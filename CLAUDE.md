# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Gemini API Proxy Server** that provides OpenAI-compatible endpoints for Google's Gemini AI models. The proxy handles API key rotation, health monitoring, circuit breaking, and request/response translation between OpenAI and Gemini formats.

**Key Architecture**: Client → Router → Key Manager → Circuit Breaker → Gemini API

**Core Value**: Allows existing OpenAI SDK applications to seamlessly use Gemini models without code changes.

## Development Commands

Default to using Bun instead of Node.js:

- **Start server**: `bun run start` (runs `src/server/server.ts`)
- **Run tests**: `bun test`
- **Lint code**: `bun run lint` (ESLint check)
- **Fix lint issues**: `bun run lint:fix`
- **Format check**: `bun run format` (Prettier check)
- **Auto-format**: `bun run format:fix`
- **Run single test**: `bun test <test-file-path>`

### Bun Usage

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";

// import .css files directly and it works
import './index.css';

import { createRoot } from "react-dom/client";

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.md`.

## Project Structure

### Current Implementation Status

- **Server Bootstrap**: `src/server/server.ts` - Basic Bun.serve() setup, currently returns 501 stub responses
- **Contract Tests**: `tests/contract/` - OpenAI API compatibility tests (currently failing, as expected)
- **Configuration**: ESLint + Prettier + TypeScript with strict settings

### Key Dependencies

- **pino**: Structured logging (replace console.log with pino logger)
- **prom-client**: Prometheus metrics export
- **undici**: HTTP client for upstream Gemini requests (preferred over fetch for advanced features)
- **yaml**: YAML configuration file parsing

### Architecture Components (To Be Implemented)

Based on the PRD and specifications:

1. **HTTP Server** (`src/server/`): Request routing and response handling
2. **Router** (`src/router/`): Endpoint normalization and request forwarding
3. **Key Manager** (`src/keys/`): API key rotation and health tracking
4. **Health Monitor** (`src/health/`): Success/failure aggregation and scoring
5. **Circuit Breaker** (`src/circuit/`): Key disabling and recovery scheduling
6. **Persistence** (`src/persistence/`): SQLite storage with JSON fallback
7. **Observability** (`src/observability/`): Metrics, logging, and admin endpoints

## Important Implementation Notes

### OpenAI Compatibility Requirements

- **Endpoint Support**: Full OpenAI v1 API surface (`/v1/chat/completions`, `/v1/models`, etc.)
- **Schema Translation**: Convert Gemini responses to OpenAI format
- **Streaming Support**: Handle both streaming and non-streaming requests
- **Error Mapping**: Translate Gemini errors to OpenAI error schemas

### Key Management

- **Configuration**: YAML file with hot reload capability
- **Health Scoring**: Simple success/failure ratio over fixed time window
- **Circuit Breaking**: 3 consecutive failures triggers key rotation
- **Persistence**: SQLite primary, file-based fallback

### Performance Requirements

- **Latency Target**: <100ms proxy overhead
- **Timeout**: 10s total request timeout
- **Payload Limit**: 10MB default maximum
- **Recovery**: 5-minute automatic key recovery cycles

### Testing Strategy

- **Contract Tests**: Validate OpenAI API compatibility (`tests/contract/`)
- **Unit Tests**: Core logic testing (`tests/unit/`)
- **Integration Tests**: End-to-end request flows (`tests/integration/`)

## Code Style & Standards

### ESLint Configuration

- TypeScript strict mode with consistent type imports
- Unused variables allowed with `_` prefix
- Test files have relaxed rules for `any` types
- Bun global available in all contexts

### File Organization

- Place new modules in appropriate `src/` subdirectories
- Contract tests define API expectations before implementation
- Use `pino` logger instead of `console.log` for structured logging
- Prefer `undici` over native `fetch` for upstream HTTP requests

## Development Workflow

1. **Start Development Server**: `bun run start` (currently serves 501 responses)
2. **Run Contract Tests**: `bun test tests/contract/` (should fail until implementation)
3. **Check Code Quality**: `bun run lint && bun run format`
4. **Implement Components**: Follow TDD approach - write tests first, then implement
5. **Validate Integration**: Ensure contract tests pass after implementation

## Project Context

This codebase follows a specification-driven development approach with detailed requirements in `PRD.md` and `specs/002-read-prd-md/`. The project uses Windsurf workflows for feature planning and implementation. Key design decisions are documented in the spec files, including clarifications about endpoint coverage, authentication, and failure handling.
