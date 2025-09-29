# Data Model: Gemini Proxy Server

**Generated**: 2025-09-29
**Feature**: Gemini Proxy Server

## Core Entities

### API Key
Represents a Gemini API key with health tracking and metadata.

**Fields**:
- `id`: string (unique identifier, first 8 chars of key)
- `key`: string (full API key, masked in logs)
- `name`: string (human-readable name from config)
- `weight`: number (rotation weight, default: 1)
- `isActive`: boolean (manually enabled/disabled state)
- `createdAt`: Date (when added to system)
- `lastUsedAt`: Date (last successful request)

**Validation Rules**:
- `id` must be unique across all keys
- `key` must start with expected Gemini API key prefix
- `weight` must be positive integer
- `name` must be non-empty string

**State Transitions**:
- New → Active (when first configured)
- Active ↔ Disabled (manual admin control)
- Active → Circuit Open (automatic on health failure)
- Circuit Open → Circuit Half-Open (automatic recovery attempt)
- Circuit Half-Open → Active (successful recovery)

### Health Score
Tracks the reliability of an API key over time.

**Fields**:
- `keyId`: string (foreign key to API Key)
- `score`: number (0.0-1.0, calculated as success/total ratio)
- `successCount`: number (successful requests in window)
- `failureCount`: number (failed requests in window)
- `windowStartTime`: Date (start of current measurement window)
- `lastUpdated`: Date (timestamp of last score update)

**Validation Rules**:
- `score` must be between 0.0 and 1.0
- `successCount` and `failureCount` must be non-negative
- `windowStartTime` must be in the past
- Score recalculated on each request outcome

**Calculation Logic**:
```typescript
score = successCount / (successCount + failureCount)
// Reset window after fixed time period (e.g., 5 minutes)
```

### Request Metrics
Aggregated metrics for monitoring and observability.

**Fields**:
- `keyId`: string (foreign key to API Key)
- `timestamp`: Date (metric collection time)
- `requestCount`: number (total requests in period)
- `successCount`: number (successful responses)
- `errorCount`: number (error responses by type)
- `avgLatency`: number (average response time in ms)
- `p95Latency`: number (95th percentile response time)

**Validation Rules**:
- All counts must be non-negative
- `avgLatency` and `p95Latency` must be positive
- `timestamp` must not be in future

**Aggregation Periods**:
- Real-time: per-request updates
- Minute: 60-second rolling windows
- Hour: 60-minute aggregates for dashboards

### Circuit Breaker State
Tracks the circuit breaker status for each API key.

**Fields**:
- `keyId`: string (foreign key to API Key)
- `state`: enum (CLOSED, OPEN, HALF_OPEN)
- `failureCount`: number (consecutive failures)
- `lastFailureTime`: Date (timestamp of last failure)
- `nextAttemptTime`: Date (when to retry in OPEN state)
- `openedAt`: Date (when circuit opened)

**Validation Rules**:
- `state` must be valid enum value
- `failureCount` must be non-negative
- `nextAttemptTime` must be in future when state is OPEN
- Failure threshold: 3 consecutive failures

**State Transitions**:
- CLOSED → OPEN: 3 consecutive failures
- OPEN → HALF_OPEN: automatic after cooldown period
- HALF_OPEN → CLOSED: successful request
- HALF_OPEN → OPEN: failed request

### Configuration
System-wide configuration settings and API key definitions.

**Fields**:
- `proxy`: ProxyConfig (server settings)
- `keys`: ApiKeyConfig[] (array of key configurations)
- `monitoring`: MonitoringConfig (health check settings)
- `loadedAt`: Date (when config was last loaded)
- `version`: string (config file version for change tracking)

**Configuration Types**:
```typescript
interface ProxyConfig {
  port: number;
  host: string;
  maxPayloadSize: number;
  adminToken: string;
}

interface ApiKeyConfig {
  name: string;
  key: string;
  weight?: number;
  cooldown?: number;
}

interface MonitoringConfig {
  healthCheckInterval: number;
  failureThreshold: number;
  recoveryTime: number;
}
```

**Validation Rules**:
- `port` must be valid port number (1-65535)
- `maxPayloadSize` must be positive
- `adminToken` must be non-empty
- Each key must have unique name

## Relationships

### API Key ← Health Score
- One-to-one relationship
- Health Score created when API Key is added
- Health Score deleted when API Key is removed

### API Key ← Request Metrics
- One-to-many relationship
- Multiple metric records per key over time
- Metrics retained for historical analysis

### API Key ← Circuit Breaker State
- One-to-one relationship
- Circuit Breaker State created when API Key is added
- State persists across service restarts

### Configuration → API Key
- Configuration defines available API Keys
- Changes trigger key pool updates
- Hot reload preserves existing health data

## Persistence Strategy

### SQLite Schema
```sql
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  name TEXT NOT NULL UNIQUE,
  weight INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME
);

CREATE TABLE health_scores (
  key_id TEXT PRIMARY KEY,
  score REAL NOT NULL DEFAULT 1.0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  window_start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (key_id) REFERENCES api_keys(id)
);

CREATE TABLE request_metrics (
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

CREATE TABLE circuit_breaker_states (
  key_id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'CLOSED',
  failure_count INTEGER DEFAULT 0,
  last_failure_time DATETIME,
  next_attempt_time DATETIME,
  opened_at DATETIME,
  FOREIGN KEY (key_id) REFERENCES api_keys(id)
);
```

### Data Lifecycle
- **Startup**: Load configuration, restore state from SQLite
- **Runtime**: Update health scores and metrics on each request
- **Shutdown**: Persist final state to SQLite
- **Cleanup**: Archive old metrics based on retention policy