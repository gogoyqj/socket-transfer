import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "../src/store.js";
import type { SocketLike } from "../src/types.js";

function mockSocket(): SocketLike {
  const listeners: Record<string, Function[]> = {};
  return {
    readyState: 1, // OPEN
    send: () => {},
    close: () => {},
    on(event, fn) { (listeners[event] ??= []).push(fn); },
    off(event, fn) { listeners[event] = (listeners[event] ?? []).filter(f => f !== fn); },
  };
}

describe("Store", () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  // ===== User Credentials =====

  describe("users", () => {
    it("add and verify user credential", () => {
      store.addUser("13800138000", "token-abc");
      expect(store.verifyUser("13800138000", "token-abc")).toBe(true);
    });

    it("reject wrong token", () => {
      store.addUser("13800138000", "token-abc");
      expect(store.verifyUser("13800138000", "wrong")).toBe(false);
    });

    it("reject unknown uid", () => {
      expect(store.verifyUser("unknown", "token-abc")).toBe(false);
    });

    it("update token for existing uid", () => {
      store.addUser("13800138000", "old-token");
      store.addUser("13800138000", "new-token");
      expect(store.verifyUser("13800138000", "old-token")).toBe(false);
      expect(store.verifyUser("13800138000", "new-token")).toBe(true);
    });

    it("hasUser returns true/false correctly", () => {
      expect(store.hasUser("13800138000")).toBe(false);
      store.addUser("13800138000", "token-abc");
      expect(store.hasUser("13800138000")).toBe(true);
      expect(store.hasUser("other")).toBe(false);
    });
  });

  // ===== Connections =====

  describe("connections", () => {
    it("create and get connection", () => {
      const ws = mockSocket();
      store.createConnection("conn-1", "agent", "13800138000", "token-abc", ws);
      const conn = store.getConnection("conn-1");
      expect(conn).toBeDefined();
      expect(conn!.uuid).toBe("conn-1");
      expect(conn!.name).toBe("agent");
      expect(conn!.uid).toBe("13800138000");
      expect(conn!.ws).toBe(ws);
      expect(conn!.disconnectedAt).toBeNull();
    });

    it("get connections by user", () => {
      store.createConnection("c1", "a1", "u1", "t1", mockSocket());
      store.createConnection("c2", "a2", "u1", "t1", mockSocket());
      store.createConnection("c3", "a3", "u2", "t2", mockSocket());

      const list = store.getConnectionsByUser("u1", "t1");
      expect(list).toHaveLength(2);
      expect(list.map(c => c.uuid).sort()).toEqual(["c1", "c2"]);
    });

    it("get connections by user filters token too", () => {
      store.createConnection("c1", "a1", "u1", "t1", mockSocket());
      store.createConnection("c2", "a2", "u1", "t2", mockSocket());

      const list = store.getConnectionsByUser("u1", "t1");
      expect(list).toHaveLength(1);
      expect(list[0].uuid).toBe("c1");
    });

    it("remove connection", () => {
      store.createConnection("c1", "a1", "u1", "t1", mockSocket());
      store.removeConnection("c1");
      expect(store.getConnection("c1")).toBeUndefined();
    });

    it("replace connection ws (reconnect scenario)", () => {
      const oldWs = mockSocket();
      const newWs = mockSocket();
      store.createConnection("c1", "a1", "u1", "t1", oldWs);

      const conn = store.replaceConnectionWs("c1", newWs);
      expect(conn).toBeDefined();
      expect(conn!.ws).toBe(newWs);
      expect(conn!.disconnectedAt).toBeNull();
    });

    it("mark disconnected and check timeout", () => {
      store.createConnection("c1", "a1", "u1", "t1", mockSocket());
      store.markDisconnected("c1");

      const conn = store.getConnection("c1");
      expect(conn!.disconnectedAt).toBeGreaterThan(0);

      // Not timed out yet
      expect(store.isTimedOut("c1", 5 * 60 * 1000)).toBe(false);
    });

    it("detect timed out connection", () => {
      store.createConnection("c1", "a1", "u1", "t1", mockSocket());
      // Manually set disconnectedAt to long ago
      const conn = store.getConnection("c1")!;
      conn.disconnectedAt = Date.now() - 10 * 60 * 1000;

      expect(store.isTimedOut("c1", 5 * 60 * 1000)).toBe(true);
    });

    it("uuid exists check", () => {
      expect(store.hasConnection("c1")).toBe(false);
      store.createConnection("c1", "a1", "u1", "t1", mockSocket());
      expect(store.hasConnection("c1")).toBe(true);
    });
  });

  // ===== Subscribers =====

  describe("subscribers", () => {
    it("add and get subscribers", () => {
      store.createConnection("c1", "a1", "u1", "t1", mockSocket());

      const fwd1 = { id: "f1", send: () => {}, destroy: () => {} };
      const fwd2 = { id: "f2", send: () => {}, destroy: () => {} };

      store.addSubscriber("c1", fwd1);
      store.addSubscriber("c1", fwd2);

      const subs = store.getSubscribers("c1");
      expect(subs.size).toBe(2);
      expect(subs.has("f1")).toBe(true);
      expect(subs.has("f2")).toBe(true);
    });

    it("remove subscriber", () => {
      store.createConnection("c1", "a1", "u1", "t1", mockSocket());
      store.addSubscriber("c1", { id: "f1", send: () => {}, destroy: () => {} });
      store.addSubscriber("c1", { id: "f2", send: () => {}, destroy: () => {} });

      store.removeSubscriber("c1", "f1");
      const subs = store.getSubscribers("c1");
      expect(subs.size).toBe(1);
      expect(subs.has("f2")).toBe(true);
    });

    it("clear subscribers", () => {
      store.createConnection("c1", "a1", "u1", "t1", mockSocket());
      store.addSubscriber("c1", { id: "f1", send: () => {}, destroy: () => {} });
      store.addSubscriber("c1", { id: "f2", send: () => {}, destroy: () => {} });

      store.clearSubscribers("c1");
      expect(store.getSubscribers("c1").size).toBe(0);
    });

    it("get subscribers for nonexistent connection returns empty", () => {
      expect(store.getSubscribers("nonexistent").size).toBe(0);
    });
  });
});
