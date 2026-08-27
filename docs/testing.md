# Testing Guide

## Run Tests

```bash
npm test                  # watch mode (default)
npm test -- --run         # single run
npm test -- --coverage    # with coverage
```

## Test Structure

One test file per module in `tests/`:

| File | What It Tests |
|------|---------------|
| `auth.test.ts` | Token generation, uid/token validation, message size |
| `store.test.ts` | In-memory store CRUD operations |
| `forwarder.test.ts` | Message forwarding between consumer and producer |
| `message-handler.test.ts` | Message routing logic |
| `connection-manager.test.ts` | Registration, takeover, disconnect, cleanup |
| `client.test.ts` | Integration: full Producer↔Consumer↔Server flow |

## Mock Strategy

Unit tests use a `mockSocket()` helper that implements the `SocketLike` interface:

```typescript
function mockSocket() {
  const sent: any[] = []
  return {
    send: vi.fn((data) => sent.push(data)),
    close: vi.fn(),
    on: vi.fn(),
    sent,            // inspect what was sent
    simulateMessage(data) { /* trigger on('message') */ },
    simulateClose() { /* trigger on('close') */ },
  }
}
```

Integration tests (`client.test.ts`) use real WebSocket connections against a test server instance.

## Adding Tests

When adding a new feature:

1. **Unit test** the module in isolation using `mockSocket()`
2. **Integration test** in `client.test.ts` if it affects the full flow
3. Follow existing patterns — each `describe` block maps to a method or behavior
4. Use `vi.fn()` for spies, `vi.useFakeTimers()` for time-dependent tests (reconnect window, UUID rotation)
