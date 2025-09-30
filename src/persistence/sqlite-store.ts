import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type {
  ApiKeyRecord,
  CircuitBreakerState,
  CircuitState,
  HealthScoreState,
  RequestMetricsSnapshot,
} from "../types/key.ts";
import type { PersistedState, StateStore } from "./types.ts";
import type { UsageStats } from "./stats-calculator.ts";

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * SQLiteStateStore persists proxy state using SQLite database.
 * Provides efficient querying for usage statistics and metrics.
 */
export class SQLiteStateStore implements StateStore {
  private db: Database;

  constructor(private readonly path: string) {
    ensureDir(path);
    this.db = new Database(path, { readwrite: true, create: true });
  }

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        api_key TEXT NOT NULL,
        name TEXT NOT NULL UNIQUE,
        weight INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME,
        cooldown_seconds INTEGER DEFAULT 30
      );

      CREATE TABLE IF NOT EXISTS health_scores (
        key_id TEXT PRIMARY KEY,
        score REAL NOT NULL DEFAULT 1.0,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        window_start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (key_id) REFERENCES api_keys(id)
      );

      CREATE TABLE IF NOT EXISTS circuit_breaker_states (
        key_id TEXT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT 'CLOSED',
        failure_count INTEGER DEFAULT 0,
        last_failure_time DATETIME,
        next_attempt_time DATETIME,
        opened_at DATETIME,
        FOREIGN KEY (key_id) REFERENCES api_keys(id)
      );

      CREATE TABLE IF NOT EXISTS request_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        request_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        avg_latency REAL DEFAULT 0,
        p95_latency REAL DEFAULT 0,
        FOREIGN KEY (key_id) REFERENCES api_keys(id)
      );
    `);
  }

  load(): PersistedState {
    const keys = this.db
      .query(
        `SELECT id, api_key, name, weight, is_active, created_at, last_used_at, cooldown_seconds FROM api_keys`,
      )
      .all()
      .map(
        (row: Record<string, unknown>) =>
          ({
            id: row.id as string,
            key: row.api_key as string,
            name: row.name as string,
            weight: Number(row.weight ?? 1),
            isActive: Boolean(row.is_active ?? 1),
            createdAt: new Date(row.created_at as string),
            lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string) : null,
            cooldownSeconds: Number(row.cooldown_seconds ?? 30),
          }) satisfies ApiKeyRecord,
      );

    const health = this.db
      .query(
        `SELECT key_id, score, success_count, failure_count, window_start_time, last_updated FROM health_scores`,
      )
      .all()
      .map(
        (row: Record<string, unknown>) =>
          ({
            keyId: row.key_id as string,
            score: Number(row.score ?? 1),
            successCount: Number(row.success_count ?? 0),
            failureCount: Number(row.failure_count ?? 0),
            windowStartTime: new Date(row.window_start_time as string),
            lastUpdated: new Date(row.last_updated as string),
          }) satisfies HealthScoreState,
      );

    const circuits = this.db
      .query(
        `SELECT key_id, state, failure_count, last_failure_time, next_attempt_time, opened_at FROM circuit_breaker_states`,
      )
      .all()
      .map(
        (row: Record<string, unknown>) =>
          ({
            keyId: row.key_id as string,
            state: row.state as CircuitState,
            failureCount: Number(row.failure_count ?? 0),
            lastFailureTime: row.last_failure_time ? new Date(row.last_failure_time as string) : null,
            nextAttemptTime: row.next_attempt_time ? new Date(row.next_attempt_time as string) : null,
            openedAt: row.opened_at ? new Date(row.opened_at as string) : null,
          }) satisfies CircuitBreakerState,
      );

    const metrics = this.db
      .query(
        `SELECT key_id, timestamp, request_count, success_count, error_count, avg_latency, p95_latency FROM request_metrics ORDER BY timestamp DESC LIMIT 1000`,
      )
      .all()
      .map(
        (row: Record<string, unknown>) =>
          ({
            keyId: row.key_id as string,
            timestamp: new Date(row.timestamp as string),
            requestCount: Number(row.request_count ?? 0),
            successCount: Number(row.success_count ?? 0),
            errorCount: Number(row.error_count ?? 0),
            avgLatencyMs: Number(row.avg_latency ?? 0),
            p95LatencyMs: Number(row.p95_latency ?? 0),
          }) satisfies RequestMetricsSnapshot,
      );

    return { keys, health, circuits, metrics };
  }

  save(state: PersistedState): void {
    const insertKey = this.db.prepare(
      `INSERT INTO api_keys (id, api_key, name, weight, is_active, created_at, last_used_at, cooldown_seconds)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(id) DO UPDATE SET
         api_key = excluded.api_key,
         name = excluded.name,
         weight = excluded.weight,
         is_active = excluded.is_active,
         last_used_at = excluded.last_used_at,
         cooldown_seconds = excluded.cooldown_seconds;
      `,
    );

    const insertHealth = this.db.prepare(
      `INSERT INTO health_scores (key_id, score, success_count, failure_count, window_start_time, last_updated)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(key_id) DO UPDATE SET
         score = excluded.score,
         success_count = excluded.success_count,
         failure_count = excluded.failure_count,
         window_start_time = excluded.window_start_time,
         last_updated = excluded.last_updated;
      `,
    );

    const insertCircuit = this.db.prepare(
      `INSERT INTO circuit_breaker_states (key_id, state, failure_count, last_failure_time, next_attempt_time, opened_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(key_id) DO UPDATE SET
         state = excluded.state,
         failure_count = excluded.failure_count,
         last_failure_time = excluded.last_failure_time,
         next_attempt_time = excluded.next_attempt_time,
         opened_at = excluded.opened_at;
      `,
    );

    const insertMetrics = this.db.prepare(
      `INSERT INTO request_metrics (key_id, timestamp, request_count, success_count, error_count, avg_latency, p95_latency)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);
      `,
    );

    this.db.transaction(() => {
      state.keys.forEach((key) => {
        insertKey.run(
          key.id,
          key.key,
          key.name,
          key.weight,
          key.isActive ? 1 : 0,
          key.createdAt.toISOString(),
          key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
          key.cooldownSeconds,
        );
      });

      state.health.forEach((health) => {
        insertHealth.run(
          health.keyId,
          health.score,
          health.successCount,
          health.failureCount,
          health.windowStartTime.toISOString(),
          health.lastUpdated.toISOString(),
        );
      });

      state.circuits.forEach((circuit) => {
        insertCircuit.run(
          circuit.keyId,
          circuit.state,
          circuit.failureCount,
          circuit.lastFailureTime ? circuit.lastFailureTime.toISOString() : null,
          circuit.nextAttemptTime ? circuit.nextAttemptTime.toISOString() : null,
          circuit.openedAt ? circuit.openedAt.toISOString() : null,
        );
      });

      state.metrics.forEach((metric) => {
        insertMetrics.run(
          metric.keyId,
          metric.timestamp.toISOString(),
          metric.requestCount,
          metric.successCount,
          metric.errorCount,
          metric.avgLatencyMs,
          metric.p95LatencyMs,
        );
      });
    })();
  }

  upsertKey(record: ApiKeyRecord, health: HealthScoreState, circuit: CircuitBreakerState): void {
    this.save({ keys: [record], health: [health], circuits: [circuit], metrics: [] });
  }

  recordRequestMetrics(snapshot: RequestMetricsSnapshot): void {
    const insertMetrics = this.db.prepare(
      `INSERT INTO request_metrics (key_id, timestamp, request_count, success_count, error_count, avg_latency, p95_latency)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);
      `,
    );

    insertMetrics.run(
      snapshot.keyId,
      snapshot.timestamp.toISOString(),
      snapshot.requestCount,
      snapshot.successCount,
      snapshot.errorCount,
      snapshot.avgLatencyMs,
      snapshot.p95LatencyMs,
    );
  }

  getDailyUsageStats(): UsageStats[] {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.getUsageStatsAfter(dayAgo);
  }

  getWeeklyUsageStats(): UsageStats[] {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.getUsageStatsAfter(weekAgo);
  }

  private getUsageStatsAfter(since: Date): UsageStats[] {
    const results = this.db
      .query(
        `SELECT
          key_id,
          SUM(request_count) as total_requests,
          SUM(success_count) as success_count,
          SUM(error_count) as error_count,
          AVG(avg_latency) as avg_latency
        FROM request_metrics
        WHERE timestamp >= ?1
        GROUP BY key_id`,
      )
      .all(since.toISOString()) as Array<{
      key_id: string;
      total_requests: number;
      success_count: number;
      error_count: number;
      avg_latency: number;
    }>;

    return results.map((row) => {
      const totalRequests = Number(row.total_requests ?? 0);
      const successCount = Number(row.success_count ?? 0);
      const errorCount = Number(row.error_count ?? 0);
      const successRate = totalRequests > 0 ? successCount / totalRequests : 0;

      return {
        keyId: row.key_id,
        totalRequests,
        successCount,
        errorCount,
        successRate,
        avgLatencyMs: Number(row.avg_latency ?? 0),
      } satisfies UsageStats;
    });
  }
}