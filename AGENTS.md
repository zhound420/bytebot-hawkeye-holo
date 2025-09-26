# Repository Guidelines

## Project Structure & Module Organization
Bytebot Hawkeye is a monorepo rooted in `packages/`, with shared DTOs and utilities in `packages/shared`. The NestJS backend lives in `packages/bytebot-agent`, Claude-facing flows in `packages/bytebot-agent-cc`, the Next.js dashboard in `packages/bytebot-ui`, the desktop daemon in `packages/bytebotd`, CV helpers in `packages/bytebot-cv`, and proxy assets in `packages/bytebot-llm-proxy`. Keep feature specs beside their sources as `*.spec.ts`, store docs in `docs/`, deployment manifests in `helm/` and `docker/`, and static overlays in `static/`.

## Build, Test, and Development Commands
Run `npm run build --prefix packages/shared` to regenerate shared types before editing dependents. Start the API with `cd packages/bytebot-agent && npm install && npm run start:dev`, pairing schema edits with `npm run prisma:dev`. Launch the desktop daemon via `cd packages/bytebotd && npm run start:dev`. Iterate on the UI through `cd packages/bytebot-ui && npm run dev`. Use `docker compose -f docker/docker-compose.yml up -d` for a full-stack sandbox.

## Coding Style & Naming Conventions
Write TypeScript with 2-space indentation, single quotes, and trailing commas. Classes stay in PascalCase, functions and variables in camelCase, and Prisma models in snake_case. Run `npm run format` before commits to align with the shared Prettier and ESLint configuration. Centralize cross-agent contracts in `packages/shared` to prevent drift.

## Testing Guidelines
All packages use Jest. Name tests `*.spec.ts` beside the code under test, and favor deterministic mocks for LLM and desktop integrations. Run `npm test`, `npm run test:watch`, or `npm run test:cov` inside each workspace. For API verification, execute `npm run test:e2e` in `packages/bytebot-agent`; cover Hawkeye CV logic with focused suites in `packages/bytebot-cv`.

## Commit & Pull Request Guidelines
Use imperative commit subjects (e.g., `Improve coordinate telemetry`) and stage only intentional changes. PRs should summarize intent, flag schema or env updates, link issues, and include UI captures where relevant. Document manual and automated test coverage so reviewers can reproduce results. Highlight any new environment variables or migration steps in the PR description.

## Security & Configuration Tips
Load secrets from package-specific `.env` files or `docker/.env`, and never commit credentials. Toggle Hawkeye systems using env vars such as `BYTEBOT_SMART_FOCUS` and `BYTEBOT_COORDINATE_METRICS`. After Prisma schema updates, run `npm run prisma:dev` in `packages/bytebot-agent` to apply migrations and regenerate the client.
