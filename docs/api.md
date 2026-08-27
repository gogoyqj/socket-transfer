# API Reference

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
  "connections": [
    { "uuid": "producer-uuid", "disconnected": false }
  ]
}
```

### `POST /api/update-token`

Update a user's authentication token.

**Request:**
```json
{ "uid": "13800138000", "oldToken": "current-token", "newToken": "new-token" }
```

### `GET /links`

Web UI for querying connections interactively.

---

## Client SDK

### Producer

```typescript
import { Producer } from 'socket-transfer'

const producer = new Producer({
  url: 'ws://localhost:3000',
  id: 'my-producer-id',        // stable identity (UUID derived from this)
  uid: '13800138000',           // 11-digit phone number
  token: 'token-from-server'    // 64-char hex
})

producer.connect()

producer.send(data)              // broadcast to all subscribers
producer.sendTo(cuuid, data)    // target specific consumer

producer.onMessage(callback)     // (data, from) => void
producer.onStateChange(cb)       // (state) => void — 'connecting' | 'connected' | 'disconnected'
producer.onError(cb)             // (error) => void
producer.close()
```

### Consumer

```typescript
import { Consumer } from 'socket-transfer'

const consumer = new Consumer({
  url: 'ws://localhost:3000',
  uid: '13800138000',
  token: 'token-from-server'
})

consumer.connect()

const connections = await consumer.listConnections(uid, token)
await consumer.subscribe(producerUuid, uid, token)

consumer.send(data)              // send to subscribed producer

consumer.onMessage(callback)     // (data, from) => void
consumer.onStateChange(cb)       // (state) => void
consumer.onError(cb)             // (error) => void
consumer.close()
```

### Browser Usage

The client auto-detects the platform. In browsers, use the esbuild bundle:

```html
<script type="module">
  import { Producer, Consumer } from './dist/client.browser.js'
  // same API as Node.js
</script>
```

---

## Internal Modules

### `Store`

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

### `ConnectionManager`

```typescript
connectionManager.registerConnection(ws, uuid, uid, token): boolean
connectionManager.markDisconnected(uuid)
connectionManager.handleCredentialChange(uid, newToken)
connectionManager.cleanup(): void  // called periodically
```

### `Auth`

```typescript
generateToken(): string           // 64-char hex
validateUid(uid: string): boolean // 11-digit phone
validateToken(token: string): boolean // 64-char lowercase hex
isValidMessageSize(data: any): boolean // ≤ 1MB
```
