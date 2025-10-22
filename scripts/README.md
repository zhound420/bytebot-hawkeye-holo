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
5. Sets up Holo 1.5-7B (platform-specific)
6. Starts Holo natively (Apple Silicon only)
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

### `setup-holo.sh`

**Purpose:** Platform-aware Holo 1.5-7B setup

**What it does:**
- Detects platform (Apple Silicon vs x86_64)
- **Apple Silicon (M1-M4):**
  - Sets up native Python environment (venv or conda)
  - Installs dependencies (openai, supervision for SOM annotations)
  - Downloads OmniParser models (~850MB)
  - **Applies PaddleOCR 3.x compatibility patch** (automated)
  - **Configures float32 dtype for MPS GPU** (automatic, prevents dtype errors)
  - Updates Docker config to use `host.docker.internal:9989`
- **x86_64:**
  - Configures Docker to use containerized OmniParser
  - Auto-detects NVIDIA GPU for CUDA acceleration
  - Falls back to CPU if no GPU

**Usage:**
```bash
./scripts/setup-holo.sh
```

**First-time setup only** - Run once per system.

---

### `start-holo.sh`

**Purpose:** Start native Holo 1.5-7B (Apple Silicon only)

**What it does:**
- Activates Python environment
- Starts OmniParser FastAPI server on port 9989
- Uses MPS GPU for ~1-2s/frame performance
- Runs in background with logs at `packages/bytebot-holo/omniparser.log`

**Usage:**
```bash
./scripts/start-holo.sh
```

**Required for Apple Silicon** before starting Docker stack.

---

### `stop-holo.sh`

**Purpose:** Stop native Holo 1.5-7B

**What it does:**
- Finds process on port 9989
- Gracefully terminates OmniParser server

**Usage:**
```bash
./scripts/stop-holo.sh
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
  - Waits for the native OmniParser health endpoint before continuing
- **x86_64:**
  - Starts the Holo container first, waits for its health check, then boots the remaining services
  - Rebuilds containers if code changed
- Waits for container health checks (Holo, Agent) and port readiness (UI/Desktop) with a 5-minute warmup window
- Prints consolidated service status with guidance if a service is still warming up
- Shows service URLs and logs commands

**Usage:**
```bash
./scripts/start-stack.sh
```

**Use for regular starts** after initial setup. Automatically rebuilds on code changes.

> **Heads-up:** Holo's first CUDA/MPS initialization can take several minutes. The
> script blocks until `/health` responds, then prints next steps. Tail logs with
> `docker compose -f docker/docker-compose.yml logs -f bytebot-holo` (or
> `docker/docker-compose.proxy.yml` if you start the proxy stack) if it times out.

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
- URL: `http://bytebot-holo:9989`

**Benefits:**
- Production-ready containerized setup
- Excellent GPU performance
- Auto-detects CUDA

### x86_64 CPU-only

**Configuration:**
- OmniParser: Docker container, CPU-only
- Performance: ~8-15s per frame
- URL: `http://bytebot-holo:9989`

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
./scripts/stop-holo.sh
./scripts/start-holo.sh
```

**Check logs:**
```bash
tail -f logs/omniparser.log
```

### OmniParser crashes with dtype errors (Apple Silicon)

**Symptoms:**
- Service crashes with "Input type (float) and bias type (c10::Half) should be the same"
- Florence-2 caption generation fails

**Solution:**
This is fixed automatically! The service now uses float32 on MPS. If you still see errors:
```bash
# Verify logs show float32
tail logs/omniparser.log | grep dtype
# Should show: "Loading OmniParser models on mps with dtype=torch.float32..."
```

### OmniParser crashes with PaddleOCR errors

**Symptoms:**
- Service crashes with "ValueError: Unknown argument: use_gpu" or similar
- PaddleOCR initialization fails

**Solution:**
This is fixed automatically by the setup script. If you installed manually:
```bash
cd packages/bytebot-holo
bash scripts/patch-paddleocr.sh
./scripts/start-holo.sh  # from project root
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

### OmniParser falling back to CPU on x86_64/NVIDIA

**Symptoms:**
- OmniParser logs show "⚠ No GPU acceleration available - using CPU"
- Processing time ~8-15s per frame instead of ~0.6s

**Diagnosis:**
```bash
# Check if container has GPU access
docker exec bytebot-holo python /app/scripts/verify-gpu.py

# Check nvidia-container-toolkit
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```

**Common Causes:**
1. **CUDA version mismatch** - PyTorch built for CUDA 11.8, but system has CUDA 12.x
   - **Fixed:** Dockerfile now uses CUDA 12.1 PyTorch (backward compatible)
2. **nvidia-container-toolkit not installed**
   ```bash
   # Install on Ubuntu/Debian
   distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
   curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
   curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
     sudo tee /etc/apt/sources.list.d/nvidia-docker.list
   sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
   sudo systemctl restart docker
   ```
3. **Docker not configured with GPU runtime**
   - Check `/etc/docker/daemon.json` includes nvidia runtime
   - Restart Docker: `sudo systemctl restart docker`

**Solution:** Rebuild OmniParser container:
```bash
cd docker
docker compose down bytebot-holo
docker compose build --no-cache bytebot-holo
docker compose up -d bytebot-holo

# Verify GPU access
docker logs bytebot-holo | grep -A 5 "GPU Diagnostics"
```

---

## Environment Configuration

### Required Files

The system uses a two-file architecture to separate user secrets from system configuration:

1. **docker/.env** (user-managed, gitignored) - API keys only
   ```bash
   # Create from template
   cp docker/.env.example docker/.env

   # Edit with your API keys
   ANTHROPIC_API_KEY=sk-...
   OPENAI_API_KEY=sk-...
   GEMINI_API_KEY=...
   OPENROUTER_API_KEY=sk-...
   ```

2. **docker/.env.defaults** (script-managed, tracked) - System configuration
   - Auto-managed by scripts (setup-holo.sh, setup-lmstudio.sh, start-stack.sh)
   - Contains Holo settings, feature flags, resource limits
   - **Do not** manually edit unless you know what you're doing

Both files are loaded by Docker Compose (`.env.defaults` first, then `.env` overrides).

### Key Variables by File

**docker/.env (API keys - user-managed):**
```bash
ANTHROPIC_API_KEY=sk-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=sk-...
```

**docker/.env.defaults (system config - script-managed):**
```bash
BYTEBOT_CV_USE_HOLO=true
HOLO_URL=http://host.docker.internal:9989  # Apple Silicon
HOLO_DEVICE=auto  # auto, cuda, mps, cpu
HOLO_MIN_CONFIDENCE=0.3
LMSTUDIO_ENABLED=false
LMSTUDIO_BASE_URL=http://192.168.x.x:1234/v1
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
