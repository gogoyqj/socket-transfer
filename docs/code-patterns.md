# Code Patterns

## Adding a new message type

1. Add the type constant in `types.ts`
2. Add the handler branch in `message-handler.ts`
3. Add client-side method in `client.ts` if needed
4. Add tests in `tests/message-handler.test.ts` and/or `tests/client.test.ts`

## Modifying connection behavior

- `connection-manager.ts` handles registration, takeover, disconnect marking
- `store.ts` holds the state — mutations go through store methods
- Reconnect window is 5 minutes (`DISCONNECT_GRACE_MS` in `types.ts`)

## Client SDK

- Producer and Consumer classes in `client.ts`
- Cross-platform: uses `ws` in Node.js, native `WebSocket` in browser
- Browser bundle built via esbuild (`npm run build`)
- `SocketLike` interface enables mock-based testing
