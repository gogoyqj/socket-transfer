# Architecture

## System Overview

```
┌─────────────┐         ┌─────────────────────────────┐         ┌─────────────┐
│  Producer A  │◄───WS──►│                             │◄───WS──►│  Consumer 1  │
│  Producer B  │◄───WS──►│        Relay Server          │◄───WS──►│  Consumer 2  │
│  Producer C  │◄───WS──►│                             │◄───WS──►│  Consumer 3  │
└─────────────┘         └─────────────────────────────┘         └─────────────┘
```

The server acts as a central hub. Producers register themselves; Consumers discover available Producers and subscribe to receive messages.

## Module Responsibilities

### `server.ts` — Server Entry Point

- Creates HTTP server (for REST API and static files)
- Creates WebSocket server (attached to HTTP server)
- Delegates WebSocket messages to `MessageHandler`
- REST endpoints:
  - `POST /api/links` — query connections by uid/token
  - `POST /api/update-token` — update user credentials
  - `GET /links` — web UI for connection query

### `message-handler.ts` — Message Router

Parses incoming WebSocket messages and routes by `type` field:

- `register_transfer` → `ConnectionManager.registerConnection()`
- `list_transfer` → `Store.listConnections()` → reply to sender
- `subscribe_transfer` → `Store.addSubscriber()` + create `Forwarder`
- `transfer_produce` → `Forwarder.produce()` (broadcast or targeted)
- `transfer_consume` → `Forwarder.consume()`

Also tracks which sockets are producers vs consumers for cleanup on disconnect.

### `connection-manager.ts` — Connection Lifecycle

- **Register**: validates auth, creates or reuses user record, creates Connection
- **Takeover**: if same UUID already exists, replaces old connection (closes old socket)
- **Disconnect marking**: on socket close, marks connection as disconnected (grace period)
- **Cleanup**: connections disconnected > 5 minutes are removed; affected subscribers get error 10001
- **Credential change**: if producer reconnects with new token, notifies subscribers with error 10004

### `store.ts` — In-Memory State

Three data structures:

```typescript
users: Map<uid, token>              // User credentials
connections: Map<uuid, Connection>  // Active connections
subscribers: Map<uuid, Set<Forwarder>> // Per-connection subscriber sets
```

Connection object:
```typescript
{
  uuid: string
  uid: string
  ws: WebSocket          // producer's socket
  disconnected: boolean
  disconnectedAt?: number
}
```

### `forwarder.ts` — Message Bridge

Created per subscription (one Forwarder per Consumer↔Producer pair). Handles:
- `produce()` — relay message from Producer to this Consumer
- `consume()` — relay message from this Consumer to Producer
- Cleanup on unsubscribe or disconnect

### `auth.ts` — Authentication

- `generateToken()` — 64-char hex string (256-bit entropy)
- `validateUid(uid)` — must be 11-digit phone number
- `validateToken(token)` — must be 64-char lowercase hex
- `isValidMessageSize(data)` — 1MB limit

### `client.ts` — Client SDK

**Producer class:**
- Connects to relay, sends `register_transfer`
- `send(data)` — broadcast to all subscribers
- `sendTo(cuuid, data)` — target specific consumer
- Auto-reconnect on disconnect
- Deterministic UUID: `sha256(id + 5-min-window)`

**Consumer class:**
- Connects to relay
- `listConnections(uid, token)` — discover producers
- `subscribe(uuid, uid, token)` — subscribe to a producer
- `send(data)` — send to subscribed producer
- Auto-resubscribe on credential change (10004)

Cross-platform: uses `ws` in Node.js, native `WebSocket` in browser.

## Data Flow

### Producer Registration

```
Producer → { type: "register_transfer", uuid, uid, token }
Server → ConnectionManager.registerConnection()
  → Store.setConnection(uuid, connection)
Server → { type: "register_transfer", uuid, success: true }
```

### Consumer Subscription

```
Consumer → { type: "subscribe_transfer", uuid, uid, token }
Server → Store.addSubscriber(uuid, forwarder)
       → new Forwarder(consumerWs, producerWs)
Server → { type: "subscribe_transfer", uuid, success: true }
```

### Message Forwarding (Producer → Consumer)

```
Producer → { type: "transfer_produce", data: "..." }
Server → MessageHandler routes to Forwarder.produce()
  → for each subscriber: consumerWs.send(data)
```

### Message Forwarding (Consumer → Producer)

```
Consumer → { type: "transfer_consume", data: "..." }
Server → Forwarder.consume()
  → producerWs.send({ from: cuuid, data: "..." })
```

## Key Design Decisions

- **Anonymous registration**: producers auto-create user records on first connect, no pre-registration needed
- **5-minute reconnect window**: disconnected producers kept alive, subscribers preserved on reconnect
- **Credential rotation**: producer reconnect with new token triggers error 10004 → consumers auto-resubscribe
- **Cross-platform client**: single codebase, conditional `ws`/native `WebSocket` detection
- **1MB message size limit** enforced in `auth.ts`
