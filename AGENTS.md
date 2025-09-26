# Repository Guidelines

## Project Structure & Module Organization
Bytebot Hawkeye lives in a multi-package monorepo under `packages/`, with shared DTOs and utilities in `shared`, the NestJS backend in `bytebot-agent`, Claude-facing flows in `bytebot-agent-cc`, the desktop daemon in `bytebotd`, the Next.js UI in `bytebot-ui`, CV helpers in `bytebot-cv`, and proxy assets in `bytebot-llm-proxy`. Keep specs beside source files as `*.spec.ts`. Global documentation sits in `docs/`, deployment manifests in `helm/` and `docker/`, and static assets (including overlay screenshots) in `static/`.

## Build, Test, and Development Commands
- `npm run build --prefix packages/shared` — regenerate shared types before touching downstream packages.
- `cd packages/bytebot-agent && npm install && npm run start:dev` — launch the NestJS API with hot reload; pair schema edits with `npm run prisma:dev`.
- `cd packages/bytebotd && npm run start:dev` — boot the desktop daemon and socket bridge for local agent trials.
- `cd packages/bytebot-ui && npm run dev` — iterate on the Next.js dashboard, including Hawkeye accuracy overlays.
- `docker compose -f docker/docker-compose.yml up -d` — provision the full stack for integration tests.
- Use `npm test`, `npm run test:watch`, or `npm run test:cov` inside the relevant workspace for targeted suites.

## Coding Style & Naming Conventions
Write TypeScript with 2-space indentation, single quotes, and trailing commas. Keep classes in PascalCase, functions and variables camelCase, and Prisma models snake_case. Run `npm run format` to enforce Prettier/ESLint alignment, and centralize shared contracts in `packages/shared` to avoid drift across agents.

## Testing Guidelines
Jest backs every package. Name specs `*.spec.ts` adjacent to the source under test, and favor deterministic mocks for LLM and desktop subsystems. Run `npm run test:e2e` inside `packages/bytebot-agent` for API flows, and cover Hawkeye CV logic with focused suites in `packages/bytebot-cv`.

## Commit & Pull Request Guidelines
Use imperative commit subjects (e.g., `Improve coordinate telemetry`). PRs should describe intent, flag schema or env updates, link issues, and include screenshots or recordings for UI changes. Document manual and automated test coverage so reviewers can trace verification steps.

## Security & Configuration Tips
Load secrets from package-specific `.env` files or `docker/.env`, and never commit credentials. Toggle Hawkeye systems via env vars such as `BYTEBOT_SMART_FOCUS` and `BYTEBOT_COORDINATE_METRICS`. After Prisma schema changes, run `npm run prisma:dev` in `packages/bytebot-agent` to apply migrations and regenerate the client.
