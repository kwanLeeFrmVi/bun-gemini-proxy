# Implementation Plan: Gemini OpenAI-Compatible Proxy Server

**Branch**: `002-read-prd-md` | **Date**: 2025-09-29 | **Spec**: `specs/002-read-prd-md/spec.md`
**Input**: Product requirements from `PRD.md`

## Execution Flow (/plan command scope)

```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect project type (single-service Bun backend)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on available guardrails or flag missing constitution file
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, CLAUDE.md updates
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:

- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary

Build a Bun-based proxy at `http://localhost:4806/v1` that forwards OpenAI-compatible requests to the Gemini API while preserving payload schemas. Implement automated key rotation with health scoring, circuit breaking, persistence to SQLite (with JSON export fallback), and operational observability (metrics, logs, admin endpoints) so teams can rely on Gemini through existing OpenAI SDKs without configuration drift.

## Technical Context

**Language/Version**: TypeScript on Bun 1.x runtime (ESM)
**Primary Dependencies**: `Bun.serve`, `bun:sqlite`, YAML parser (e.g., `yaml`), Prometheus metrics exporter, structured logging utilities
**Storage**: SQLite snapshots for key state + optional JSON export/import files
**Testing**: `bun test` for unit/integration suites; contract tests validating OpenAI schema parity
**Target Platform**: Headless server (macOS/Linux) hosting Bun proxy at `localhost:4806`
**Project Type**: single
**Performance Goals**: <100 ms added latency per proxied request; automated key recovery within 5 minutes
**Constraints**: ≥99% of traffic routed via healthy keys, graceful degradation to informative 503 when all keys fail, secrets never logged
**Scale/Scope**: Single proxy service managing multiple Gemini keys for backend/ops workloads under rate limits

## Constitution Check

- Gate 1: Confirm plan stays within a single Bun service and avoids unnecessary additional projects or frameworks.
- Gate 2: Ensure security practices (secret masking, admin auth) are captured before implementation.
- Gate 3: Require persistence strategy (SQLite + JSON fallback) to be validated during research before any coding.
- Note: `/memory/constitution.md` not found in repo; confirm with stakeholders if additional guardrails are required.

## Project Structure

### Documentation (this feature)

```
specs/002-read-prd-md/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)

```
src/
├── server/              # Bun server bootstrap and graceful shutdown logic
├── router/              # Request normalization, path mapping, retry policies
├── keys/                # Key manager, rotation strategies, admin controls
├── health/              # Health scoring, rolling window metrics, circuit breaker
├── persistence/         # SQLite + JSON adapters, schema migrations
├── observability/       # Logging, Prometheus metrics, debug endpoints
├── admin/               # HTTP handlers for key management actions
└── types/               # Shared TypeScript definitions and schema adapters

config/
└── keys.yaml            # Example YAML configuration with API keys and metadata

