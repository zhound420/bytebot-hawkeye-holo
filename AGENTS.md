# Repository Guidelines

## Project Structure & Module Organization
Bytebot uses a multi-package monorepo. Core workspaces sit in `packages/`:
- `shared` holds DTOs, validation schemas, and utilities shared across services.
- `bytebot-agent` provides the NestJS API and Prisma client.
- `bytebot-agent-cc` maintains the Claude-optimized agent flavor.
- `bytebotd` runs the desktop daemon and socket gateway.
- `bytebot-ui` is the Next.js front end.
- `bytebot-cv` delivers reusable CV helpers.
- `bytebot-llm-proxy` contains proxy configs and Docker assets.
Keep tests beside source as `*.spec.ts`. Top-level assets live in `docs/`, `helm/`, `docker/`, and `static/`.

## Build, Test, and Development Commands
- `npm run build --prefix packages/shared` builds shared types before dependent packages.
- `cd packages/bytebot-agent && npm install && npm run start:dev` launches the API in watch mode.
- `cd packages/bytebot-agent-cc && npm run start:dev` spins up the alternate agent.
- `cd packages/bytebotd && npm run start:dev` starts the desktop daemon.
- `cd packages/bytebot-ui && npm run dev` runs the Next.js UI with hot reload.
- `cd packages/bytebot-cv && npm run dev` watches the CV library; use `npm run build` for releases.
- `docker compose -f docker/docker-compose.yml up -d` brings up the full stack locally.

## Coding Style & Naming Conventions
Code is TypeScript-first with 2-space indentation, single quotes, and trailing commas. Classes use PascalCase, functions and variables use camelCase, and Prisma models stay snake_case. Run `npm run format` (Prettier + ESLint) before committing. Centralize shared contracts in `packages/shared`.

## Testing Guidelines
Jest is standard; name specs `*.spec.ts` alongside source. Use `npm test`, `npm run test:watch`, or `npm run test:cov` in each package. For API end-to-end flows, run `npm run test:e2e` within `packages/bytebot-agent`. Mock LLM or desktop integrations to keep runs deterministic and fast.

## Commit & Pull Request Guidelines
Write imperative commit messages (e.g., `Add Prisma seed script`). PRs should describe intent, call out schema or env changes, link issues, and attach UI screenshots when relevant. State manual and automated test coverage. Keep changes scoped and consistent across affected packages.

## Security & Configuration Tips
Load secrets through per-package `.env` files or `docker/.env`; never commit credentials. After updating Prisma schema, execute `npm run prisma:dev` inside `packages/bytebot-agent` to apply migrations and regenerate the client. Prefer existing npm scripts and Docker services over custom tooling.
