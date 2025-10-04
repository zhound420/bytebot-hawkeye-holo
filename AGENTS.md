# Repository Guidelines

Contributors keep Hawkeye’s high-precision desktop agent dependable. Use this guide to align changes across services.

## Project Structure & Module Organization
- `packages/bytebot-agent`: NestJS control plane with Prisma state and CV orchestration.
- `packages/bytebot-ui`: Next.js command center served through `tsx server.ts`; static assets live in `static/`.
- `packages/bytebot-cv` and `packages/bytebot-agent-cc`: OpenCV helpers, scalar polyfills, and camera control consumed by the agent.
- Support modules: `packages/shared` (types/utilities), `packages/bytebotd` & `packages/bytebot-llm-proxy` (daemon + LiteLLM bridge), while `scripts/`, `docker/`, and `tests/` hold operational tooling and integration fixtures.

## Build, Test & Development Commands
- `npm install` (root): installs all workspaces; requires Node 20+.
- `npm run start:dev --workspace bytebot-agent`: watches the NestJS service and regenerates Prisma types.
- `npm run dev --workspace bytebot-ui`: rebuilds shared packages then launches the UI proxy.
- `./scripts/start-stack.sh` / `./scripts/stop-stack.sh`: orchestrate the full stack, OmniParser mode, and health checks.
- `npm run build --workspace <workspace>`: produce ship-ready bundles before containerizing or pushing images.

## Coding Style & Naming Conventions
- TypeScript-first codebase; keep modules under `src/` with feature-oriented folder names.
- Prettier enforces single quotes, trailing commas, and two-space indentation; run the `format` script per workspace before committing.
- ESLint configs (`eslint.config.mjs`) extend the TS recommended set and warn on unhandled promises—`await` async helpers or document intentional detaches.
- Use `camelCase` for functions/constants, `PascalCase` for classes and React components, kebab-case for UI filenames.

## Testing Guidelines
- Backend: `npm test --workspace bytebot-agent` (Jest unit specs), `npm run test:e2e --workspace bytebot-agent`, and `npm run test:cov --workspace bytebot-agent` for coverage review.
- Frontend: `npm test --workspace bytebot-ui` runs the TSX-based test runner; colocate `.test.ts(x)` files alongside components.
- CV & ops: execute integration scripts in `tests/integration/` (Node or Bash). They assume the stack is live and emit diagnostics plus artifacts under `tests/images/`.

## Commit & Pull Request Guidelines
- Follow the existing Conventional Commit pattern (`feat:`, `fix:`, `chore:`) seen in history.
- PRs should link issues, summarize behaviour changes, note test commands run, and attach screenshots or clips for UI or CV-visual tweaks.
- Flag environment-sensitive work (GPU tuning, OmniParser toggles, env vars like `BYTEBOT_GRID_OVERLAY`) so reviewers can reproduce.

## Configuration & Security
- Store secrets in `docker/.env`; keep real keys out of Git and document placeholders in `.env.defaults`.
- Large CUDA/OpenCV assets are provisioned via `scripts/setup-omniparser.sh`—do not commit binaries. Capture any cache/bootstrap nuances in your PR description.
