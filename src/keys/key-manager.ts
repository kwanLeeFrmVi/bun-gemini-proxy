import { randomInt } from "node:crypto";
import { logger } from "../observability/logger.ts";
import { observeKeyHealth } from "../observability/metrics.ts";
import type { ApiKeyConfig, MonitoringConfig } from "../types/config.ts";
import type {
  ApiKeyRecord,
  CircuitBreakerState,
  CircuitState,
  HealthScoreState,
  KeySelectionResult,
  KeyStatusSummary,
} from "../types/key.ts";
import type { PersistedState, StateStore } from "../persistence/state-store.ts";

const CIRCUIT_STATE_VALUE: Record<CircuitState, number> = {
  CLOSED: 0,
  OPEN: 2,
  HALF_OPEN: 1,
};

export interface KeyManagerOptions {
  monitoring: MonitoringConfig;
  persistence: StateStore;
}

interface InternalKeyState {
  record: ApiKeyRecord;
  health: HealthScoreState;
  circuit: CircuitBreakerState;
}

export class KeyManager {
  private readonly keys = new Map<string, InternalKeyState>();
  private failureThreshold: number;
  private recoveryTimeMs: number;
  private windowMs: number;
  private readonly persistence: StateStore;

  constructor(options: KeyManagerOptions) {
    this.persistence = options.persistence;
    this.failureThreshold = Math.max(1, options.monitoring.failureThreshold);
    this.recoveryTimeMs = Math.max(0, options.monitoring.recoveryTimeSeconds * 1000);
    this.windowMs = Math.max(1000, options.monitoring.windowSeconds * 1000);
  }

  updateMonitoringConfig(config: MonitoringConfig): void {
    this.failureThreshold = Math.max(1, config.failureThreshold);
    this.recoveryTimeMs = Math.max(0, config.recoveryTimeSeconds * 1000);
    this.windowMs = Math.max(1000, config.windowSeconds * 1000);
  }

  bootstrap(configKeys: ApiKeyConfig[], persisted: PersistedState): void {
    const persistedById = new Map<string, InternalKeyState>();
    persisted.keys.forEach((key) => {
      persistedById.set(key.id, {
        record: key,
        health:
          persisted.health.find((state) => state.keyId === key.id) ??
          this.createDefaultHealthState(key.id),
        circuit:
          persisted.circuits.find((state) => state.keyId === key.id) ??
          this.createDefaultCircuitState(key.id),
      });
    });

    configKeys.forEach((configKey) => {
      const id = this.deriveId(configKey.key, configKey.name);
      const existing = persistedById.get(id);
      const record: ApiKeyRecord = existing?.record ?? {
        id,
        key: configKey.key,
        name: configKey.name,
        weight: configKey.weight ?? 1,
        isActive: true,
        createdAt: existing?.record?.createdAt ?? new Date(),
        lastUsedAt: existing?.record?.lastUsedAt ?? null,
        cooldownSeconds: configKey.cooldownSeconds ?? 30,
      };
      record.key = configKey.key;
      record.name = configKey.name;
      record.weight = Math.max(1, configKey.weight ?? record.weight ?? 1);
      record.cooldownSeconds = configKey.cooldownSeconds ?? record.cooldownSeconds ?? 30;
      record.isActive = existing?.record?.isActive ?? true;

      const health = existing?.health ?? this.createDefaultHealthState(id);
      const circuit = existing?.circuit ?? this.createDefaultCircuitState(id);

      this.keys.set(id, { record, health, circuit });
      this.persistState(id);
    });

    // Remove keys that disappeared from config
    [...this.keys.entries()].forEach(([id, state]) => {
      if (!configKeys.some((configKey) => this.deriveId(configKey.key, configKey.name) === id)) {
        this.keys.delete(id);
        logger.info({ keyId: id }, "Removed key no longer present in configuration");
      } else {
        observeKeyHealth(id, state.record.name, state.health.score, CIRCUIT_STATE_VALUE[state.circuit.state]);
      }
    });
  }

  deriveId(key: string, name: string): string {
    if (name) {
      return name;
    }
    const visible = key.slice(0, 8);
    return `gemini-key-${visible}`;
  }

