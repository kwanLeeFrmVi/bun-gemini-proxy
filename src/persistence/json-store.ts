import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "../observability/logger.ts";
import type {
  ApiKeyRecord,
  CircuitBreakerState,
  ClientMetricsSnapshot,
  ClientUsageStats,
  HealthScoreState,
  RequestMetricsSnapshot,
} from "../types/key.ts";
import type { PersistedState, StateStore } from "./types.ts";
import { StatsCalculator, type UsageStats } from "./stats-calculator.ts";

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * JsonStateStore persists proxy state using a JSON file.
 * Serves as a fallback when SQLite is unavailable.
 */
export class JsonStateStore implements StateStore {
  constructor(private readonly path: string) {
    ensureDir(path);
  }

  init(): void {
    if (!existsSync(this.path)) {
      writeFileSync(
        this.path,
        JSON.stringify({ keys: [], health: [], circuits: [], metrics: [], clientMetrics: [] }),
      );
    }
  }

  load(): PersistedState {
    if (!existsSync(this.path)) {
      return { keys: [], health: [], circuits: [], metrics: [], clientMetrics: [] };
    }
    const raw = readFileSync(this.path, "utf8");
    if (!raw) {
      return { keys: [], health: [], circuits: [], metrics: [], clientMetrics: [] };
    }

    try {
      const parsed = JSON.parse(raw) as PersistedState;
      return {
        keys: (parsed.keys ?? []).map((key) => ({
          ...key,
          createdAt: new Date(key.createdAt),
          lastUsedAt: key.lastUsedAt ? new Date(key.lastUsedAt) : null,
        })),
        health: (parsed.health ?? []).map((health) => ({
          ...health,
          windowStartTime: new Date(health.windowStartTime),
          lastUpdated: new Date(health.lastUpdated),
        })),
        circuits: (parsed.circuits ?? []).map((circuit) => ({
          ...circuit,
          lastFailureTime: circuit.lastFailureTime ? new Date(circuit.lastFailureTime) : null,
          nextAttemptTime: circuit.nextAttemptTime ? new Date(circuit.nextAttemptTime) : null,
          openedAt: circuit.openedAt ? new Date(circuit.openedAt) : null,
        })),
        metrics: (parsed.metrics ?? []).map((metric) => ({
          ...metric,
          timestamp: new Date(metric.timestamp),
        })),
        clientMetrics: (parsed.clientMetrics ?? []).map((metric) => ({
          ...metric,
          timestamp: new Date(metric.timestamp),
        })),
      } satisfies PersistedState;
    } catch (error) {
      logger.error({ error }, "Failed to parse fallback persistence file; starting empty state");
      return { keys: [], health: [], circuits: [], metrics: [], clientMetrics: [] };
    }
  }

  save(state: PersistedState): void {
    writeFileSync(
      this.path,
      JSON.stringify(
        {
          ...state,
          keys: state.keys.map((key) => ({
            ...key,
            createdAt: key.createdAt.toISOString(),
            lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
          })),
          health: state.health.map((health) => ({
            ...health,
            windowStartTime: health.windowStartTime.toISOString(),
            lastUpdated: health.lastUpdated.toISOString(),
          })),
          circuits: state.circuits.map((circuit) => ({
            ...circuit,
            lastFailureTime: circuit.lastFailureTime ? circuit.lastFailureTime.toISOString() : null,
            nextAttemptTime: circuit.nextAttemptTime ? circuit.nextAttemptTime.toISOString() : null,
            openedAt: circuit.openedAt ? circuit.openedAt.toISOString() : null,
          })),
          metrics: state.metrics.map((metric) => ({
            ...metric,
            timestamp: metric.timestamp.toISOString(),
          })),
          clientMetrics: (state.clientMetrics ?? []).map((metric) => ({
            ...metric,
            timestamp: metric.timestamp.toISOString(),
          })),
        },
        null,
        2,
      ),
    );
  }

  upsertKey(record: ApiKeyRecord, health: HealthScoreState, circuit: CircuitBreakerState): void {
    const current = this.load();
    const keyIndex = current.keys.findIndex((k) => k.id === record.id);
    if (keyIndex >= 0) {
      current.keys[keyIndex] = record;
    } else {
      current.keys.push(record);
    }

    const healthIndex = current.health.findIndex((h) => h.keyId === health.keyId);
    if (healthIndex >= 0) {
      current.health[healthIndex] = health;
    } else {
      current.health.push(health);
    }

    const circuitIndex = current.circuits.findIndex((c) => c.keyId === circuit.keyId);
    if (circuitIndex >= 0) {
      current.circuits[circuitIndex] = circuit;
    } else {
      current.circuits.push(circuit);
    }

    this.save(current);
  }

  recordRequestMetrics(snapshot: RequestMetricsSnapshot): void {
    const current = this.load();
    current.metrics.push(snapshot);
    if (current.metrics.length > 1000) {
      current.metrics.splice(0, current.metrics.length - 1000);
    }
    this.save(current);
  }

  getDailyUsageStats(): UsageStats[] {
    const current = this.load();
    return StatsCalculator.getDailyStats(current.metrics);
  }

  getWeeklyUsageStats(): UsageStats[] {
    const current = this.load();
    return StatsCalculator.getWeeklyStats(current.metrics);
  }

  recordClientMetrics(snapshot: ClientMetricsSnapshot): void {
    const current = this.load();
    const clientMetrics = current.clientMetrics ?? [];
    clientMetrics.push(snapshot);
    if (clientMetrics.length > 10000) {
      clientMetrics.splice(0, clientMetrics.length - 10000);
    }
    current.clientMetrics = clientMetrics;
    this.save(current);
  }

  getClientDailyStats(): ClientUsageStats[] {
    const current = this.load();
    return this.calculateClientStats(current.clientMetrics ?? [], 24 * 60 * 60 * 1000, 60 * 1000);
  }

  getClientWeeklyStats(): ClientUsageStats[] {
    const current = this.load();
    return this.calculateClientStats(
      current.clientMetrics ?? [],
      7 * 24 * 60 * 60 * 1000,
      60 * 1000,
    );
  }

  private calculateClientStats(
    metrics: ClientMetricsSnapshot[],
    windowMs: number,
    minuteWindowMs: number,
  ): ClientUsageStats[] {
    const now = Date.now();
    const windowStart = new Date(now - windowMs);
    const minuteStart = new Date(now - minuteWindowMs);

    const filtered = metrics.filter((m) => m.timestamp >= windowStart);
    const grouped = new Map<
      string,
      { total: number; success: number; error: number; minute: number }
    >();

    filtered.forEach((metric) => {
      const existing = grouped.get(metric.clientId) ?? {
        total: 0,
        success: 0,
        error: 0,
        minute: 0,
      };
      existing.total += metric.requestCount;
      existing.success += metric.successCount;
      existing.error += metric.errorCount;
      if (metric.timestamp >= minuteStart) {
        existing.minute += metric.requestCount;
      }
      grouped.set(metric.clientId, existing);
    });

    return Array.from(grouped.entries())
      .map(([clientId, stats]) => {
        const successRate = stats.total > 0 ? stats.success / stats.total : 0;
        return {
          clientId,
          maskedToken: clientId, // Already masked
          minuteRequests: stats.minute,
          dailyRequests: stats.total,
          weeklyRequests: stats.total,
          successRate,
        } satisfies ClientUsageStats;
      })
      .sort((a, b) => b.dailyRequests - a.dailyRequests);
  }
}
