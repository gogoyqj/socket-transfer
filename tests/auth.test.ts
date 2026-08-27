import { describe, it, expect } from "vitest";
import { generateToken, validateUid, validateToken, isValidMessageSize } from "../src/auth.js";
import { MAX_MESSAGE_SIZE } from "../src/types.js";

describe("auth", () => {
  describe("generateToken", () => {
    it("generates 64-char hex string", () => {
      const token = generateToken();
      expect(token).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
    });

    it("generates unique tokens", () => {
      const tokens = new Set(Array.from({ length: 1000 }, () => generateToken()));
      expect(tokens.size).toBe(1000);
    });
  });

  describe("validateUid", () => {
    it("accepts 11-digit phone number", () => {
      expect(validateUid("13800138000")).toBe(true);
    });

    it("rejects non-numeric", () => {
      expect(validateUid("1380013800a")).toBe(false);
    });

    it("rejects too short", () => {
      expect(validateUid("1380013800")).toBe(false);
    });

    it("rejects too long", () => {
      expect(validateUid("138001380001")).toBe(false);
    });

    it("rejects empty", () => {
      expect(validateUid("")).toBe(false);
    });
  });

  describe("validateToken", () => {
    it("accepts 64-char hex string", () => {
      expect(validateToken("a".repeat(64))).toBe(true);
    });

    it("rejects too short", () => {
      expect(validateToken("abc")).toBe(false);
    });

    it("rejects too long", () => {
      expect(validateToken("a".repeat(65))).toBe(false);
    });

    it("rejects non-hex", () => {
      expect(validateToken("g".repeat(64))).toBe(false);
    });

    it("rejects empty", () => {
      expect(validateToken("")).toBe(false);
    });
  });

  describe("isValidMessageSize", () => {
    it("accepts small message", () => {
      expect(isValidMessageSize({ hello: "world" })).toBe(true);
    });

    it("accepts message at exactly 1MB", () => {
      const big = "x".repeat(MAX_MESSAGE_SIZE - 20); // JSON overhead
      expect(isValidMessageSize({ data: big })).toBe(true);
    });

    it("rejects message over 1MB", () => {
      const big = "x".repeat(MAX_MESSAGE_SIZE);
      expect(isValidMessageSize({ data: big })).toBe(false);
    });
  });
});