  listKeys(): KeyStatusSummary[] {
    return [...this.keys.values()].map(({ record, health, circuit }) => ({
      id: record.id,
      name: record.name,
      status: this.describeStatus(record, circuit),
      healthScore: Number(health.score.toFixed(4)),
      lastUsed: record.lastUsedAt,
      failureCount: circuit.failureCount,
      nextRetry: circuit.nextAttemptTime,
      weight: record.weight,
    }));
  }

  selectKey(): KeySelectionResult | null {
    const candidates: InternalKeyState[] = [];
    this.keys.forEach((state) => {
      this.evaluateCircuitState(state.record.id);
      const status = this.describeStatus(state.record, state.circuit);
      if (status === "active" || status === "circuit_half_open") {
        const multiplier = Math.max(1, state.record.weight);
        for (let i = 0; i < multiplier; i += 1) {
          candidates.push(state);
        }
      }
    });

    if (candidates.length === 0) {
      return null;
    }

    const index = randomInt(candidates.length);
    const selected = candidates[index];
    if (!selected) {
      // This should be unreachable given the length check, but it satisfies the compiler.
      return null;
    }
    return {
      record: selected.record,
      health: selected.health,
      circuit: selected.circuit,
    } satisfies KeySelectionResult;
  }

  recordSuccess(keyId: string, latencyMs: number): void {
    const state = this.keys.get(keyId);
    if (!state) {
      return;
    }

    const now = new Date();
    this.rollWindow(state.health, now);

    state.health.successCount += 1;
    state.health.score = this.calculateScore(state.health);
    state.health.lastUpdated = now;
    state.record.lastUsedAt = now;

    if (state.circuit.state === "HALF_OPEN") {
      state.circuit.state = "CLOSED";
      state.circuit.failureCount = 0;
      state.circuit.lastFailureTime = null;
      state.circuit.openedAt = null;
      state.circuit.nextAttemptTime = null;
      logger.info({ keyId }, "Circuit closed for key after successful recovery");
    } else if (state.circuit.state === "OPEN") {
      // This should not happen, but as a safeguard:
      state.circuit = this.createDefaultCircuitState(keyId);
    }

    observeKeyHealth(keyId, state.record.name, state.health.score, CIRCUIT_STATE_VALUE[state.circuit.state]);
    this.persistState(keyId);
    this.persistence.recordRequestMetrics({
      keyId,
      timestamp: now,
      requestCount: 1,
      successCount: 1,
      errorCount: 0,
      avgLatencyMs: latencyMs,
      p95LatencyMs: latencyMs,
    });
  }

  recordFailure(keyId: string, reason: string, isRateLimit: boolean, latencyMs: number): void {
    const state = this.keys.get(keyId);
    if (!state) {
      return;
    }

    const now = new Date();
    this.rollWindow(state.health, now);

    state.health.failureCount += 1;
    state.health.score = this.calculateScore(state.health);
    state.health.lastUpdated = now;

    state.circuit.failureCount += 1;
    state.circuit.lastFailureTime = now;

    const thresholdReached = state.circuit.failureCount >= this.failureThreshold;
    if (isRateLimit || thresholdReached) {
      state.circuit.state = "OPEN";
      state.circuit.openedAt = now;
      state.circuit.nextAttemptTime = new Date(now.getTime() + this.recoveryTimeMs);
      logger.warn({ keyId, reason }, "Circuit opened for key");
    }

    observeKeyHealth(keyId, state.record.name, state.health.score, CIRCUIT_STATE_VALUE[state.circuit.state]);
    this.persistState(keyId);
    this.persistence.recordRequestMetrics({
      keyId,
      timestamp: now,
      requestCount: 1,
      successCount: 0,
      errorCount: 1,
      avgLatencyMs: latencyMs,
      p95LatencyMs: latencyMs,
    });
  }

  evaluateCircuitState(keyId: string): void {
    const state = this.keys.get(keyId);
    if (!state) {
      return;
    }

    if (state.circuit.state === "OPEN" && state.circuit.nextAttemptTime && state.circuit.nextAttemptTime.getTime() <= Date.now()) {
      state.circuit.state = "HALF_OPEN";
      state.circuit.nextAttemptTime = null;
      logger.info({ keyId }, "Circuit half-open; allowing limited traffic");
      observeKeyHealth(
        keyId,
        state.record.name,
        state.health.score,
        CIRCUIT_STATE_VALUE[state.circuit.state],
      );
      this.persistState(keyId);
    }
  }

