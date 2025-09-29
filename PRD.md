# Gemini Proxy Server PRD

## Overview
- Build a Bun-based HTTP proxy at `http://localhost:4806/v1` that forwards requests to `https://generativelanguage.googleapis.com/v1beta/openai/`.
- Ensure drop-in OpenAI compatibility by preserving paths, payloads, and response schemas.
- Implement automated key rotation, health monitoring, and circuit breaking to maximize uptime under rate limits.
- Persist operational state in SQLite so restarts do not lose key health, usage history, or configuration context.

## Goals
- Deliver low-latency, reliable request forwarding with async, non-blocking handlers.
- Balance load across healthy keys while respecting per-key quotas and limits.
- Provide actionable health metrics, logs, and admin endpoints for operational visibility.
- Keep configuration simple (YAML for keys, SQLite for state with optional JSON fallback) and developer-friendly.

## Non-Goals
- No UI dashboard beyond basic HTTP endpoints.
- No automated acquisition or provisioning of new API keys.
- No detailed billing or quota analytics beyond operational metrics.
- No multi-tenant isolation beyond per-key health tracking.

## Personas & Use Cases
- Backend engineers needing Gemini access via existing OpenAI SDKs.
- Ops teams managing rotating credentials for production workloads.
- QA or research teams simulating OpenAI-compatible workloads against Gemini.
- Power users running a local dev proxy to experiment with Gemini features.

## Success Metrics
- Proxy overhead adds <100 ms average latency per request under nominal load.
- ≥99% of requests routed through healthy keys without manual intervention.
- Failed keys automatically recover within 5 minutes of stable responses.
- Zero state loss (keys, health scores) across controlled restarts.

## Architecture
- Client → Router → Key Manager → Circuit Breaker → Gemini API.
- Response Handler and Error Handler return results to client while reporting health metrics.
- Modular design to allow independent testing of routing, health, and persistence layers.

## Core Components
- **HTTP Server:** Handles async routing, request parsing, and streaming responses.
- **Router:** Normalizes endpoints, forwards headers, and manages retries.
- **Key Manager:** Maintains round-robin queue, health scores, and key metadata.
- **Health Monitor:** Aggregates successes/failures to update health scores.
- **Circuit Breaker:** Disables unhealthy keys and schedules cooldowns.
- **Persistence Layer:** Stores key state in SQLite with optional JSON export for restart recovery.

## Configuration & Data
- YAML file lists API keys with optional metadata (friendly name, weight, cooldown overrides).
- Support hot reload via SIGHUP or admin endpoint to refresh configuration.
- Persist per-key metrics (`success_count`, `error_count`, `score`, `last_failure`).
- Provide defaults for retry counts, timeout thresholds, and failure windows.

## Key Rotation & Health
- Round-robin selection skips keys below a configurable health threshold.
- Compute health score as weighted moving average of recent successes and failures (0.0–1.0).
- Apply exponential backoff for re-entry after repeated failures with a maximum cooldown cap.
- Provide admin endpoint to enable, disable, or reprioritize keys manually.

## Routing & API Behavior
- Preserve request paths and query params beyond `/v1`, adjusting only the upstream base URL.
- Forward relevant headers (auth, content-type) while injecting the selected API key.
- Stream responses and errors without buffering large payloads.
- Map Gemini error shapes to OpenAI-style JSON envelopes while preserving status codes.

## Fault Tolerance
- Retry idempotent requests once with an alternate key on 5xx/429 responses.
- Trip circuit breaker after configurable failure thresholds and return informative errors.
- Fall back to 503 when all keys are unhealthy while surfacing debug context for operators.
- Graceful shutdown drains in-flight requests, saves state, and closes listeners.

## Persistence & State
- Default to SQLite-backed snapshots; provide optional JSON export/import for portability.
- Checkpoint state periodically (after N requests or every T seconds) plus during shutdown.
- Version persisted schema to support future upgrades without destructive migrations.
- Allow persistence to be disabled for ephemeral or stateless deployments.

## Observability & Tooling
- Emit structured logs with request ID, key ID, latency, and outcome classification.
- Expose Prometheus-style metrics endpoint for per-key success, failure, and latency counters.
- Provide health endpoint summarizing active, disabled, and recovering keys with last error.
- Offer optional debug endpoint to inspect in-memory rotation orders and key status.

## Security & Compliance
- Never log raw API keys; mask all secrets in output and traces.
- Support TLS termination via reverse proxy or optional TLS listener configuration.
- Validate incoming payload size against configurable limits to prevent abuse.
- Add simple auth (static token or IP allowlist) for admin and debug endpoints.

## Testing Strategy
- Unit tests covering key selection, health scoring, and error classification logic.
- Integration tests using mock Gemini responses (200, 429, 5xx) to validate retry and fallback behavior.
- Load tests to measure async throughput, tail latency, and circuit breaker responsiveness.
- Restart/resume tests to ensure persistence preserves state under concurrent load.

## Release Plan
- **Phase 1:** Core proxy with static rotation, structured logging, SQLite persistence.
- **Phase 2:** Health scoring, circuit breaker, admin endpoints for key management.
- **Phase 3:** Metrics endpoint, Prometheus integration, JSON export tooling, config hot reload.
- **Phase 4:** Hardening, documentation, packaging (Dockerfile, Bun scripts).

## Risks & Open Questions
- Potential Gemini schema differences requiring adapter logic for full compatibility.
- Tuning health score formula for balance between responsiveness and stability.
- Operational considerations for SQLite durability and optional JSON export maintenance.
- Security expectations for admin endpoints in production deployments.

## Next Steps
- Confirm YAML schema details and SQLite schema/export strategy with stakeholders.
- Draft high-level technical design with module APIs, data flows, and error taxonomy.
- Build Phase 1 prototype to validate request flow, key rotation, and logging baseline.
