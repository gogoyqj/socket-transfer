# socket-transfer

WebSocket relay server with access control. Enables message forwarding between **Producers** (e.g. desktop/agent) and **Consumers** (e.g. mobile device) through a central relay.

## Features

- **Producer / Consumer architecture** — Producers register connections; Consumers discover and subscribe to them
- **Access control** — uid + token based authentication for all operations
- **Bidirectional messaging** — Producers can broadcast or send targeted messages to specific Consumers; Consumers can send messages back
- **Auto-reconnect** — Both Producer and Consumer clients handle disconnections and reconnect automatically
- **Deterministic UUID** — Producer UUID rotates every 5 minutes based on a stable ID, surviving process restarts
- **Cross-platform client** — Works in Node.js (`ws` package) and browser (native WebSocket)
- **HTTP API** — `/api/links` for querying connections, `/api/update-token` for credential management
- **Static file serving** — Built-in HTTP server serves example HTML pages

## Quick Start

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start the server
npm start -- --port 3000
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--port <number>` | `3000` (or `PORT` env) | Server port |
| `--root <path>` | cwd | Static file root directory |

The server starts on the configured port:

```
Producer:  http://localhost:3000/produce.html
Consumer:  http://localhost:3000/consume.html
Links:     http://localhost:3000/links
WebSocket: ws://localhost:3000
```

## Usage

### Server

Use the CLI to start the server:

```bash
npm start -- --port 3000
# or
node dist/cli.js --port 3000
```

For programmatic usage:

```typescript
import { startTransferServer } from "socket-transfer/server";

const server = startTransferServer({ port: 3000 });

// Cleanup on shutdown
server.close();
```

### Producer (Node.js)

```typescript
import { createProducer } from "socket-transfer";

const producer = createProducer({
  url: "ws://localhost:3000",
  uid: "13800138000",
  token: "<64-char-token>",
  id: "my-agent",       // Stable ID for deterministic UUID
  name: "my-producer",
});

producer.onStateChange((state) => {
  console.log("Producer state:", state);
});

// Send to all subscribed consumers
producer.send({ type: "greeting", data: "hello" });

// Send to a specific consumer
producer.sendTo(consumerCuuid, { type: "private", data: "secret" });

// Listen for messages from consumers
producer.onMessage((msg) => {
  console.log("Received from consumer:", msg);
});

producer.close();
```

### Consumer (Node.js)

```typescript
import { createConsumer } from "socket-transfer";

const consumer = createConsumer({
  url: "ws://localhost:3000",
  uid: "13800138000",
  token: "<64-char-token>",
});

// List available producer connections
const list = await consumer.listConnections();
console.log("Available:", list);

// Subscribe to a producer
consumer.subscribe(list[0].uuid);

consumer.onConnect((uuid) => {
  console.log("Connected to producer:", uuid);
});

// Listen for messages from the producer
consumer.onMessage((msg) => {
  console.log("Received:", msg);
});

// Send a message to the producer
consumer.send({ type: "response", data: "pong" });

consumer.close();
```

### Browser Client

The project builds a browser-compatible bundle at `dist/client.browser.js`:

```html
<script type="module">
  import { createProducer } from "./dist/client.browser.js";

  const producer = createProducer({
    url: "ws://localhost:3000",
    uid: "13800138000",
    token: "<64-char-token>",
    name: "browser-producer",
  });
</script>
```

## Error Codes

| Code  | Name                   | Description                                  |
| ----- | ---------------------- | -------------------------------------------- |
| 10001 | PRODUCER_DISCONNECTED  | Producer disconnected for over 5 minutes     |
| 10002 | SUBSCRIBE_FAILED       | Subscription failed (auth error or invalid uuid) |
| 10003 | AUTH_FAILED            | Authentication failed (invalid uid/token)    |
| 10004 | CREDENTIALS_CHANGED    | Producer reconnected with a new token        |
| 10005 | MESSAGE_TOO_LARGE      | Message exceeds 1MB limit                    |

## API Endpoints

| Endpoint              | Method | Description                          |
| --------------------- | ------ | ------------------------------------ |
| `/api/links`          | POST   | Query available connections by uid/token |
| `/api/update-token`   | POST   | Update a user's token                |
| `/links`              | GET    | Web UI for querying connections      |
| `/produce.html`       | GET    | Example producer page                |
| `/consume.html`       | GET    | Example consumer page                |

## Development

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Build (TypeScript + browser bundle)
npm run build
```

## Architecture

```
┌──────────┐     WebSocket     ┌──────────────┐     WebSocket     ┌──────────┐
│ Producer │ ◄──────────────► │ Relay Server │ ◄──────────────► │ Consumer │
│ (agent)  │   register/send  │   (store +   │  subscribe/recv  │ (mobile) │
└──────────┘                  │   forwarder) │                  └──────────┘
                              └──────────────┘
                                    │
                              ┌─────┴─────┐
                              │ HTTP API  │
                              │ /links    │
                              │ /config   │
                              └───────────┘
```

## License

ISC
