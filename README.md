<div align="center">

<img src="docs/images/bytebot-logo.png" width="500" alt="Bytebot Logo">

# Bytebot: Open-Source AI Desktop Agent

**An AI that has its own computer to complete tasks for you**

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/bytebot?referralCode=L9lKXQ)
</div>

<details>
<summary><strong>Resources &amp; Translations</strong></summary>

<div align="center">

<a href="https://trendshift.io/repositories/14624" target="_blank"><img src="https://trendshift.io/api/badge/repositories/14624" alt="bytebot-ai%2Fbytebot | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](https://github.com/bytebot-ai/bytebot/tree/main/docker)
[![License](https://img.shields.io/badge/license-Apache%202.0-green.svg)](LICENSE)
[![Discord](https://img.shields.io/discord/1232768900274585720?color=7289da&label=discord)](https://discord.com/invite/d9ewZkWPTP)

[🌐 Website](https://bytebot.ai) • [📚 Documentation](https://docs.bytebot.ai) • [💬 Discord](https://discord.com/invite/d9ewZkWPTP) • [𝕏 Twitter](https://x.com/bytebot_ai)

<!-- Keep these links. Translations will automatically update with the README. -->
[Deutsch](https://zdoc.app/de/bytebot-ai/bytebot) |
[Español](https://zdoc.app/es/bytebot-ai/bytebot) |
[français](https://zdoc.app/fr/bytebot-ai/bytebot) |
[日本語](https://zdoc.app/ja/bytebot-ai/bytebot) |
[한국어](https://zdoc.app/ko/bytebot-ai/bytebot) |
[Português](https://zdoc.app/pt/bytebot-ai/bytebot) |
[Русский](https://zdoc.app/ru/bytebot-ai/bytebot) |
[中文](https://zdoc.app/zh/bytebot-ai/bytebot)

</div>
</details>

---

## 📋 Prerequisites

### Required Software
- **Docker** (≥20.10) & **Docker Compose** (≥2.0)
- **Git** for cloning the repository
- **Node.js** ≥20.0.0 (for local development only, not needed for Docker)

### API Keys (Required)
At least one LLM provider API key:
- **Anthropic** (Claude models) - Get at [console.anthropic.com](https://console.anthropic.com)
- **OpenAI** (GPT models) - Get at [platform.openai.com](https://platform.openai.com)
- **Google** (Gemini models) - Get at [aistudio.google.com](https://aistudio.google.com)
- **OpenRouter** (Multi-model proxy) - Get at [openrouter.ai](https://openrouter.ai)

### Disk Space Requirements

**Holo 1.5-7B Model:**
- **Model size:** ~15.4 GB (8.29B parameters in BF16 precision)
- **Cache location:** `~/.cache/huggingface/hub/`
- **Recommended free space:** 25 GB (model + cache overhead)
- **Download time:** 5-30 minutes depending on internet speed (one-time download)

**By Platform:**
- **Apple Silicon (M1-M4):** Model downloads automatically during `setup-holo.sh` (~5-30 min)
- **x86_64 (Docker):** Model downloads when container first starts, cached for future use
- **Storage:** Model is cached permanently and reused across restarts

**Model Validation:**
The setup script validates complete downloads by checking:
- ✅ Cache size must be ≥10GB (not just 16MB tokenizer files)
- ✅ Model weight files (.safetensors/.bin) must exist
- ✅ Shows diagnostic info if validation fails (actual size, weight count, what's missing)

If you see "⚠ Partial setup detected", the script will automatically:
1. Show cache size and weight file count
2. Clean incomplete cache
3. Re-download with latest dependencies (including transformers ≥4.49.0)

> **Tip:** If disk space is limited, the setup script will warn you and ask for confirmation before downloading. To force a clean reinstall: `./scripts/setup-holo.sh --force`

### GPU Requirements (Recommended for Best Holo 1.5-7B Performance)

Holo 1.5-7B provides precision UI localization with GPU acceleration:

#### **x86_64 Linux/Windows (NVIDIA GPU)**
**Best performance: ~0.8-1.5s/inference with CUDA**

Install `nvidia-container-toolkit` to enable GPU in Docker:

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker

# Verify GPU access works
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

**Without GPU:** Falls back to CPU (~8-15s/inference) - works but significantly slower.

#### **Apple Silicon (M1-M4)**
**Best performance: ~1.5-2.5s/inference with MPS**

No additional installation needed - `setup-holo.sh` automatically configures native execution with Metal GPU acceleration.

> **Note:** Docker Desktop on macOS doesn't pass through GPU access, so Holo 1.5-7B runs natively outside Docker for best performance.

#### **x86_64 CPU-only**
Works without GPU but slower (~8-15s/inference). No additional setup needed.

---

## 🚀 Quick Start (3 Simple Steps)

### Step 1: Clone Repository
```bash
git clone https://github.com/zhound420/bytebot-hawkeye-uitars.git
cd bytebot-hawkeye-uitars
```

### Step 2: Configure API Keys

Create `docker/.env` with your API keys (**at least one required**):

```bash
cat <<'EOF' > docker/.env
# LLM Provider API Keys (At least one required)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=sk-or-v1-...
EOF
```

### Step 3: Setup & Start

The setup script automatically detects your hardware and configures optimal performance:

```bash
# One-time setup (installs Holo 1.5-7B and dependencies)
./scripts/setup-holo.sh

# Start the full stack
./scripts/start-stack.sh
```

**What happens automatically:**

**Apple Silicon (M1-M4):**
- ✅ Native Holo 1.5-7B with MPS GPU (~1.5-2.5s/inference)
- ✅ Best performance via Metal acceleration

**x86_64 + NVIDIA GPU:**
- ✅ Docker container with CUDA (~0.8-1.5s/inference)
- ✅ Production-ready GPU acceleration

**x86_64 CPU-only:**
- ✅ Docker container with CPU (~8-15s/inference)
- ✅ Works everywhere without GPU

The start script will:
- Launch all services (agent, UI, desktop, database, Holo 1.5-7B)
- Apply database migrations automatically
- Verify all services are healthy

**Access the Stack:**
- 🌐 **Web UI**: http://localhost:9992
- 🖥️ **Desktop (noVNC)**: http://localhost:9990
- 🤖 **Agent API**: http://localhost:9991
- 🔀 **LiteLLM Proxy**: http://localhost:4000
- 🎯 **Holo 1.5-7B**: http://localhost:9989

**Stop the stack:**
```bash
./scripts/stop-stack.sh
```

### Troubleshooting Setup

**Model download fails with "qwen2_5_vl not recognized":**
- **Cause:** Outdated transformers version in existing venv (needs ≥4.49.0)
- **Fix:** Run setup with force flag to upgrade packages:
  ```bash
  ./scripts/setup-holo.sh --force
  ```

**Setup reports "already set up" but model isn't downloaded:**
- Scripts now validate cache is complete (≥10GB size + weight files present)
- Shows diagnostic info: actual cache size, weight file count, what's missing
- Auto-cleans incomplete cache and re-downloads automatically
- **Fix:** Just run setup again - it will detect and fix incomplete state:
  ```bash
  ./scripts/setup-holo.sh
  ```

**First-time setup on limited disk space:**
- Setup script checks free space and warns if <25GB available
- You can confirm to continue or cancel to free up space
- Model cache location: `~/.cache/huggingface/hub/` (~15.4GB)
- **Fix:** Free up disk space and run `./scripts/setup-holo.sh`

**Force reinstall (clean slate):**
```bash
./scripts/setup-holo.sh --force
```
- Removes existing venv and incomplete model cache
- Performs clean installation from scratch with latest dependencies
- Useful for recovering from corrupted state or upgrading transformers

> **More help?** See [GPU Setup Guide](docs/GPU_SETUP.md) for platform-specific configuration and debugging.

## Hawkeye Fork Enhancements

Hawkeye layers precision tooling on top of upstream Bytebot so the agent can land clicks with far greater reliability:

| Capability | Hawkeye | Upstream Bytebot |
| --- | --- | --- |
| **Grid overlay guidance** | Always-on 100 px grid with labeled axes and optional debug overlays toggled via `BYTEBOT_GRID_OVERLAY`/`BYTEBOT_GRID_DEBUG`, plus a live preview in the [overlay capture](docs/images/hawkeye-desktop.png). | No persistent spatial scaffolding; relies on raw screenshots. |
| **Smart Focus targeting** | Three-stage coarse→focus→click workflow with tunable grids and prompts described in [Smart Focus System](docs/SMART_FOCUS_SYSTEM.md). | Single-shot click reasoning without structured zoom or guardrails. |
| **Progressive zoom capture** | Deterministic zoom ladder with cyan micro-grids that map local→global coordinates; see [zoom samples](test-zoom-with-grid.png). | Manual zoom commands with no coordinate reconciliation. |
| **Coordinate telemetry & accuracy** | Telemetry pipeline with `BYTEBOT_COORDINATE_METRICS` and `BYTEBOT_COORDINATE_DEBUG`, an attempt towards accuracy.(COORDINATE_ACCURACY_IMPROVEMENTS.md). | No automated accuracy measurement or debug dataset. |
| **Universal coordinate mapping** | Shared lookup in `config/universal-coordinates.yaml` bundled in repo and `@bytebot/shared`, auto-discovered without extra configuration. | Requires custom configuration for consistent coordinate frames. |
| **Universal element detection** | CV pipeline merges visual heuristics, OCR enrichments, and semantic roles to emit consistent `UniversalUIElement` metadata for buttons, inputs, and clickable controls. | LLM prompts must infer UI semantics from raw OCR spans and manually chosen click targets. |
| **Holo 1.5-7B precision localization** | AI-powered UI element localization using Holo 1.5-7B (Qwen2.5-VL-7B base, 90%+ accuracy) with GPU acceleration (NVIDIA/Apple Silicon). Direct coordinate prediction for superior click accuracy. | No semantic understanding of UI elements; relies on pixel-based analysis only. |
| **Streamlined CV pipeline** | Two-method detection: Holo 1.5-7B (primary, 90%+ accuracy) + Tesseract.js OCR (fallback). OpenCV removed for simpler builds. | Basic screenshot analysis without advanced computer vision techniques. |
| **Real-time CV activity monitoring** | Live tracking of active CV methods with animated indicators, Holo 1.5-7B model display, GPU detection (NVIDIA GPU/Apple Silicon/CPU), performance metrics, success rates, and dedicated UI panels on Desktop and Task pages with 500ms polling. | No visibility into which detection methods are active or their performance characteristics. |
| **Accessible UI theming** | Header theme toggle powered by Next.js theme switching delivers high-contrast light/dark palettes so operators can pick the most legible view. | Single default theme without in-app toggles. |
| **Active Model desktop telemetry** | The desktop dashboard's Active Model card (under `/desktop`) continuously surfaces the agent's current provider, model alias, and streaming heartbeat so you can spot token stalls before they derail long-running sessions. | No dedicated real-time status card—operators must tail logs to confirm the active model. |

Flip individual systems off by setting the corresponding environment variables—`BYTEBOT_UNIVERSAL_TEACHING`, `BYTEBOT_ADAPTIVE_CALIBRATION`, `BYTEBOT_ZOOM_REFINEMENT`, or `BYTEBOT_COORDINATE_METRICS`—to `false` (default `true`). Enable deep-dive logs with `BYTEBOT_COORDINATE_DEBUG=true` when troubleshooting. Visit the `/desktop` route (see the screenshot above) to monitor the Active Model card while long-running tasks execute.

### Smart Focus Targeting (Hawkeye Exclusive)

The fork’s Smart Focus workflow narrows attention in three deliberate passes—coarse region selection, focused capture, and final click—so the agent can reason about targets instead of guessing. Enable or tune it with `BYTEBOT_SMART_FOCUS`, `BYTEBOT_OVERVIEW_GRID`, `BYTEBOT_REGION_GRID`, `BYTEBOT_FOCUSED_GRID`, and related knobs documented in [docs/SMART_FOCUS_SYSTEM.md](docs/SMART_FOCUS_SYSTEM.md).

![Desktop accuracy overlay](docs/images/hawkeye2.png)

### Desktop Accuracy Drawer

The `/desktop` dashboard now ships with a Desktop Accuracy drawer that exposes the fork’s adaptive telemetry at a glance. The panel streams live stats for the currently selected session, lets operators jump between historical sessions with the session selector, and provides reset controls so you can zero out a learning run before capturing a new benchmark. Use the reset button to clear the in-memory metrics without restarting the daemon when you want a clean baseline for regression tests or demonstrations.

![Desktop accuracy overlay](docs/images/hawkeye3.png)

#### Learning Metrics Explained

To help you interpret the drawer’s live readouts, Hawkeye surfaces several learning metrics that highlight how the desktop agent is adapting:

- **Attempt count** — The number of clicks evaluated during the active session. Use it to gauge how large the sample is before trusting the aggregate metrics.
- **Success rate** — Percentage of attempts that landed within the configured smart click success radius. This reflects real-time precision as the agent iterates on a task.
- **Weighted offsets** — Average X/Y drift in pixels, weighted by recency so the panel emphasizes the most recent behavior. Watch this to see whether recent tuning is nudging the cursor closer to targets.
- **Convergence** — A decay-weighted score that trends toward 1.0 as the agent stops overshooting targets, signaling that the current calibration has stabilized.
- **Hotspots** — Highlighted regions where misses cluster, helping you identify UI zones that need larger affordances, different prompts, or manual overrides.

Together, these metrics give you continuous feedback on how Hawkeye’s coordinate calibration improves over time and whether additional guardrails are necessary for stubborn workflows.

### Precision Computer Vision with Holo 1.5-7B

Hawkeye uses **Holo 1.5-7B** (Qwen2.5-VL-7B base) for precision UI localization with superior click accuracy:

#### **Two-Method Detection (OpenCV Removed)**
- **Holo 1.5-7B** (PRIMARY) - Direct coordinate prediction via vision-language model for 90%+ localization accuracy
- **Tesseract.js OCR** (FALLBACK) - Pure JavaScript text extraction for text-based elements

**What changed:** Replaced OmniParser's YOLOv8 + Florence-2 pipeline with Holo 1.5-7B for direct coordinate prediction. OpenCV-based methods have been removed to reduce complexity. Holo provides superior click accuracy with simpler architecture.

#### **Holo 1.5-7B Precision Localization**
Hawkeye now uses **Holo 1.5-7B** as the primary detection method, providing direct coordinate prediction:

- **Model**: Hcompany/Holo1.5-7B (8.29B parameters, Qwen2.5-VL base)
- **Method**: Direct coordinate prediction via "Click(x, y)" output
- **Accuracy**: 90%+ on UI localization benchmarks
- **GPU Acceleration**: Supports NVIDIA CUDA, Apple Silicon (MPS), and CPU fallback
- **Performance**: ~0.8-1.5s/inference on NVIDIA GPU, ~1.5-2.5s on Apple Silicon, ~8-15s on CPU
- **Advantages**: Direct coordinate prediction eliminates bounding box→coordinate conversion errors

**Platform Support:**
- 🍎 **Apple Silicon (M1-M4):** Native execution with MPS GPU acceleration (~1.5-2.5s/inference)
- ⚡ **x86_64 + NVIDIA GPU:** Docker with CUDA support (~0.8-1.5s/inference)
- 💻 **CPU-only:** Docker with CPU fallback (~8-15s/inference)

#### **Simplified Detection Orchestration**
The `EnhancedVisualDetectorService` uses Holo 1.5-7B as the primary method with Tesseract.js OCR as fallback:
```typescript
// Detection using Holo 1.5-7B + OCR
const result = await enhancedDetector.detectElements(screenshotBuffer, null, {
  useOmniParser: true,         // Primary: Holo 1.5-7B precision localization
  useOCR: false,               // Fallback: Tesseract.js text extraction (expensive)
  combineResults: true         // Merge overlapping detections
});
```

**Detection Priority:**
1. **Holo 1.5-7B** (PRIMARY) - Direct coordinate prediction with 90%+ accuracy
2. **Tesseract.js OCR** (FALLBACK) - Text extraction when Holo unavailable or disabled

#### **Real-Time CV Activity Monitoring**
Hawkeye provides comprehensive visibility into computer vision operations with live UI indicators:

- **Live Method Tracking** - `CVActivityIndicatorService` tracks which CV methods are actively processing with animated indicators
- **Holo 1.5-7B Model Display** - Real-time display of active model (Holo 1.5-7B / Qwen2.5-VL) with GPU detection (NVIDIA GPU, Apple Silicon, or CPU)
- **Performance Metrics** - Real-time success rates, processing times, average execution times, and total executions
- **GPU Acceleration Status** - Live hardware detection showing compute device: ⚡ NVIDIA GPU, 🍎 Apple Silicon, or 💻 CPU
- **UI Integration** - Dedicated CV Activity panels on both Desktop and Task pages with 500ms polling for real-time updates
- **Debug Telemetry** - Comprehensive method execution history for optimization and troubleshooting

**CV Activity Panel Features:**
- Active method indicators with color-coded badges (Holo 1.5-7B: Pink, OCR: Yellow)
- Live execution timers showing how long each method has been processing
- Performance grid: Avg Time, Total Executions, Success Rate, Compute Device
- Automatic visibility when CV methods are active or have recent execution history

#### **API Endpoints for CV Visibility**
```bash
GET /cv-activity/stream      # Real-time activity snapshot with Holo model info (polled every 500ms by UI)
GET /cv-activity/status      # Current active methods snapshot
GET /cv-activity/active      # Quick active/inactive check
GET /cv-activity/performance # Method performance statistics
GET /cv-activity/history     # Method execution history (last 20 executions)
```

**Response includes:**
- Active methods array with execution timers
- Holo device type (cuda, mps, cpu)
- Holo model info (Holo 1.5-7B / Qwen2.5-VL base)
- Performance metrics (avg processing time, total executions, success rate)

#### **Universal Element Detection Pipeline**
The streamlined system outputs structured `UniversalUIElement` objects by fusing:

- **Holo 1.5-7B precision localization** (PRIMARY) - Direct coordinate prediction for 90%+ click accuracy
- **Tesseract.js OCR** (FALLBACK) - Pure JavaScript text extraction
- **Semantic analysis** (`TextSemanticAnalyzerService`) for intent-based reasoning over raw UI text

**Benefits of Holo 1.5-7B:**
- ✅ Superior click accuracy (90%+ vs 89% OmniParser)
- ✅ Direct coordinate prediction (no bbox→coordinate conversion)
- ✅ Simpler architecture (single VLM vs YOLO + Florence-2 pipeline)
- ✅ Same platform support (CUDA, MPS, CPU)
- ✅ No OpenCV dependencies (simpler installation)

### Keyboard & Shortcut Reliability

`NutService` on the desktop daemon parses compound shortcuts such as `ctrl+shift+p`, mixed-case modifiers, and platform aliases (`cmd`, `option`, `win`). Legacy arrays like `['Control', 'Shift', 'X']` continue to work, but LLM tool calls can now emit compact strings and rely on the daemon to normalize, validate, and execute the correct nut-js sequence.

### Troubleshooting

**UI shows "ECONNREFUSED" to port 9991:**
- Check agent health: `docker compose ps bytebot-agent`
- View agent logs: `docker compose logs bytebot-agent`
- Verify database migrations: `docker exec bytebot-agent npx prisma migrate status`

**Holo 1.5-7B connection issues:**
- Apple Silicon: Ensure native Holo is running: `lsof -i :9989`
- x86_64: Check Holo container: `docker logs bytebot-holo`
- Verify `HOLO_URL` in `docker/.env` matches your platform

**Database errors:**
- The agent automatically applies migrations on startup
- Manual migration: `docker exec bytebot-agent npx prisma migrate deploy`

**Setup script issues:**
- **Model incomplete:** Check cache size: `du -sh ~/.cache/huggingface/hub/models--Hcompany--Holo1.5-7B/` (should be ~15GB, not 16MB)
- **Download fails:** Transformers version too old - run `./scripts/setup-holo.sh --force` to upgrade
- **"qwen2_5_vl not recognized":** Old transformers in venv - force flag upgrades packages
- **Disk space:** Needs 25GB free - script checks and warns before downloading

## Advanced: Manual Docker Compose Setup

![Desktop accuracy overlay](docs/images/hawkeye1.png)

If you prefer to run Docker Compose manually instead of using the automated `start-stack.sh` script, follow these steps:

### Using the Proxy Stack (Recommended)

The proxy stack includes LiteLLM for unified model access across providers:

```bash
# 1. Configure API keys in docker/.env (API keys ONLY)
cat <<'EOF' > docker/.env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=sk-or-v1-...
EOF

# 2. System configuration is already set in docker/.env.defaults
#    (OmniParser settings, Hawkeye features, etc.)

# 3. Start the full stack with proxy
docker compose -f docker/docker-compose.proxy.yml up -d --build
```

**Available Models via Proxy:**
- Anthropic: `claude-opus-4`, `claude-sonnet-4`
- OpenAI: `gpt-4o`, `o3`, `gpt-4o-mini`, `gpt-4.1`, `gpt-5` variants
- OpenRouter: `openrouter-claude-3.7-sonnet`, `openrouter-gemini-2.5-pro`, etc.
- Local LMStudio: Configure in [`packages/bytebot-llm-proxy/litellm-config.yaml`](packages/bytebot-llm-proxy/litellm-config.yaml)

To use custom model endpoints, edit `litellm-config.yaml` and restart: `docker compose restart bytebot-llm-proxy`

### Using the Standard Stack (No Proxy)

The standard stack connects directly to provider APIs without LiteLLM:

```bash
# Start without proxy (uses direct API keys)
docker compose -f docker/docker-compose.yml up -d --build
```

**Note:** Direct API access requires API keys in `docker/.env`. The agent will use the provider-specific services (Anthropic, OpenAI, Google) directly.

## LMStudio Deployment Recommendations

### Resource Constraints on Apple Silicon

**Important:** On Apple Silicon Macs, Holo 1.5-7B **must** run locally for MPS GPU acceleration. This means you likely **cannot** run LMStudio locally due to GPU memory constraints unless you have a massive GPU.

**Why Holo runs locally:**
- Docker Desktop on macOS doesn't support MPS (Metal Performance Shaders) GPU passthrough
- Running Holo natively gives ~1.5-2.5s inference vs ~8-15s CPU-only in Docker
- Holo 1.5-7B needs ~8GB GPU memory (8.29B parameters in BF16 precision)

**Why LMStudio can't run locally (usually):**
- M1/M2/M3 unified memory is shared between CPU and GPU
- Running both Holo (8GB) + LMStudio models (7-70B) exceeds available GPU memory
- Result: GPU memory exhaustion, severe slowdown, or OOM crashes

### Recommended Deployment Options

#### **Option 1: LMStudio on Separate Host (Recommended)**

Run LMStudio on a different machine with its own GPU:

```yaml
# In packages/bytebot-llm-proxy/litellm-config.yaml
- model_name: local-lmstudio-ui-tars-72b-dpo
  litellm_params:
    model: openai/ui-tars-72b-dpo
    api_base: http://192.168.4.250:1234/v1  # Different machine on local network
    api_key: lm-studio
```

**Advantages:**
- ✅ Holo gets full MPS GPU access for fast inference (~1.5-2.5s)
- ✅ LMStudio models run on separate hardware with dedicated resources
- ✅ No GPU memory contention
- ✅ Best performance for both systems
- ✅ Can use large models (70B+) without affecting Holo

**Setup:**
1. **On LMStudio host machine:**
   - Start LMStudio with network binding: `--host 0.0.0.0`
   - Note the IP address (e.g., `192.168.4.250`)
   - Verify port 1234 is accessible: `curl http://192.168.4.250:1234/v1/models`

2. **On Bytebot Mac:**
   - Edit `packages/bytebot-llm-proxy/litellm-config.yaml`
   - Update `api_base` to point to LMStudio host IP
   - Restart: `docker compose restart bytebot-llm-proxy`

#### **Option 2: LMStudio Locally (Only for Massive GPUs)**

Only viable if you have exceptional hardware:

```yaml
# Only works with >24GB GPU memory
api_base: http://localhost:1234/v1  # Local LMStudio
```

**Requirements:**
- **Apple Silicon:** M3 Max (96GB+ unified memory) or M4 Max with 128GB+ RAM
- **x86_64 Workstation:** >24GB VRAM (RTX 4090, RTX 6000 Ada, A6000, etc.)

**Why:** Running Holo 1.5-7B (8GB) + 7-70B LLM models simultaneously requires massive GPU memory. Most consumer hardware can't handle both.

#### **Option 3: Cloud LLM Providers (Simplest)**

Use Anthropic, OpenAI, or OpenRouter instead of LMStudio:

```bash
# docker/.env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

**Advantages:**
- ✅ No local GPU memory constraints
- ✅ Holo gets full local GPU for UI localization
- ✅ Simpler setup, no additional hardware needed
- ✅ Access to latest frontier models (Claude Opus 4, GPT-5, etc.)
- ✅ No maintenance or model management

**Costs:** Pay-per-token pricing, but eliminates need for expensive GPU hardware.

### Summary: Best Practices

| Setup | Holo Location | LLM Location | Best For |
|-------|---------------|--------------|----------|
| **Recommended** | Local (MPS GPU) | Remote LMStudio host | Maximum performance, large models |
| **Simplest** | Local (MPS GPU) | Cloud API (Anthropic/OpenAI) | Easy setup, frontier models |
| **Power Users** | Local (MPS GPU) | Local LMStudio (if >24GB GPU) | Massive hardware, privacy needs |

**Bottom line:** Unless you have exceptional GPU hardware, run LMStudio on a separate host to avoid GPU memory contention with Holo 1.5-7B.

## Alternative Deployments

Looking for a different hosting environment? Follow the upstream guides for the full walkthroughs:

- [Railway one-click template](https://docs.bytebot.ai/deployment/railway)
- [Helm charts for Kubernetes](https://docs.bytebot.ai/deployment/helm)
- [Custom Docker Compose topologies](https://docs.bytebot.ai/deployment/litellm)

## Stay in Sync with Upstream Bytebot

For a full tour of the core desktop agent, installation options, and API surface, follow the upstream README and docs. Hawkeye inherits everything there—virtual desktop orchestration, task APIs, and deployment guides—so this fork focuses documentation on the precision tooling and measurement upgrades described above.

## Further Reading

- [Bytebot upstream README](https://github.com/bytebot-ai/bytebot#readme)
- [Quickstart guide](https://docs.bytebot.ai/quickstart)
- [API reference](https://docs.bytebot.ai/api-reference/introduction)

## Operations & Tuning

### Smart Click Success Radius

Smart click telemetry now records the real cursor landing position. Tune the pass/fail threshold by setting an environment variable on the desktop daemon:

```bash
export BYTEBOT_SMART_CLICK_SUCCESS_RADIUS=12  # pixels of acceptable drift
```

Increase the value if the VNC stream or hardware introduces more cursor drift, or decrease it to tighten the definition of a successful AI-guided click.
