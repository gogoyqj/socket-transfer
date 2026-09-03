import type {
  TransferListItem,
  TransferErrorCode,
  ServerMessage,
} from "./types.js";

// ===== Cross-platform abstractions =====

/** Simple event emitter, works in both Node.js and browser. */
class Emitter {
  private listeners = new Map<string, Set<Function>>();

  on(event: string, fn: Function): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }

  off(event: string, fn: Function): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const fn of this.listeners.get(event) ?? []) {
      try { fn(...args); } catch { /* ignore listener errors */ }
    }
  }
}

/**
 * Create a WebSocket instance. Uses `ws` package in Node.js,
 * native WebSocket in browser. Both expose the same .on/.send/.close API.
 */
function createSocket(url: string): any {
  // Browser: native WebSocket
  if (typeof globalThis.WebSocket !== "undefined") {
    const ws = new globalThis.WebSocket(url);
    const origOn = (evt: string, fn: Function) => {
      ws.addEventListener(evt, (e: any) => fn(e.data ?? e));
    };
    return {
      on(evt: string, fn: Function) { origOn(evt, fn); },
      off() { /* browser WS doesn't support off, close cleans up */ },
      send(data: unknown) { ws.send(data as string); },
      close() { ws.close(); },
      get readyState() { return ws.readyState; },
      OPEN: 1,
    };
  }
  // Node.js: ws package
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const WS = require("ws");
  const ws = new WS(url);
  return ws;
}

const WS_OPEN = 1;

export interface ConsumerOptions {
  url: string;
  uid: string;
  token: string;
  /** Auto-reconnect on disconnect. Default: true */
  reconnect?: boolean;
  /** Reconnect delay in ms. Default: 3000 */
  reconnectDelay?: number;
}

export interface Consumer {
  /** List available connections for this credential */
  listConnections(): Promise<TransferListItem[]>;
  /** Subscribe to a specific connection */
  subscribe(uuid: string): void;
  /** Send a message to the subscribed producer */
  send(message: unknown): void;
  /** Listen for messages from the producer */
  onMessage(callback: (message: unknown) => void): () => void;
  /** Listen for transfer_connect events */
  onConnect(callback: (uuid: string) => void): () => void;
  /** Listen for transfer_break events */
  onBreak(callback: (code: TransferErrorCode) => void): () => void;
  /** Listen for errors */
  onError(callback: (error: Error) => void): () => void;
  /** Listen for connection state changes */
  onStateChange(callback: (state: ConsumerState) => void): () => void;
  /** Close the connection */
  close(): void;
  /** Whether currently connected to the relay server */
  readonly connected: boolean;
  /** Currently subscribed uuid, if any */
  readonly subscribedUuid: string | null;
  /** Auto-generated consumer unique ID */
  readonly cuuid: string;
}

export type ConsumerState = "connecting" | "connected" | "disconnected" | "closed";

export function createConsumer(options: ConsumerOptions): Consumer {
  const {
    url,
    uid,
    token,
    reconnect = true,
    reconnectDelay = 3000,
  } = options;

  const cuuid = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const emitter = new Emitter();
  let ws: any = null;
  let state: ConsumerState = "disconnected";
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentPuuid: string | null = null;
  let lastSubscribedPuuid: string | null = null;

  let pendingList: {
    resolve: (list: TransferListItem[]) => void;
    reject: (err: Error) => void;
  } | null = null;

  function setState(s: ConsumerState) {
    state = s;
    emitter.emit("stateChange", s);
  }

  function sendMsg(msg: unknown) {
    if (!ws || ws.readyState !== WS_OPEN) {
      throw new Error("Consumer is not connected");
    }
    ws.send(JSON.stringify(msg));
  }

  function listConnectionsInternal(): Promise<TransferListItem[]> {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WS_OPEN) {
        reject(new Error("Consumer is not connected"));
        return;
      }
      pendingList = { resolve, reject };
      sendMsg({ type: "list_transfer", uid, token, cuuid });
    });
  }

  function subscribeInternal(uuid: string) {
    sendMsg({ type: "subscribe_transfer", uid, token, uuid, cuuid });
  }

  async function handleCredentialsChanged(oldPuuid: string) {
    try {
      const list = await listConnectionsInternal();
      if (list.length === 0) return;

      const target = list.find(c => c.uuid === oldPuuid) ?? list[0]!;
      subscribeInternal(target.uuid);
    } catch {
      // List failed — will retry on next reconnect
    }
  }

  function connect() {
    if (closed) return;
    setState("connecting");

    ws = createSocket(url);

    ws.on("open", () => setState("connected"));

    ws.on("message", (data: unknown) => {
      try {
        const msg = JSON.parse(typeof data === "string" ? data : data!.toString()) as ServerMessage | { type: string; data?: any };

        switch (msg.type) {
          case "transfer_list":
            if (pendingList) {
              pendingList.resolve(msg.data!.list);
              pendingList = null;
            }
            break;

          case "transfer_connect":
            currentPuuid = msg.data!.uuid;
            lastSubscribedPuuid = msg.data!.uuid;
            emitter.emit("connect", msg.data!.uuid);
            break;

          case "transfer_break": {
            const code = msg.data!.code as number;
            const oldPuuid = lastSubscribedPuuid;
            currentPuuid = null;

            if (code === 10004 && oldPuuid) {
              handleCredentialsChanged(oldPuuid);
            } else {
              lastSubscribedPuuid = null;
            }

            emitter.emit("break", code);
            break;
          }

          case "transfer_error":
            emitter.emit("error", new Error(`Transfer error: ${msg.data!.message}`));
            break;

          default:
            emitter.emit("message", msg);
            break;
        }
      } catch {
        // Invalid JSON, ignore
      }
    });

    ws.on("close", () => {
      if (closed) return;
      setState("disconnected");
      if (pendingList) {
        pendingList.reject(new Error("Connection closed"));
        pendingList = null;
      }
      if (reconnect) {
        reconnectTimer = setTimeout(connect, reconnectDelay);
      }
    });

    ws.on("error", (err: unknown) => {
      if (!closed) emitter.emit("error", err);
    });
  }

  connect();

  return {
    listConnections(): Promise<TransferListItem[]> {
      return listConnectionsInternal();
    },

    subscribe(uuid: string) {
      subscribeInternal(uuid);
    },

    send(message: unknown) {
      if (!currentPuuid) {
        throw new Error("Not subscribed to any connection");
      }
      sendMsg({
        type: "transfer_consume",
        data: { uuid: currentPuuid, cuuid, message },
      });
    },

    onMessage(callback: (message: unknown) => void) {
      emitter.on("message", callback);
      return () => emitter.off("message", callback);
    },

    onConnect(callback: (uuid: string) => void) {
      emitter.on("connect", callback);
      return () => emitter.off("connect", callback);
    },

    onBreak(callback: (code: TransferErrorCode) => void) {
      emitter.on("break", callback);
      return () => emitter.off("break", callback);
    },

    onError(callback: (error: Error) => void) {
      emitter.on("error", callback);
      return () => emitter.off("error", callback);
    },

    onStateChange(callback: (state: ConsumerState) => void) {
      emitter.on("stateChange", callback);
      return () => emitter.off("stateChange", callback);
    },

    close() {
      if (closed) return;
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
      setState("closed");
    },

    get connected() {
      return state === "connected";
    },

    get subscribedUuid() {
      return currentPuuid;
    },

    get cuuid() {
      return cuuid;
    },
  };
}
