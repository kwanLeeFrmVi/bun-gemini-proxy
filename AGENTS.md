# Repository Guidelines

## Project Structure & Module Organization

- `src/server/server.ts` exposes `startProxyServer`, the Bun entrypoint that answers on `0.0.0.0:4806` and will host the proxy pipeline.
- Feature scaffolding lives under `src/admin`, `src/health`, `src/keys`, `src/observability`, `src/persistence`, `src/router`, and `src/types`; keep cross-cutting code in `src/server` and isolate adapters in their domain folder.
- Contract tests reside in `tests/contract/*.test.ts`, exercising the Admin and Proxy APIs against a running local server; align endpoints with the OpenAPI specs in `specs/002-read-prd-md/contracts/`.

## Build, Test, and Development Commands

- `bun install` – install dependencies described in `package.json`.
- `bun run start` – boot the proxy stub (`src/server/server.ts`); use `CTRL+C` to stop.
- `bun test` – execute the Bun test suite; add `--watch` while iterating locally.
- `bunx eslint .` / `bunx eslint . --fix` – lint TypeScript (tests lint separately per config).
- `bunx prettier --check .` / `--write` – enforce formatting prior to commits.

## Coding Style & Naming Conventions

- TypeScript with ECMAScript modules; prefer explicit file extensions in relative imports.
- Follow Prettier defaults (2-space indent, double quotes, trailing commas) and avoid manual formatting tweaks.
- Use `camelCase` for variables/functions, `PascalCase` for types, and suffix tests with `*.test.ts`.
- eslint rules require `@typescript-eslint/consistent-type-imports` and treat unused identifiers as warnings unless prefixed with `_`.

## Testing Guidelines

- Keep new tests in `tests/contract` or a `tests/unit` folder if fine-grained cases emerge; mirror endpoint names in the describe blocks.
- When adding endpoints, extend the relevant OpenAPI contract first, then cover success, auth, and error branches in Bun tests.
- Document required env vars (e.g., `PROXY_ADMIN_TOKEN`) in tests or PR notes so reviewers can reproduce failures.

## Commit & Pull Request Guidelines

- Use Conventional Commit prefixes (`feat`, `chore`, `fix`, etc.) as seen in `git log`; keep the subject ≤72 characters and present-tense.
- Squash local WIP before opening PRs, reference tracking issues or spec IDs (e.g., `specs/002`) in the description, and include outcome screenshots for admin console changes.
- Confirm `bun test`, lint, and formatting pass before requesting review; share any skipped checks with rationale.

## Security & Configuration Tips

- Never commit real API tokens; load secrets via environment variables (`PROXY_ADMIN_TOKEN`, storage credentials) and document defaults for local runs.
- Expose admin routes only on trusted networks; if binding to a public host, enforce TLS or a reverse proxy and rotate keys tracked in `src/keys`.
