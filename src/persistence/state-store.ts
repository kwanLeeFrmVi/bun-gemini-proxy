import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { logger } from "../observability/logger.ts";
import type {
  ApiKeyRecord,
  CircuitBreakerState,
  CircuitState,
  HealthScoreState,
  RequestMetricsSnapshot,
} from "../types/key.ts";

export interface PersistedState {
  keys: ApiKeyRecord[];
  health: HealthScoreState[];
  circuits: CircuitBreakerState[];
  metrics: RequestMetricsSnapshot[];
}

export interface StateStore {
  init(): void;
  load(): PersistedState;
  save(state: PersistedState): void;
  upsertKey(record: ApiKeyRecord, health: HealthScoreState, circuit: CircuitBreakerState): void;
  recordRequestMetrics(snapshot: RequestMetricsSnapshot): void;
}

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

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
      .map((row: any) => ({
        id: row.id as string,
        key: row.api_key as string,
        name: row.name as string,
        weight: Number(row.weight ?? 1),
        isActive: Boolean(row.is_active ?? 1),
        createdAt: new Date(row.created_at as string),
        lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string) : null,
        cooldownSeconds: Number(row.cooldown_seconds ?? 30),
      } satisfies ApiKeyRecord));

    const health = this.db
      .query(
        `SELECT key_id, score, success_count, failure_count, window_start_time, last_updated FROM health_scores`,
      )
      .all()
      .map((row: any) => ({
        keyId: row.key_id as string,
        score: Number(row.score ?? 1),
        successCount: Number(row.success_count ?? 0),
        failureCount: Number(row.failure_count ?? 0),
        windowStartTime: new Date(row.window_start_time as string),
        lastUpdated: new Date(row.last_updated as string),
      } satisfies HealthScoreState));

    const circuits = this.db
      .query(
        `SELECT key_id, state, failure_count, last_failure_time, next_attempt_time, opened_at FROM circuit_breaker_states`,
      )
      .all()
      .map((row: any) => ({
        keyId: row.key_id as string,
        state: row.state as CircuitState,
        failureCount: Number(row.failure_count ?? 0),
        lastFailureTime: row.last_failure_time ? new Date(row.last_failure_time as string) : null,
        nextAttemptTime: row.next_attempt_time ? new Date(row.next_attempt_time as string) : null,
        openedAt: row.opened_at ? new Date(row.opened_at as string) : null,
      } satisfies CircuitBreakerState));

    const metrics = this.db
      .query(
        `SELECT key_id, timestamp, request_count, success_count, error_count, avg_latency, p95_latency FROM request_metrics ORDER BY timestamp DESC LIMIT 1000`,
      )
      .all()
      .map((row: any) => ({
        keyId: row.key_id as string,
        timestamp: new Date(row.timestamp as string),
        requestCount: Number(row.request_count ?? 0),
        successCount: Number(row.success_count ?? 0),
        errorCount: Number(row.error_count ?? 0),
        avgLatencyMs: Number(row.avg_latency ?? 0),
        p95LatencyMs: Number(row.p95_latency ?? 0),
      } satisfies RequestMetricsSnapshot));

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
}

export class JsonStateStore implements StateStore {
  constructor(private readonly path: string) {
    ensureDir(path);
  }

  init(): void {
    if (!existsSync(this.path)) {
      writeFileSync(this.path, JSON.stringify({ keys: [], health: [], circuits: [], metrics: [] }));
    }
  }

  load(): PersistedState {
    if (!existsSync(this.path)) {
      return { keys: [], health: [], circuits: [], metrics: [] };
    }
    const raw = readFileSync(this.path, "utf8");
    if (!raw) {
      return { keys: [], health: [], circuits: [], metrics: [] };
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
      } satisfies PersistedState;
    } catch (error) {
      logger.error({ error }, "Failed to parse fallback persistence file; starting empty state");
      return { keys: [], health: [], circuits: [], metrics: [] };
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
}
