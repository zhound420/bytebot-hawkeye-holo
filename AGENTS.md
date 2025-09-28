# Repository Guidelines

## Project Structure & Module Organization
- Core services live under `packages/`: `bytebot-agent` and `bytebot-agent-cc` drive automation flows, `bytebot-cv` delivers computer-vision pipelines, `bytebot-ui` renders dashboards, `bytebotd` runs the desktop daemon, and `bytebot-llm-proxy` mediates LLM traffic.
- Shared DTOs, types, and utilities are in `packages/shared`; rerun `npm run build --prefix packages/shared` after changing any shape.
- Keep feature tests beside implementation as `*.spec.ts`; reference assets and docs in `docs/`, `docker/`, `helm/`, and `static/` when wiring integrations.

## Build, Test, and Development Commands
- `npm install` — bootstrap workspace dependencies from the repo root.
- `npm run start:dev --prefix packages/bytebot-agent` — launch the primary agent backend; swap the prefix for other services (for example `packages/bytebot-ui`).
- `npm run build --prefix packages/bytebot-ui` — produce production-ready UI bundles.
- `npm test --prefix <package>` — run unit and integration suites; `npm run test:e2e --prefix packages/bytebot-agent` covers full automation flows.
- `docker compose -f docker/docker-compose.yml up -d` — start the sandbox stack; use `down` to stop and clean.

## Coding Style & Naming Conventions
- TypeScript-first codebase with 2-space indentation, single quotes, trailing commas, and mandatory semicolons.
- Favor camelCase for variables/functions, PascalCase for classes, and snake_case for Prisma models.
- Import shared helpers via relative paths or the `packages/shared` entrypoint; run `npm run format` to apply Prettier + ESLint.

## Testing Guidelines
- Jest underpins all suites; mirror the implementation module name in each `*.spec.ts` file.
- Regenerate fixtures whenever shared DTOs shift to prevent contract drift.
- Prior to merging, execute targeted `npm test --prefix <package>` runs and finish with `npm run test:e2e --prefix packages/bytebot-agent` for regression coverage.

## Commit & Pull Request Guidelines
- Use imperative commit subjects (examples: `Improve coordinate telemetry`, `Add agent metrics hook`) and stage only intentional hunks.
- PRs should explain intent, link related issues, note schema or feature-flag changes, and attach UI captures when dashboards change.
- Coordinate with downstream consumers before modifying shared DTOs or computer-vision pipelines to avoid breaking dependent agents.

## Security & Configuration Tips
- Store secrets in package-level `.env` files or `docker/.env`; never commit credentials.
- Document feature flags such as `BYTEBOT_SMART_FOCUS` or `BYTEBOT_COORDINATE_METRICS` in PR descriptions and verify dependent flows after toggles.
- Rerun relevant builds or tests after dependency upgrades to confirm compatibility before releasing.
