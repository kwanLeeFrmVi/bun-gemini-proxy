import type { CircuitBreakerState } from "../types/key.ts";
import { logger } from "../observability/logger.ts";

/**
 * CircuitBreaker implements the circuit breaker pattern for API keys.
 * Protects against repeatedly failing keys using a state machine:
 * CLOSED → OPEN → HALF_OPEN → CLOSED
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly recoveryTimeMs: number;

  constructor(failureThreshold: number, recoveryTimeSeconds: number) {
    this.failureThreshold = Math.max(1, failureThreshold);
    this.recoveryTimeMs = Math.max(0, recoveryTimeSeconds * 1000);
  }

  /**
   * Create a new default circuit state for a key.
   */
  createDefault(keyId: string): CircuitBreakerState {
    return {
      keyId,
      state: "CLOSED",
      failureCount: 0,
      lastFailureTime: null,
      nextAttemptTime: null,
      openedAt: null,
    };
  }

  /**
   * Record a successful request. If circuit is HALF_OPEN, close it.
   */
  recordSuccess(circuit: CircuitBreakerState): CircuitBreakerState {
    if (circuit.state === "HALF_OPEN") {
      logger.info({ keyId: circuit.keyId }, "Circuit closed for key after successful recovery");
      return {
        ...circuit,
        state: "CLOSED",
        failureCount: 0,
        lastFailureTime: null,
        nextAttemptTime: null,
        openedAt: null,
      };
    }

    if (circuit.state === "OPEN") {
      // This should not happen, but as a safeguard, reset to default
      return this.createDefault(circuit.keyId);
    }

    return circuit;
  }

  /**
   * Record a failed request. Open circuit if threshold is reached or if rate-limited.
   */
  recordFailure(
    circuit: CircuitBreakerState,
    reason: string,
    isRateLimit: boolean,
  ): CircuitBreakerState {
    const now = new Date();
    const updated = {
      ...circuit,
      failureCount: circuit.failureCount + 1,
      lastFailureTime: now,
    };

    const thresholdReached = updated.failureCount >= this.failureThreshold;
    if (isRateLimit || thresholdReached) {
      logger.warn({ keyId: circuit.keyId, reason }, "Circuit opened for key");
      return {
        ...updated,
        state: "OPEN" as const,
        openedAt: now,
        nextAttemptTime: new Date(now.getTime() + this.recoveryTimeMs),
      };
    }

    return updated;
  }

  /**
   * Evaluate if circuit should transition from OPEN to HALF_OPEN.
   * Should be called periodically or before key selection.
   */
  evaluate(circuit: CircuitBreakerState): CircuitBreakerState {
    if (
      circuit.state === "OPEN" &&
      circuit.nextAttemptTime &&
      circuit.nextAttemptTime.getTime() <= Date.now()
    ) {
      logger.info({ keyId: circuit.keyId }, "Circuit half-open; allowing limited traffic");
      return {
        ...circuit,
        state: "HALF_OPEN",
        nextAttemptTime: null,
      };
    }
    return circuit;
  }

  /**
   * Forcefully reset circuit to closed state.
   */
  reset(circuit: CircuitBreakerState): CircuitBreakerState {
    return this.createDefault(circuit.keyId);
  }
}
