# Repository Guidelines

## Project Structure & Module Organization
- Monorepo roots live under `packages/`; key products include `bytebot-cv` for vision, `bytebot-agent` and `bytebot-agent-cc` for automation, `bytebot-ui` for dashboards, `bytebotd` for the desktop daemon, and `bytebot-llm-proxy` for LLM brokerage.
- Shared DTOs and utilities reside in `packages/shared`; regenerate them with `npm run build --prefix packages/shared` before consuming changes elsewhere.
- Co-locate specs as `*.spec.ts` beside their sources, document features in `docs/`, keep container assets in `docker/` and `helm/`, and place fixtures or overlays in `static/`.

## Build, Test, and Development Commands
- `npm install` (repo root) hydrates workspace dependencies.
- `npm run start:dev --prefix packages/bytebot-agent` launches backend flows; swap the prefix to target other packages.
- `npm run build --prefix packages/bytebot-ui` produces production bundles for the dashboard.
- `npm test --prefix <package>` executes that package's Jest suite; `npm run test:watch --prefix <package>` keeps it hot-reloading.
- `npm install --prefix packages/bytebot-cv` now validates OpenCV CLAHE support; export `OPENCV4NODEJS_AUTOBUILD_FLAGS="-DWITH_FFMPEG=OFF -DBUILD_opencv_imgproc=ON -DBUILD_opencv_photo=ON -DBUILD_opencv_xphoto=ON -DBUILD_opencv_ximgproc=ON -DOPENCV_ENABLE_NONFREE=ON"` before reinstalling if the check fails.
- The OpenCV autobuild pulls `opencv_contrib`; if logs say "skipping opencv_contrib" unset `OPENCV4NODEJS_AUTOBUILD_WITHOUT_CONTRIB` and rebuild (`docker compose build --no-cache` is the quickest sanity check).
- `docker compose -f docker/docker-compose.yml up -d` starts the full sandbox; tear down with the matching `down` command.

## Coding Style & Naming Conventions
- TypeScript first with 2-space indentation, single quotes, trailing commas, and camelCase variables; classes stay in PascalCase and Prisma models in snake_case.
- Prefer local module imports; export shared helpers through `packages/shared`.
- Run `npm run format` before committing to apply Prettier + ESLint.

## Testing Guidelines
- Jest covers unit, integration, and e2e paths; ensure new features ship with companion specs following the `<name>.spec.ts` pattern.
- Backend e2e suites live in `packages/bytebot-agent`; invoke them via `npm run test:e2e --prefix packages/bytebot-agent` before major releases.
- Refresh mocks and fixtures when DTO schemas evolve to prevent contract drift.

## Commit & Pull Request Guidelines
- Write imperative commit subjects (e.g., `Improve coordinate telemetry`) and stage only intentional hunks.
- PRs should describe intent, link issues, flag schema or environment changes, and include UI captures when visuals shift.
- Coordinate with downstream teams whenever `packages/shared` or vision pipelines change to avoid breaking consumers.

## Security & Configuration Tips
- Load secrets through package-level `.env` files or `docker/.env`; never commit credentials.
- Document feature flags such as `BYTEBOT_SMART_FOCUS` or `BYTEBOT_COORDINATE_METRICS` in PR notes and validate the impacted flows.
- Align dependency upgrades across packages and rerun affected builds or tests to confirm compatibility.
