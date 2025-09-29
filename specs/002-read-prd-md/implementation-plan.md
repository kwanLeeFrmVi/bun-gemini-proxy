# Implementation Plan: Gemini API Proxy

This document outlines the implementation plan for the Gemini API Proxy, broken down into phases with specific, actionable tasks.

## Phase 1: Core Proxy and Server Setup

- **Task 1.1: Set up the basic Bun server.**
  - **Files to be created/modified:**
    - `src/server/server.ts`: Create the main server file, initialize a Bun server, and define the entry point.
    - `package.json`: Add dependencies like `elysia`.

- **Task 1.2: Implement the core proxy logic.**
  - **Files to be created/modified:**
    - `src/router/proxy-router.ts`: Create a router to handle incoming proxy requests and forward them to the Gemini API.
    - `src/router/gemini-client.ts`: Implement a client to handle communication with the Gemini API.
    - `src/server/server.ts`: Integrate the proxy router.

- **Task 1.3: Implement basic OpenAI-compatible response translation.**
  - **Files to be created/modified:**
    - `src/router/responses.ts`: Create functions to translate Gemini API responses to the OpenAI format.
    - `src/router/proxy-router.ts`: Use the translation functions to format responses.

## Phase 2: Key Management and Rotation

- **Task 2.1: Implement the key manager.**
  - **Files to be created/modified:**
    - `src/keys/key-manager.ts`: Create the key manager to load API keys from a YAML configuration file.
    - `src/types/config.ts`: Define the structure of the configuration file.
    - `config/keys.yaml`: Create a sample key configuration file.

- **Task 2.2: Implement round-robin key rotation.**
  - **Files to be created/modified:**
    - `src/keys/key-manager.ts`: Implement logic to rotate keys in a round-robin fashion.

- **Task 2.3: Implement health-aware key selection logic.**
  - **Files to be created/modified:**
    - `src/keys/key-manager.ts`: Add logic to select keys based on their health status, skipping unhealthy keys.

## Phase 3: Circuit Breaker and Health Monitoring

- **Task 3.1: Implement the circuit breaker pattern.**
  - **Files to be created/modified:**
    - `src/keys/key-manager.ts`: Implement a circuit breaker to temporarily disable failing keys.
    - `src/types/key.ts`: Add a status field to the key object to track its state (e.g., `ACTIVE`, `DISABLED`).

- **Task 3.2: Implement health score calculation.**
  - **Files to be created/modified:**
    - `src/keys/key-manager.ts`: Implement logic to calculate a health score for each key based on its success/failure rate.

- **Task 3.3: Implement exponential backoff.**
  - **Files to be created/modified:**
    - `src/keys/key-manager.ts`: Implement exponential backoff to re-test disabled keys after a certain period.

## Phase 4: Persistence

- **Task 4.1: Implement the SQLite persistence layer.**
  - **Files to be created/modified:**
    - `src/persistence/state-store.ts`: Create a class to manage the state of keys and health scores.
    - `src/persistence/resilient-store.ts`: Implement a resilient store that uses SQLite as the primary persistence mechanism.

- **Task 4.2: Implement JSON file-based fallback persistence.**
  - **Files to be created/modified:**
    - `src/persistence/resilient-store.ts`: Implement a fallback to a JSON file if SQLite is unavailable.

- **Task 4.3: Implement graceful shutdown and state restoration.**
  - **Files to be created/modified:**
    - `src/server/server.ts`: Implement graceful shutdown to save the current state before exiting.
    - `src/persistence/resilient-store.ts`: Implement state restoration on startup.

## Phase 5: Observability and Admin API

- **Task 5.1: Implement structured logging with Pino.**
  - **Files to be created/modified:**
    - `src/observability/logger.ts`: Create a logger instance using Pino.
    - Integrate the logger throughout the application.

- **Task 5.2: Implement the Prometheus metrics endpoint.**
  - **Files to be created/modified:**
    - `src/observability/metrics.ts`: Create a Prometheus metrics endpoint to expose key metrics.
    - `src/server/server.ts`: Expose the metrics endpoint.

- **Task 5.3: Implement the admin API endpoints.**
  - **Files to be created/modified:**
    - `src/router/admin-router.ts`: Create a router for the admin API.
    - `src/server/server.ts`: Integrate the admin router.
    - `specs/002-read-prd-md/contracts/admin-api.yaml`: Define the admin API endpoints.

- **Task 5.4: Secure the admin endpoints.**
  - **Files to be created/modified:**
    - `src/router/admin-router.ts`: Implement bearer token authentication for the admin endpoints.

## Phase 6: Testing and Refinement

- **Task 6.1: Write contract tests.**
  - **Files to be created/modified:**
    - `tests/contract/proxy-api.test.ts`: Write contract tests for the proxy API.
    - `tests/contract/admin-api.test.ts`: Write contract tests for the admin API.

- **Task 6.2: Write unit tests.**
  - **Files to be created/modified:**
    - `tests/unit/key-manager.test.ts`: Write unit tests for the key manager.
    - `tests/unit/resilient-store.test.ts`: Write unit tests for the persistence layer.

- **Task 6.3: Perform performance testing.**
  - **Files to be created/modified:**
    - `tests/performance/load-test.ts`: Create a load test script to measure latency and success rates.

- **Task 6.4: Refine the implementation.**
  - **Files to be created/modified:**
    - Refine the implementation based on the results of testing and performance analysis.