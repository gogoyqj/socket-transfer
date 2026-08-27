# AGENTS.md — AI Agent Guide

## What This Project Is

A WebSocket relay server that sits between **Producers** (data sources) and **Consumers** (data subscribers). The relay handles authentication, connection management, and message forwarding. Both a server and a cross-platform client SDK are included.

## Getting Oriented

```
src/
├── index.ts                  # Public API surface — start here
├── types.ts                  # All types, constants, error codes — read this second
├── server.ts                 # Entry point for the relay server
├── client.ts                 # Producer & Consumer client SDK
├── store.ts                  # In-memory state (users, connections)
├── connection-manager.ts     # Connection lifecycle (register, disconnect, takeover)
├── message-handler.ts        # Message routing logic
├── forwarder.ts              # Per-subscription message bridge
└── auth.ts                   # Token & UID validation

tests/                        # One test file per module
example/                      # Runnable server + browser UI
docs/                         # Detailed knowledge base
```

### Server Architecture

```
Client (Producer/Consumer)
  ↕ WebSocket
Server (server.ts)
  ├── MessageHandler — routes messages by type
  ├── ConnectionManager — lifecycle, reconnect, takeover
  ├── Store — in-memory users, connections, subscribers
  ├── Forwarder — bridges consumer ↔ producer per subscription
  └── Auth — token generation & validation
```

## How To Verify Your Changes

```bash
npm test                      # Run all tests
npm run build                 # Ensure it compiles
npm run example               # Start example server (port 3000)
```

Always run both `npm test` and `npm run build` after making changes. Tests are the source of truth.

## Conventions

- **ESM** (`"type": "module"`), TypeScript 7.x, target ES2022
- **No runtime dependencies** except `ws`; everything else is devDependencies
- **SocketLike interface** abstracts WebSocket for testability
- **Deterministic UUID**: `sha256(id + 5-min-window)` — survives restarts, rotates periodically
- **Error codes** defined in `types.ts` (10001–10005)
- **Tests**: Vitest, one `*.test.ts` per module in `tests/`

## Common Pitfalls

- `Store` is in-memory only — no persistence across restarts
- Producer UUID rotates every 5 minutes based on `sha256(id + time-window)`
- The client detects platform via `typeof WebSocket` — don't break this when editing
- Tests use real WebSocket connections for integration tests (`client.test.ts`) and mock sockets for unit tests

## On-Demand Reference

- [Code Patterns](docs/code-patterns.md) — How to add message types, modify connections, client SDK
- [Message Types](docs/protocol.md#message-types) — Protocol message format
- [Error Codes](docs/protocol.md#error-codes) — Error code reference
- [Key Design Decisions](docs/architecture.md#key-design-decisions) — Architecture rationale
- [API Reference](docs/api.md) — Server endpoints and client SDK
- [Testing Guide](docs/testing.md) — Mock strategy and test patterns
