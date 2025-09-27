# Repository Guidelines

## Project Structure & Module Organization
- The monorepo centers each product under `packages/`, with `packages/bytebot-cv` for vision pipelines, `packages/bytebot-agent` for automation flows, `packages/bytebot-agent-cc` for contact-center logic, `packages/bytebot-ui` for dashboards, `packages/bytebotd` for the desktop daemon, and `packages/bytebot-llm-proxy` for LLM brokering.
- Keep unit specs beside sources as `name.spec.ts`; docs belong in `docs/`, container assets in `docker/` and `helm/`, and overlays or fixtures in `static/`.
- Shared DTOs and utilities live in `packages/shared`; publish or rebuild there before consuming updates downstream.

## Build, Test, and Development Commands
- Run `npm install` once from the repo root to hydrate workspace dependencies.
- Target a package with `npm run <script> --prefix <package>`, e.g. `npm run start:dev --prefix packages/bytebot-agent` or `npm run dev --prefix packages/bytebot-ui`.
- Refresh shared contracts using `npm run build --prefix packages/shared`.
- Launch the full sandbox via `docker compose -f docker/docker-compose.yml up -d` and tear down with `docker compose -f docker/docker-compose.yml down`.

## Coding Style & Naming Conventions
- Default to TypeScript with 2-space indentation, single quotes, trailing commas; classes in PascalCase, variables camelCase, Prisma models snake_case.
- Prefer co-located modules over deep relative imports; export cross-cutting helpers through `packages/shared`.
- Run `npm run format` before committing to apply the unified Prettier + ESLint ruleset.

## Testing Guidelines
- Jest covers unit, integration, and e2e paths; execute with `npm test --prefix <package>` and watch changes via `npm run test:watch --prefix <package>`.
- Backend e2e coverage lives in `packages/bytebot-agent` and runs with `npm run test:e2e --prefix packages/bytebot-agent`.
- Keep mocks local to their specs, refresh fixtures when DTO schemas evolve, and block merges on failing suites.

## Commit & Pull Request Guidelines
- Use imperative commit subjects (e.g., `Improve coordinate telemetry`) and stage only intentional hunks.
- PRs should capture intent, link issues, flag schema or environment changes, attach UI captures when visuals shift, and note required rollouts.
- Coordinate with downstream consumers whenever shared contracts or computer-vision pipelines evolve.

## Security & Configuration Tips
- Load secrets through package-level `.env` files or `docker/.env`; never check credentials into git.
- Document feature flags such as `BYTEBOT_SMART_FOCUS` or `BYTEBOT_COORDINATE_METRICS` in PR notes.
- Align dependency upgrades across packages and rerun impacted build/test scripts to confirm compatibility.
