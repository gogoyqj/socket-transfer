import type {
  TransferListItem,
  TransferErrorCode,
  ServerMessage,
  UserCredential,
} from "./types.js";

// ===== UUID Generation =====

const UUID_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate a deterministic UUID from an ID string, rotating every 5 minutes.
 * hash(id + timeWindow) → same ID + same 5-min window → same UUID.
 * Survives process restarts as long as `id` doesn't change.
 */
export function generateWindowedUuid(id: string): string {
  const window = Math.floor(Date.now() / UUID_WINDOW_MS) * UUID_WINDOW_MS;
  const input = `${id}:${window}`;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHash } = require("node:crypto");
    return createHash("sha256").update(input).digest("hex").slice(0, 32);
  } catch {
    // Browser fallback: simple FNV-1a hash → hex
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    const hex = hash.toString(16).padStart(8, "0");
    return `${hex}${hex}${hex}${hex}`; // 32 chars
  }
}

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
    // Wrap addEventListener-style API to .on-style
    const handlers = new Map<string, Function[]>();
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

const WS_OPEN = 1; // Both ws and native WebSocket use readyState=1 for OPEN

// ===== Producer (电脑端) =====

export interface ProducerOptions {
  url: string;
  uid: string;
  token: string;
  /** Stable identifier for deterministic UUID generation. Same id + same 5-min window → same uuid. */
  id?: string;
  /** Connection name (e.g. agent name). Default: "producer" */
  name?: string;
  /** Auto-reconnect on disconnect. Default: true */
  reconnect?: boolean;
  /** Reconnect delay in ms. Default: 3000 */
  reconnectDelay?: number;
}

export interface ProducerChannel {
  /** Send a message to this specific consumer */
  send(message: unknown): void;
  /** The consumer's unique identifier */
  readonly cuuid: string;
}

export interface Producer {
  /** Send a message to all subscribed consumers */
  send(message: unknown): void;
  /** Send a message to a specific consumer by cuuid */
  sendTo(cuuid: string, message: unknown): void;
  /** Get a per-consumer channel for automatic routing */
  channel(cuuid: string): ProducerChannel;
  /** Listen for messages from consumers */
  onMessage(callback: (message: unknown) => void): () => void;
  /** Listen for errors */
  onError(callback: (error: Error) => void): () => void;
  /** Listen for connection state changes */
  onStateChange(callback: (state: ProducerState) => void): () => void;
  /** Close the connection */
  close(): void;
  /** Whether currently connected to the relay server */
  readonly connected: boolean;
  /** The auto-generated producer connection uuid */
  readonly uuid: string;
}

export type ProducerState = "connecting" | "connected" | "disconnected" | "closed";

export function createProducer(options: ProducerOptions): Producer {
  const {
    url,
    uid,
    token,
    id,
    name = "producer",
    reconnect = true,
    reconnectDelay = 3000,
  } = options;

  // Generate deterministic uuid: same id + same 5-min window → same uuid
  // Falls back to a random id if not provided (unique per instance)
  const uuid = generateWindowedUuid(id ?? Math.random().toString(36).slice(2, 10));

  const emitter = new Emitter();
  let ws: any = null;
  let state: ProducerState = "disconnected";
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function setState(s: ProducerState) {
    state = s;
    emitter.emit("stateChange", s);
  }

  function connect() {
    if (closed) return;
    setState("connecting");

    ws = createSocket(url);

    ws.on("open", () => {
      setState("connected");
      ws.send(JSON.stringify({
        type: "register_transfer",
        uid,
        token,
        uuid,
        name,
      }));
    });

    ws.on("message", (data: unknown) => {
      try {
        const msg = JSON.parse(typeof data === "string" ? data : data!.toString());
        if (msg.type === "transfer_break") {
          emitter.emit("error", new Error(`Transfer break: code ${msg.data?.code}`));
          return;
        }
        if (msg.type === "transfer_error") {
          emitter.emit("error", new Error(`Transfer error: ${msg.data?.message}`));
          return;
        }
        emitter.emit("message", msg);
      } catch {
        // Invalid JSON, ignore
      }
    });

    ws.on("close", () => {
      if (closed) return;
      setState("disconnected");
      if (reconnect) {
        reconnectTimer = setTimeout(connect, reconnectDelay);
      }
    });

    ws.on("error", (err: unknown) => {
      if (!closed) emitter.emit("error", err instanceof Error ? err : new Error(String(err)));
    });
  }

  connect();

  return {
    send(message: unknown) {
      if (!ws || ws.readyState !== WS_OPEN) {
        throw new Error("Producer is not connected");
      }
      ws.send(JSON.stringify({
        type: "transfer_produce",
        data: { uuid, message },
      }));
    },

    sendTo(cuuid: string, message: unknown) {
      if (!ws || ws.readyState !== WS_OPEN) {
        throw new Error("Producer is not connected");
      }
      ws.send(JSON.stringify({
        type: "transfer_produce",
        data: { uuid, targetConsumer: cuuid, message },
      }));
    },

    channel(cuuid: string): ProducerChannel {
      return {
        cuuid,
        send: (message: unknown) => this.sendTo(cuuid, message),
      };
    },

    onMessage(callback: (message: unknown) => void) {
      emitter.on("message", callback);
      return () => emitter.off("message", callback);
    },

    onError(callback: (error: Error) => void) {
      emitter.on("error", callback);
      return () => emitter.off("error", callback);
    },

    onStateChange(callback: (state: ProducerState) => void) {
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

    get uuid() {
      return uuid;
    },
  };
}

// ===== Consumer (手机端) =====

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

  // Auto-generate consumer cuuid
  const cuuid = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const emitter = new Emitter();
  let ws: any = null;
  let state: ConsumerState = "disconnected";
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentPuuid: string | null = null;
  let lastSubscribedPuuid: string | null = null; // For 10004 auto-resubscribe

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

  /** Internal listConnections — used by 10004 auto-recovery. */
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

  /** Internal subscribe — used by 10004 auto-recovery. */
  function subscribeInternal(uuid: string) {
    sendMsg({ type: "subscribe_transfer", uid, token, uuid, cuuid });
  }

  /**
   * 10004 auto-recovery: re-list connections and resubscribe.
   * Tries the previously subscribed uuid first; falls back to the first available.
   */
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

    ws.on("open", () => {
      setState("connected");
    });

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
              // Credentials changed → auto re-auth and resubscribe
              handleCredentialsChanged(oldPuuid);
            } else {
              // Other breaks (10001, 10002, 10003) → clear remembered uuid
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
      if (!closed) emitter.emit("error", err instanceof Error ? err : new Error(String(err)));
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
