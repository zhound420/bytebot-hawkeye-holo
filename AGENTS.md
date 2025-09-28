# Repository Guidelines

## Project Structure & Module Organization
- Core packages live in `packages/`; `bytebot-cv` handles vision flows, `bytebot-agent` and `bytebot-agent-cc` automate workflows, `bytebot-ui` ships dashboards, `bytebotd` powers the desktop daemon, and `bytebot-llm-proxy` brokers LLM traffic.
- Shared DTOs and helpers reside in `packages/shared`; regenerate them with `npm run build --prefix packages/shared` before consuming updates elsewhere.
- Keep specs adjacent to sources as `*.spec.ts`; product docs live in `docs/`, container assets in `docker/` and `helm/`, and reference fixtures or overlays in `static/`.

## Build, Test, and Development Commands
- `npm install` in the repo root installs workspace dependencies.
- `npm run start:dev --prefix packages/bytebot-agent` boots backend flows; swap the prefix for other services.
- `npm run build --prefix packages/bytebot-ui` produces production-ready UI bundles.
- `npm test --prefix <package>` runs Jest for that package; `npm run test:watch --prefix <package>` keeps feedback hot.
- `npm run test:e2e --prefix packages/bytebot-agent` exercises end-to-end agent scenarios.
- `npm install --prefix packages/bytebot-cv` validates the OpenCV toolchain; export `OPENCV4NODEJS_AUTOBUILD_FLAGS="-DWITH_FFMPEG=OFF -DBUILD_opencv_imgproc=ON -DBUILD_opencv_photo=ON -DBUILD_opencv_xphoto=ON -DBUILD_opencv_ximgproc=ON -DOPENCV_ENABLE_NONFREE=ON"` if CLAHE support fails.
- `docker compose -f docker/docker-compose.yml up -d` spins up the full sandbox; use the matching `down` command to stop it.

## Coding Style & Naming Conventions
- TypeScript-first codebase with 2-space indentation, single quotes, trailing commas, and semantically named camelCase variables; classes stay in PascalCase and Prisma models remain snake_case.
- Favor local module imports; surface shared utilities through `packages/shared`.
- Run `npm run format` before commits to apply Prettier and ESLint.

## Testing Guidelines
- Jest drives unit, integration, and e2e coverage; mirror new features with nearby specs following the `<name>.spec.ts` pattern.
- Refresh mocks and fixtures whenever DTO schemas evolve to prevent contract drift.
- Run `npm run test:e2e --prefix packages/bytebot-agent` ahead of releases that touch automation flows.

## Commit & Pull Request Guidelines
- Write imperative commit subjects (e.g., `Improve coordinate telemetry`) and stage only intentional hunks.
- PRs should explain intent, link issues, flag schema or feature-toggle changes, and include UI captures when visuals shift.
- Coordinate with downstream teams when modifying `packages/shared` or computer-vision pipelines to avoid breaking consumers.

## Security & Configuration Tips
- Load secrets through package-level `.env` files or `docker/.env`; never commit credentials.
- Document flags such as `BYTEBOT_SMART_FOCUS` or `BYTEBOT_COORDINATE_METRICS` in PR notes and verify the affected flows.
- Align dependency upgrades across packages and rerun the impacted builds or tests to confirm compatibility.
