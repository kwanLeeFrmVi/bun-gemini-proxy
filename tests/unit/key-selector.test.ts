import { describe, it, expect, beforeEach, setSystemTime, afterEach } from "bun:test";
import { KeySelector } from "../../src/keys/key-selector.ts";
import type { ApiKeyRecord, CircuitBreakerState } from "../../src/types/key.ts";

describe("KeySelector", () => {
  let selector: KeySelector;

  beforeEach(() => {
    setSystemTime(new Date("2025-01-01T00:00:00Z"));
    selector = new KeySelector();
  });

  afterEach(() => {
    setSystemTime();
  });

  describe("isEligible", () => {
    it("should return true for active key with CLOSED circuit and no cooldown", () => {
      const result = selector.isEligible(true, "CLOSED", null, 30);
      expect(result).toBe(true);
    });

    it("should return true for active key with HALF_OPEN circuit and no cooldown", () => {
      const result = selector.isEligible(true, "HALF_OPEN", null, 30);
      expect(result).toBe(true);
    });

    it("should return false for inactive key", () => {
      const result = selector.isEligible(false, "CLOSED", null, 30);
      expect(result).toBe(false);
    });

    it("should return false for key with OPEN circuit", () => {
      const result = selector.isEligible(true, "OPEN", null, 30);
      expect(result).toBe(false);
    });

    it("should return false if cooldown period has not elapsed", () => {
      const lastUsed = new Date("2025-01-01T00:00:00Z");
      setSystemTime(new Date("2025-01-01T00:00:10Z")); // 10 seconds later

      const result = selector.isEligible(true, "CLOSED", lastUsed, 30);
      expect(result).toBe(false);
    });

    it("should return true if cooldown period has elapsed", () => {
      const lastUsed = new Date("2025-01-01T00:00:00Z");
      setSystemTime(new Date("2025-01-01T00:00:35Z")); // 35 seconds later

      const result = selector.isEligible(true, "CLOSED", lastUsed, 30);
      expect(result).toBe(true);
    });

    it("should return true if cooldown period has exactly elapsed", () => {
      const lastUsed = new Date("2025-01-01T00:00:00Z");
      setSystemTime(new Date("2025-01-01T00:00:30Z")); // Exactly 30 seconds later

      const result = selector.isEligible(true, "CLOSED", lastUsed, 30);
      expect(result).toBe(true);
    });

    it("should return false for inactive key even if cooldown has elapsed", () => {
      const lastUsed = new Date("2025-01-01T00:00:00Z");
      setSystemTime(new Date("2025-01-01T00:01:00Z"));

      const result = selector.isEligible(false, "CLOSED", lastUsed, 30);
      expect(result).toBe(false);
    });

    it("should return false for OPEN circuit even if cooldown has elapsed", () => {
      const lastUsed = new Date("2025-01-01T00:00:00Z");
      setSystemTime(new Date("2025-01-01T00:01:00Z"));

      const result = selector.isEligible(true, "OPEN", lastUsed, 30);
      expect(result).toBe(false);
    });
  });

  describe("select", () => {
    const createCandidate = (
      id: string,
      weight: number,
    ): { record: ApiKeyRecord; circuit: CircuitBreakerState } => ({
      record: {
        id,
        key: `key-${id}`,
        name: id,
        weight,
        isActive: true,
        createdAt: new Date(),
        lastUsedAt: null,
        cooldownSeconds: 30,
      },
      circuit: {
        keyId: id,
        state: "CLOSED",
        failureCount: 0,
        lastFailureTime: null,
        nextAttemptTime: null,
        openedAt: null,
      },
    });

    it("should return null for empty candidate list", () => {
      const result = selector.select([]);
      expect(result).toBeNull();
    });

    it("should select the only candidate when there is one", () => {
      const candidates = [createCandidate("key1", 1)];
      const result = selector.select(candidates);
      expect(result).not.toBeNull();
      expect(result?.record.id).toBe("key1");
    });

    it("should select from multiple candidates", () => {
      const candidates = [
        createCandidate("key1", 1),
        createCandidate("key2", 1),
        createCandidate("key3", 1),
      ];
      const result = selector.select(candidates);
      expect(result).not.toBeNull();
      expect(["key1", "key2", "key3"]).toContain(result?.record.id);
    });

    it("should respect weighted distribution over multiple selections", () => {
      const candidates = [
        createCandidate("key1", 1),
        createCandidate("key2", 9), // 90% probability
      ];

      const selections = new Map<string, number>();
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        const result = selector.select(candidates);
        if (result) {
          selections.set(result.record.id, (selections.get(result.record.id) ?? 0) + 1);
        }
      }

      // key2 should be selected significantly more often (approximately 9:1 ratio)
      const key1Count = selections.get("key1") ?? 0;
      const key2Count = selections.get("key2") ?? 0;
      expect(key2Count).toBeGreaterThan(key1Count);
      expect(key2Count).toBeGreaterThan(iterations * 0.7); // At least 70% for key2
    });
  });
});
