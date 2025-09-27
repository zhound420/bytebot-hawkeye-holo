# Repository Guidelines

## Project Structure & Module Organization
The monorepo anchors each product under `packages/`: automation in `packages/bytebot-agent`, contact-center flows in `packages/bytebot-agent-cc`, computer vision here in `packages/bytebot-cv`, dashboards in `packages/bytebot-ui`, the desktop daemon in `packages/bytebotd`, the LLM proxy in `packages/bytebot-llm-proxy`, and shared DTOs/utilities in `packages/shared`. Co-locate specs as `*.spec.ts`, stash docs in `docs/`, containers in `docker/` and `helm/`, and static overlays in `static/`.

## Build, Test, and Development Commands
Run `npm install` once from the repo root. Target a workspace with `npm run <script> --prefix <package>`, e.g. `npm run start:dev --prefix packages/bytebot-agent` for the NestJS service or `npm run dev --prefix packages/bytebot-ui` for the Next.js UI. Rebuild shared contracts via `npm run build --prefix packages/shared`. Spin up the full sandbox with `docker compose -f docker/docker-compose.yml up -d`.

## Coding Style & Naming Conventions
Write TypeScript with 2-space indentation, single quotes, trailing commas, and camelCase identifiers; classes stay in PascalCase and Prisma models in snake_case. Run `npm run format` before committing to apply the shared Prettier + ESLint config. Export shared logic through `packages/shared` rather than cross-importing internals.

## Testing Guidelines
Jest drives unit and integration suites. Name specs `filename.spec.ts` alongside their sources, and keep mocks local. Execute packages with `npm test --prefix <package>`, watch via `npm run test:watch --prefix <package>`, and cover backend e2e cases using `npm run test:e2e --prefix packages/bytebot-agent`. Treat failing tests as blockers and refresh fixtures when DTOs shift.

## Commit & Pull Request Guidelines
Use imperative commit subjects such as `Improve coordinate telemetry` and stage intentional hunks only. PRs should explain intent, link tracking issues, flag schema or environment tweaks, list manual/automated test evidence, and attach UI captures when visuals change. Coordinate with downstream consumers whenever shared contracts or CV pipelines evolve.

## Security & Configuration Tips
Load secrets through package-level `.env` files or `docker/.env`; never commit credentials. Document new feature toggles like `BYTEBOT_SMART_FOCUS` or `BYTEBOT_COORDINATE_METRICS` in PR notes. Align dependency upgrades across packages to avoid shim mismatches.
