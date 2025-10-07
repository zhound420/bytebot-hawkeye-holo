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

**Holo 1.5-7B GGUF Model:**
- **Model size:** ~6 GB (Q4_K_M quantization: 4.8GB model + 1GB mmproj)
- **Cache location:** `~/.cache/huggingface/hub/`
- **Recommended free space:** 15 GB (model + cache overhead)
- **Download time:** 5-15 minutes depending on internet speed (one-time download)
- **Backend:** llama-cpp-python with GGUF quantization for efficient inference

**By Platform:**
- **Apple Silicon (M1-M4):** GGUF model downloads automatically on first run via llama-cpp-python
- **x86_64 (Docker):** GGUF model downloads when container first starts, cached for future use
- **Storage:** GGUF model is cached permanently and reused across restarts

**Model Validation:**
The setup script validates complete GGUF downloads by checking:
- ✅ Cache size must be ≥5GB (GGUF Q4_K_M + mmproj)
- ✅ GGUF model files (.gguf) must exist (2 files: model + mmproj)
- ✅ Shows diagnostic info if validation fails (actual size, GGUF count, what's missing)

**Note:** GGUF models download automatically via llama-cpp-python on first use, so setup is optional. The service will download the model when first started.

> **Tip:** If disk space is limited, the setup script will warn you and ask for confirmation before starting (needs ~15GB vs previous 25GB). To force a clean reinstall: `./scripts/setup-holo.sh --force`

### GPU Requirements (Recommended for Best Holo 1.5-7B GGUF Performance)

Holo 1.5-7B GGUF provides precision UI localization with GPU acceleration via llama-cpp-python:

#### **x86_64 Linux/Windows (NVIDIA GPU)**
**Best performance: ~0.8-1.5s/inference with CUDA**

Install `nvidia-container-toolkit` to enable GPU in Docker:

```bash
# Ubuntu/Debian
sudo apt-get update
# Install the Nvidia Container Toolkit packages
export NVIDIA_CONTAINER_TOOLKIT_VERSION=1.17.8-1
  sudo apt-get install -y \
      nvidia-container-toolkit=${NVIDIA_CONTAINER_TOOLKIT_VERSION} \
      nvidia-container-toolkit-base=${NVIDIA_CONTAINER_TOOLKIT_VERSION} \
      libnvidia-container-tools=${NVIDIA_CONTAINER_TOOLKIT_VERSION} \
      libnvidia-container1=${NVIDIA_CONTAINER_TOOLKIT_VERSION}

# Configure the container so it can use the Nvidia runtime
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# Verify GPU access works by running a sample workload
sudo docker run --rm --runtime=nvidia --gpus all ubuntu nvidia-smi
```

**Without GPU:** Falls back to CPU (~8-15s/inference) - works but significantly slower.

#### **Apple Silicon (M1-M4)**
**Best performance: ~1.5-2.5s/inference with Metal GPU**

No additional installation needed - `setup-holo.sh` automatically configures native execution with Metal GPU acceleration via llama-cpp-python.

> **Note:** Docker Desktop on macOS doesn't pass through Metal GPU access, so Holo 1.5-7B GGUF runs natively outside Docker for best performance.

#### **x86_64 CPU-only**
Works without GPU but slower (~8-15s/inference). No additional setup needed.

#### **Alternative: LM Studio**
Since Holo uses GGUF models, you can also load the model in LM Studio:
- Model: `mradermacher/Holo1.5-7B-GGUF` (Q4_K_M recommended)
- Configure llama-cpp-python to connect to LM Studio's OpenAI-compatible API
- See LMStudio section below for setup details

---

## 🚀 Quick Start (3 Simple Steps)

### Step 1: Clone Repository
```bash
git clone https://github.com/zhound420/bytebot-hawkeye-uitars.git
cd bytebot-hawkeye-uitars
```

### Optional: Windows 11 or macOS Desktop Container

Run Bytebot with a **Windows 11** or **macOS** desktop environment instead of Linux:

**Windows 11:**
```bash
# Start Windows 11 stack (requires KVM support)
./scripts/start-stack.sh --os windows

# Access Windows via web viewer
open http://localhost:8006

# Setup runs AUTOMATICALLY on first boot!
# - Installs Node.js 20, Git, VSCode, 1Password
# - Builds and configures bytebotd
# - Creates auto-start scheduled task
# Wait 10-15 minutes for automated installation to complete
```

**macOS Sonoma/Sequoia:**
```bash
# Start macOS stack (requires KVM + Apple hardware)
./scripts/start-stack.sh --os macos

# Access macOS via web viewer or VNC
open http://localhost:8006

# Inside macOS Terminal, run setup script as root
cd /shared
sudo bash ./setup-macos-bytebotd.sh
```

**Requirements:**
- KVM support (`/dev/kvm` must be available on Linux host)
- 8GB+ RAM, 4+ CPU cores, 128GB+ disk space
- First boot takes 5-10 minutes for OS installation
- **macOS only:** Must run on Apple hardware (licensing requirement)

**Why Use Alternate OS Containers?**
- Test automation on native Windows or macOS applications
- Holo 1.5-7B trained on Windows/Linux/macOS UI (same model, cross-platform)
- Same resolution across all platforms (1280x960)

**Ports:**
- `8006` - Web-based viewer (all platforms)
- `3389` - RDP access (Windows only)
- `5900` - VNC access (macOS only)
- `9990` - Bytebotd API (after setup)

**📚 Full Guides:**
- Windows: [`docs/WINDOWS_SETUP.md`](docs/WINDOWS_SETUP.md)
- macOS: [`docs/MACOS_SETUP.md`](docs/MACOS_SETUP.md)

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

**GGUF model doesn't download:**
- **Cause:** GGUF models download automatically on first run via llama-cpp-python
- **Fix:** Start the service and it will download automatically:
  ```bash
  ./scripts/start-holo.sh  # Apple Silicon
  ./scripts/start-stack.sh  # x86_64 in Docker
  ```

**Setup reports "already set up" but GGUF model isn't cached:**
- Scripts now validate GGUF cache is complete (≥5GB size + 2 .gguf files present)
- Shows diagnostic info: actual cache size, GGUF file count, what's missing
- Auto-cleans incomplete cache if detected
- **Fix:** Just start the service - llama-cpp-python will download on first run:
  ```bash
  ./scripts/start-holo.sh
  ```

**First-time setup on limited disk space:**
- Setup script checks free space and warns if <15GB available
- You can confirm to continue or cancel to free up space
- GGUF model cache location: `~/.cache/huggingface/hub/` (~6GB)
- **Fix:** Free up disk space and run `./scripts/setup-holo.sh`

**Force reinstall (clean slate):**
```bash
./scripts/setup-holo.sh --force
```
- Removes existing venv and incomplete GGUF model cache
- Performs clean installation from scratch with latest llama-cpp-python
- Useful for recovering from corrupted state or switching quantization levels

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
| **Hybrid vision/non-vision support** | 41 models (28 vision + 13 text-only) with automatic message transformation, vision-aware prompts/guards, optimized enrichment, and enhanced UI picker with visual grouping. Enables reasoning models (o1, o3, DeepSeek R1) for complex tasks. | Limited model support with assumed vision capability; no differentiation between vision and text-only models. |

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

#### **Holo 1.5-7B GGUF Precision Localization**
Hawkeye now uses **Holo 1.5-7B GGUF** (quantized) as the primary detection method, providing direct coordinate prediction with reduced memory usage:

- **Model**: mradermacher/Holo1.5-7B-GGUF (Q4_K_M quantization)
- **Size**: ~6 GB (4.8GB model + 1GB mmproj) vs 15.4GB unquantized
- **Backend**: llama-cpp-python with GGUF support
- **Method**: Direct coordinate prediction via "Click(x, y)" output
- **Accuracy**: 95%+ of full precision quality maintained with Q4_K_M
- **GPU Acceleration**: Supports NVIDIA CUDA, Apple Silicon (Metal), and CPU fallback
- **Performance**: ~0.8-1.5s/inference on NVIDIA GPU, ~1.5-2.5s on Apple Silicon, ~8-15s on CPU
- **Advantages**:
  - 69% smaller model size (15.4GB → 6GB)
  - Direct coordinate prediction eliminates bounding box→coordinate conversion errors
  - Compatible with LM Studio and other GGUF tools
  - Automatic download via llama-cpp-python

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
- **GPU VRAM Monitoring** - Real-time memory usage with color-coded progress bars (green <50%, yellow 50-80%, red >80%)
- **UI Integration** - Dedicated CV Activity panels on both Desktop and Task pages with 500ms polling for real-time updates
- **Debug Telemetry** - Comprehensive method execution history for optimization and troubleshooting

### Adaptive Model Capability System

Hawkeye's **Model Capability System** provides intelligent CV-first enforcement based on each AI model's vision capabilities. Different models receive different levels of enforcement, ensuring optimal performance without blocking capable models or frustrating weaker ones.

#### **Three-Tier Model Classification**

**🥇 Tier 1: Strong CV Capability (Strict Enforcement)**
- **Models**: GPT-4o, Claude Sonnet 4.5, Claude Opus 4, Claude 3.5 Sonnet
- **CV Success Rate**: 90-95%
- **Behavior**: Strict CV-first workflow enforcement, no click violations allowed
- **Testing**: GPT-4o demonstrated 100% CV-first compliance with adaptive keyboard fallback
- **Max CV Attempts**: 2 before keyboard shortcut suggestions

**🥈 Tier 2: Medium CV Capability (Balanced Enforcement)**
- **Models**: GPT-4o-mini, Gemini 2.0 Flash, Gemini 1.5 Pro, Claude 3 Haiku
- **CV Success Rate**: 75-85%
- **Behavior**: Relaxed enforcement (allow 1 click violation), emphasized keyboard shortcuts
- **Max CV Attempts**: 3 before alternative approaches
- **Default**: Unknown models default to Tier 2 for balanced behavior

**🥉 Tier 3: Weak CV Capability (Minimal Enforcement)**
- **Models**: Qwen3-VL, LLaVA, CogVLM
- **CV Success Rate**: 40-50%
- **Behavior**: Suggest CV-first but don't block, keyboard-first prompts
- **Testing**: Qwen3-VL showed 4 click violations and detect→click loops, required help
- **Max CV Attempts**: 2 with aggressive loop detection

#### **Real-World Performance Data**

Based on production session analysis comparing GPT-4o vs Qwen3-VL:

| Metric | GPT-4o (Tier 1) | Qwen3-VL (Tier 3) |
|--------|----------------|-------------------|
| **Assistant Messages** | 8 | 21 (2.6x more) |
| **CV Detection Attempts** | 2 | 6 |
| **Click Violations** | 0 ✅ | 4 ❌ |
| **Workflow Quality** | Clean with keyboard fallback | Stuck in detect→click loops |
| **Outcome** | Adaptive completion | Requested help (loop detected) |

#### **Adaptive Enforcement Features**

- **Pattern Matching**: Fuzzy model name matching for automatic tier assignment
- **Loop Detection**: Tier 3 models get more sensitive loop detection (2 failures vs 3)
- **Dynamic Prompts**: Future: Different system prompts per tier emphasizing strengths
- **Fallback Strategies**: Future: Tier-specific fallback chains (CV → Keyboard → Coords)

**Location**: `packages/bytebot-agent/src/models/`
**Configuration**: See `model-capabilities.config.ts` for full model database

### Hybrid Vision/Non-Vision Model Support

Hawkeye now supports **both vision-capable and text-only models** with intelligent content adaptation. The system automatically transforms visual content based on each model's capabilities, enabling you to use reasoning models (o1, o3, DeepSeek R1) and other non-vision models alongside vision models.

#### **Intelligent Content Transformation**

When you select a non-vision model, Hawkeye automatically:

- **Transforms Images → Text Descriptions**: Screenshots and uploaded images are converted to detailed text descriptions including metadata (resolution, capture time, file size)
- **Adapts System Prompts**: Non-vision models receive instructions focused on text-based analysis and tool results, while vision models get visual observation prompts
- **Skips Visual Observation Guards**: Screenshot observation requirements only apply to vision models; non-vision models can proceed immediately after screenshots
- **Optimizes Background Processing**: Holo 1.5-7B enrichment only runs for vision models, eliminating unnecessary 30-80s detections for text-only models

#### **Supported Non-Vision Models (13 Added)**

**OpenAI Reasoning Models:**
- `o3-pro`, `o3`, `o3-mini` - Advanced reasoning with extended thinking time
- `o1`, `o1-mini`, `o1-preview` - Original reasoning model series

**OpenRouter Models:**
- `openrouter-deepseek-r1` - DeepSeek's flagship reasoning model
- `openrouter-deepseek-r1-distill-qwen-32b` - Qwen-distilled variant (32B)
- `openrouter-deepseek-r1-distill-llama-70b` - Llama-distilled variant (70B)
- `openrouter-qwen-plus`, `openrouter-qwen-turbo`, `openrouter-qwen-max` - Qwen series
- `openrouter-claude-3-haiku` - Fast, cost-effective Claude variant
- `openrouter-mistral-large` - Mistral's flagship model

**Total:** 41 models supported (28 vision + 13 text-only)

#### **Enhanced Model Picker UI**

The model selection dropdown now features visual differentiation:

- **👁️ Vision Models Section** - Eye icon with blue theme for image-capable models
- **📝 Text-Only Models Section** - FileText icon with amber theme for text-only models
- **Color-Coded Badges** - "Vision" (blue) or "Text-Only" (amber) labels
- **Descriptive Headers** - "Can process images" vs "Text descriptions only"
- **Scrolling Support** - Smooth scrolling for all 41 models with max-height constraint

The UI makes it immediately clear which models support image input, preventing confusion when uploading files or expecting visual analysis.

#### **Technical Implementation**

**Message Transformation Pipeline** (`message-transformer.util.ts`):
```typescript
// Automatically transforms images for non-vision models
if (!model.supportsVision) {
  messages = transformImagesForNonVision(messages);
  // Converts Image blocks → Text descriptions
  // Handles nested images in ToolResult blocks
}
```

**Vision-Aware Prompts** (`tier-specific-prompts.ts`):
```typescript
buildTierSpecificAgentSystemPrompt(tier, maxCvAttempts, currentDate, currentTime, timeZone, supportsVision)
// Different instructions per capability:
// - Vision models: "deliver exhaustive visual observation"
// - Non-vision: "review text descriptions and tool results"
```

**Optimized Enrichment** (`agent.processor.ts`):
```typescript
// Only run Holo for vision models
if (isScreenshot && supportsVision(model)) {
  enrichScreenshotWithOmniParser(); // 30-80s Holo detection
}
```

**Benefits:**
- ✅ Reasoning models (o1, o3, DeepSeek R1) now accessible for complex tasks
- ✅ No manual configuration - automatic adaptation based on model capabilities
- ✅ Performance optimization - skip expensive CV for text-only models
- ✅ Better UX - clear visual indicators of model capabilities
- ✅ Consistent experience - both model types use same tool APIs

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
- **GGUF model incomplete:** Check cache size: `du -sh ~/.cache/huggingface/hub/models--mradermacher--Holo1.5-7B-GGUF/` (should be ~6GB with 2 .gguf files)
- **Download fails:** Models download automatically via llama-cpp-python on first run
- **llama-cpp-python errors:** Run `./scripts/setup-holo.sh --force` to reinstall with correct build flags
- **Disk space:** Needs 15GB free (vs previous 25GB) - script checks and warns before starting

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

**Available Models via Proxy (41 Total: 28 Vision + 13 Text-Only):**

**Vision Models (👁️ Can process images):**
- **Anthropic**: `claude-opus-4`, `claude-sonnet-4`
- **OpenAI**: `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-5-thinking`, `gpt-5-main`, `gpt-5-mini`, `gpt-5-nano`
- **OpenRouter**: `openrouter-claude-3.5-sonnet`, `openrouter-claude-3.7-sonnet`, `openrouter-gemini-2.5-pro`, `openrouter-gemini-2.5-flash`, `openrouter-gemini-1.5-pro`, `openrouter-internvl3-78b`, `openrouter-qwen3-vl-235b-a22b-instruct`
- **Gemini**: `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-vertex-pro`, `gemini-vertex-flash`
- **Local LMStudio**: `local-lmstudio-qwen2.5-vl-32b-instruct` (vision), configure in [`packages/bytebot-llm-proxy/litellm-config.yaml`](packages/bytebot-llm-proxy/litellm-config.yaml)

**Text-Only Models (📝 Receive text descriptions):**
- **OpenAI Reasoning**: `o3-pro`, `o3`, `o3-mini`, `o1`, `o1-mini`, `o1-preview`
- **OpenRouter**: `openrouter-deepseek-r1`, `openrouter-deepseek-r1-distill-qwen-32b`, `openrouter-deepseek-r1-distill-llama-70b`, `openrouter-qwen-plus`, `openrouter-qwen-turbo`, `openrouter-qwen-max`, `openrouter-claude-3-haiku`, `openrouter-mistral-large`, `openrouter-glm-4.6`, `openrouter-grok-4-fast-free`
- **Local LMStudio**: `local-lmstudio-ui-tars-72b-dpo`, `local-lmstudio-ui-tars-7b-dpo`, `local-lmstudio-gemma-3-27b`, `local-lmstudio-magistral-small-2509` (text-only)

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

**Important:** On Apple Silicon Macs, Holo 1.5-7B **must** run locally for Metal GPU acceleration. This means you likely **cannot** run LMStudio locally due to GPU memory constraints unless you have a massive GPU.

**Why Holo runs locally:**
- Docker Desktop on macOS doesn't support Metal GPU passthrough
- Running Holo natively gives ~1.5-2.5s inference vs ~8-15s CPU-only in Docker
- Holo 1.5-7B GGUF Q4_K_M needs ~6GB GPU memory (quantized from 8.29B parameters)

**Can I run Holo in LM Studio?**
Yes! Since Holo is now GGUF format, you can load it in LM Studio:
- Model: `mradermacher/Holo1.5-7B-GGUF` (search in LM Studio model browser)
- Quantization: Q4_K_M recommended (4.8GB)
- Use LM Studio's OpenAI-compatible API endpoint
- Configure Holo service to connect to LM Studio instead of running its own inference

However, this still requires ~6GB GPU memory, so you may not be able to run both Holo + large LLMs simultaneously on consumer hardware.

**Why LMStudio can't run locally (usually):**
- M1/M2/M3 unified memory is shared between CPU and GPU
- Running both Holo GGUF (6GB) + LMStudio models (7-70B) exceeds available GPU memory
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
- ✅ Holo GGUF gets full Metal GPU access for fast inference (~1.5-2.5s)
- ✅ LMStudio models run on separate hardware with dedicated resources
- ✅ No GPU memory contention
- ✅ Best performance for both systems
- ✅ Can use large models (70B+) without affecting Holo
- ✅ Holo's GGUF format (6GB) is more memory-efficient than before (was 15.4GB)

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
