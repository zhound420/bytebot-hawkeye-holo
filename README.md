<div align="center">

<img src="docs/images/bytebot-logo.png" width="500" alt="Bytebot Hawkeye Logo">

# Bytebot Hawkeye

**Precision-Enhanced AI Desktop Agent Fork**

An AI that controls its own computer with enhanced accuracy, smart focus targeting, and advanced computer vision.

[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](https://github.com/zhound420/bytebot-hawkeye-holo/tree/main/docker)
[![License](https://img.shields.io/badge/license-Apache%202.0-green.svg)](LICENSE)

🔱 **Fork** of [bytebot-ai/bytebot](https://github.com/bytebot-ai/bytebot) with precision tooling enhancements

[📚 Documentation](#documentation) • [🚀 Quick Start](#-quick-start-3-steps) • [⚡ Features](#-hawkeye-enhancements)

</div>

---

## 🎯 What is Hawkeye?

Hawkeye is a **precision-enhanced fork** of Bytebot that adds advanced computer vision, smart targeting, and accuracy measurement tools to make AI desktop agents more reliable. While upstream Bytebot provides the foundation, Hawkeye layers on:

- **🎯 Smart Focus System** - 3-stage coarse→focus→click workflow for precise targeting
- **🔬 Holo 1.5-7B Vision** - AI-powered UI element localization (90%+ accuracy)
- **📊 Real-time Telemetry** - Live accuracy metrics and performance monitoring
- **🎨 Grid Overlay Guidance** - Always-on coordinate scaffolding for spatial reasoning
- **🧠 46 Model Support** - Vision & text-only models with intelligent adaptation

---

## ⚡ Hawkeye Enhancements

| Feature | Hawkeye | Upstream |
|---------|---------|----------|
| **UI Element Detection** | Holo 1.5-7B (90%+ accuracy) + Tesseract.js OCR | Basic screenshot analysis |
| **Click Targeting** | Smart Focus 3-stage workflow with zoom refinement | Single-shot click reasoning |
| **Coordinate Accuracy** | Telemetry pipeline with adaptive calibration | No automated measurement |
| **Visual Grounding** | Set-of-Mark (SOM) numbered annotations (70-85% accuracy) | Raw element IDs (20-30% accuracy) |
| **Grid Overlays** | Always-on 100px grids with debug mode | No spatial scaffolding |
| **Real-time Monitoring** | Live CV activity, GPU status, performance metrics | No visibility into detection methods |
| **Model Support** | 46 models (31 vision + 15 text-only) with auto-adaptation | Limited model support |
| **Cross-Platform** | Windows/Linux/macOS containers with identical workflows | Linux only |
| **UI Theming** | Light/dark mode toggle | Single default theme |
| **Learning System** | Empirical model performance tracking with recommendations | No performance learning |

**See [docs/FEATURES.md](docs/FEATURES.md) for comprehensive feature documentation.**

---

## 📋 Prerequisites

### Required Software
- **Docker** (≥20.10) & **Docker Compose** (≥2.0)
- **Git** for cloning the repository
- **Node.js** ≥20.0.0 (local development only, not needed for Docker)

### API Keys (At Least One Required)
```bash
# Choose your preferred LLM provider(s):
ANTHROPIC_API_KEY=sk-ant-...     # Claude models (console.anthropic.com)
OPENAI_API_KEY=sk-...             # GPT models (platform.openai.com)
GEMINI_API_KEY=...                # Gemini models (aistudio.google.com)
OPENROUTER_API_KEY=sk-or-v1-...  # Multi-model proxy (openrouter.ai)
```

**Or** use **LMStudio** for free local models (see [LMStudio Setup](#lmstudio-local-models-optional)).

### GPU Requirements (Recommended for Best Performance)

**Holo 1.5-7B** provides precision UI localization with GPU acceleration:

| Platform | Performance | Requirements |
|----------|-------------|--------------|
| **NVIDIA GPU** ⚡ | ~1.5-3s/inference | 14GB+ VRAM, nvidia-container-toolkit |
| **Apple Silicon** 🍎 | ~2-4s/inference | 16GB+ unified memory (M1-M4) |
| **CPU-only** 💻 | ~15-30s/inference | Automatic fallback to Tesseract.js OCR |

**GPU setup guide:** [docs/GPU_SETUP.md](docs/GPU_SETUP.md)

> **Note:** CPU-only systems automatically disable Holo and use fast Tesseract.js OCR instead.

---

## 🚀 Quick Start (3 Steps)

### Step 1: Clone Repository
```bash
git clone https://github.com/zhound420/bytebot-hawkeye-holo.git
cd bytebot-hawkeye-holo
```

### Step 2: Configure API Keys
```bash
cat <<'EOF' > docker/.env
# At least one LLM provider API key required
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=sk-or-v1-...
EOF
```

### Step 3: Start the Stack
```bash
# Interactive setup (recommended for first-time users)
./scripts/start-stack.sh

# Or use flags for automation:
./scripts/start-stack.sh --os linux              # Linux desktop (default)
./scripts/start-stack.sh --os windows --prebaked # Windows 11 container
./scripts/start-stack.sh --os macos              # macOS container
```

**What happens automatically:**
- 🔍 Detects GPU (NVIDIA/Apple Silicon) and configures Holo 1.5-7B accordingly
- 🐳 Launches all services (agent, UI, desktop, database, LLM proxy)
- 🤖 Downloads Holo 1.5-7B model (~14GB, one-time, cached)
- ✅ Applies database migrations and verifies health

**Access the stack:**
- 🌐 **Web UI**: http://localhost:9992
- 🖥️ **Desktop (noVNC)**: http://localhost:9990
- 🤖 **Agent API**: http://localhost:9991
- 🔀 **LiteLLM Proxy**: http://localhost:4000
- 🎯 **Holo 1.5-7B**: http://localhost:9989

**Stop the stack:**
```bash
./scripts/stop-stack.sh
```

### Optional: Windows/macOS Containers

Test automation on native Windows or macOS environments:

**Windows 11 (Tiny11 pre-baked - 96% faster startup):**
```bash
./scripts/start-stack.sh --os windows --prebaked
# Access: http://localhost:8006 (30-60s startup vs 10-15min runtime install)
```

**macOS Sonoma/Sequoia:**
```bash
./scripts/start-stack.sh --os macos --prebaked
# Access: http://localhost:8006
# One-time setup required: Complete Setup Assistant, then run /shared/setup-macos-first-time.sh
```

**See:** [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md) | [docs/MACOS_SETUP.md](docs/MACOS_SETUP.md)

---

## 🧠 Model Support

Hawkeye supports **46 models** across all major providers with intelligent vision/text-only adaptation:

### Vision Models (31) - Can Process Images
- **Claude**: Opus 4, Sonnet 4, 4.1, Haiku 4.5, 3.5 Sonnet, 3.7 Sonnet
- **GPT**: 4o, 4o-mini, 4.1, 5-main, 5-mini, 5-thinking, 5-image (1 & mini)
- **Gemini**: 2.5 Pro/Flash, 2.0 Flash Thinking, 1.5 Pro/Flash, Computer Use Preview
- **OpenRouter**: Qwen3-VL series, InternVL3, Kimi-VL, Mistral Small 3.1
- **LMStudio**: Auto-detected local vision models (LLaVA, Qwen-VL, etc.)

### Text-Only Models (15) - Receive Text Descriptions
- **Reasoning**: o3-pro, o3, o3-mini, o1, o1-mini, o1-preview
- **OpenRouter**: DeepSeek R1 series, Qwen Plus/Turbo/Max, Claude Haiku, Mistral Large, GLM 4.6

**Automatic Adaptation:**
- ✅ Vision models receive screenshots with SOM numbered annotations
- ✅ Text-only models receive detailed text descriptions
- ✅ System prompts tailored to each model's capabilities
- ✅ Holo enrichment skipped for text-only models (30-80s saved)

**Enhanced Model Picker:**
- 👁️ Vision section (blue theme)
- 📝 Text-Only section (amber theme)
- 💻 Local Models section (green theme, FREE badge)
- Clear capability indicators

---

## 🔬 Computer Vision Pipeline

Hawkeye uses a streamlined 2-method detection system:

### Primary: Holo 1.5-7B Precision Localization
- **Model**: Hcompany/Holo1.5-7B (Qwen2.5-VL-7B base)
- **Accuracy**: 90%+ UI element localization
- **Method**: Direct coordinate prediction via vision-language model
- **Size**: ~14GB (bfloat16 precision, official transformers implementation)
- **Performance**: 1.5-3s on NVIDIA GPU, 2-4s on Apple Silicon, 15-30s on CPU
- **Platforms**: NVIDIA CUDA, Apple Metal (MPS), CPU fallback

### Fallback: Tesseract.js OCR
- **Purpose**: Text extraction when Holo unavailable or disabled
- **Speed**: Fast, pure JavaScript
- **Use Case**: CPU-only systems, text-based UI elements

### Set-of-Mark (SOM) Visual Grounding
- **Accuracy Boost**: 70-85% vs 20-30% with raw element IDs
- **Method**: Numbered bounding box annotations on screenshots
- **Usage**: Vision models reference elements by visible numbers (e.g., "click [5]")
- **Backend**: Automatic number→coordinate resolution

**See:** [docs/HOLO_SETUP.md](docs/HOLO_SETUP.md) for detailed setup and troubleshooting.

---

## 💻 LMStudio Local Models (Optional)

Run models locally with **zero API costs** through automatic LMStudio integration:

```bash
# During stack startup, answer 'y' to LMStudio prompt
# Or run standalone:
./scripts/setup-lmstudio.sh
```

**Auto-Configuration:**
- 🔍 Discovers models from LMStudio server
- 👁️ Detects vision support (llava, qwen-vl, cogvlm)
- ⚙️ Generates LiteLLM config entries
- 💚 Displays in UI with FREE badge

**Best Setup:** Run LMStudio on separate GPU-equipped machine to avoid memory contention with Holo 1.5-7B.

**See:** [docs/LMSTUDIO_SETUP.md](docs/LMSTUDIO_SETUP.md) for deployment strategies.

---

## 🎯 Smart Focus System

Hawkeye's signature precision feature - a 3-stage targeting workflow:

1. **Coarse** - Overview with 200px grid to identify region
2. **Focus** - Zoom into region with 25px grid for precise location
3. **Click** - Final coordinate selection with sub-pixel accuracy

**Configuration:**
```bash
BYTEBOT_SMART_FOCUS=true              # Enable/disable
BYTEBOT_SMART_FOCUS_MODEL=gpt-4o-mini # Model for focus reasoning
BYTEBOT_OVERVIEW_GRID=200             # Coarse grid size
BYTEBOT_FOCUSED_GRID=25               # Fine grid size
```

**See:** [docs/SMART_FOCUS_SYSTEM.md](docs/SMART_FOCUS_SYSTEM.md) for comprehensive guide.

---

## 📊 Real-Time Monitoring

### CV Activity Panel
- 🔴 Live method indicators (Holo 1.5-7B, OCR)
- ⚡ GPU status (NVIDIA GPU / Apple Silicon / CPU)
- 📈 Performance metrics (success rate, avg time, executions)
- 🎯 Detection history with cache indicators

### Model Performance Dashboard (`/desktop`)
- 🏆 Model leaderboard (ranked by success rate)
- 📊 Active model performance card
- 🎯 Task outcome tracking
- 💡 Intelligent model recommendations

### Desktop Accuracy Drawer
- ✅ Success rate per session
- 📍 Weighted offset tracking
- 🔄 Convergence metrics
- 🗺️ Hotspot visualization

---

## 🛠️ Troubleshooting

### Common Issues

**Canvas build errors (Ubuntu/Debian):**
```bash
# Install system dependencies BEFORE npm install
sudo apt update
sudo apt install -y pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

**GPU not detected:**
```bash
# Test GPU access
nvidia-smi  # For NVIDIA
# If fails → CPU-only mode (automatic fallback to Tesseract.js)
```

**Holo 1.5-7B model not downloading:**
```bash
# Model downloads automatically on first run
./scripts/start-holo.sh  # Apple Silicon
./scripts/start-stack.sh  # x86_64 Docker
```

**Services won't start:**
```bash
# Check service health
docker compose ps
docker logs bytebot-agent
docker logs bytebot-holo

# Verify database migrations
docker exec bytebot-agent npx prisma migrate status
```

**Force clean reinstall:**
```bash
./scripts/setup-holo.sh --force
./scripts/stop-stack.sh
./scripts/start-stack.sh
```

**See:** [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for comprehensive troubleshooting guide.

---

## 📚 Documentation

### Setup Guides
- [GPU Setup](docs/GPU_SETUP.md) - Platform-specific GPU configuration
- [Holo 1.5-7B Setup](docs/HOLO_SETUP.md) - Model installation and troubleshooting
- [Windows Container Setup](docs/WINDOWS_SETUP.md) - Tiny11/Nano11 deployment
- [macOS Container Setup](docs/MACOS_SETUP.md) - Sonoma/Sequoia deployment
- [LMStudio Setup](docs/LMSTUDIO_SETUP.md) - Local model integration

### Feature Documentation
- [Features Overview](docs/FEATURES.md) - Comprehensive Hawkeye enhancements
- [Smart Focus System](docs/SMART_FOCUS_SYSTEM.md) - 3-stage targeting workflow
- [Model Tier System](docs/MODEL_TIERS.md) - CV enforcement and capabilities
- [Coordinate Accuracy](docs/COORDINATE_ACCURACY_IMPROVEMENTS.md) - Telemetry and calibration

### Development
- [Architecture Overview](CLAUDE.md) - Package structure and dependencies
- [Build Instructions](CLAUDE.md#quick-start) - Local development setup
- [API Reference](#) - Coming soon

---

## 🔗 Fork Relationship

Hawkeye is a **precision-enhanced fork** of [bytebot-ai/bytebot](https://github.com/bytebot-ai/bytebot). We maintain compatibility with upstream and regularly sync updates.

**What we add:**
- Advanced computer vision (Holo 1.5-7B)
- Smart Focus targeting system
- Real-time telemetry and monitoring
- Extended model support (46 models)
- Cross-platform containers (Windows/macOS)

**What we preserve:**
- Core agent architecture
- Task API and workflows
- Database schema
- Docker deployment

**Upstream Resources:**
- [Bytebot Documentation](https://docs.bytebot.ai)
- [Bytebot API Reference](https://docs.bytebot.ai/api-reference/introduction)
- [Bytebot Quickstart](https://docs.bytebot.ai/quickstart)

---

## 📝 License

Apache License 2.0 - Same as upstream Bytebot.

See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- **Original Project**: [bytebot-ai/bytebot](https://github.com/bytebot-ai/bytebot) - Foundation for desktop agent capabilities
- **Holo 1.5-7B**: Hcompany for the precision UI localization model
- **Community**: Contributors and testers making Hawkeye more reliable

---

<div align="center">

**Built with precision. Forked with purpose.**

</div>
