import type { Forwarder, SocketLike, TransferListItem } from "./types.js";
import { RECONNECT_TIMEOUT_MS } from "./types.js";

export interface Connection {
  uuid: string;
  name: string;
  uid: string;
  token: string;
  ws: SocketLike;
  subscribers: Map<string, Forwarder>;
  disconnectedAt: number | null;
}

/**
 * In-memory store for connections, user credentials, and subscribers.
 */
export class Store {
  /** uid → token */
  private users = new Map<string, string>();

  /** uuid → Connection */
  private connections = new Map<string, Connection>();

  // ===== User Credentials =====

  hasUser(uid: string): boolean {
    return this.users.has(uid);
  }

  addUser(uid: string, token: string): void {
    this.users.set(uid, token);
  }

  verifyUser(uid: string, token: string): boolean {
    return this.users.get(uid) === token;
  }

  /** Get the current token for a uid (used for credential-change detection). */
  getUserToken(uid: string): string | undefined {
    return this.users.get(uid);
  }

  // ===== Connections =====

  createConnection(
    uuid: string,
    name: string,
    uid: string,
    token: string,
    ws: SocketLike
  ): Connection {
    const conn: Connection = {
      uuid,
      name,
      uid,
      token,
      ws,
      subscribers: new Map(),
      disconnectedAt: null,
    };
    this.connections.set(uuid, conn);
    return conn;
  }

  getConnection(uuid: string): Connection | undefined {
    return this.connections.get(uuid);
  }

  hasConnection(uuid: string): boolean {
    return this.connections.has(uuid);
  }

  getConnectionsByUser(uid: string, token: string): Connection[] {
    const result: Connection[] = [];
    for (const conn of this.connections.values()) {
      if (conn.uid === uid && conn.token === token) {
        result.push(conn);
      }
    }
    return result;
  }

  removeConnection(uuid: string): void {
    this.connections.delete(uuid);
  }

  /** Replace ws on existing connection (reconnect / duplicate uuid takeover). */
  replaceConnectionWs(uuid: string, newWs: SocketLike): Connection | undefined {
    const conn = this.connections.get(uuid);
    if (!conn) return undefined;

    // Close old socket if still open
    if (conn.ws.readyState === 1) {
      try { conn.ws.close(); } catch { /* ignore */ }
    }

    conn.ws = newWs;
    conn.disconnectedAt = null;
    return conn;
  }

  markDisconnected(uuid: string): void {
    const conn = this.connections.get(uuid);
    if (conn) {
      conn.disconnectedAt = Date.now();
    }
  }

  isTimedOut(uuid: string, timeoutMs: number = RECONNECT_TIMEOUT_MS): boolean {
    const conn = this.connections.get(uuid);
    if (!conn || conn.disconnectedAt === null) return false;
    return Date.now() - conn.disconnectedAt > timeoutMs;
  }

  // ===== Subscribers =====

  addSubscriber(uuid: string, forwarder: Forwarder): void {
    const conn = this.connections.get(uuid);
    if (conn) {
      conn.subscribers.set(forwarder.id, forwarder);
    }
  }

  removeSubscriber(uuid: string, cuuid: string): void {
    const conn = this.connections.get(uuid);
    if (conn) {
      conn.subscribers.delete(cuuid);
    }
  }

  getSubscribers(uuid: string): Map<string, Forwarder> {
    const conn = this.connections.get(uuid);
    return conn?.subscribers ?? new Map();
  }

  clearSubscribers(uuid: string): void {
    const conn = this.connections.get(uuid);
    if (conn) {
      conn.subscribers.clear();
    }
  }
}
