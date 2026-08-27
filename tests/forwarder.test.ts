import { describe, it, expect, vi } from "vitest";
import { createForwarder } from "../src/forwarder.js";
import type { SocketLike } from "../src/types.js";

function mockSocket(): SocketLike & { sent: unknown[] } {
  const sent: unknown[] = [];
  const listeners: Record<string, Function[]> = {};
  return {
    readyState: 1,
    sent,
    send(data) { sent.push(data); },
    close() {},
    on(event, fn) { (listeners[event] ??= []).push(fn); },
    off(event, fn) { listeners[event] = (listeners[event] ?? []).filter(f => f !== fn); },
    _emit(event: string, ...args: unknown[]) {
      for (const fn of listeners[event] ?? []) fn(...args);
    },
  } as any;
}

describe("createForwarder", () => {
  it("sends data to consumer socket", () => {
    const consumer = mockSocket();
    const fwd = createForwarder("fwd-1", consumer);

    fwd.send({ hello: "world" });
    expect(consumer.sent).toEqual([{ hello: "world" }]);
  });

  it("destroy removes listeners and prevents further sends", () => {
    const consumer = mockSocket();
    const fwd = createForwarder("fwd-1", consumer);

    fwd.destroy();
    expect(() => fwd.send("data")).toThrow("Forwarder is destroyed");
  });

  it("send after destroy throws", () => {
    const consumer = mockSocket();
    const fwd = createForwarder("fwd-1", consumer);

    fwd.destroy();
    expect(() => fwd.send("anything")).toThrow("Forwarder is destroyed");
  });

  it("id is set correctly", () => {
    const consumer = mockSocket();
    const fwd = createForwarder("my-id", consumer);
    expect(fwd.id).toBe("my-id");
  });
});
