# Repository Guidelines

## Project Structure & Module Organization
Packages live under `packages/`, with the NestJS control plane in `packages/bytebot-agent` and the Next.js UI in `packages/bytebot-ui`. Prisma schema and migrations sit in `packages/bytebot-agent/prisma/`, while feature modules land in `packages/bytebot-agent/src/`. UI assets are kept in `packages/bytebot-ui/static/`. Computer-vision helpers and camera control reside in `packages/bytebot-cv` and `packages/bytebot-agent-cc`. Shared utilities stay in `packages/shared`. Operational scripts live in `scripts/`, container specs in `docker/`, Helm charts in `helm/`, and integration fixtures in `tests/`.

## Build, Test, and Development Commands
Bootstrap dependencies with `npm install` (Node 20+). Start the control plane with `npm run start:dev --workspace bytebot-agent` to hot reload NestJS and regenerate Prisma types. Launch the UI via `npm run dev --workspace bytebot-ui` for a rebuild-aware proxy. Bring the full stack (agent, OmniParser, health checks) up with `./scripts/start-stack.sh` and tear down via `./scripts/stop-stack.sh`. Produce optimized bundles with `npm run build --workspace <workspace>`.

## Coding Style & Naming Conventions
Use TypeScript-first code with two-space indentation, single quotes, and trailing commas. Prefer `camelCase` for variables and helpers, `PascalCase` for classes and React components, and kebab-case for UI filenames and routes. Run the workspace `format` scripts before committing. ESLint (`eslint.config.mjs`) flags unawaited promises—either `await` them or annotate intentional detaches.

## Testing Guidelines
Run backend unit tests with `npm test --workspace bytebot-agent`, E2E tests via `npm run test:e2e --workspace bytebot-agent`, and coverage gates through `npm run test:cov --workspace bytebot-agent`. Frontend tests execute with `npm test --workspace bytebot-ui`, exercising colocated `.test.ts(x)` files. CV and ops integration flows run from `tests/integration/`, producing artifacts under `tests/images/`.

## Commit & Pull Request Guidelines
Follow Conventional Commits (e.g., `feat(agent): add action orchestrator`). Link issues in PR descriptions, summarize behavioural changes, list executed test commands, and attach screenshots or clips for UI or CV updates. Flag environment-sensitive toggles such as `BYTEBOT_GRID_OVERLAY`, GPU tuning, or OmniParser modes so reviewers can reproduce your results.

## Security & Configuration Tips
Store secrets in `docker/.env` and document placeholders in `.env.defaults`. Fetch large CUDA or Holo assets through `scripts/setup-holo.sh` instead of committing binaries. Treat new configuration toggles as part of the review checklist and update docs accordingly.
