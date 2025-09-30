import type { MonitoringConfig } from "../types/config.ts";
import type { StateStore } from "../persistence/types.ts";
import type { ApiKeyRecord, CircuitBreakerState, HealthScoreState } from "../types/key.ts";

/**
 * KeyManagerOptions defines the configuration needed to create a KeyManager.
 */
export interface KeyManagerOptions {
  monitoring: MonitoringConfig;
  persistence: StateStore;
}

/**
 * InternalKeyState represents the complete state for a single key.
 * Combines the key record with its health and circuit breaker state.
 */
export interface InternalKeyState {
  record: ApiKeyRecord;
  health: HealthScoreState;
  circuit: CircuitBreakerState;
}