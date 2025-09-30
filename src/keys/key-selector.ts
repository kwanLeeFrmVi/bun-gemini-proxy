import { randomInt } from "node:crypto";
import type { ApiKeyRecord, CircuitBreakerState } from "../types/key.ts";

/**
 * KeyCandidate represents a key eligible for selection.
 */
export interface KeyCandidate {
  record: ApiKeyRecord;
  circuit: CircuitBreakerState;
}

/**
 * KeySelector implements weighted random selection for API keys.
 * Keys with higher weights have proportionally higher selection probability.
 */
export class KeySelector {
  /**
   * Select a key using weighted random selection.
   * Returns null if no eligible candidates are available.
   *
   * @param candidates - Array of eligible keys with their circuit states
   * @returns Selected key candidate or null
   */
  select(candidates: KeyCandidate[]): KeyCandidate | null {
    if (candidates.length === 0) {
      return null;
    }

    // Build weighted candidate pool
    const weighted: KeyCandidate[] = [];
    candidates.forEach((candidate) => {
      const multiplier = Math.max(1, candidate.record.weight);
      for (let i = 0; i < multiplier; i += 1) {
        weighted.push(candidate);
      }
    });

    if (weighted.length === 0) {
      return null;
    }

    // Select random candidate from weighted pool
    const index = randomInt(weighted.length);
    const selected = weighted[index];

    // This should be unreachable given the length check, but satisfies the compiler
    if (!selected) {
      return null;
    }

    return selected;
  }

  /**
   * Determine if a key is eligible for selection based on its status.
   *
   * @param isActive - Whether the key is administratively active
   * @param circuitState - Current circuit breaker state
   * @returns true if the key can be selected
   */
  isEligible(isActive: boolean, circuitState: "CLOSED" | "OPEN" | "HALF_OPEN"): boolean {
    return isActive && (circuitState === "CLOSED" || circuitState === "HALF_OPEN");
  }
}