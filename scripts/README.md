# Bytebot Hawkeye - Build & Deployment Scripts

This directory contains scripts to set up, build, and manage Bytebot Hawkeye stack.

## Quick Start

### Fresh Build (Recommended for First Time or After Code Changes)

```bash
./scripts/fresh-build.sh
```

This comprehensive script:
1. Stops any running services
2. Optionally clears Docker build cache
3. Builds `shared` package (required dependency)
4. Builds `bytebot-cv` package (CV capabilities)
5. Sets up OmniParser (platform-specific)
6. Starts OmniParser natively (Apple Silicon only)
7. Builds all Docker containers with latest code
8. Starts the full stack
9. Verifies service health

**Use this when:**
- First time setup
- After pulling code changes
- After modifying packages (agent, cv, shared, ui)
- TypeScript/build errors occur

---

## Script Reference

### `setup-omniparser.sh`

**Purpose:** Platform-aware OmniParser setup

**What it does:**
- Detects platform (Apple Silicon vs x86_64)
- **Apple Silicon (M1-M4):**
  - Sets up native Python environment (venv or conda)
  - Downloads OmniParser models (~850MB)
  - Configures MPS GPU acceleration
  - Updates Docker config to use `host.docker.internal:9989`
- **x86_64:**
  - Configures Docker to use containerized OmniParser
  - Auto-detects NVIDIA GPU for CUDA acceleration
  - Falls back to CPU if no GPU

**Usage:**
```bash
./scripts/setup-omniparser.sh
```

**First-time setup only** - Run once per system.

---

### `start-omniparser.sh`

**Purpose:** Start native OmniParser (Apple Silicon only)

**What it does:**
- Activates Python environment
- Starts OmniParser FastAPI server on port 9989
- Uses MPS GPU for ~1-2s/frame performance
- Runs in background with logs at `packages/bytebot-omniparser/omniparser.log`

**Usage:**
```bash
./scripts/start-omniparser.sh
```

**Required for Apple Silicon** before starting Docker stack.

---

### `stop-omniparser.sh`

**Purpose:** Stop native OmniParser

**What it does:**
- Finds process on port 9989
- Gracefully terminates OmniParser server

**Usage:**
```bash
./scripts/stop-omniparser.sh
```

---

### `start-stack.sh`

**Purpose:** Start Docker stack (with automatic rebuild)

**What it does:**
- Detects platform and running services
- **Apple Silicon:**
  - Checks if native OmniParser is running
  - Auto-starts OmniParser if not running
  - Starts Docker services (excluding OmniParser container)
  - Rebuilds containers if code changed (`--build` flag)
- **x86_64:**
  - Starts full Docker stack including OmniParser container
  - Rebuilds containers if code changed
- Verifies service health
- Shows service URLs and logs commands

**Usage:**
```bash
./scripts/start-stack.sh
```

**Use for regular starts** after initial setup. Automatically rebuilds on code changes.

---

### `stop-stack.sh`

**Purpose:** Stop all services

**What it does:**
- Stops Docker containers
- Optionally stops native OmniParser (prompts user)

**Usage:**
```bash
./scripts/stop-stack.sh
```

---

## Build Dependencies

Packages must be built in this order:

```
1. shared (base types, utilities)
   ↓
2. bytebot-cv (CV capabilities, depends on shared)
   ↓
3. bytebot-agent, bytebotd (services, depend on shared + cv)
   ↓
4. bytebot-ui (frontend, depends on shared)
```

**Docker builds handle this automatically**, but for local development:

```bash
# Build order
cd packages/shared && npm run build
cd packages/bytebot-cv && npm run build
cd packages/bytebot-agent && npm run build
cd packages/bytebot-ui && npm run build
```

---

## Platform-Specific Performance

### Apple Silicon (M1/M2/M3/M4)

**Configuration:**
- OmniParser: Native with MPS GPU
- Performance: ~1-2s per frame
- URL: `http://host.docker.internal:9989`

**Benefits:**
- GPU acceleration via Metal Performance Shaders
- No Docker overhead for ML models
- Best performance on Apple Silicon

### x86_64 + NVIDIA GPU

**Configuration:**
- OmniParser: Docker container with CUDA
- Performance: ~0.6s per frame
- URL: `http://bytebot-omniparser:9989`

**Benefits:**
- Production-ready containerized setup
- Excellent GPU performance
- Auto-detects CUDA

### x86_64 CPU-only

**Configuration:**
- OmniParser: Docker container, CPU-only
- Performance: ~8-15s per frame
- URL: `http://bytebot-omniparser:9989`

**Fallback mode** - works everywhere but slower.

---

## Troubleshooting

### "Cannot find module '@bytebot/shared'" or similar

**Solution:** Run fresh build to rebuild dependencies:
```bash
./scripts/fresh-build.sh
```

### OmniParser not responding (Apple Silicon)

**Check if running:**
```bash
lsof -i :9989
curl http://localhost:9989/health
```

**Restart:**
```bash
./scripts/stop-omniparser.sh
./scripts/start-omniparser.sh
```

**Check logs:**
```bash
tail -f packages/bytebot-omniparser/omniparser.log
```

### Docker build fails with OpenCV errors

**Solution:** Clear build cache and rebuild:
```bash
docker builder prune -f
./scripts/fresh-build.sh
```

### Agent showing "unhealthy" status

**Common causes:**
1. Database not ready (wait 10-15 seconds)
2. Build errors in TypeScript
3. Missing environment variables

**Check logs:**
```bash
docker logs bytebot-agent
```

### Changes not reflected after rebuild

**Solution:** Force full rebuild:
```bash
./scripts/stop-stack.sh
docker builder prune -f
./scripts/fresh-build.sh
```

---

## Environment Configuration

### Required Files

1. **docker/.env** - Docker Compose environment
   ```bash
   cp docker/.env.defaults docker/.env
   # Edit with your API keys
   ```

2. **docker/.env.defaults** - System defaults (auto-managed by scripts)

### Key Variables

```bash
# OmniParser Integration
BYTEBOT_CV_USE_OMNIPARSER=true
OMNIPARSER_URL=http://host.docker.internal:9989  # Apple Silicon
OMNIPARSER_DEVICE=auto  # auto, cuda, mps, cpu
OMNIPARSER_MIN_CONFIDENCE=0.3

# API Keys
ANTHROPIC_API_KEY=sk-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
```

---

## Development Workflow

### Standard Development Loop

1. **Make code changes** in packages/
2. **Restart with rebuild:**
   ```bash
   ./scripts/start-stack.sh
   ```
   (Now includes `--build` flag automatically)
3. **View logs:**
   ```bash
   docker logs -f bytebot-agent
   ```

### After Major Changes (TypeScript refactors, new dependencies)

```bash
./scripts/fresh-build.sh
```

### Testing OmniParser Detection

```bash
# Health check
curl http://localhost:9989/health

# View recent CV activity
curl http://localhost:9991/cv-activity/stream | jq

# View CV performance stats
curl http://localhost:9991/cv-activity/performance | jq
```

---

## Service URLs

After successful startup:

- **UI:** http://localhost:9992
- **Agent API:** http://localhost:9991
- **Desktop (noVNC):** http://localhost:9990
- **OmniParser:** http://localhost:9989
- **PostgreSQL:** localhost:5432

---

## Getting Help

If issues persist:

1. Check logs: `docker compose -f docker/docker-compose.yml logs -f`
2. Verify health: `curl http://localhost:9991/health`
3. Test OmniParser: `curl http://localhost:9989/health`
4. Review CLAUDE.md for architecture details
