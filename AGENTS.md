# Repository Guidelines

## Project Structure & Module Organization
Bytebot lives in a multi-package monorepo rooted at `packages/`. Core workspaces: `shared` for DTOs and utilities, `bytebot-agent` for the NestJS API, `bytebot-agent-cc` for the Claude-oriented agent, `bytebotd` for the desktop daemon, `bytebot-ui` for the Next.js interface, `bytebot-cv` for CV helpers, and `bytebot-llm-proxy` for proxy assets. Place specs beside source as `*.spec.ts`. Global assets and deployment collateral live under `docs/`, `helm/`, `docker/`, and `static/`.

## Build, Test, and Development Commands
- `npm run build --prefix packages/shared`: refresh shared types before touching downstream packages.
- `cd packages/bytebot-agent && npm install && npm run start:dev`: launch the NestJS API with hot reload; follow with `npm run prisma:dev` when schema changes.
- `cd packages/bytebot-agent-cc && npm run start:dev`: run the Claude-oriented agent.
- `cd packages/bytebotd && npm run start:dev`: start the desktop daemon and socket bridge.
- `cd packages/bytebot-ui && npm run dev`: develop the Next.js UI.
- `cd packages/bytebot-cv && npm run dev`: watch CV utilities; run `npm run build` before publishing.
- `docker compose -f docker/docker-compose.yml up -d`: spin up the full stack for integration tests.
- Use `npm test` variants inside each workspace for targeted suites.

## Coding Style & Naming Conventions
Write TypeScript with 2-space indentation, single quotes, and trailing commas. Keep classes PascalCase, functions and variables camelCase, and Prisma models snake_case. Centralize shared contracts in `packages/shared` and run `npm run format` before committing.

## Testing Guidelines
Jest powers all workspaces. Name specs `*.spec.ts` next to the files they cover. Use `npm test`, `npm run test:watch`, or `npm run test:cov` within a package, and `npm run test:e2e` inside `packages/bytebot-agent` for API flows. Mock LLM and desktop integrations to keep suites deterministic.

## Commit & Pull Request Guidelines
Write imperative commit messages (e.g., `Add Prisma seed script`). PRs should explain intent, call out schema or env updates, link issues, attach screenshots for UI changes, and list manual plus automated coverage. Keep scope tight and ensure affected packages share consistent contracts.

## Security & Configuration Tips
Load secrets from per-package `.env` files or `docker/.env`; never commit credentials. After changing Prisma schemas, run `npm run prisma:dev` in `packages/bytebot-agent` to apply migrations and regenerate the client. Prefer the provided npm scripts and Docker services over ad-hoc tooling for reproducibility.
