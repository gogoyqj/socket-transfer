import { randomBytes, createHash } from "node:crypto";
import { MAX_MESSAGE_SIZE } from "./types.js";

/**
 * Generate a 64-char unique hex token.
 * randomBytes(32) gives 256 bits of entropy — practically no collisions.
 */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/** Validate 11-digit phone number. */
export function validateUid(uid: unknown): uid is string {
  return typeof uid === "string" && /^\d{11}$/.test(uid);
}

/** Validate 64-char lowercase hex token. */
export function validateToken(token: unknown): token is string {
  return typeof token === "string" && /^[0-9a-f]{64}$/.test(token);
}

/** Check if a JSON-serialized message fits within the size limit. */
export function isValidMessageSize(message: unknown): boolean {
  try {
    const size = Buffer.byteLength(JSON.stringify(message), "utf-8");
    return size <= MAX_MESSAGE_SIZE;
  } catch {
    return false;
  }
}
