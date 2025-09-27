# Repository Guidelines

## Project Structure & Module Organization
The monorepo roots each product area in `packages/`, and every directory acts as an isolated npm workspace. Backend automation lives in `packages/bytebot-agent`, contact-center flows in `packages/bytebot-agent-cc`, computer-vision logic right here in `packages/bytebot-cv`, UI dashboards in `packages/bytebot-ui`, the desktop daemon in `packages/bytebotd`, and the LLM proxy in `packages/bytebot-llm-proxy`. Shared DTOs and helpers sit in `packages/shared`; regenerate published artifacts after edits before pushing downstream changes. Keep specs beside their implementations as `*.spec.ts`, stash documentation in `docs/`, container assets in `docker/` and `helm/`, and static overlays in `static/`.

## Build, Test, and Development Commands
Run `npm install` from the repo root once per machine, then target packages with `npm run <script> --prefix <package>`. Rebuild shared contracts via `npm run build --prefix packages/shared`. Start the NestJS backend with `npm run start:dev --prefix packages/bytebot-agent`, pairing schema tweaks with `npm run prisma:dev --prefix packages/bytebot-agent`. Bring up the Next.js UI through `npm run dev --prefix packages/bytebot-ui`, and fire up the full sandbox using `docker compose -f docker/docker-compose.yml up -d` when validating integrations.

## Coding Style & Naming Conventions
Code in TypeScript with 2-space indentation, single quotes, trailing commas, and camelCase identifiers. Classes remain in PascalCase, Prisma models in snake_case. Run `npm run format` before committing to apply the shared Prettier + ESLint ruleset, and respect existing module boundaries when sharing logic by exporting through `packages/shared`.

## Testing Guidelines
Jest powers unit and integration coverage. Co-locate deterministic specs with their source as `filename.spec.ts`, mocking external services in-place. Execute suites using `npm test --prefix <package>`, watch loops with `npm run test:watch --prefix <package>`, and target backend e2e flows via `npm run test:e2e --prefix packages/bytebot-agent`. Treat failing tests as blockers and update fixtures whenever DTOs evolve.

## Commit & Pull Request Guidelines
Write imperative commit subjects such as `Improve coordinate telemetry`, and stage only intentional hunks. PRs should summarize intent, link tracking issues, flag schema or environment adjustments, list manual and automated test evidence, and attach UI captures when visuals shift. Coordinate closely with downstream consumers whenever shared contracts or CV pipelines change.

## Security & Configuration Tips
Load secrets through package-level `.env` files or `docker/.env`; never commit credentials. Feature toggles such as `BYTEBOT_SMART_FOCUS` and `BYTEBOT_COORDINATE_METRICS` control Hawkeye behaviors—document any new switches in PR notes. Keep dependency upgrades coordinated across packages to avoid mismatched shim versions.
