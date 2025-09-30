import { logger } from "../observability/logger.ts";
import { observeKeyHealth } from "../observability/metrics.ts";
import type { ApiKeyConfig, MonitoringConfig } from "../types/config.ts";
import type {
  ApiKeyRecord,
  CircuitState,
  KeySelectionResult,
  KeyStatusSummary,
} from "../types/key.ts";
import type { PersistedState } from "../persistence/types.ts";
import type { KeyManagerOptions, InternalKeyState } from "./types.ts";
import { KeySelector } from "./key-selector.ts";
import { HealthTracker } from "./health-tracker.ts";
import { CircuitBreaker } from "./circuit-breaker.ts";

const CIRCUIT_STATE_VALUE: Record<CircuitState, number> = {
  CLOSED: 0,
  OPEN: 2,
  HALF_OPEN: 1,
};

/**
 * KeyManager orchestrates API key management including:
 * - Key selection with weighted random distribution
 * - Health score tracking with sliding windows
 * - Circuit breaker pattern for failure protection
 * - State persistence
 *
 * This class delegates specific responsibilities to:
 * - KeySelector: Weighted random key selection
 * - HealthTracker: Health score calculation
 * - CircuitBreaker: Circuit breaker state machine
 */
export class KeyManager {
  private readonly keys = new Map<string, InternalKeyState>();
  private readonly persistence: KeyManagerOptions["persistence"];
  private readonly selector: KeySelector;
  private healthTracker: HealthTracker;
  private circuitBreaker: CircuitBreaker;

  constructor(options: KeyManagerOptions) {
    this.persistence = options.persistence;
    this.selector = new KeySelector();
    this.healthTracker = new HealthTracker(options.monitoring.windowSeconds);
    this.circuitBreaker = new CircuitBreaker(
      options.monitoring.failureThreshold,
      options.monitoring.recoveryTimeSeconds,
    );
  }

  /**
   * Update monitoring configuration and recreate dependent components.
   */
  updateMonitoringConfig(config: MonitoringConfig): void {
    this.healthTracker = new HealthTracker(config.windowSeconds);
    this.circuitBreaker = new CircuitBreaker(config.failureThreshold, config.recoveryTimeSeconds);
  }

  /**
   * Bootstrap the key manager with configuration and persisted state.
   * Merges config keys with persisted state, preferring persistence for runtime values.
   */
  bootstrap(configKeys: ApiKeyConfig[], persisted: PersistedState): void {
    const persistedById = new Map<string, InternalKeyState>();
    persisted.keys.forEach((key) => {
      persistedById.set(key.id, {
        record: key,
        health: persisted.health.find((state) => state.keyId === key.id) ?? this.healthTracker.createDefault(key.id),
        circuit: persisted.circuits.find((state) => state.keyId === key.id) ?? this.circuitBreaker.createDefault(key.id),
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

      // Update mutable fields from config
      record.key = configKey.key;
      record.name = configKey.name;
      record.weight = Math.max(1, configKey.weight ?? record.weight ?? 1);
      record.cooldownSeconds = configKey.cooldownSeconds ?? record.cooldownSeconds ?? 30;
      record.isActive = existing?.record?.isActive ?? true;

      const health = existing?.health ?? this.healthTracker.createDefault(id);
      const circuit = existing?.circuit ?? this.circuitBreaker.createDefault(id);

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

  /**
   * Derive a unique key ID from its value and name.
   */
  deriveId(key: string, name: string): string {
    if (name) {
      return name;
    }
    const visible = key.slice(0, 8);
    return `gemini-key-${visible}`;
  }

  /**
   * List all keys with their current status.
   */
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

  /**
   * Select an eligible key using weighted random distribution.
   * Evaluates circuit states before selection.
   */
  selectKey(isMockMode = false): KeySelectionResult | null {
    const candidates: InternalKeyState[] = [];

    this.keys.forEach((state) => {
      // Evaluate circuit state transitions
      const evaluatedCircuit = this.circuitBreaker.evaluate(state.circuit);
      if (evaluatedCircuit !== state.circuit) {
        state.circuit = evaluatedCircuit;
        observeKeyHealth(state.record.id, state.record.name, state.health.score, CIRCUIT_STATE_VALUE[state.circuit.state]);
        this.persistState(state.record.id);
      }

      // Check eligibility
      if (this.selector.isEligible(state.record.isActive, state.circuit.state, isMockMode)) {
        candidates.push(state);
      }
    });

    const selected = this.selector.select(candidates.map((s) => ({ record: s.record, circuit: s.circuit })));
    if (!selected) {
      return null;
    }

    const state = this.keys.get(selected.record.id);
    if (!state) {
      return null;
    }

    return {
      record: state.record,
      health: state.health,
      circuit: state.circuit,
    } satisfies KeySelectionResult;
  }

  /**
   * Record a successful request for a key.
   */
  recordSuccess(keyId: string, latencyMs: number): void {
    const state = this.keys.get(keyId);
    if (!state) {
      return;
    }

    const now = new Date();
    state.health = this.healthTracker.recordSuccess(state.health);
    state.circuit = this.circuitBreaker.recordSuccess(state.circuit);
    state.record.lastUsedAt = now;

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

  /**
   * Record a failed request for a key.
   */
  recordFailure(keyId: string, reason: string, isRateLimit: boolean, latencyMs: number): void {
    const state = this.keys.get(keyId);
    if (!state) {
      return;
    }

    const now = new Date();
    state.health = this.healthTracker.recordFailure(state.health);
    state.circuit = this.circuitBreaker.recordFailure(state.circuit, reason, isRateLimit);

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

  /**
   * Evaluate circuit state for a key (transition OPEN → HALF_OPEN if recovery time elapsed).
   */
  evaluateCircuitState(keyId: string): void {
    const state = this.keys.get(keyId);
    if (!state) {
      return;
    }

    const evaluated = this.circuitBreaker.evaluate(state.circuit);
    if (evaluated !== state.circuit) {
      state.circuit = evaluated;
      observeKeyHealth(keyId, state.record.name, state.health.score, CIRCUIT_STATE_VALUE[state.circuit.state]);
      this.persistState(keyId);
    }
  }

  /**
   * Enable a disabled key and reset its health/circuit state.
   */
  enableKey(keyId: string): boolean {
    const state = this.keys.get(keyId);
    if (!state) {
      return false;
    }

    state.record.isActive = true;
    state.circuit = this.circuitBreaker.reset(state.circuit);
    state.health = this.healthTracker.createDefault(keyId);
    observeKeyHealth(keyId, state.record.name, state.health.score, CIRCUIT_STATE_VALUE[state.circuit.state]);
    this.persistState(keyId);
    return true;
  }

  /**
   * Disable a key to prevent it from being selected.
   */
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

  /**
   * Apply configuration updates dynamically (hot reload).
   */
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

      const health = existing?.health ?? this.healthTracker.createDefault(id);
      const circuit = existing?.circuit ?? this.circuitBreaker.createDefault(id);

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

  /**
   * Get count of active (eligible) keys.
   */
  getActiveKeyCount(): number {
    return this.listKeys().filter((key) => key.status === "active").length;
  }

  /**
   * Describe the human-readable status of a key.
   */
  private describeStatus(record: ApiKeyRecord, circuit: { state: CircuitState }): KeyStatusSummary["status"] {
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

  /**
   * Persist the state of a single key.
   */
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