tests/
├── unit/                # Key manager, circuit breaker, persistence unit tests
├── integration/         # End-to-end proxy flows, failover scenarios
└── contract/            # OpenAI schema conformance tests
```

**Structure Decision**: Single Bun backend service organized under `src/` with domain-oriented folders and shared tests under `tests/`.

## Phase 0: Outline & Research

1. **Extract unknowns from Technical Context**:

   - Health scoring formula weighting (success/failure windows).
   - Bun-compatible Prometheus metrics exporter integration.
   - SQLite durability and concurrency best practices under Bun.
   - YAML hot-reload approach using Bun (SIGHUP vs HTTP endpoint).
   - Mapping Gemini responses to OpenAI schema, including error envelopes.
   - Security model for admin endpoints (token vs IP allowlist).

2. **Generate and dispatch research agents**:

   - "Research weighted moving average health scoring for API key rotation in rate-limited environments".
   - "Find best practices for exposing Prometheus metrics from Bun HTTP servers".
   - "Investigate SQLite usage patterns with `bun:sqlite` for concurrent writes".
   - "Evaluate safe YAML hot-reload strategies under Bun without downtime".
   - "Document Gemini ↔ OpenAI response mapping differences".
   - "Assess lightweight auth mechanisms for Bun admin endpoints".

3. **Consolidate findings** in `research.md` using Decision/Rationale/Alternatives format; resolve all NEEDS CLARIFICATION items before moving to Phase 1.

**Output**: `research.md` with finalized technology choices, algorithms, and operational guardrails.

## Phase 1: Design & Contracts

_Prerequisites: research.md complete_

1. **Extract entities** into `data-model.md`:

   - API Key Profile (metadata, weights, cooldowns, persistent IDs).
   - Key Health Snapshot (rolling metrics, score, last failure).
   - Proxy Request Session (request metadata, selected key, latency, outcome).
   - Operational Snapshot (persisted state, config versioning, timestamps).
   - Any auxiliary entities for retries, cooldown schedules, and admin audit logs.

2. **Generate API contracts** in `/contracts/`:

   - Proxy interface summary (OpenAI-compatible schema references).
   - Admin endpoints: list keys, enable/disable, reprioritize.
   - Metrics endpoint (`/metrics`) output format.
   - Health status endpoint (`/healthz` / `/readyz`) payload.
   - Configuration reload endpoint (if HTTP-based) including auth expectations.

3. **Generate contract tests**:

   - One `bun test` file per endpoint (admin, metrics, health).
   - Include schema assertions for translated Gemini responses and error mappings.
   - Ensure tests fail pending implementation (mock upstream behavior where needed).

4. **Extract test scenarios** for integration coverage:

   - Successful proxy request with response translation.
   - Key rotation after 429/5xx failures with cooldown enforcement.
   - All keys unhealthy returning 503 with diagnostic payload.
   - Hot config reload with in-flight requests.
   - Persistence recovery across restart.

5. **Update agent file incrementally**:
   - Run `.specify/scripts/bash/update-agent-context.sh kilocode` with new technologies/process updates.
   - Append only new context relevant to Gemini proxy without duplicating existing guidance.

**Output**: `data-model.md`, `/contracts/*`, failing contract + integration tests, `quickstart.md`, updated `CLAUDE.md` context.

## Phase 2: Task Planning Approach

_This section describes what the /tasks command will do - DO NOT execute during /plan_

**Task Generation Strategy**:

- Load `.specify/templates/tasks-template.md` as base.
- Derive tasks from Phase 1 docs: each contract/test scenario becomes a task.
- Separate tasks for implementing key rotation, health scorer, persistence adapter, admin & metrics endpoints, logging, and shutdown flow.
- Mark prerequisites (e.g., persistence before health scoring) and identify parallelizable efforts (metrics vs admin endpoints).

**Ordering Strategy**:

- TDD-first: write/enable tests before implementation.
- Build persistence foundation → key manager → health monitor → router/circuit breaker → observability.
- Integrate configuration reload and security controls after core proxy path is stable.

**Estimated Output**: 25-30 numbered tasks in `tasks.md`, grouped by subsystem with [P] markers for parallel candidates.

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan.

## Phase 3+: Future Implementation

_These phases are beyond the scope of the /plan command_

**Phase 3**: Task execution (/tasks command creates tasks.md)
**Phase 4**: Implementation (execute tasks following constitutional principles)
**Phase 5**: Validation (run bun tests, exercise quickstart.md, verify performance targets)

## Complexity Tracking

_No deviations identified; leave empty unless Constitution Check flags issues._

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |

## Progress Tracking

_This checklist is updated during execution flow_

**Phase Status**:

- [ ] Phase 0: Research complete (/plan command)
- [ ] Phase 1: Design complete (/plan command)
- [ ] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:

- [ ] Initial Constitution Check: PASS
- [ ] Post-Design Constitution Check: PASS
- [ ] All NEEDS CLARIFICATION resolved
- [ ] Complexity deviations documented

---

_Based on Constitution v2.1.1 - confirm guardrails once `/memory/constitution.md` is provided_