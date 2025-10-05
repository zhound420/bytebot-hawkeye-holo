# Repository Guidelines

Maintain Hawkeye’s desktop agent by aligning contributions with these workspace standards.

## Project Structure & Module Organization
- `packages/bytebot-agent`: NestJS control plane; Prisma schema in `prisma/`, feature modules under `src/`.
- `packages/bytebot-ui`: Next.js command center served through `tsx server.ts`; global assets live in `static/`.
- `packages/bytebot-cv` and `packages/bytebot-agent-cc`: OpenCV helpers, scalar polyfills, and camera control consumed by the agent.
- Shared tooling: `packages/shared` (types/utilities), `packages/bytebotd` and `packages/bytebot-llm-proxy` (daemon + LiteLLM bridge), with operational scripts in `scripts/`, container specs in `docker/`, Helm in `helm/`, and integration fixtures in `tests/`.

## Build, Test & Development Commands
- `npm install`: bootstraps all workspaces (Node 20+).
- `npm run start:dev --workspace bytebot-agent`: hot-reloads the NestJS service and regenerates Prisma types.
- `npm run dev --workspace bytebot-ui`: rebuilds shared packages and launches the UI proxy for local inspection.
- `./scripts/start-stack.sh` / `./scripts/stop-stack.sh`: bring up or tear down the full stack, including OmniParser and health checks.
- `npm run build --workspace <workspace>`: produce optimized bundles ahead of container builds.

## Coding Style & Naming Conventions
- TypeScript-first, two-space indentation, single quotes, trailing commas—run the per-workspace `format` script before committing.
- ESLint via `eslint.config.mjs` flags unawaited promises; `await` async helpers or comment intentional detaches.
- Naming: `camelCase` for functions/constants, `PascalCase` for classes and React components, kebab-case for UI filenames and routes.

## Testing Guidelines
- Backend: `npm test --workspace bytebot-agent` (Jest), `npm run test:e2e --workspace bytebot-agent`, and `npm run test:cov --workspace bytebot-agent` for coverage gates.
- Frontend: `npm test --workspace bytebot-ui` exercises colocated `.test.ts(x)` files via the TSX runner.
- CV & ops: run integration flows under `tests/integration/`; artifacts land in `tests/images/`.

## Commit & Pull Request Guidelines
- Use Conventional Commit prefixes (`feat:`, `fix:`, `chore:`) and keep scopes descriptive.
- PRs should link issues, describe behavioural changes, list test commands executed, and attach screenshots or clips for UI/CV updates.
- Flag environment-sensitive toggles (GPU tuning, OmniParser modes, env vars like `BYTEBOT_GRID_OVERLAY`) so reviewers can reproduce results.

## Security & Configuration Tips
- Keep secrets in `docker/.env`; document placeholders in `.env.defaults`.
- Treat large CUDA/Holo assets as external dependencies—fetch via `scripts/setup-holo.sh` rather than committing binaries.
