# Implementation Architecture & Phases

## Core Architecture

### Request Flow

```
Client → HTTP Server (port 4806) → Router → Key Manager → Circuit Breaker → Gemini API
                                        ↓
                                  Health Monitor → Persistence Layer (SQLite)
```

### Module Structure

- **HTTP Server** (`server.ts`): Bun.serve() handling async routing
- **Router** (`router.ts`): Path normalization, header forwarding
- **Key Manager** (`key-manager.ts`): Round-robin selection, key health
- **Health Monitor** (`health-monitor.ts`): Score calculation, failure tracking
- **Circuit Breaker** (`circuit-breaker.ts`): Key disabling, cooldown management
- **Persistence Layer** (`persistence.ts`): SQLite state management
- **Config Loader** (`config.ts`): YAML parsing, hot reload support

## Implementation Phases

### Phase 1: Core Proxy (Current)

- [x] Project setup with Bun and TypeScript
- [ ] Basic HTTP server on port 4806
- [ ] Request forwarding to Gemini API
- [ ] Static API key rotation
- [ ] SQLite persistence setup
- [ ] Structured logging

### Phase 2: Health & Resilience

- [ ] Health scoring algorithm (0.0-1.0 weighted average)
- [ ] Circuit breaker implementation
- [ ] Exponential backoff for failed keys
- [ ] Admin endpoints for key management
- [ ] Automatic retry with alternate keys

### Phase 3: Observability

- [ ] Prometheus metrics endpoint (`/metrics`)
- [ ] Health check endpoint (`/health`)
- [ ] Debug endpoint for key status
- [ ] Request ID tracking
- [ ] Latency measurements
- [ ] JSON export/import for state

### Phase 4: Production Hardening

- [ ] Configuration hot reload (SIGHUP)
- [ ] Graceful shutdown handling
- [ ] Request rate limiting
- [ ] TLS support (optional)
- [ ] Docker containerization
- [ ] Load testing suite

## Key Technical Decisions

### Database Schema (SQLite)

```sql
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  name TEXT,
  key TEXT NOT NULL,
  health_score REAL DEFAULT 1.0,
  success_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  last_failure TIMESTAMP,
  cooldown_until TIMESTAMP,
  is_enabled BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE request_logs (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  key_id TEXT,
  status_code INTEGER,
  latency_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Configuration Format (YAML)

```yaml
api_keys:
  - name: "primary"
    key: "sk-..."
    weight: 2 # Optional: higher weight = more traffic
  - name: "secondary"
    key: "sk-..."
    cooldown_seconds: 300 # Optional: custom cooldown

settings:
  health_threshold: 0.3
  max_retries: 2
  timeout_ms: 30000
  checkpoint_interval: 100 # Save state every N requests
```

### API Compatibility Mapping

- Path: `/v1/*` → `https://generativelanguage.googleapis.com/v1beta/openai/*`
- Headers: Preserve all except Authorization
- Auth: Inject `Authorization: Bearer {selected_key}`
- Errors: Map Gemini errors to OpenAI format

### Health Score Calculation

```typescript
// Weighted moving average
newScore = 0.7 * currentScore + 0.3 * recentSuccessRate;
// Where recentSuccessRate = successes / (successes + failures) over last N requests
```

### Circuit Breaker States

1. **Closed** (healthy): Normal operation
2. **Open** (unhealthy): All requests fail fast
3. **Half-Open** (recovering): Test with limited traffic

### Performance Targets

- Proxy latency: < 100ms p99
- Health check: < 10ms
- Key rotation: < 1ms
- State checkpoint: < 50ms
- Graceful shutdown: < 5s

## Testing Strategy

### Unit Tests

- Key selection algorithm
- Health score calculation
- Circuit breaker state transitions
- Error classification logic

### Integration Tests

- End-to-end proxy requests
- Retry behavior on 429/5xx
- State persistence/recovery
- Config hot reload

### Load Tests

```bash
# Using k6 or similar
k6 run --vus 100 --duration 30s load-test.js
```

## Monitoring & Alerts

### Key Metrics

- `proxy_requests_total{status,key}`
- `proxy_request_duration_seconds`
- `api_key_health_score{key}`
- `circuit_breaker_state{key}`

### Alert Conditions

- All keys unhealthy > 1 minute
- Proxy latency > 200ms p99
- Error rate > 10%
- No successful requests > 30s