  enableKey(keyId: string): boolean {
    const state = this.keys.get(keyId);
    if (!state) {
      return false;
    }

    state.record.isActive = true;
    state.circuit = this.createDefaultCircuitState(keyId);
    state.health = this.createDefaultHealthState(keyId);
    observeKeyHealth(keyId, state.record.name, state.health.score, CIRCUIT_STATE_VALUE[state.circuit.state]);
    this.persistState(keyId);
    return true;
  }

  disableKey(keyId: string): boolean {
    const state = this.keys.get(keyId);
    if (!state) {
      return false;
    }

    state.record.isActive = false;
    observeKeyHealth(keyId, state.record.name, state.health.score, CIRCUIT_STATE_VALUE[state.circuit.state]);
    this.persistState(keyId);
    return true;
  }

  applyConfigUpdate(configKeys: ApiKeyConfig[]): void {
    const existingIds = new Set(this.keys.keys());

    configKeys.forEach((configKey) => {
      const id = this.deriveId(configKey.key, configKey.name);
      const existing = this.keys.get(id);
      const baseRecord: ApiKeyRecord = existing?.record ?? {
        id,
        key: configKey.key,
        name: configKey.name,
        weight: configKey.weight ?? 1,
        isActive: true,
        createdAt: new Date(),
        lastUsedAt: null,
        cooldownSeconds: configKey.cooldownSeconds ?? 30,
      };

      baseRecord.key = configKey.key;
      baseRecord.name = configKey.name;
      baseRecord.weight = Math.max(1, configKey.weight ?? baseRecord.weight ?? 1);
      baseRecord.cooldownSeconds = configKey.cooldownSeconds ?? baseRecord.cooldownSeconds ?? 30;

      const health = existing?.health ?? this.createDefaultHealthState(id);
      const circuit = existing?.circuit ?? this.createDefaultCircuitState(id);

      this.keys.set(id, { record: baseRecord, health, circuit });
      observeKeyHealth(id, baseRecord.name, health.score, CIRCUIT_STATE_VALUE[circuit.state]);
      this.persistState(id);
      existingIds.delete(id);
    });

    existingIds.forEach((id) => {
      this.keys.delete(id);
      logger.info({ keyId: id }, "Removed key after config reload");
    });
  }

  getActiveKeyCount(): number {
    return this.listKeys().filter((key) => key.status === "active").length;
  }

  private describeStatus(record: ApiKeyRecord, circuit: CircuitBreakerState): KeyStatusSummary["status"] {
    if (!record.isActive) {
      return "disabled";
    }
    if (circuit.state === "OPEN") {
      return "circuit_open";
    }
    if (circuit.state === "HALF_OPEN") {
      return "circuit_half_open";
    }
    return "active";
  }

  private rollWindow(health: HealthScoreState, now: Date): void {
    if (now.getTime() - health.windowStartTime.getTime() >= this.windowMs) {
      health.successCount = 0;
      health.failureCount = 0;
      health.windowStartTime = now;
    }
  }

  private calculateScore(health: HealthScoreState): number {
    const total = health.successCount + health.failureCount;
    if (total <= 0) {
      return 1;
    }
    return Math.max(0, Math.min(1, health.successCount / total));
  }

  private createDefaultHealthState(keyId: string): HealthScoreState {
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

  private createDefaultCircuitState(keyId: string): CircuitBreakerState {
    return {
      keyId,
      state: "CLOSED",
      failureCount: 0,
      lastFailureTime: null,
      nextAttemptTime: null,
      openedAt: null,
    };
  }

  private persistState(keyId: string): void {
    const state = this.keys.get(keyId);
    if (!state) {
      return;
    }
    try {
      this.persistence.upsertKey(state.record, state.health, state.circuit);
    } catch (error) {
      logger.error({ error, keyId }, "Failed to persist key state");
    }
  }
}
