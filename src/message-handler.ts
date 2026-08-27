import { Store } from "./store.js";
import { validateUid, validateToken, isValidMessageSize } from "./auth.js";
import { createForwarder } from "./forwarder.js";
import { TransferErrorCode } from "./types.js";
import type {
  ClientMessage,
  SocketLike,
  TransferListItem,
} from "./types.js";

type HandleResult =
  | { ok: true; list?: TransferListItem[]; uuid?: string }
  | { ok: false; code: TransferErrorCode }
  | undefined;

/** Role tracked per socket, determined at registration/subscription time. */
type SocketRole =
  | { role: "producer"; uuid: string }
  | { role: "consumer"; uuid: string; cuuid: string };

/**
 * Routes incoming socket messages to the appropriate handler.
 * Tracks socket roles (producer/consumer) for clean disconnect handling.
 */
export class MessageHandler {
  private store: Store;
  /** ws → role, established at register/subscribe time */
  private socketRoles = new Map<SocketLike, SocketRole>();

  constructor(store: Store) {
    this.store = store;
  }

  /**
   * Parse and route an incoming message from a socket.
   * Returns a result for testing; side-effects (sending responses) happen inline.
   */
  handleMessage(ws: SocketLike, raw: unknown): HandleResult {
    const msg = raw as ClientMessage;
    if (!msg || typeof msg !== "object" || !("type" in msg)) return undefined;

    switch (msg.type) {
      case "register_transfer":
        return this.handleRegister(ws, msg);
      case "list_transfer":
        return this.handleList(ws, msg);
      case "subscribe_transfer":
        return this.handleSubscribe(ws, msg);
      case "transfer_produce":
        return this.handleProduce(ws, msg);
      case "transfer_consume":
        return this.handleConsume(ws, msg);
      default:
        return undefined;
    }
  }

  /**
   * Handle socket close. Determines role from registration and executes
   * the appropriate cleanup:
   * - producer → calls onProducerClose(uuid) for downstream cleanup
   * - consumer → removes its forwarder from subscribers
   */
  handleClose(ws: SocketLike, onProducerClose?: (uuid: string) => void): void {
    const role = this.socketRoles.get(ws);
    if (!role) return; // Unknown socket, nothing to clean up
    this.socketRoles.delete(ws);

    if (role.role === "producer") {
      // Producer disconnected → caller handles downstream (notify subscribers, etc.)
      if (onProducerClose) onProducerClose(role.uuid);
    } else {
      // Consumer disconnected → clean up its forwarder from subscribers
      const { uuid, cuuid } = role;
      const fwd = this.store.getSubscribers(uuid).get(cuuid);
      if (fwd) fwd.destroy();
      this.store.removeSubscriber(uuid, cuuid);
    }
  }

  // ===== Private handlers =====

  private handleRegister(
    ws: SocketLike,
    msg: { uid: string; token: string; uuid: string; name: string }
  ): HandleResult {
    if (!validateUid(msg.uid) || !validateToken(msg.token)) {
      this.sendError(ws, TransferErrorCode.AUTH_FAILED, msg.uuid);
      return { ok: false, code: TransferErrorCode.AUTH_FAILED };
    }

    // Register user if not exists (producer 注册时自动入库)
    if (!this.store.hasUser(msg.uid)) {
      this.store.addUser(msg.uid, msg.token);
    }

    // Duplicate uuid: replace old connection
    if (this.store.hasConnection(msg.uuid)) {
      const oldConn = this.store.getConnection(msg.uuid)!;
      const tokenChanged = oldConn.token !== msg.token;

      this.store.replaceConnectionWs(msg.uuid, ws);
      const conn = this.store.getConnection(msg.uuid)!;
      conn.name = msg.name;
      conn.uid = msg.uid;
      conn.disconnectedAt = null;

      if (tokenChanged) {
        // Token changed → notify existing subscribers with 10004, then clear
        const subscribers = this.store.getSubscribers(msg.uuid);
        for (const fwd of subscribers.values()) {
          try {
            fwd.send(JSON.stringify({
              type: "transfer_break",
              data: { uuid: msg.uuid, code: TransferErrorCode.CREDENTIALS_CHANGED },
            }));
          } catch { /* ignore */ }
          fwd.destroy();
        }
        this.store.clearSubscribers(msg.uuid);
      }

      conn.token = msg.token;
    } else {
      this.store.createConnection(msg.uuid, msg.name, msg.uid, msg.token, ws);
    }

    // Record role: this socket is a producer
    this.socketRoles.set(ws, { role: "producer", uuid: msg.uuid });

    return { ok: true };
  }

  private handleList(
    ws: SocketLike,
    msg: { uid: string; token: string }
  ): HandleResult {
    if (!validateUid(msg.uid) || !validateToken(msg.token)) {
      this.sendError(ws, TransferErrorCode.AUTH_FAILED);
      return { ok: false, code: TransferErrorCode.AUTH_FAILED };
    }

    if (!this.store.verifyUser(msg.uid, msg.token)) {
      this.sendError(ws, TransferErrorCode.AUTH_FAILED);
      return { ok: false, code: TransferErrorCode.AUTH_FAILED };
    }

    const connections = this.store.getConnectionsByUser(msg.uid, msg.token);
    const list: TransferListItem[] = connections.map(c => ({
      uuid: c.uuid,
      name: c.name,
    }));

    ws.send(JSON.stringify({ type: "transfer_list", data: { list } }));
    return { ok: true, list };
  }

