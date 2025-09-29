# Bun Gemini Proxy Project Overview

## Project Purpose
This is a Bun-based HTTP proxy server that provides an OpenAI-compatible interface for Google's Gemini API. The proxy runs at `http://localhost:4806/v1` and forwards requests to `https://generativelanguage.googleapis.com/v1beta/openai/`.

## Key Features
- Drop-in OpenAI SDK compatibility
- Automated API key rotation with health monitoring
- Circuit breaking for rate limit handling
- SQLite persistence for operational state
- Prometheus metrics and admin endpoints
- Streaming response support

## Tech Stack
- **Runtime**: Bun v1.2.22 (fast all-in-one JavaScript runtime)
- **Language**: TypeScript (strict mode enabled)
- **Database**: SQLite (via bun:sqlite)
- **HTTP Server**: Bun.serve() (native Bun API)
- **Module System**: ESNext with bundler module resolution
- **Testing**: bun test (built-in test runner)

## Project Structure
- `index.ts` - Main entry point (currently basic server template)
- `PRD.md` - Detailed product requirements document
- `CLAUDE.md` - Bun-specific development guidelines
- `package.json` - Project dependencies (minimal setup)
- `tsconfig.json` - TypeScript configuration with strict settings
- `bun.lock` - Lockfile for dependencies

## Development Philosophy
- Use Bun's native APIs instead of Node.js alternatives
- Leverage Bun's built-in features (SQLite, testing, bundling)
- Async, non-blocking request handling
- Modular architecture with clear separation of concerns
- Low-latency focus (<100ms proxy overhead)

## Current Status
- Initial project setup completed
- Basic Bun server template in place
- Ready for Phase 1 implementation: core proxy with SQLite persistence