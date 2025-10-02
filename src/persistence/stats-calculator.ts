import type { RequestMetricsSnapshot } from "../types/key.ts";

/**
 * UsageStats represents aggregated statistics for a key over a time period.
 */
export interface UsageStats {
  keyId: string;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgLatencyMs: number;
}

/**
 * StatsCalculator provides utilities for calculating usage statistics
 * from request metrics snapshots. Shared across all store implementations.
 */
export class StatsCalculator {
  /**
   * Calculate usage statistics from metrics within a time window.
   */
  static calculateStats(metrics: RequestMetricsSnapshot[], sinceDate: Date): UsageStats[] {
    const filtered = metrics.filter((m) => m.timestamp >= sinceDate);
    const grouped = new Map<
      string,
      { requests: number; success: number; errors: number; latencies: number[] }
    >();

    filtered.forEach((metric) => {
      const existing = grouped.get(metric.keyId) ?? {
        requests: 0,
        success: 0,
        errors: 0,
        latencies: [],
      };
      existing.requests += metric.requestCount;
      existing.success += metric.successCount;
      existing.errors += metric.errorCount;
      existing.latencies.push(metric.avgLatencyMs);
      grouped.set(metric.keyId, existing);
    });

    return Array.from(grouped.entries()).map(([keyId, stats]) => {
      const successRate = stats.requests > 0 ? stats.success / stats.requests : 0;
      const avgLatency =
        stats.latencies.length > 0
          ? stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length
          : 0;

      return {
        keyId,
        totalRequests: stats.requests,
        successCount: stats.success,
        errorCount: stats.errors,
        successRate,
        avgLatencyMs: avgLatency,
      } satisfies UsageStats;
    });
  }

  /**
   * Get stats for the last 24 hours.
   */
  static getDailyStats(metrics: RequestMetricsSnapshot[]): UsageStats[] {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.calculateStats(metrics, dayAgo);
  }

  /**
   * Get stats for the last 7 days.
   */
  static getWeeklyStats(metrics: RequestMetricsSnapshot[]): UsageStats[] {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.calculateStats(metrics, weekAgo);
  }
}