  private handleSubscribe(
    ws: SocketLike,
    msg: { uid: string; token: string; uuid: string; cuuid: string }
  ): HandleResult {
    if (!validateUid(msg.uid) || !validateToken(msg.token)) {
      this.sendBreak(ws, TransferErrorCode.SUBSCRIBE_FAILED, msg.uuid);
      return { ok: false, code: TransferErrorCode.AUTH_FAILED };
    }

    if (!this.store.verifyUser(msg.uid, msg.token)) {
      this.sendBreak(ws, TransferErrorCode.SUBSCRIBE_FAILED, msg.uuid);
      return { ok: false, code: TransferErrorCode.AUTH_FAILED };
    }

    const conn = this.store.getConnection(msg.uuid);
    if (!conn) {
      this.sendBreak(ws, TransferErrorCode.SUBSCRIBE_FAILED, msg.uuid);
      return { ok: false, code: TransferErrorCode.SUBSCRIBE_FAILED };
    }

    // Check if this consumer ws already has a subscription to this uuid
    const existing = this.socketRoles.get(ws);
    if (existing && existing.role === "consumer" && existing.uuid === msg.uuid) {
      // Already subscribed — just re-send connect event
      ws.send(JSON.stringify({ type: "transfer_connect", data: { uuid: msg.uuid } }));
      return { ok: true, uuid: msg.uuid };
    }

    // Create forwarder using consumer's cuuid as the forwarder ID
    const fwd = createForwarder(msg.cuuid, ws, (data) => {
      // Forward consumer data to producer
      if (conn.ws.readyState === 1) {
        conn.ws.send(data);
      }
    });

    this.store.addSubscriber(msg.uuid, fwd);

    // Record role: this socket is a consumer
    this.socketRoles.set(ws, { role: "consumer", uuid: msg.uuid, cuuid: msg.cuuid });

    ws.send(JSON.stringify({ type: "transfer_connect", data: { uuid: msg.uuid } }));
    return { ok: true, uuid: msg.uuid };
  }

  private handleProduce(
    ws: SocketLike,
    msg: { data: { uuid: string; targetConsumer?: string; message: unknown } }
  ): HandleResult {
    if (!isValidMessageSize(msg.data.message)) {
      ws.send(JSON.stringify({
        type: "transfer_error",
        data: { code: TransferErrorCode.MESSAGE_TOO_LARGE, message: "message too large" },
      }));
      return { ok: false, code: TransferErrorCode.MESSAGE_TOO_LARGE };
    }

    const conn = this.store.getConnection(msg.data.uuid);
    if (!conn) return undefined;

    const messageStr = JSON.stringify(msg.data.message);
    const subscribers = this.store.getSubscribers(msg.data.uuid);

    if (msg.data.targetConsumer) {
      // 定向路由：只发给目标 consumer
      const fwd = subscribers.get(msg.data.targetConsumer);
      if (fwd) {
        try {
          fwd.send(messageStr);
        } catch { /* ignore send errors on dead forwarders */ }
      }
    } else {
      // 广播：发给所有 subscribers
      for (const fwd of subscribers.values()) {
        try {
          fwd.send(messageStr);
        } catch { /* ignore send errors on dead forwarders */ }
      }
    }

    return undefined;
  }

  private handleConsume(
    ws: SocketLike,
    msg: { data: { uuid: string; message: unknown } }
  ): HandleResult {
    if (!isValidMessageSize(msg.data.message)) {
      ws.send(JSON.stringify({
        type: "transfer_error",
        data: { code: TransferErrorCode.MESSAGE_TOO_LARGE, message: "message too large" },
      }));
      return { ok: false, code: TransferErrorCode.MESSAGE_TOO_LARGE };
    }

    const conn = this.store.getConnection(msg.data.uuid);
    if (!conn) return undefined;

    // 注入 cuuid 后转发给 Producer
    const role = this.socketRoles.get(ws);
    const cuuid = role?.role === "consumer" ? role.cuuid : undefined;

    const forwarded = {
      uuid: msg.data.uuid,
      ...(cuuid ? { cuuid } : {}),
      message: msg.data.message,
    };

    // Forward directly to producer
    if (conn.ws.readyState === 1) {
      conn.ws.send(JSON.stringify(forwarded));
    }

    return undefined;
  }

  // ===== Helpers =====

  private sendError(ws: SocketLike, code: TransferErrorCode, uuid?: string): void {
    ws.send(JSON.stringify({
      type: "transfer_break",
      data: uuid ? { uuid, code } : { code },
    }));
  }

  private sendBreak(ws: SocketLike, code: TransferErrorCode, uuid?: string): void {
    ws.send(JSON.stringify({
      type: "transfer_break",
      data: uuid ? { uuid, code } : { code },
    }));
  }
}
