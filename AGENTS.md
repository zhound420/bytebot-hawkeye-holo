# Repository Guidelines

## Project Structure & Module Organization
Monorepo code lives under `packages/`. Shared DTOs and helpers belong in `packages/shared`; regenerate them before touching dependent packages. Backend services are in `packages/bytebot-agent`, Claude control flows in `packages/bytebot-agent-cc`, CV tooling in `packages/bytebot-cv`, UI dashboards in `packages/bytebot-ui`, the desktop daemon in `packages/bytebotd`, and proxy assets in `packages/bytebot-llm-proxy`. Docs sit in `docs/`, deployment manifests in `helm/` and `docker/`, and static overlays in `static/`. Keep specs close to implementations using `*.spec.ts` filenames.

## Build, Test, and Development Commands
Run `npm run build --prefix packages/shared` whenever shared contracts change. Start the NestJS API via `cd packages/bytebot-agent && npm install && npm run start:dev`; pair schema edits with `npm run prisma:dev`. Spin up the Next.js UI using `cd packages/bytebot-ui && npm run dev`, and launch the desktop daemon with `cd packages/bytebotd && npm run start:dev`. For an end-to-end sandbox, execute `docker compose -f docker/docker-compose.yml up -d`.

## Coding Style & Naming Conventions
Write TypeScript with 2-space indentation, single quotes, trailing commas, and camelCase variables. Use PascalCase for classes and snake_case for Prisma models. Run `npm run format` to apply the shared Prettier and ESLint configuration before committing.

## Testing Guidelines
All packages rely on Jest. Name unit tests `*.spec.ts` and co-locate them with the code they cover. Execute suites with `npm test`, `npm run test:watch`, or `npm run test:cov` from each package. Validate API flows through `npm run test:e2e` in `packages/bytebot-agent` and keep deterministic mocks alongside their specs.

## Commit & Pull Request Guidelines
Write imperative commit subjects (e.g., `Improve coordinate telemetry`) and stage only intentional changes. PR descriptions should summarize intent, flag schema or env updates, link issues, and include UI captures when relevant. Document automated and manual test coverage and call out new environment variables or migration steps.

## Security & Configuration Tips
Load secrets from package-specific `.env` files or `docker/.env`; never commit credentials. Toggle Hawkeye features with environment variables such as `BYTEBOT_SMART_FOCUS` and `BYTEBOT_COORDINATE_METRICS`.
