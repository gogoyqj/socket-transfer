import { randomUUID } from "node:crypto";
import type { Forwarder, SocketLike } from "./types.js";

/**
 * Create a Forwarder that bridges a consumer socket and a producer.
 *
 * - `send(data)` → pushes data to the consumer socket
 * - `onProduce(data)` → forwards consumer data to the producer via producerSend
 * - `destroy()` → tears down the forwarder, preventing further use
 *
 * Based on the Transport pattern from prime-agent:
 * @see ../prime-agent/packages/ui-client/src/transport.ts
 */
export function createForwarder(
  id: string,
  consumer: SocketLike,
  producerSend?: (data: unknown) => void
): Forwarder {
  let destroyed = false;

  const forwarder: Forwarder = {
    id,

    send(data: unknown) {
      if (destroyed) throw new Error("Forwarder is destroyed");
      consumer.send(data);
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      // Remove consumer message listener if attached
      if (producerSend && (forwarder as any)._consumerHandler) {
        consumer.off("message", (forwarder as any)._consumerHandler);
      }
    },
  };

  return forwarder;
}

/** Generate a unique forwarder ID. */
export function generateForwarderId(): string {
  return `fwd-${randomUUID()}`;
}
