# Repository Guidelines

## Project Structure & Module Organization
- The monorepo lives under `packages/`; treat each folder as an isolated npm workspace.
- Shared DTOs and helpers sit in `packages/shared`; regenerate published artifacts before editing dependent services.
- Backend automation runs in `packages/bytebot-agent`, conversation flows in `packages/bytebot-agent-cc`, CV logic in `packages/bytebot-cv`, web dashboards in `packages/bytebot-ui`, the desktop daemon in `packages/bytebotd`, and LLM proxy assets in `packages/bytebot-llm-proxy`.
- Specs belong beside their implementations using the `*.spec.ts` suffix. Docs live in `docs/`, deploy assets in `helm/` and `docker/`, static overlays in `static/`.

## Build, Test, and Development Commands
- `npm install` from the repo root once per machine; afterwards run package-specific scripts via `npm run <script> --prefix <package>`.
- Rebuild shared contracts with `npm run build --prefix packages/shared` whenever DTOs change.
- Start the NestJS API with `cd packages/bytebot-agent && npm run start:dev`; pair schema edits with `npm run prisma:dev`.
- Launch the Next.js UI through `cd packages/bytebot-ui && npm run dev`.
- Bring up the full sandbox using `docker compose -f docker/docker-compose.yml up -d`.

## Coding Style & Naming Conventions
- Use TypeScript with 2-space indentation, single quotes, trailing commas, and camelCase variables.
- Classes stay in PascalCase; Prisma models remain snake_case.
- Run `npm run format` before commits to apply the shared Prettier + ESLint rules.

## Testing Guidelines
- Tests use Jest and live with the code as `*.spec.ts`. Create deterministic mocks alongside specs.
- Run suites per package with `npm test`, `npm run test:watch`, or `npm run test:cov`.
- For API flows, rely on `npm run test:e2e` inside `packages/bytebot-agent`.

## Commit & Pull Request Guidelines
- Write imperative commit subjects (e.g., `Improve coordinate telemetry`); stage only intentional changes.
- PRs should summarize intent, call out schema or env updates, link issues, describe manual/automated testing, and add UI captures when relevant.

## Security & Configuration Tips
- Load secrets from package-specific `.env` files or `docker/.env`; never commit credentials.
- Toggle Hawkeye features with env vars such as `BYTEBOT_SMART_FOCUS` and `BYTEBOT_COORDINATE_METRICS`.
