import type {
  ApiKeyRecord,
  CircuitBreakerState,
  HealthScoreState,
  RequestMetricsSnapshot,
} from "../types/key.ts";
import type { UsageStats } from "./stats-calculator.ts";

/**
 * PersistedState represents the complete state snapshot
 * that can be saved and loaded from storage.
 */
export interface PersistedState {
  keys: ApiKeyRecord[];
  health: HealthScoreState[];
  circuits: CircuitBreakerState[];
  metrics: RequestMetricsSnapshot[];
}

/**
 * StateStore defines the interface for persisting proxy state.
 * Implementations include SQLite (primary) and JSON (fallback).
 */
export interface StateStore {
  /**
   * Initialize the storage backend (create tables, files, etc).
   */
  init(): void;

  /**
   * Load the complete persisted state.
   */
  load(): PersistedState;

  /**
   * Save the complete state snapshot.
   */
  save(state: PersistedState): void;

  /**
   * Upsert a single key with its health and circuit state.
   */
  upsertKey(record: ApiKeyRecord, health: HealthScoreState, circuit: CircuitBreakerState): void;

  /**
   * Record a request metrics snapshot.
   */
  recordRequestMetrics(snapshot: RequestMetricsSnapshot): void;

  /**
   * Get usage statistics for the last 24 hours.
   */
  getDailyUsageStats(): UsageStats[];

  /**
   * Get usage statistics for the last 7 days.
   */
  getWeeklyUsageStats(): UsageStats[];
}