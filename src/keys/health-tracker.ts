import type { HealthScoreState } from "../types/key.ts";

/**
 * HealthTracker manages health scoring for API keys.
 * Uses a sliding time window to track success/failure ratios.
 */
export class HealthTracker {
  private readonly windowMs: number;

  constructor(windowSeconds: number) {
    this.windowMs = Math.max(1000, windowSeconds * 1000);
  }

  /**
   * Create a new default health state for a key.
   */
  createDefault(keyId: string): HealthScoreState {
    const now = new Date();
    return {
      keyId,
      score: 1,
      successCount: 0,
      failureCount: 0,
      windowStartTime: now,
      lastUpdated: now,
    };
  }

  /**
   * Record a successful request and update health score.
   */
  recordSuccess(health: HealthScoreState): HealthScoreState {
    const now = new Date();
    const updated = this.rollWindow(health, now);
    updated.successCount += 1;
    updated.score = this.calculateScore(updated);
    updated.lastUpdated = now;
    return updated;
  }

  /**
   * Record a failed request and update health score.
   */
  recordFailure(health: HealthScoreState): HealthScoreState {
    const now = new Date();
    const updated = this.rollWindow(health, now);
    updated.failureCount += 1;
    updated.score = this.calculateScore(updated);
    updated.lastUpdated = now;
    return updated;
  }

  /**
   * Reset the time window if it has expired, clearing counters.
   */
  private rollWindow(health: HealthScoreState, now: Date): HealthScoreState {
    if (now.getTime() - health.windowStartTime.getTime() >= this.windowMs) {
      return {
        ...health,
        successCount: 0,
        failureCount: 0,
        windowStartTime: now,
      };
    }
    return health;
  }

  /**
   * Calculate health score as success rate (0.0 to 1.0).
   * Returns 1.0 if no requests have been made.
   */
  private calculateScore(health: HealthScoreState): number {
    const total = health.successCount + health.failureCount;
    if (total <= 0) {
      return 1;
    }
    return Math.max(0, Math.min(1, health.successCount / total));
  }
}
