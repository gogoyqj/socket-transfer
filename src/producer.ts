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

const WS_OPEN = 1;

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
      if (!closed) emitter.emit("error", err);
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
