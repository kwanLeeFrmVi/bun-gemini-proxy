export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface ApiKeyRecord {
  id: string;
  name: string;
  key: string;
  weight: number;
  isActive: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
  cooldownSeconds: number;
}

export interface HealthScoreState {
  keyId: string;
  score: number;
  successCount: number;
  failureCount: number;
  windowStartTime: Date;
  lastUpdated: Date;
}

export interface CircuitBreakerState {
  keyId: string;
  state: CircuitState;
  failureCount: number;
  lastFailureTime: Date | null;
  nextAttemptTime: Date | null;
  openedAt: Date | null;
}

export interface RequestMetricsSnapshot {
  keyId: string;
  timestamp: Date;
  requestCount: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

export interface KeyStatusSummary {
  id: string;
  name: string;
  status: "active" | "disabled" | "circuit_open" | "circuit_half_open";
  healthScore: number;
  lastUsed: Date | null;
  failureCount: number;
  nextRetry: Date | null;
  weight: number;
}

export type KeySelectionResult = {
  record: ApiKeyRecord;
  circuit: CircuitBreakerState;
  health: HealthScoreState;
};
