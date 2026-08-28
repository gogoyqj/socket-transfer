# API Reference

## CLI

```bash
# Start the server
node dist/cli.js [options]
npm start -- [options]

# Global install
npx socket-transfer [options]
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--port <number>` | `3000` (or `PORT` env) | Server port |
| `--root <path>` | cwd | Static file root directory |
| `--help` | — | Show help |

The server shuts down gracefully on `SIGINT` / `SIGTERM`.

---

## Server HTTP Endpoints

### `POST /api/links`

Query connections by uid and token. Returns list of producer connections for the given user.

**Request:**
```json
{ "uid": "13800138000", "token": "64-char-hex-token" }
```

**Response:**
```json
{
  "list": [
    { "uuid": "producer-uuid", "name": "agent-1" }
  ]
}
```

### `POST /api/update-token`

Update a user's authentication token.

**Request:**
```json
{ "uid": "13800138000", "newToken": "new-64-char-hex-token" }
```

### `GET /links`

Web UI for querying connections interactively.

---

## Client SDK

### Producer

```typescript
import { createProducer } from 'socket-transfer'

const producer = createProducer({
  url: 'ws://localhost:3000',
  uid: '13800138000',           // 11-digit phone number
  token: 'token-from-server',   // 64-char hex
  id: 'my-producer-id',         // optional: stable identity (UUID derived from this)
  name: 'agent-1',              // optional: display name (default: "producer")
  reconnect: true,              // optional: auto-reconnect (default: true)
  reconnectDelay: 3000,         // optional: reconnect delay in ms (default: 3000)
})

producer.send(data)              // broadcast to all subscribers
producer.sendTo(cuuid, data)    // target specific consumer
producer.channel(cuuid)         // get a per-consumer channel

producer.onMessage(callback)     // (message) => void
producer.onError(callback)       // (error) => void — original ws error, no wrapping
producer.onStateChange(callback) // (state: ProducerState) => void

producer.connected               // boolean
producer.uuid                    // auto-generated connection uuid

producer.close()
```

**ProducerState:** `"connecting"` | `"connected"` | `"disconnected"` | `"closed"`

### Consumer

```typescript
import { createConsumer } from 'socket-transfer'

const consumer = createConsumer({
  url: 'ws://localhost:3000',
  uid: '13800138000',
  token: 'token-from-server',
  reconnect: true,
  reconnectDelay: 3000,
})

const connections = await consumer.listConnections()
consumer.subscribe(producerUuid)

consumer.send(data)              // send to subscribed producer

consumer.onMessage(callback)     // (message) => void
consumer.onConnect(callback)     // (uuid: string) => void — fired on subscribe success
consumer.onBreak(callback)       // (code: TransferErrorCode) => void — subscription broken
consumer.onError(callback)       // (error) => void — original ws error, no wrapping
consumer.onStateChange(callback) // (state: ConsumerState) => void

consumer.connected               // boolean
consumer.subscribedUuid          // string | null
consumer.cuuid                   // auto-generated consumer unique ID

consumer.close()
```

**ConsumerState:** `"connecting"` | `"connected"` | `"disconnected"` | `"closed"`

### Browser Usage

The client auto-detects the platform. In browsers, use the esbuild bundle:

```html
<script type="module">
  import { createProducer, createConsumer } from './dist/client.browser.js'
  // same API as Node.js
</script>
```

---

## Internal Modules

These are **not** exported from the public API (`src/index.ts`). Import from their source files directly if needed for server-side development.

### `Store` — `src/store.ts`

```typescript
store.setUser(uid, token)
store.getUser(uid): string | undefined

store.setConnection(uuid, connection)
store.getConnection(uuid): Connection | undefined
store.removeConnection(uuid)
store.listConnections(uid): Connection[]

store.addSubscriber(uuid, forwarder)
store.removeSubscriber(uuid, forwarder)
store.getSubscribers(uuid): Set<Forwarder>
store.removeAllSubscribers(uuid)
```

### `ConnectionManager` — `src/connection-manager.ts`

```typescript
connectionManager.registerConnection(ws, uuid, uid, token): boolean
connectionManager.markDisconnected(uuid)
connectionManager.handleCredentialChange(uid, newToken)
connectionManager.cleanup(): void  // called periodically
```

### `Auth` — `src/auth.ts`

```typescript
generateToken(): string           // 64-char hex
validateUid(uid: string): boolean // 11-digit phone
validateToken(token: string): boolean // 64-char lowercase hex
isValidMessageSize(data: any): boolean // ≤ 1MB
```
