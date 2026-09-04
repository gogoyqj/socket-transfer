import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import { createProducer } from "../src/producer.js";
import { createConsumer } from "../src/consumer.js";
import { Store } from "../src/store.js";
import { MessageHandler } from "../src/message-handler.js";
import { ConnectionManager } from "../src/connection-manager.js";
import type { SocketLike } from "../src/types.js";

// ===== Test Helpers =====

function waitFor(fn: () => boolean, timeout = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      if (fn()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error("waitFor timeout"));
      setTimeout(check, 10);
    }
    check();
  });
}

function waitState(sdk: { onStateChange: Function }, target: string): Promise<void> {
  return new Promise((resolve) => {
    sdk.onStateChange((state: string) => {
      if (state === target) resolve();
    });
  });
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

/** Create an isolated test server. Returns { url, store, handler, close }. */
function createTestServer() {
  const store = new Store();
  const handler = new MessageHandler(store);
  const connManager = new ConnectionManager(store, { uid: "", token: "" });
  const wss = new WebSocketServer({ port: 0 });
  const port = (wss.address() as any).port;

  wss.on("connection", (ws) => {
    const socket = ws as unknown as SocketLike;
    ws.on("message", (data) => {
      try {
        handler.handleMessage(socket, JSON.parse(data.toString()));
      } catch { /* ignore */ }
    });
    ws.on("close", () => {
      handler.handleClose(socket, (uuid) => {
        // Match real server.ts: only mark disconnected, don't notify subscribers
        // 10001 is sent on timeout, not on immediate disconnect
        store.markDisconnected(uuid);
      });
    });
  });

  return {
    url: `ws://localhost:${port}`,
    store,
    handler,
    close: () => new Promise<void>(resolve => wss.close(() => resolve())),
  };
}

// ===== Producer SDK Tests =====

describe("Producer SDK", () => {
  let server: ReturnType<typeof createTestServer>;
  let url: string;
  let store: Store;

  beforeAll(() => {
    server = createTestServer();
    url = server.url;
    store = server.store;
  });
  afterAll(async () => { await server.close(); });
  beforeEach(() => { store.addUser("13800138000", "a".repeat(64)); });

  it("connects and registers", async () => {
    const producer = createProducer({
      url, uid: "13800138000", token: "a".repeat(64),
      name: "agent-1", reconnect: false,
    });
    await waitFor(() => store.hasConnection(producer.uuid));
    expect(producer.connected).toBe(true);
    expect(producer.uuid).toBeTruthy();
    expect(store.getConnection(producer.uuid)!.name).toBe("agent-1");
    producer.close();
  });

  it("sends message to server", async () => {
    const producer = createProducer({
      url, uid: "13800138000", token: "a".repeat(64),
      name: "agent-2", reconnect: false,
    });
    await waitFor(() => producer.connected);
    producer.send({ text: "hello" });
    producer.close();
  });

  it("closes cleanly", async () => {
    const producer = createProducer({
      url, uid: "13800138000", token: "a".repeat(64),
      name: "agent-3", reconnect: false,
    });
    await waitFor(() => store.hasConnection(producer.uuid));

    const closed = new Promise<void>(resolve => {
      producer.onStateChange(s => { if (s === "closed") resolve(); });
    });
    producer.close();
    await closed;

    expect(producer.connected).toBe(false);
    expect(() => producer.send("test")).toThrow("Producer is not connected");
  });
});

// ===== Consumer SDK Tests =====

describe("Consumer SDK", () => {
  let server: ReturnType<typeof createTestServer>;
  let url: string;
  let store: Store;

  beforeAll(() => {
    server = createTestServer();
    url = server.url;
    store = server.store;
  });
  afterAll(async () => { await server.close(); });
  beforeEach(() => { store.addUser("13800138000", "a".repeat(64)); });

  it("connects and lists connections", async () => {
    store.createConnection("c1", "agent-1", "13800138000", "a".repeat(64), {
      readyState: 1, send() {}, close() {}, on() {}, off() {},
    });

    const consumer = createConsumer({
      url, uid: "13800138000", token: "a".repeat(64), reconnect: false,
    });
    await waitState(consumer, "connected");

    const list = await consumer.listConnections();
    expect(list).toEqual([{ uuid: "c1", name: "agent-1" }]);
    consumer.close();
  });

  it("subscribes to a connection", async () => {
    store.createConnection("c2", "agent-2", "13800138000", "a".repeat(64), {
      readyState: 1, send() {}, close() {}, on() {}, off() {},
    });

    const consumer = createConsumer({
      url, uid: "13800138000", token: "a".repeat(64), reconnect: false,
    });
    await waitState(consumer, "connected");

    const connectedUuid = await new Promise<string>((resolve) => {
      consumer.onConnect((uuid) => resolve(uuid));
      consumer.subscribe("c2");
    });
    expect(connectedUuid).toBe("c2");
    expect(consumer.subscribedUuid).toBe("c2");
    consumer.close();
  });

  it("sends and receives messages through relay", async () => {
    // Producer via SDK (uuid auto-generated)
    const producer = createProducer({
      url, uid: "13800138000", token: "a".repeat(64),
      name: "agent-3", reconnect: false,
    });
    await waitFor(() => store.hasConnection(producer.uuid));

    // Consumer
    const consumer = createConsumer({
      url, uid: "13800138000", token: "a".repeat(64), reconnect: false,
    });
    await waitState(consumer, "connected");

    // Register message listener BEFORE subscribing
    const producerReceivedP = new Promise<unknown>(resolve => {
      producer.onMessage(msg => resolve(msg));
    });
    const consumerReceivedP = new Promise<unknown>(resolve => {
      consumer.onMessage(msg => resolve(msg));
    });

    // Subscribe to the producer's auto-generated uuid
    await new Promise<string>(resolve => {
      consumer.onConnect(uuid => resolve(uuid));
      consumer.subscribe(producer.uuid);
    });
    await sleep(100);

    // Consumer → Producer: handleConsume wraps with uuid + cuuid
    consumer.send({ text: "hello from consumer" });
    const receivedByProducer = await producerReceivedP as any;
    expect(receivedByProducer.message).toEqual({ text: "hello from consumer" });
    expect(receivedByProducer.uuid).toBe(producer.uuid);
    expect(receivedByProducer.cuuid).toBe(consumer.cuuid);

    // Producer → Consumer
    producer.send({ text: "hello from producer" });
    const receivedByConsumer = await consumerReceivedP;
    expect(receivedByConsumer).toEqual({ text: "hello from producer", fuuid: producer.uuid });

    producer.close();
    consumer.close();
  });

  it("producer disconnect: consumer stays subscribed until timeout", async () => {
    const producer = createProducer({
      url, uid: "13800138000", token: "a".repeat(64),
      name: "agent-4", reconnect: false,
    });
    await waitFor(() => store.hasConnection(producer.uuid));

    const consumer = createConsumer({
      url, uid: "13800138000", token: "a".repeat(64), reconnect: false,
    });
    await waitState(consumer, "connected");

    await new Promise<string>(resolve => {
      consumer.onConnect(uuid => resolve(uuid));
      consumer.subscribe(producer.uuid);
    });
    expect(consumer.subscribedUuid).toBe(producer.uuid);

    // Producer disconnects — server marks disconnected but doesn't clear subscribers
    producer.close();
    await sleep(100);

    // Consumer is still subscribed (subscribers not cleared on immediate disconnect)
    expect(consumer.subscribedUuid).toBe(producer.uuid);
    expect(store.getSubscribers(producer.uuid).size).toBe(1);

    consumer.close();
  });

  it("auto-resubscribes on 10004 (credentials changed)", async () => {
    // Create a mock producer socket
    store.createConnection("c5", "agent-5", "13800138000", "a".repeat(64), {
      readyState: 1, send() {}, close() {}, on() {}, off() {},
    });

    const consumer = createConsumer({
      url, uid: "13800138000", token: "a".repeat(64), reconnect: false,
    });
    await waitState(consumer, "connected");

    // Subscribe
    await new Promise<string>(resolve => {
      consumer.onConnect(uuid => resolve(uuid));
      consumer.subscribe("c5");
    });
    expect(consumer.subscribedUuid).toBe("c5");

    // Simulate 10004: send credentials-changed break through the forwarder
    const reconnected = new Promise<string>(resolve => {
      consumer.onConnect(uuid => resolve(uuid));
    });

    const subs = store.getSubscribers("c5");
    for (const fwd of subs.values()) {
      fwd.send(JSON.stringify({ type: "transfer_break", data: { code: 10004 } }));
    }

    // Consumer should auto re-list and re-subscribe to c5
    const newUuid = await reconnected;
    expect(newUuid).toBe("c5");
    expect(consumer.subscribedUuid).toBe("c5");

    consumer.close();
  });

  it("closes cleanly", async () => {
    const consumer = createConsumer({
      url, uid: "13800138000", token: "a".repeat(64), reconnect: false,
    });
    await waitState(consumer, "connected");

    const closed = new Promise<void>(resolve => {
      consumer.onStateChange(s => { if (s === "closed") resolve(); });
    });
    consumer.close();
    await closed;

    expect(consumer.connected).toBe(false);
    expect(() => consumer.send("test")).toThrow("Not subscribed");
  });
});

// ===== Error Event Forwarding Tests =====

describe("Error event forwarding", () => {
  it("producer forwards ws error as-is", async () => {
    const producer = createProducer({
      url: "ws://localhost:1", // port 1 → connection refused
      uid: "13800138000", token: "a".repeat(64),
      name: "err-test", reconnect: false,
    });

    const err = await new Promise<unknown>(resolve => {
      producer.onError(e => resolve(e));
    });

    // ws library emits Error instances for connection failures
    expect(err).toBeInstanceOf(Error);
    producer.close();
  });

  it("consumer forwards ws error as-is", async () => {
    const consumer = createConsumer({
      url: "ws://localhost:1", // port 1 → connection refused
      uid: "13800138000", token: "a".repeat(64),
      reconnect: false,
    });

    const err = await new Promise<unknown>(resolve => {
      consumer.onError(e => resolve(e));
    });

    expect(err).toBeInstanceOf(Error);
    consumer.close();
  });
});
