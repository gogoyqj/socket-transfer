import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConnectionManager } from "../src/connection-manager.js";
import { Store } from "../src/store.js";
import { TransferErrorCode, RECONNECT_TIMEOUT_MS } from "../src/types.js";
import type { SocketLike } from "../src/types.js";

function mockSocket(): SocketLike & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    readyState: 1,
    sent,
    send(data) { sent.push(data); },
    close() { (this as any).readyState = 3; },
    on() {},
    off() {},
  } as any;
}

describe("ConnectionManager", () => {
  let store: Store;
  let manager: ConnectionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new Store();
    manager = new ConnectionManager(store, {
      uid: "13800138000",
      token: "a".repeat(64),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("register", () => {
    it("registers a new connection", () => {
      store.addUser("13800138000", "a".repeat(64));
      const ws = mockSocket();
      const result = manager.register("13800138000", "a".repeat(64), "c1", "agent-1", ws);
      expect(result.ok).toBe(true);
      expect(store.hasConnection("c1")).toBe(true);
    });

    it("rejects invalid uid", () => {
      const ws = mockSocket();
      const result = manager.register("bad", "a".repeat(64), "c1", "agent-1", ws);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(TransferErrorCode.AUTH_FAILED);
      }
    });

    it("rejects invalid token", () => {
      const ws = mockSocket();
      const result = manager.register("13800138000", "bad", "c1", "agent-1", ws);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(TransferErrorCode.AUTH_FAILED);
      }
    });

    it("auto-registers user on first register", () => {
      const ws = mockSocket();
      const result = manager.register("13800138000", "a".repeat(64), "c1", "agent-1", ws);
      expect(result.ok).toBe(true);
      expect(store.hasUser("13800138000")).toBe(true);
    });

    it("replaces existing connection on duplicate uuid", () => {
      store.addUser("13800138000", "a".repeat(64));
      const oldWs = mockSocket();
      const newWs = mockSocket();

      manager.register("13800138000", "a".repeat(64), "c1", "agent-1", oldWs);

      // Add a subscriber to verify takeover
      store.addSubscriber("c1", { id: "f1", send: vi.fn(), destroy: vi.fn() });

      const result = manager.register("13800138000", "a".repeat(64), "c1", "agent-2", newWs);
      expect(result.ok).toBe(true);

      const conn = store.getConnection("c1")!;
      expect(conn.ws).toBe(newWs);
      expect(conn.name).toBe("agent-2");
      // Subscribers should be taken over
      expect(store.getSubscribers("c1").has("f1")).toBe(true);
      // Old socket should be closed
      expect(oldWs.readyState).toBe(3); // CLOSED
    });
  });

  describe("disconnect and reconnect", () => {
    it("marks connection as disconnected", () => {
      store.addUser("13800138000", "a".repeat(64));
      manager.register("13800138000", "a".repeat(64), "c1", "agent-1", mockSocket());
      manager.markDisconnected("c1");

      const conn = store.getConnection("c1")!;
      expect(conn.disconnectedAt).toBeGreaterThan(0);
    });

    it("allows reconnect within timeout", () => {
      store.addUser("13800138000", "a".repeat(64));
      manager.register("13800138000", "a".repeat(64), "c1", "agent-1", mockSocket());
      manager.markDisconnected("c1");

      const newWs = mockSocket();
      const result = manager.reconnect("c1", newWs);
      expect(result.ok).toBe(true);
      expect(store.getConnection("c1")!.ws).toBe(newWs);
      expect(store.getConnection("c1")!.disconnectedAt).toBeNull();
    });

    it("rejects reconnect after timeout", () => {
      store.addUser("13800138000", "a".repeat(64));
      manager.register("13800138000", "a".repeat(64), "c1", "agent-1", mockSocket());
      manager.markDisconnected("c1");

      // Fast-forward past timeout
      vi.advanceTimersByTime(RECONNECT_TIMEOUT_MS + 1000);

      const result = manager.reconnect("c1", mockSocket());
      expect(result.ok).toBe(false);
      // Connection should be destroyed
      expect(store.hasConnection("c1")).toBe(false);
    });
  });

  describe("credentials changed (token update)", () => {
    it("updates token and notifies subscribers", () => {
      store.addUser("13800138000", "a".repeat(64));
      const ws = mockSocket();
      manager.register("13800138000", "a".repeat(64), "c1", "agent-1", ws);

      const subSend = vi.fn();
      store.addSubscriber("c1", { id: "f1", send: subSend, destroy: vi.fn() });

      // Update token
      store.addUser("13800138000", "b".repeat(64));
      manager.handleCredentialsChanged("c1");

      // Subscriber should be notified
      expect(subSend).toHaveBeenCalledWith({
        type: "transfer_break",
        data: { code: TransferErrorCode.CREDENTIALS_CHANGED },
      });
      // Subscribers should be cleared
      expect(store.getSubscribers("c1").size).toBe(0);
      // Token should be updated
      expect(store.getConnection("c1")!.token).toBe("b".repeat(64));
    });
  });

  describe("timeout cleanup", () => {
    it("destroys timed-out connections and notifies subscribers", () => {
      store.addUser("13800138000", "a".repeat(64));
      manager.register("13800138000", "a".repeat(64), "c1", "agent-1", mockSocket());

      const subSend = vi.fn();
      const subDestroy = vi.fn();
      store.addSubscriber("c1", { id: "f1", send: subSend, destroy: subDestroy });

      manager.markDisconnected("c1");

      // Fast-forward past timeout
      vi.advanceTimersByTime(RECONNECT_TIMEOUT_MS + 1000);

      manager.cleanupTimedOut();

      expect(subSend).toHaveBeenCalledWith({
        type: "transfer_break",
        data: { code: TransferErrorCode.PRODUCER_DISCONNECTED },
      });
      expect(subDestroy).toHaveBeenCalled();
      expect(store.hasConnection("c1")).toBe(false);
    });
  });
});
