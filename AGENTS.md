# Repository Guidelines

## Project Structure & Module Organization
- Monorepo lives under `packages/`; keep shared DTOs and helpers in `packages/shared`.
- NestJS backend resides in `packages/bytebot-agent`, Claude control flows in `packages/bytebot-agent-cc`, UI dashboards in `packages/bytebot-ui`, and the desktop daemon in `packages/bytebotd`.
- Store CV tooling in `packages/bytebot-cv`, LLM proxy assets in `packages/bytebot-llm-proxy`, docs inside `docs/`, deployment files under `helm/` and `docker/`, and static overlays in `static/`.
- Place specs beside implementation as `*.spec.ts`; avoid scattering test utilities outside their owning package.

## Build, Test, and Development Commands
- Regenerate shared types with `npm run build --prefix packages/shared` before touching downstream packages.
- Start the API via `cd packages/bytebot-agent && npm install && npm run start:dev`; pair schema edits with `npm run prisma:dev`.
- Launch the Next.js UI using `cd packages/bytebot-ui && npm run dev`; run the desktop daemon with `cd packages/bytebotd && npm run start:dev`.
- For a full sandbox spin-up, run `docker compose -f docker/docker-compose.yml up -d`.

## Coding Style & Naming Conventions
- Use TypeScript with 2-space indentation, single quotes, trailing commas, and camelCase variables; keep classes PascalCase and Prisma models snake_case.
- Run `npm run format` to enforce the shared Prettier and ESLint rules before committing.
- Keep cross-agent contracts centralized in `packages/shared`; duplicate definitions drift quickly.

## Testing Guidelines
- All packages use Jest; place deterministic mocks alongside specs.
- Name tests `*.spec.ts` and run suites locally with `npm test`, `npm run test:watch`, or `npm run test:cov` from each package.
- Validate API flows with `npm run test:e2e` in `packages/bytebot-agent`; cover CV helpers with focused suites in `packages/bytebot-cv`.

## Commit & Pull Request Guidelines
- Write imperative commit subjects (e.g., `Improve coordinate telemetry`) and stage only intentional changes.
- In PR descriptions, summarize intent, flag schema or env updates, link issues, and attach UI captures when relevant.
- Document manual and automated test coverage and highlight new environment variables or migration steps.

## Security & Configuration Tips
- Load secrets from package-specific `.env` files or `docker/.env`; never commit credentials.
- Use env toggles such as `BYTEBOT_SMART_FOCUS` and `BYTEBOT_COORDINATE_METRICS` to switch Hawkeye features.
