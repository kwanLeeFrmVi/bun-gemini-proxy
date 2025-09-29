# Tasks: Gemini OpenAI-Compatible Proxy Server

**Input**: Design documents from `specs/002-read-prd-md/`
**Prerequisites**: `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

## Phase 3.1: Setup

- [ ] T001 Establish Bun service skeleton (create `src/server/`, `src/router/`, `src/keys/`, `src/health/`, `src/persistence/`, `src/observability/`, `src/admin/`, `src/types/`, `tests/` directories) and stub `src/server/server.ts` aligned with plan structure.
- [ ] T002 Update `package.json` and `bun.lock` to add runtime deps (`yaml`, `prom-client`, `undici`, structured logging lib) plus scripts for `bun test` and `bun run src/server/server.ts`.
- [ ] T003 [P] Configure linting/formatting (`eslint.config.js`, `.prettierrc`, `package.json` script) and ensure Bun hooks (`bun lint`) are wired.

## Phase 3.2: Tests First (TDD)

- [ ] T004 [P] Generate contract tests from `contracts/proxy-api.yaml` in `tests/contract/proxy-api.test.ts` to assert `/v1/chat/completions` and `/v1/models` OpenAI schema parity.
- [ ] T005 [P] Generate contract tests from `contracts/admin-api.yaml` in `tests/contract/admin-api.test.ts` covering all admin responses and auth failures.
- [ ] T006 [P] Author integration test for OpenAI SDK compatibility scenario in `tests/integration/proxy-openai-compat.test.ts` using mocked Gemini responses.
- [ ] T007 [P] Author integration test for automatic key rotation in `tests/integration/key-rotation.test.ts` asserting circuit breaker behavior.
- [ ] T008 [P] Author integration test for state persistence across restarts in `tests/integration/state-persistence.test.ts` validating SQLite + JSON fallback state restore.
- [ ] T009 [P] Author integration test for operational visibility in `tests/integration/admin-visibility.test.ts` covering `/admin/health`, `/admin/keys`, `/admin/metrics`.
- [ ] T010 [P] Author integration test for "all keys unhealthy" degradation in `tests/integration/all-keys-unhealthy.test.ts` expecting 503 + diagnostics.
- [ ] T011 [P] Author integration test for payload guardrails in `tests/integration/payload-guardrails.test.ts` enforcing size limits and validation errors.

## Phase 3.3: Core Implementation (ONLY after tests are failing)

- [ ] T012 [P] Define API key domain types and masking helpers in `src/types/api-key.ts` per `data-model.md`.
- [ ] T013 [P] Define health score domain types and calculation utilities in `src/types/health-score.ts` per `data-model.md`.
- [ ] T014 [P] Define request metrics domain types in `src/types/request-metrics.ts` per `data-model.md`.
- [ ] T015 [P] Define circuit breaker state types in `src/types/circuit-breaker.ts` per `data-model.md`.
- [ ] T016 [P] Define configuration schema and validation contracts in `src/types/config.ts` reflecting YAML structure.
- [ ] T017 Implement shared SQLite client and migration runner in `src/persistence/sqlite-client.ts` using `bun:sqlite`.
- [ ] T018 Implement schema migration `src/persistence/migrations/001_init.ts` provisioning tables from `data-model.md`.
- [ ] T019 [P] Implement API key repository in `src/persistence/api-key-repository.ts` with CRUD + masking logic.
- [ ] T020 [P] Implement health score repository in `src/persistence/health-score-repository.ts` with window management.
- [ ] T021 [P] Implement request metrics repository in `src/persistence/request-metrics-repository.ts` with aggregation helpers.
- [ ] T022 [P] Implement circuit breaker state repository in `src/persistence/circuit-breaker-repository.ts` tracking transitions.
- [ ] T023 Implement JSON import/export fallback for persistence snapshots in `src/persistence/json-backup.ts`.
- [ ] T024 Implement configuration loader + schema validation in `src/persistence/config-loader.ts` consuming YAML files.
- [ ] T025 Implement configuration hot-reload watcher in `src/persistence/config-watcher.ts` to refresh key pool safely.
- [ ] T026 Implement key manager with weighted rotation and manual overrides in `src/keys/key-manager.ts`.
- [ ] T027 Implement health monitoring service in `src/health/health-score-service.ts` updating scores post-request.
- [ ] T028 Implement circuit breaker controller in `src/health/circuit-breaker-service.ts` enforcing thresholds and cooldowns.
- [ ] T029 Implement metrics aggregator in `src/observability/metrics.ts` using `prom-client` for per-key metrics.
- [ ] T030 Implement structured logger utilities with secret masking in `src/observability/logger.ts`.
- [ ] T031 Implement Gemini API client adapter in `src/router/gemini-client.ts` leveraging `undici` and retry policies.
- [ ] T032 Implement request normalization helpers in `src/router/request-normalizer.ts` mapping OpenAI payloads to Gemini.
- [ ] T033 Implement `/v1/chat/completions` handler in `src/router/handlers/chat-completions.ts` with streaming support.
- [ ] T034 Implement `/v1/models` handler in `src/router/handlers/models.ts` returning mapped Gemini model list.
- [ ] T035 Compose public proxy router in `src/router/index.ts` wiring handlers and middleware pipeline.
- [ ] T036 Compose admin router shell in `src/admin/routes.ts` registering secured routes.
- [ ] T037 [P] Implement `/admin/health` handler in `src/admin/handlers/health.ts` summarizing key status + uptime.
- [ ] T038 [P] Implement `/admin/keys` handler in `src/admin/handlers/keys.ts` exposing per-key diagnostics.
- [ ] T039 [P] Implement `/admin/keys/{keyId}/enable` handler in `src/admin/handlers/enable-key.ts` toggling key manager state.
- [ ] T040 [P] Implement `/admin/keys/{keyId}/disable` handler in `src/admin/handlers/disable-key.ts` applying manual disable with audit logging.
- [ ] T041 [P] Implement `/admin/metrics` handler in `src/admin/handlers/metrics.ts` streaming Prometheus payloads.
- [ ] T042 [P] Implement `/admin/config/reload` handler in `src/admin/handlers/reload-config.ts` invoking loader with validation feedback.

## Phase 3.4: Integration & Platform

- [ ] T043 Implement admin bearer authentication middleware in `src/admin/middleware/auth.ts` honoring `config.proxy.adminToken`.
- [ ] T044 Implement payload validation middleware in `src/router/middleware/validate.ts` enforcing size and schema guards.
- [ ] T045 Implement request logging middleware in `src/router/middleware/logging.ts` integrating `logger` and masking secrets.
- [ ] T046 Implement circuit breaker middleware in `src/router/middleware/circuit-breaker.ts` to short-circuit unhealthy keys before handler execution.
- [ ] T047 Implement persistence bootstrap + state hydration in `src/server/bootstrap/persistence.ts` loading repositories on start.
- [ ] T048 Integrate observability and metrics endpoint exposure in `src/server/bootstrap/observability.ts` wiring `/admin/metrics` and counters.
- [ ] T049 Wire configuration watch + reload scheduling in `src/server/bootstrap/configuration.ts` to coordinate with key manager.
- [ ] T050 Compose full router stack in `src/server/bootstrap/router.ts` merging public and admin routers with middleware.
- [ ] T051 Implement graceful shutdown workflow in `src/server/shutdown.ts` flushing SQLite + metrics.
- [ ] T052 Finalize Bun server bootstrap in `src/server/server.ts` invoking `Bun.serve` with routers, middleware, shutdown hooks.
- [ ] T053 Implement CLI entrypoint in `index.ts` parsing env/config and launching `src/server/server.ts`.

## Phase 3.5: Polish & Validation

- [ ] T054 [P] Add unit tests for key manager edge cases in `tests/unit/key-manager.test.ts`.
- [ ] T055 [P] Add unit tests for circuit breaker logic in `tests/unit/circuit-breaker.test.ts`.
- [ ] T056 [P] Add unit tests for config loader + watcher in `tests/unit/config-loader.test.ts`.
- [ ] T057 [P] Add unit tests for persistence repositories in `tests/unit/persistence-repositories.test.ts` (mock SQLite + JSON backup).
- [ ] T058 [P] Add unit tests for metrics aggregator in `tests/unit/metrics.test.ts` validating Prometheus output.
- [ ] T059 [P] Add performance regression script in `tests/performance/proxy-latency.test.ts` ensuring <100ms overhead under load.
- [ ] T060 [P] Update operational documentation in `docs/operations.md` and refresh `specs/002-read-prd-md/quickstart.md` with final commands.
- [ ] T061 Run full validation pass (`bun test`, performance script, quickstart flows) and document results in `specs/002-read-prd-md/progress.md`.

## Dependencies

- **TDD gating**: Complete T004-T011 and confirm failing states before starting T012-T052.
- **Data foundations**: T012-T023 must complete before repositories/services (T024-T042) consume models or storage.
- **Endpoint wiring**: Proxy handlers (T033-T035) depend on Gemini client and normalization (T031-T032); admin handlers (T037-T042) depend on routers/middleware T036 & T043.
- **Server bootstrap**: Integration tasks T043-T053 rely on core services and handlers (T024-T042) being ready.
- **Polish**: T054-T061 run only after functional stack (T001-T053) is implemented.

## Parallel Execution Examples

- **Contract & integration tests**:

  ```bash
  cascade tasks run --ids T004 T005 T006 T007 T008 T009 T010 T011
  ```

- **Domain model types**:

  ```bash
  cascade tasks run --ids T012 T013 T014 T015 T016
  ```

- **Polish unit suites**:

  ```bash
  cascade tasks run --ids T054 T055 T056 T057 T058
  ```
