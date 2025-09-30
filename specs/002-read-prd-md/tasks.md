# Tasks: Gemini OpenAI-Compatible Proxy Server

**Input**: Design documents from `specs/002-read-prd-md/`
**Prerequisites**: `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

> **Historical reference**: Legacy tasks from the previous revision – T001 service skeleton, T002 dependency setup, T003 lint/format wiring, T004 proxy contract scaffolding, and T005 admin contract scaffolding – are complete and remain prerequisites for the plan below.

## Phase 3.1: Setup

- [ ] T001 Run `.specify/scripts/bash/update-agent-context.sh kilocode` to sync AI helper context as noted in `specs/002-read-prd-md/plan.md`.
- [ ] T002 Create example configuration files `config/keys.example.yaml` and `config/proxy.example.yaml` mirroring `quickstart.md` so integration tests can load realistic fixtures without secrets.

## Phase 3.2: Tests First (TDD)

- [ ] T003 [P] Extend `tests/contract/proxy-api.test.ts` (follow-up to legacy T004) to cover 400/413/429/503 responses from `contracts/proxy-api.yaml`.
- [ ] T004 [P] Extend `tests/contract/admin-api.test.ts` (follow-up to legacy T005) to cover enable/disable/reload happy paths and auth failures from `contracts/admin-api.yaml`.
- [ ] T005 [P] Author OpenAI compatibility integration test in `tests/integration/proxy-openai-compat.test.ts` simulating SDK requests per `quickstart.md` Scenario 1.
- [ ] T006 [P] Author automatic key rotation integration test in `tests/integration/key-rotation.test.ts` validating circuit breaker behavior from Scenario 2.
- [ ] T007 [P] Author state persistence integration test in `tests/integration/state-persistence.test.ts` ensuring SQLite + JSON fallback restore Scenario 3.
- [ ] T008 [P] Author operational visibility integration test in `tests/integration/admin-visibility.test.ts` covering `/admin/health`, `/admin/keys`, `/admin/metrics` from Scenario 4.
- [ ] T009 [P] Author all-keys-unhealthy degradation test in `tests/integration/all-keys-unhealthy.test.ts` expecting 503 diagnostics when every key is disabled.
- [ ] T010 [P] Author payload guardrails test in `tests/integration/payload-guardrails.test.ts` enforcing size and schema limits.
- [ ] T011 [P] Author configuration hot reload test in `tests/integration/config-hot-reload.test.ts` that mutates YAML fixtures and asserts live key reloading.
- [ ] T012 [P] Author performance and concurrency test in `tests/integration/proxy-latency.test.ts` measuring <100 ms overhead and ≥99% success under load per `quickstart.md` performance targets.

## Phase 3.3: Core Implementation (ONLY after tests are failing)

- [ ] T013 [P] Define API key domain types and masking helpers in `src/types/api-key.ts` using the `API Key` entity from `data-model.md`.
- [ ] T014 [P] Define health score domain types and calculators in `src/types/health-score.ts` per `data-model.md`.
- [ ] T015 [P] Define request metrics domain types in `src/types/request-metrics.ts` per `data-model.md`.
- [ ] T016 [P] Define circuit breaker state types in `src/types/circuit-breaker.ts` per `data-model.md`.
- [ ] T017 [P] Define configuration schema and validation contracts in `src/types/config.ts` reflecting YAML structures.
- [ ] T018 Implement shared SQLite client and migration runner in `src/persistence/sqlite-client.ts` using `bun:sqlite`.
- [ ] T019 Implement schema migration `src/persistence/migrations/001_init.ts` provisioning tables from `data-model.md`.
- [ ] T020 [P] Implement API key repository in `src/persistence/api-key-repository.ts` with CRUD and masking logic.
- [ ] T021 [P] Implement health score repository in `src/persistence/health-score-repository.ts` with rolling window updates.
- [ ] T022 [P] Implement request metrics repository in `src/persistence/request-metrics-repository.ts` with aggregation helpers.
- [ ] T023 [P] Implement circuit breaker state repository in `src/persistence/circuit-breaker-repository.ts` tracking transitions.
- [ ] T024 Implement JSON import/export fallback snapshots in `src/persistence/json-backup.ts`.
- [ ] T025 Implement configuration loader plus schema validation in `src/persistence/config-loader.ts`.
- [ ] T026 Implement configuration hot-reload watcher in `src/persistence/config-watcher.ts` that coordinates with the key manager.
- [ ] T027 Implement key manager with weighted rotation and manual overrides in `src/keys/key-manager.ts`.
- [ ] T028 Implement health monitoring service in `src/health/health-score-service.ts` updating scores post-request.
- [ ] T029 Implement circuit breaker controller in `src/health/circuit-breaker-service.ts` enforcing thresholds and cooldowns.
- [ ] T030 Implement metrics aggregator in `src/observability/metrics.ts` using `prom-client` for per-key metrics.
- [ ] T031 Implement structured logger utilities with secret masking in `src/observability/logger.ts`.
- [ ] T032 Implement Gemini API client adapter in `src/router/gemini-client.ts` leveraging `undici` and retry policies.
- [ ] T033 Implement request normalization helpers in `src/router/request-normalizer.ts` mapping OpenAI payloads to Gemini.
- [ ] T034 Implement `/v1/chat/completions` handler in `src/router/handlers/chat-completions.ts` with streaming support and key rotation integration.
- [ ] T035 Implement `/v1/models` handler in `src/router/handlers/models.ts` returning mapped Gemini model list.
- [ ] T036 Compose public proxy router in `src/router/index.ts` wiring middleware and handlers.
- [ ] T037 Compose admin router in `src/admin/routes.ts` registering secured routes.
- [ ] T038 [P] Implement `/admin/health` handler in `src/admin/handlers/health.ts` summarizing uptime and key health.
- [ ] T039 [P] Implement `/admin/keys` handler in `src/admin/handlers/keys.ts` exposing per-key diagnostics.
- [ ] T040 [P] Implement `/admin/keys/{keyId}/enable` handler in `src/admin/handlers/enable-key.ts` toggling key state via `key-manager`.
- [ ] T041 [P] Implement `/admin/keys/{keyId}/disable` handler in `src/admin/handlers/disable-key.ts` with audit logging.
- [ ] T042 [P] Implement `/admin/metrics` handler in `src/admin/handlers/metrics.ts` streaming Prometheus payloads.
- [ ] T043 [P] Implement `/admin/config/reload` handler in `src/admin/handlers/reload-config.ts` invoking config loader and reporting changes.

## Phase 3.4: Integration & Platform

- [ ] T044 Implement admin bearer authentication middleware in `src/admin/middleware/auth.ts` honoring `config.proxy.adminToken`.
- [ ] T045 Implement payload validation middleware in `src/router/middleware/validate.ts` enforcing size and schema guards.
- [ ] T046 Implement request logging middleware in `src/router/middleware/logging.ts` integrating `logger` masking helpers.
- [ ] T047 Implement circuit breaker middleware in `src/router/middleware/circuit-breaker.ts` to short-circuit unhealthy keys.
- [ ] T048 Implement persistence bootstrap and state hydration in `src/server/bootstrap/persistence.ts` loading repositories on start.
- [ ] T049 Integrate observability and metrics exposure in `src/server/bootstrap/observability.ts` wiring `/admin/metrics` and gauges.
- [ ] T050 Wire configuration watch and reload scheduling in `src/server/bootstrap/configuration.ts` to coordinate with key manager and watcher.
- [ ] T051 Compose full router stack in `src/server/bootstrap/router.ts` merging public and admin routers with middleware.
- [ ] T052 Implement graceful shutdown workflow in `src/server/shutdown.ts` flushing SQLite and metrics before exit.
- [ ] T053 Finalize Bun server bootstrap in `src/server/server.ts` invoking `Bun.serve` with routers, middleware, and shutdown hooks.
- [ ] T054 Implement CLI entrypoint in `index.ts` parsing env/config and launching `src/server/server.ts`.

## Phase 3.5: Polish & Validation

- [ ] T055 [P] Add unit tests for key manager edge cases in `tests/unit/key-manager.test.ts`.
- [ ] T056 [P] Add unit tests for circuit breaker logic in `tests/unit/circuit-breaker.test.ts`.
- [ ] T057 [P] Add unit tests for config loader and watcher in `tests/unit/config-loader.test.ts`.
- [ ] T058 [P] Add unit tests for persistence repositories in `tests/unit/persistence-repositories.test.ts` using mocked SQLite + JSON backup.
- [ ] T059 [P] Add unit tests for metrics aggregator in `tests/unit/metrics.test.ts` validating Prometheus output.
- [ ] T060 [P] Update operational documentation in `docs/operations.md` and refresh `specs/002-read-prd-md/quickstart.md` with final commands and troubleshooting notes.
- [ ] T061 Run full validation pass (`bun test`, performance script, quickstart flows) and capture results in `specs/002-read-prd-md/progress.md`.

## Dependencies

- **Legacy gate**: Confirm historical tasks T001–T005 remain green before starting T001–T061.
- **TDD gating**: Complete T003–T012 and observe failing states before beginning T013–T054.
- **Data foundations**: Finish T013–T024 before repositories/services (T025–T043) consume models or storage.
- **Endpoint wiring**: Proxy handlers (T034–T036) depend on Gemini client and normalization (T032–T033); admin handlers (T038–T043) depend on routers and middleware (T037, T044–T047).
- **Server bootstrap**: Integration tasks T044–T054 rely on core services, handlers, and repositories (T013–T043) being ready.
- **Polish**: T055–T061 run only after functional stack (T001–T054) is implemented.

## Parallel Execution Examples

- **Contract & integration tests**

  ```bash
  cascade tasks run --ids T003 T004 T005 T006 T007 T008 T009 T010 T011 T012
  ```

- **Domain model and repository types**

  ```bash
  cascade tasks run --ids T013 T014 T015 T016 T017 T020 T021 T022 T023
  ```

- **Polish unit suites**

  ```bash
  cascade tasks run --ids T055 T056 T057 T058 T059
  ```
