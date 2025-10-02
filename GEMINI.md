# Gemini Proxy

## Project Overview

This project is a Bun-based TypeScript proxy server for the Gemini API. It is designed to manage multiple API keys, distribute requests among them, and handle failures gracefully. It uses a circuit breaker pattern to detect and isolate failing keys, and it persists its state to a SQLite database with a JSON fallback. The proxy exposes a Gemini-compatible API, allowing it to be used as a drop-in replacement for the official Gemini API. It also provides an admin interface for managing keys and monitoring the proxy's health.

## Building and Running

### Prerequisites

- [Bun](https://bun.sh/)

### Installation

```bash
bun install
```

### Running the Server

```bash
bun run index.ts
```

The server will start on the host and port specified in the configuration file (defaults to `localhost:8000`).

### Running Tests

```bash
bun test
```

### Linting and Formatting

To check for linting errors:

```bash
bun run lint
```

To fix linting errors:

```bash
bun run lint:fix
```

To check for formatting errors:

```bash
bun run format
```

To fix formatting errors:

```bash
bun run format:fix
```

## Development Conventions

- **Code Style:** The project uses Prettier for code formatting and ESLint for linting. The configuration for these tools can be found in `.prettierrc` and `eslint.config.js`, respectively.
- **Testing:** The project uses `bun test` for running tests. Test files are located in the `tests` directory.
- **Persistence:** The application state is persisted to a SQLite database, with a JSON file as a fallback. The `StateStore` interface in `src/persistence/state-store.ts` defines the contract for state persistence.
- **Configuration:** The application is configured via a `config.yaml` file. The `ConfigManager` in `src/server/config-manager.ts` is responsible for loading and managing the configuration.
