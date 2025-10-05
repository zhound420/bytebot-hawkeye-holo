# Repository Guidelines

This guide helps contributors orient quickly inside bytebot-hawkeye-holo and ship reliable changes with confidence.

## Project Structure & Module Organization
- `packages/bytebot-agent/` hosts the NestJS control plane; Prisma schema and migrations live in `prisma/`, feature modules under `src/`, and camera orchestration glue in `packages/bytebot-agent-cc/`.
- `packages/bytebot-ui/` is the Next.js client with static assets in `static/`; colocate UI fixtures beside their components.
- Vision helpers reside in `packages/bytebot-cv/`; cross-cutting utilities sit in `packages/shared/`; operational tooling spans `scripts/`, `docker/`, `helm/`, and `tests/` (integration artifacts under `tests/images/`).
- Reference design notes and troubleshooting guides in `docs/` and top-level `*_GUIDE.md` files before introducing new modules.

## Build, Test, and Development Commands
- Install dependencies with `npm install` (Node 20+).
- Run the control plane live reload via `npm run start:dev --workspace bytebot-agent` to refresh Prisma types.
- Launch the UI locally with `npm run dev --workspace bytebot-ui`.
- Bring the full stack up with `./scripts/start-stack.sh` and down with `./scripts/stop-stack.sh`.
- Produce optimized bundles using `npm run build --workspace <workspace>`.

## Coding Style & Naming Conventions
- Default to TypeScript, two-space indentation, single quotes, and trailing commas.
- Use `camelCase` for variables/functions, `PascalCase` for classes and React components, and kebab-case filenames for UI routes.
- Run workspace formatters and linters (`npm run lint --workspace <workspace>`) before commit; address unawaited promise warnings in `eslint.config.mjs`.

## Testing Guidelines
- Backend unit tests: `npm test --workspace bytebot-agent`; E2E: `npm run test:e2e --workspace bytebot-agent`; coverage: `npm run test:cov --workspace bytebot-agent`.
- Frontend tests: `npm test --workspace bytebot-ui`; place `.test.ts(x)` beside the code they cover.
- Store integration suites in `tests/integration/`; generated imagery belongs under `tests/images/`.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (for example `feat(agent): add action orchestrator`).
- In PR descriptions, reference issues, summarize behavioural changes, and enumerate the test commands you executed.
- Attach UI or CV screenshots/clips when visual regressions are possible and call out toggles such as `BYTEBOT_GRID_OVERLAY`.

## Security & Configuration Tips
- Keep secrets in `docker/.env`; document placeholders via `.env.defaults`.
- Use `scripts/setup-holo.sh` to fetch large CUDA or Holo assets instead of committing binaries.
- Treat new configuration flags as review items and update docs or Helm values accordingly.
