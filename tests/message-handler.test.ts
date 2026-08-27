import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageHandler } from "../src/message-handler.js";
import { Store } from "../src/store.js";
import { TransferErrorCode } from "../src/types.js";
import type { SocketLike } from "../src/types.js";

function mockSocket(): SocketLike & { sent: unknown[] } {
  const sent: unknown[] = [];
  const listeners: Record<string, Function[]> = {};
  return {
    readyState: 1,
    sent,
    send(data) {
      // Auto-parse JSON strings for easier assertions
      try { sent.push(JSON.parse(data as string)); } catch { sent.push(data); }
    },
    close() { (this as any).readyState = 3; },
    on(event, fn) { (listeners[event] ??= []).push(fn); },
    off(event, fn) { listeners[event] = (listeners[event] ?? []).filter(f => f !== fn); },
    _emit(event: string, ...args: unknown[]) {
      for (const fn of listeners[event] ?? []) fn(...args);
    },
  } as any;
}

describe("MessageHandler", () => {
  let store: Store;
  let handler: MessageHandler;

  beforeEach(() => {
    store = new Store();
    handler = new MessageHandler(store);
  });

  // ===== register_transfer =====

  describe("register_transfer", () => {
    it("registers successfully with valid credentials", () => {
      store.addUser("13800138000", "a".repeat(64));
      const ws = mockSocket();

      const result = handler.handleMessage(ws, {
        type: "register_transfer",
        uid: "13800138000",
        token: "a".repeat(64),
        uuid: "c1",
        name: "agent-1",
      });

      expect(result).toEqual({ ok: true });
      expect(store.hasConnection("c1")).toBe(true);
    });

    it("auto-registers user on first register", () => {
      const ws = mockSocket();

      const result = handler.handleMessage(ws, {
        type: "register_transfer",
        uid: "13800138000",
        token: "a".repeat(64),
        uuid: "c1",
        name: "agent-1",
      });

      // Should succeed — user is auto-added to store
      expect(result).toEqual({ ok: true });
      expect(store.hasConnection("c1")).toBe(true);
      expect(store.verifyUser("13800138000", "a".repeat(64))).toBe(true);
    });

    it("rejects with malformed uid or token", () => {
      const ws = mockSocket();

      const result = handler.handleMessage(ws, {
        type: "register_transfer",
        uid: "bad",
        token: "a".repeat(64),
        uuid: "c1",
        name: "agent-1",
      });

      expect(result).toEqual({ ok: false, code: TransferErrorCode.AUTH_FAILED });
      expect(ws.sent[0]).toEqual({
        type: "transfer_break",
        data: { uuid: "c1", code: TransferErrorCode.AUTH_FAILED },
      });
    });

    it("handles duplicate uuid by replacing", () => {
      store.addUser("13800138000", "a".repeat(64));
      const oldWs = mockSocket();
      const newWs = mockSocket();

      handler.handleMessage(oldWs, {
        type: "register_transfer",
        uid: "13800138000",
        token: "a".repeat(64),
        uuid: "c1",
        name: "agent-1",
      });

      store.addSubscriber("c1", { id: "f1", send: vi.fn(), destroy: vi.fn() });

      handler.handleMessage(newWs, {
        type: "register_transfer",
        uid: "13800138000",
        token: "a".repeat(64),
        uuid: "c1",
        name: "agent-2",
      });

      expect(store.getConnection("c1")!.ws).toBe(newWs);
      expect(store.getSubscribers("c1").has("f1")).toBe(true);
    });
  });

  // ===== list_transfer =====

  describe("list_transfer", () => {
    it("returns connection list for valid user", () => {
      store.addUser("13800138000", "a".repeat(64));
      store.createConnection("c1", "agent-1", "13800138000", "a".repeat(64), mockSocket());
      store.createConnection("c2", "agent-2", "13800138000", "a".repeat(64), mockSocket());

      const ws = mockSocket();
      const result = handler.handleMessage(ws, {
        type: "list_transfer",
        uid: "13800138000",
        token: "a".repeat(64),
      });

      expect(result).toEqual({
        ok: true,
        list: [
          { uuid: "c1", name: "agent-1" },
          { uuid: "c2", name: "agent-2" },
        ],
      });
      expect(ws.sent[0]).toEqual({
        type: "transfer_list",
        data: {
          list: [
            { uuid: "c1", name: "agent-1" },
            { uuid: "c2", name: "agent-2" },
          ],
        },
      });
    });

    it("returns empty list for valid user with no connections", () => {
      store.addUser("13800138000", "a".repeat(64));
      const ws = mockSocket();

      const result = handler.handleMessage(ws, {
        type: "list_transfer",
        uid: "13800138000",
        token: "a".repeat(64),
      });

      expect(result).toEqual({ ok: true, list: [] });
    });

    it("rejects invalid credentials", () => {
      const ws = mockSocket();

      const result = handler.handleMessage(ws, {
        type: "list_transfer",
        uid: "13800138000",
        token: "a".repeat(64),
      });

      expect(result).toEqual({ ok: false, code: TransferErrorCode.AUTH_FAILED });
    });
  });

  // ===== subscribe_transfer =====

  describe("subscribe_transfer", () => {
    it("subscribes successfully", () => {
      store.addUser("13800138000", "a".repeat(64));
      store.createConnection("c1", "agent-1", "13800138000", "a".repeat(64), mockSocket());

      const consumerWs = mockSocket();
      const result = handler.handleMessage(consumerWs, {
        type: "subscribe_transfer",
        uid: "13800138000",
        token: "a".repeat(64),
        uuid: "c1",
      });

      expect(result).toEqual({ ok: true, uuid: "c1" });
      expect(store.getSubscribers("c1").size).toBe(1);
      expect(consumerWs.sent[0]).toEqual({
        type: "transfer_connect",
        data: { uuid: "c1" },
      });
    });

    it("rejects invalid credentials", () => {
      const consumerWs = mockSocket();

      const result = handler.handleMessage(consumerWs, {
        type: "subscribe_transfer",
        uid: "13800138000",
        token: "a".repeat(64),
        uuid: "c1",
      });

      expect(result).toEqual({ ok: false, code: TransferErrorCode.AUTH_FAILED });
      expect(consumerWs.sent[0]).toEqual({
        type: "transfer_break",
        data: { uuid: "c1", code: TransferErrorCode.SUBSCRIBE_FAILED },
      });
    });

    it("rejects nonexistent uuid", () => {
      store.addUser("13800138000", "a".repeat(64));
      const consumerWs = mockSocket();

      const result = handler.handleMessage(consumerWs, {
        type: "subscribe_transfer",
        uid: "13800138000",
        token: "a".repeat(64),
        uuid: "nonexistent",
      });

      expect(result).toEqual({ ok: false, code: TransferErrorCode.SUBSCRIBE_FAILED });
      expect(consumerWs.sent[0]).toEqual({
        type: "transfer_break",
        data: { uuid: "nonexistent", code: TransferErrorCode.SUBSCRIBE_FAILED },
      });
    });

    it("does not create duplicate subscriber for same consumer ws", () => {
      store.addUser("13800138000", "a".repeat(64));
      store.createConnection("c1", "agent-1", "13800138000", "a".repeat(64), mockSocket());

      const consumerWs = mockSocket();
      handler.handleMessage(consumerWs, {
        type: "subscribe_transfer",
        uid: "13800138000",
        token: "a".repeat(64),
        uuid: "c1",
      });

      // Second subscribe from same ws should be idempotent
      handler.handleMessage(consumerWs, {
        type: "subscribe_transfer",
        uid: "13800138000",
        token: "a".repeat(64),
        uuid: "c1",
      });

      expect(store.getSubscribers("c1").size).toBe(1);
    });
  });

  // ===== transfer_produce =====

  describe("transfer_produce", () => {
    it("forwards message to all subscribers", () => {
      store.addUser("13800138000", "a".repeat(64));
      const producerWs = mockSocket();
      store.createConnection("c1", "agent-1", "13800138000", "a".repeat(64), producerWs);

      const sub1Send = vi.fn();
      const sub2Send = vi.fn();
      store.addSubscriber("c1", { id: "f1", send: sub1Send, destroy: vi.fn() });
      store.addSubscriber("c1", { id: "f2", send: sub2Send, destroy: vi.fn() });

      handler.handleMessage(producerWs, {
        type: "transfer_produce",
        data: { uuid: "c1", message: { text: "hello" } },
      });

      // sub1Send/sub2Send are raw vi.fn(), not auto-parsing mock sockets
      expect(sub1Send).toHaveBeenCalledWith('{"text":"hello"}');
      expect(sub2Send).toHaveBeenCalledWith('{"text":"hello"}');
    });

    it("drops message if connection not found", () => {
      const ws = mockSocket();

      const result = handler.handleMessage(ws, {
        type: "transfer_produce",
        data: { uuid: "nonexistent", message: { text: "hello" } },
      });

      // Should not throw, just silently drop
      expect(result).toBeUndefined();
    });

    it("drops message if too large", () => {
      store.addUser("13800138000", "a".repeat(64));
      const producerWs = mockSocket();
      store.createConnection("c1", "agent-1", "13800138000", "a".repeat(64), producerWs);

      const subSend = vi.fn();
      store.addSubscriber("c1", { id: "f1", send: subSend, destroy: vi.fn() });

      const bigMessage = "x".repeat(1024 * 1024); // > 1MB after JSON
      handler.handleMessage(producerWs, {
        type: "transfer_produce",
        data: { uuid: "c1", message: { data: bigMessage } },
      });

      expect(subSend).not.toHaveBeenCalled();
      expect(producerWs.sent[0]).toEqual({
        type: "transfer_error",
        data: { code: TransferErrorCode.MESSAGE_TOO_LARGE, message: "message too large" },
      });
    });
  });

  // ===== transfer_consume =====

  describe("transfer_consume", () => {
    it("forwards message to producer", () => {
      store.addUser("13800138000", "a".repeat(64));
      const producerWs = mockSocket();
      store.createConnection("c1", "agent-1", "13800138000", "a".repeat(64), producerWs);

      const consumerWs = mockSocket();
      handler.handleMessage(consumerWs, {
        type: "transfer_consume",
        data: { uuid: "c1", message: { text: "reply" } },
      });

      // producerWs mock auto-parses JSON strings; handleConsume wraps with uuid
      expect(producerWs.sent).toEqual([{ uuid: "c1", message: { text: "reply" } }]);
    });

    it("drops if connection not found", () => {
      const ws = mockSocket();

      const result = handler.handleMessage(ws, {
        type: "transfer_consume",
        data: { uuid: "nonexistent", message: { text: "reply" } },
      });

      expect(result).toBeUndefined();
    });

    it("drops if message too large", () => {
      store.addUser("13800138000", "a".repeat(64));
      const producerWs = mockSocket();
      store.createConnection("c1", "agent-1", "13800138000", "a".repeat(64), producerWs);

      const consumerWs = mockSocket();
      const bigMessage = "x".repeat(1024 * 1024);
      handler.handleMessage(consumerWs, {
        type: "transfer_consume",
        data: { uuid: "c1", message: { data: bigMessage } },
      });

      expect(producerWs.sent).toHaveLength(0);
      expect(consumerWs.sent[0]).toEqual({
        type: "transfer_error",
        data: { code: TransferErrorCode.MESSAGE_TOO_LARGE, message: "message too large" },
      });
    });
  });

  // ===== handleClose (disconnect cleanup) =====

  describe("handleClose", () => {
    it("consumer close: removes forwarder from subscribers", () => {
      store.addUser("13800138000", "a".repeat(64));
      store.createConnection("c1", "agent-1", "13800138000", "a".repeat(64), mockSocket());

      const consumerWs = mockSocket();
      handler.handleMessage(consumerWs, {
        type: "subscribe_transfer",
        uid: "13800138000",
        token: "a".repeat(64),
        uuid: "c1",
      });

      expect(store.getSubscribers("c1").size).toBe(1);

      handler.handleClose(consumerWs);

      expect(store.getSubscribers("c1").size).toBe(0);
    });

    it("producer close: calls onProducerClose with uuid", () => {
      store.addUser("13800138000", "a".repeat(64));
      const producerWs = mockSocket();
      handler.handleMessage(producerWs, {
        type: "register_transfer",
        uid: "13800138000",
        token: "a".repeat(64),
        uuid: "c1",
        name: "agent-1",
      });

      const onClose = vi.fn();
      handler.handleClose(producerWs, onClose);

      expect(onClose).toHaveBeenCalledWith("c1");
    });

    it("unknown socket: no-op", () => {
      const unknownWs = mockSocket();
      const onClose = vi.fn();
      // Should not throw
      handler.handleClose(unknownWs, onClose);
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
