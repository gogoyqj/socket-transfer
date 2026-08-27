import { Store } from "./store.js";
import { validateUid, validateToken } from "./auth.js";
import { TransferErrorCode, RECONNECT_TIMEOUT_MS } from "./types.js";
import type { SocketLike } from "./types.js";

type RegisterResult = { ok: true } | { ok: false; code: TransferErrorCode };
type ReconnectResult = { ok: true } | { ok: false; code: TransferErrorCode };

/**
 * Manages connection lifecycle: register, reconnect, timeout cleanup,
 * and credential-change handling.
 */
export class ConnectionManager {
  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  /**
   * Register a new connection (producer).
   * Anonymous registration — user is auto-added to store if not exists.
   * If uuid already exists, replaces the old connection and takes over subscribers.
   */
  register(
    uid: string,
    token: string,
    uuid: string,
    name: string,
    ws: SocketLike
  ): RegisterResult {
    // Validate format
    if (!validateUid(uid) || !validateToken(token)) {
      return { ok: false, code: TransferErrorCode.AUTH_FAILED };
    }

    // Auto-register user if not exists
    if (!this.store.hasUser(uid)) {
      this.store.addUser(uid, token);
    }

    // Duplicate uuid: replace old connection, take over subscribers
    if (this.store.hasConnection(uuid)) {
      this.store.replaceConnectionWs(uuid, ws);
      const conn = this.store.getConnection(uuid)!;
      conn.name = name;
      conn.uid = uid;
      conn.token = token;
    } else {
      this.store.createConnection(uuid, name, uid, token, ws);
    }

    return { ok: true };
  }

  /** Mark a connection as disconnected (producer dropped). */
  markDisconnected(uuid: string): void {
    this.store.markDisconnected(uuid);
  }

  /**
   * Attempt reconnect for a disconnected connection.
   * Fails if timed out (connection already destroyed).
   */
  reconnect(uuid: string, ws: SocketLike): ReconnectResult {
    const conn = this.store.getConnection(uuid);
    if (!conn) {
      return { ok: false, code: TransferErrorCode.SUBSCRIBE_FAILED };
    }

    // Check if timed out
    if (this.store.isTimedOut(uuid)) {
      this.destroyConnection(uuid, TransferErrorCode.PRODUCER_DISCONNECTED);
      return { ok: false, code: TransferErrorCode.PRODUCER_DISCONNECTED };
    }

    this.store.replaceConnectionWs(uuid, ws);
    return { ok: true };
  }

  /**
   * Handle credential change: producer reconnects with a new token.
   * Updates token, notifies subscribers with code 10004, clears subscribers.
   */
  handleCredentialsChanged(uuid: string): void {
    const conn = this.store.getConnection(uuid);
    if (!conn) return;

    // Get the latest token from the user store
    const latestToken = this.store.getUserToken(conn.uid);
    if (latestToken) {
      conn.token = latestToken;
    }

    // Notify all subscribers
    const subscribers = this.store.getSubscribers(uuid);
    for (const fwd of subscribers.values()) {
      try {
        fwd.send({
          type: "transfer_break",
          data: { code: TransferErrorCode.CREDENTIALS_CHANGED },
        });
      } catch { /* ignore send errors */ }
      fwd.destroy();
    }

    // Clear subscribers
    this.store.clearSubscribers(uuid);
  }

  /**
   * Immediately notify subscribers that the producer disconnected.
   * Sends transfer_break(10001) to all subscribers and clears them.
   * The connection stays for 5 minutes to allow reconnect.
   */
  notifyProducerDisconnected(uuid: string): void {
    const subscribers = this.store.getSubscribers(uuid);
    for (const fwd of subscribers.values()) {
      try {
        fwd.send(JSON.stringify({
          type: "transfer_break",
          data: { code: TransferErrorCode.PRODUCER_DISCONNECTED },
        }));
      } catch { /* ignore send errors */ }
      fwd.destroy();
    }
    this.store.clearSubscribers(uuid);
  }

  /**
   * Cleanup all timed-out connections.
   * For each timed-out connection: notify subscribers, destroy forwarders, remove connection.
   */
  cleanupTimedOut(): void {
    const timedOut: string[] = [];

    for (const [uuid, conn] of (this.store as any).connections as Map<string, any>) {
      if (conn.disconnectedAt !== null && this.store.isTimedOut(uuid)) {
        timedOut.push(uuid);
      }
    }

    for (const uuid of timedOut) {
      this.destroyConnection(uuid, TransferErrorCode.PRODUCER_DISCONNECTED);
    }
  }

  /**
   * Destroy a connection: notify subscribers, destroy forwarders, remove from store.
   */
  private destroyConnection(uuid: string, code: TransferErrorCode): void {
    const subscribers = this.store.getSubscribers(uuid);
    for (const fwd of subscribers.values()) {
      try {
        fwd.send({
          type: "transfer_break",
          data: { code },
        });
      } catch { /* ignore send errors */ }
      fwd.destroy();
    }

    this.store.clearSubscribers(uuid);
    this.store.removeConnection(uuid);
  }
}
