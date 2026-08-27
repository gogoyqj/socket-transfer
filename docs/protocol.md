# WebSocket Protocol

All messages are JSON strings. Every message has a `type` field.

## Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `register_transfer` | Producer → Server | Register as a producer |
| `list_transfer` | Consumer → Server | Discover available producers |
| `subscribe_transfer` | Consumer → Server | Subscribe to a producer |
| `transfer_produce` | Producer → Server → Consumer | Broadcast or targeted message |
| `transfer_consume` | Consumer → Server → Producer | Consumer sends data upstream |

## Client → Server Messages

### `register_transfer` — Register as Producer

```json
{
  "type": "register_transfer",
  "uuid": "producer-uuid",
  "uid": "13800138000",
  "token": "64-char-hex-token",
  "name": "optional-display-name"
}
```

On success: no response sent back. On failure: connection closed with `transfer_break` error.

### `list_transfer` — List Available Producers

```json
{
  "type": "list_transfer",
  "uid": "13800138000",
  "token": "64-char-hex-token",
  "cuuid": "consumer-uuid"
}
```

**Response:**
```json
{
  "type": "transfer_list",
  "data": {
    "list": [
      { "uuid": "producer-uuid-1", "name": "My Device" },
      { "uuid": "producer-uuid-2", "name": "Another Device" }
    ]
  }
}
```

### `subscribe_transfer` — Subscribe to a Producer

```json
{
  "type": "subscribe_transfer",
  "uuid": "producer-uuid",
  "uid": "13800138000",
  "token": "64-char-hex-token",
  "cuuid": "consumer-uuid"
}
```

### `transfer_produce` — Producer Sends Data to Subscribers

Broadcast to all:
```json
{
  "type": "transfer_produce",
  "data": { "uuid": "producer-uuid", "message": "any-json-value" }
}
```

Target specific consumer:
```json
{
  "type": "transfer_produce",
  "data": { "uuid": "producer-uuid", "targetConsumer": "consumer-uuid", "message": "any-json-value" }
}
```

### `transfer_consume` — Consumer Sends Data to Producer

```json
{
  "type": "transfer_consume",
  "data": { "uuid": "producer-uuid", "cuuid": "consumer-uuid", "message": "any-json-value" }
}
```

## Server → Client Messages

### Forwarded Producer Data (to Consumer)

Consumer receives the raw message value directly (no wrapper):
```json
"any-json-value"
```

Or if the value is an object:
```json
{ "key": "value" }
```

### Forwarded Consumer Data (to Producer)

Producer receives the message with consumer context:
```json
{ "uuid": "producer-uuid", "cuuid": "consumer-uuid", "message": "any-json-value" }
```

### `transfer_list` — List Response

```json
{
  "type": "transfer_list",
  "data": {
    "list": [
      { "uuid": "producer-uuid-1", "name": "My Device", "disconnected": false }
    ]
  }
}
```

### `transfer_connect` — Subscription Success

```json
{ "type": "transfer_connect", "data": { "uuid": "producer-uuid" } }
```

### `transfer_break` — Error Notification

```json
{ "type": "transfer_break", "data": { "uuid": "producer-uuid", "code": 10001 } }
```

Note: `uuid` is included when the error is associated with a specific producer (register, subscribe). For general auth failures (list), `uuid` may be omitted.

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 10001 | PRODUCER_DISCONNECTED | Disconnected > 5 min |
| 10002 | SUBSCRIBE_FAILED | Auth failed or invalid UUID |
| 10003 | AUTH_FAILED | Invalid uid/token |
| 10004 | CREDENTIALS_CHANGED | Producer token changed, consumers should resubscribe |
| 10005 | MESSAGE_TOO_LARGE | Exceeds 1MB |

## Connection Lifecycle

```
Producer connects → register_transfer → [active] → disconnect
  → 5-min grace: reconnect takes over, subscribers preserved
  → after 5 min: removed, subscribers get 10001

Consumer connects → list_transfer → subscribe_transfer → [active]
  → producer changes token (10004) → consumer auto-resubscribes
```
