# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🎯 Recent Changes: Holo 1.5-7B Integration & SOM Visual Grounding

**OpenCV and OmniParser have been removed** to reduce complexity and improve maintainability. The system now relies on:
- **Holo 1.5-7B** (PRIMARY) - Qwen2.5-VL-based UI element localization (cross-platform: Windows/Linux/macOS)
- **Set-of-Mark (SOM)** - Numbered visual grounding for improved click accuracy (70-85% vs 20-30% with raw IDs)
- **Tesseract.js** (FALLBACK) - Pure JavaScript OCR for text extraction

**Benefits:**
- ✅ Simpler installation (no native bindings to compile)
- ✅ Smaller package size (~5.5GB Holo 1.5 GGUF vs multiple GB OmniParser + OpenCV)
- ✅ Better cross-platform compatibility (no C++ compilation issues)
- ✅ Superior detection accuracy (Holo 1.5 cross-platform UI understanding)
- ✅ Improved click accuracy (70-85% with SOM vs 20-30% with raw IDs)

## Important Instruction Reminders

Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.

## Architecture Overview

Bytebot Hawkeye is a precision-enhanced fork of the open-source AI Desktop Agent platform. It consists of these main packages:

1. **bytebot-agent** - NestJS service that orchestrates AI tasks, computer use, and precision targeting
2. **bytebot-agent-cc** - Claude Code integration variant with `@anthropic-ai/claude-code` SDK
3. **bytebot-ui** - Next.js frontend with desktop dashboard and task management
4. **bytebotd** - Desktop daemon providing computer control with enhanced coordinate accuracy
5. **bytebot-cv** - Computer vision package with Holo 1.5 client + Tesseract.js for element detection
6. **bytebot-holo** - Python FastAPI service running Holo 1.5-7B (Qwen2.5-VL) for UI element localization
7. **bytebot-llm-proxy** - LiteLLM proxy service for multi-provider model routing
8. **shared** - Common TypeScript types, utilities, and universal coordinate mappings

### Package Dependencies

All packages depend on `shared` and must build it first. The build order is:
1. `shared` (base types and utilities)
2. `bytebot-cv` (CV capabilities)
3. `bytebot-agent`, `bytebot-agent-cc`, `bytebotd` (services that consume shared + cv)
4. `bytebot-ui` (frontend that consumes shared)

## Key Hawkeye Enhancements

This fork adds precision tooling on top of upstream Bytebot:
- **Smart Focus System**: 3-stage coarse→focus→click workflow with tunable grids
- **Progressive zoom capture**: Deterministic zoom ladder with coordinate reconciliation
- **Universal element detection**: Holo 1.5-7B (Qwen2.5-VL) + Tesseract.js OCR
- **Coordinate telemetry**: Accuracy metrics and adaptive calibration
- **Grid overlay guidance**: Always-on coordinate grids with debug overlays

## Quick Start

**Simple 3-step setup:**

```bash
# 1. Install dependencies
npm install

# 2. Build packages (shared → bytebot-cv → services)
cd packages/shared && npm run build
cd ../bytebot-cv && npm install && npm run build

# 3. Setup Holo 1.5-7B (auto-detects Apple Silicon vs x86_64/NVIDIA)
./scripts/setup-holo.sh

# 4. Start stack
./scripts/start-stack.sh
```

### What Happens Automatically

**On Apple Silicon (M1-M4):**
- Sets up native OmniParser with MPS GPU (~1-2s/frame)
- Configures Docker to connect to native service
- Best performance: GPU-accelerated

**On x86_64 + NVIDIA GPU:**
- Uses Docker container with CUDA (~0.6s/frame)
- Auto-detects and uses GPU
- Production-ready setup

**On x86_64 CPU-only:**
- Uses Docker container with CPU (~8-15s/frame)
- Works everywhere, slower performance

### Manual Control

```bash
# Apple Silicon only: Start/stop native Holo 1.5-7B
./scripts/start-holo.sh  # Start with MPS GPU
./scripts/stop-holo.sh   # Stop

# Stop entire stack
./scripts/stop-stack.sh
```

### Windows Container (Tiny11/Nano11)

Run Bytebot with **Tiny11 2311** (stripped Windows 11) or **Nano11 25H2** (minimal Windows 11) for faster installation:

```bash
# Start Windows stack with pre-baked PowerShell installer (15-20 min initial setup)
./scripts/start-stack.sh --os windows --prebaked
```

**System Requirements:**
- KVM support (`/dev/kvm` must be available)
- **Recommended**: 8GB+ RAM, 4+ CPU cores
- **Minimum**: 6GB RAM, 4 cores
- 50GB+ disk space

**Why Tiny11/Nano11?**
- 🚀 **Faster download**: 3.5GB (Tiny11) or 2.5GB (Nano11) vs 6GB Windows 11 ISO
- ⚡ **Less resources**: 6GB RAM vs 8GB, 50GB disk vs 100GB
- 🎯 **Stripped Windows 11**: No bloatware, fully serviceable and updateable
- ✅ **Same compatibility**: Works identically to Windows 11 for bytebotd

**Setup Process:**
1. **Windows installer package built automatically** (~90MB with Windows sharp binaries)
   - Builds packages on Linux host (shared, bytebot-cv, bytebotd)
   - Pre-installs Windows-native sharp binaries (@img/sharp-win32-x64)
   - Creates ZIP package at `docker/windows-installer/bytebotd-prebaked.zip`
2. Stack starts Windows container (5-10 minutes for OS installation)
3. **Automated installation** via `install-prebaked.ps1`:
   - Downloads Node.js 20 portable, adds to system PATH
   - Extracts installer package to `C:\Program Files\Bytebot\packages\`
   - Creates scheduled task "Bytebotd Desktop Agent" with S4U logon (interactive desktop access)
   - Starts bytebotd service and tray monitor
4. Access Windows web viewer at `http://localhost:8006`
5. **Total time: 15-20 minutes** (mostly Windows boot + ZIP extraction)

**S4U Scheduled Task (Critical):**
- Uses Service-for-User logon type for interactive desktop access
- Required for nut-js screen.capture() and input automation
- Scheduled task runs as current user with S4U logon, not SYSTEM

**BTRFS Filesystem Support:**
- ✅ Windows containers work directly on BTRFS (no workaround needed)
- Uses `DISK_IO=threads` and `DISK_CACHE=writeback` to avoid O_DIRECT requirement

**Troubleshooting:**
- **Slow startup**: Wait up to 2 minutes for health check on slower systems
- **Check logs**: `C:\Bytebot-Logs\install-prebaked.log` and `bytebotd-*.log` (view via tray icon)
- **Tray icon**: Green = healthy, Yellow = starting, Red = stopped
- **Rebuild installer**: `rm -rf docker/windows-installer/bytebotd-prebaked.zip && ./scripts/build-windows-prebaked-package.sh`
- **Fresh start**: Delete volume (`docker volume rm docker_bytebot-windows-storage`) then restart

**Ports:**
- `8006` - Web-based VNC viewer
- `3389` - RDP access
- `9990` - Bytebotd API
- `9991` - Bytebot Agent
- `9992` - Bytebot UI
- `9989` - Holo 1.5-7B

**Display Resolution:**
- Target: 1280x960 (configured via `WINDOWS_RESOLUTION`)
- Actual: 1280x720 (VirtIO GPU limitation - QXL not available in dockur/windows)
- 40px difference minimal impact on AI models

### macOS Container (Sonoma/Sequoia)

Run Bytebot with a macOS Sonoma/Sequoia desktop environment:

```bash
# Prebaked image (96% faster startup, recommended)
./scripts/start-stack.sh --os macos --prebaked

# Runtime installation (one-time manual setup required)
./scripts/start-stack.sh --os macos
```

**System Requirements:**
- **Apple Hardware Only** (iMac, Mac mini, MacBook, Mac Studio, Mac Pro - Apple licensing)
- KVM support, 8GB+ RAM, 64GB+ disk space

**Why Prebaked?**
- 🚀 **96% faster startup**: 30-60 seconds vs 10-15 minutes
- ✅ **Zero manual steps** after initial creation
- 🔄 **Reusable image** across deployments
- ⚠️ **One-time Setup Assistant** completion required (Apple licensing constraint)

**Prebaked Image Workflow:**

Creating the prebaked image (one-time setup):
1. Run: `./scripts/build-macos-prebaked-image.sh`
2. Script starts fresh macOS container (~5-10 min boot)
3. **Manual Setup Assistant completion required** (~5 minutes):
   - Access macOS at `http://localhost:8006` or `vnc://localhost:5900`
   - Complete Setup Assistant (region, keyboard, user account)
   - **SKIP**: Migration Assistant, Apple ID, iCloud, Analytics, Siri
   - Create user account: `docker` / `docker`
4. After reaching desktop, run in Terminal:
   ```bash
   sudo bash /shared/setup-macos-first-time.sh
   ```
5. Automated installation completes (~5-8 minutes):
   - Installs Homebrew + Node.js 20
   - Extracts bytebotd packages to `/Users/Shared/bytebot`
   - Creates LaunchAgent for auto-start
   - Verifies bytebotd health
6. Script commits container to prebaked image: `bytebot-macos-prebaked:latest`
7. Total time: **10-15 minutes** (one-time only)

Using the prebaked image (subsequent deployments):
```bash
./scripts/start-stack.sh --os macos --prebaked
```
- Boots in 30-60 seconds
- Bytebotd starts automatically via LaunchAgent
- Ready to use immediately

**Runtime Installation Workflow:**

For deployments without prebaked image:
1. **macOS installer package built automatically** (~150MB with ARM64 binaries)
   - Builds packages on host (shared, bytebot-cv, bytebotd)
   - Pre-installs macOS-native sharp binaries (@img/sharp-darwin-arm64)
   - Creates TAR.GZ at `docker/macos-installer/bytebotd-macos-prebaked.tar.gz`
2. Container starts (~5-10 minutes first boot)
3. **Manual Setup Assistant completion** (~5 minutes) - same as prebaked workflow
4. Run in Terminal: `sudo bash /shared/setup-macos-first-time.sh`
5. Automated installation (~5-8 minutes) - same as prebaked workflow
6. Total time: **10-15 minutes** (every deployment)

**Why Setup Assistant Cannot Be Bypassed:**
- Apple licensing requires interactive EULA acceptance
- macOS has no equivalent to Windows `autounattend.xml`
- `.AppleSetupDone` bypass no longer works on macOS 14+
- LaunchDaemons run AFTER Setup Assistant (chicken-and-egg problem)
- **Solution**: Docker commit approach (industry best practice)

**Troubleshooting:**
- **Check logs**: `/Users/Shared/bytebot-logs/first-time-setup.log` and `bytebotd.log`
- **Prebaked image missing**: Run `./scripts/build-macos-prebaked-image.sh`
- **Rebuild package**: `rm -rf docker/macos-installer && ./scripts/build-macos-prebaked-package.sh`
- **Fresh start (runtime)**: Delete volume (`docker volume rm docker_bytebot-macos-storage`)
- **Fresh start (prebaked)**: Rebuild image with `--skip-test` to avoid test container

**Ports:**
- `8006` - Web-based viewer
- `5900` - VNC access
- `9990` - Bytebotd API
- `9991` - Bytebot Agent
- `9992` - Bytebot UI
- `9989` - Holo 1.5-7B

## Development Commands

### Build Dependencies
The shared package must be built first as other packages depend on it:
```bash
cd packages/shared && npm run build
```

### bytebot-agent (NestJS API service)
```bash
cd packages/bytebot-agent
npm run start:dev          # Watch mode with shared build
npm run prisma:dev         # Run migrations + generate client
npm run test               # Jest unit tests
npm run build              # Build with shared dependencies
npm run start:prod         # Production server
```

### bytebot-ui (Next.js frontend)
```bash
cd packages/bytebot-ui
npm run dev                # Development server
npm run build              # Production build
npm run start              # Production server
```

### bytebotd (Desktop daemon)
```bash
cd packages/bytebotd
npm run start:dev          # Watch mode with shared build
npm run build              # Nest build
npm run start:prod         # Production server
```

### bytebot-cv (Computer vision)
```bash
cd packages/bytebot-cv
npm install                # Install dependencies (Tesseract.js, canvas)
npm run build              # TypeScript compilation
npm run dev                # Watch mode
```

### bytebot-holo (Python Service)
```bash
cd packages/bytebot-holo
bash scripts/setup.sh       # Creates conda env, downloads models (~850MB)
conda activate omniparser   # or: source venv/bin/activate
python src/server.py        # Starts FastAPI service on port 9989
```

## Docker Development

All stacks now include Holo 1.5-7B for semantic UI detection by default.

> **Note**: To disable Holo (e.g., on systems without GPU), set `BYTEBOT_CV_USE_HOLO=false` in `docker/.env`

### Full Stack (Standard)
```bash
docker compose -f docker/docker-compose.yml up -d --build
```

### Proxy Stack (with LiteLLM)
```bash
# Configure docker/.env with API keys and Hawkeye settings first
docker compose -f docker/docker-compose.proxy.yml up -d --build
```

### Service Ports
- bytebot-ui: 9992 (web interface)
- bytebot-agent: 9991 (API server)
- bytebotd: 9990 (desktop daemon + noVNC)
- bytebot-holo: 9989 (Holo 1.5-7B service)
- PostgreSQL: 5432

## Holo 1.5-7B Platform Support

Holo 1.5-7B is a Qwen2.5-VL-based model trained on Windows, macOS, and Linux UI screenshots.

### Docker (Multi-Architecture)

| Platform | Device | Performance | Notes |
|----------|--------|-------------|-------|
| x86_64 + NVIDIA GPU | CUDA | ~0.6s/frame ⚡ | **Recommended for production** |
| x86_64 CPU-only | CPU | ~8-15s/frame | Works but slow |
| ARM64 (Apple Silicon) | CPU | ~8-15s/frame ⚠️ | **MPS not available in containers** |

**Auto-detection**: Set `HOLO_DEVICE=auto` (default) to automatically use the best available device.

### Native Execution (Apple Silicon)

For GPU acceleration on Apple Silicon (M1-M4), run Holo **natively outside Docker**:
- **Performance**: ~1-2s/frame with MPS (Metal Performance Shaders)
- **Setup Guide**: See `packages/bytebot-holo/NATIVE_MACOS.md`
- **Architecture**: Run natively, connect from Docker via `host.docker.internal:9989`

**Why native?** Docker Desktop on macOS doesn't pass through MPS/Metal GPU access to containers.

### Configuration

```bash
# docker/.env
HOLO_DEVICE=auto  # Recommended: auto-detect (cuda > mps > cpu)
BYTEBOT_CV_USE_HOLO=true
```

## Database

Uses PostgreSQL with Prisma ORM:
- Schema: `packages/bytebot-agent/prisma/schema.prisma`
- Migrations: `npm run prisma:dev` (in bytebot-agent)
- Connection: `postgresql://postgres:postgres@localhost:5432/bytebotdb`

## AI Provider Integration

Supports multiple providers via environment variables:
- `ANTHROPIC_API_KEY` - Claude models
- `OPENAI_API_KEY` - GPT models
- `GEMINI_API_KEY` - Gemini models
- `OPENROUTER_API_KEY` - OpenRouter proxy

## Model Capability System

**Status:** Phase 1 Complete (Tier-based model profiling)
**Location:** `packages/bytebot-agent/src/models/`

Adaptive CV-first enforcement based on each AI model's vision capabilities:

### Tier 1: Strong CV (Strict Enforcement)
- **Models**: GPT-4o, Claude Sonnet 4.5, Claude Opus 4, Claude 3.5 Sonnet
- **CV Success**: 90-95% | **Max CV Attempts**: 2 | **Click Violations**: None allowed

### Tier 2: Medium CV (Balanced Enforcement)
- **Models**: GPT-4o-mini, Gemini 2.0 Flash, Gemini 1.5 Pro, Claude 3 Haiku
- **CV Success**: 75-85% | **Max CV Attempts**: 3 | **Click Violations**: 1 allowed

### Tier 3: Weak CV (Minimal Enforcement)
- **Models**: Qwen3-VL, LLaVA, CogVLM
- **CV Success**: 40-50% | **Max CV Attempts**: 2 | **Click Violations**: Suggest CV-first but don't block

### Usage

```typescript
import { ModelCapabilityService } from './models/model-capability.service';

const tier = modelCapabilityService.getModelTier('gpt-4o'); // Returns 'tier1'
const rules = modelCapabilityService.getEnforcementRules('qwen3-vl');
const strictMode = modelCapabilityService.shouldEnforceCvFirst('claude-opus-4'); // true
```

Model profiles defined in `packages/bytebot-agent/src/models/model-capabilities.config.ts`.

## Hawkeye-Specific Configuration

Key environment variables for precision features:
```bash
# Smart Focus System
BYTEBOT_SMART_FOCUS=true
BYTEBOT_SMART_FOCUS_MODEL=gpt-4o-mini
BYTEBOT_OVERVIEW_GRID=200
BYTEBOT_FOCUSED_GRID=25

# Grid Overlays
BYTEBOT_GRID_OVERLAY=true
BYTEBOT_GRID_DEBUG=false

# Coordinate Accuracy
BYTEBOT_COORDINATE_METRICS=true
BYTEBOT_COORDINATE_DEBUG=false
BYTEBOT_SMART_CLICK_SUCCESS_RADIUS=12

# Universal Element Detection
BYTEBOT_UNIVERSAL_TEACHING=true
BYTEBOT_ADAPTIVE_CALIBRATION=true
```

## Computer Vision Pipeline

The bytebot-cv package provides two detection methods:
- **Holo 1.5-7B** (PRIMARY) - Qwen2.5-VL-based UI element localization (cross-platform)
- **OCR** (FALLBACK) - Tesseract.js text extraction

**Note:** OpenCV and OmniParser have been removed to reduce complexity. Holo 1.5-7B provides superior cross-platform semantic understanding.

### CV Services Architecture
Core detection services in `packages/bytebot-cv/src/`:
- `services/enhanced-visual-detector.service.ts` - Holo 1.5 + OCR orchestrator
- `services/holo-client.service.ts` - Holo 1.5-7B REST client
- `services/cv-activity-indicator.service.ts` - Real-time CV activity tracking
- `services/text-semantic-analyzer.service.ts` - OCR text analysis
- `services/universal-detector.service.ts` - Universal element detection
- `detectors/ocr/ocr-detector.ts` - Tesseract.js OCR implementation

### Holo 1.5-7B Integration

**Status: FULL INTEGRATION COMPLETE ✅** (Holo 1.5-7B replaces OmniParser)
**Documentation:** See `packages/bytebot-holo/README.md` for details

**Core Features:**
- **Qwen2.5-VL Base** - 7B parameter vision-language model
- **GGUF Quantization** - Q4_K_M (4-bit) or Q8_0 (8-bit) for efficiency
- **Multi-prompt Detection** - Multiple detection passes for comprehensive coverage
- **Set-of-Mark Annotations** - Numbered visual grounding for VLM click accuracy
- **Cross-platform Training** - Windows, macOS, Linux UI screenshots
- **Performance Profiles** - SPEED, BALANCED, QUALITY modes

**Performance:**
- NVIDIA GPU: ~2-4s/frame (Q4_K_M quantization)
- Apple Silicon MPS: ~4-6s/frame (Q4_K_M quantization)
- CPU: ~15-30s/frame

**Benchmarks:**
- ScreenSpot-Pro: 57.94 (Holo 1.5-7B) vs 29.00 (Qwen2.5-VL-7B base)

**Configuration:**
```bash
BYTEBOT_CV_USE_HOLO=true
HOLO_URL=http://localhost:9989
HOLO_DEVICE=auto  # auto, cuda, mps (Apple Silicon), or cpu
HOLO_MIN_CONFIDENCE=0.05
HOLO_PERFORMANCE_PROFILE=BALANCED  # SPEED, BALANCED, or QUALITY
BYTEBOT_USE_SOM_SCREENSHOTS=true  # Enable numbered element annotations
```

**API Usage:**
```typescript
const result = await holoClient.parseScreenshot(buffer, {
  task: 'click on submit button',
  detect_multiple: true,
  include_som: true,
  performance_profile: 'BALANCED',
});
```

## Testing

All NestJS packages use Jest:
- Test files: `*.spec.ts`
- E2E tests: `test/jest-e2e.json` config
- UI tests: Native Node.js test runner

## Key Technical Notes

- Node.js ≥20.0.0 required for all packages (Python 3.12 for bytebot-holo)
- TypeScript strict mode enabled
- Monorepo structure requires building shared package first
- **OpenCV removed** - system now uses Holo 1.5-7B (primary) + Tesseract.js (fallback)
- Universal coordinates stored in `config/universal-coordinates.yaml`
- Desktop accuracy metrics available at `/desktop` UI route
- Holo 1.5-7B requires 8-10GB VRAM (NVIDIA GPU, Apple Silicon M1-M4, or CPU fallback)

## Cross-Platform Compatibility

**Status:** ✅ FULL WINDOWS SUPPORT - All tools work identically on Windows, Linux, and macOS

The desktop daemon (bytebotd) now provides full cross-platform support with platform-specific implementations for all computer control operations:

### Platform-Aware Computer Control

All tools automatically detect the operating system and use appropriate platform APIs:

**Open Application Tool** (`computer_use/computer-use.service.ts:1328-1634`)
- **Windows**: PowerShell Start-Process + Win32 API (ShowWindow, SetForegroundWindow)
- **Linux**: wmctrl for X11 window management
- **macOS**: AppleScript and `open -a` commands

**Clipboard Operations** (`nut/nut.service.ts:427-513`)
- **Windows**: PowerShell Set-Clipboard with here-string escaping
- **Linux**: xclip for X11 clipboard
- **macOS**: pbcopy native clipboard

**Active Window Telemetry** (`telemetry/telemetry.service.ts:298-361`)
- **Windows**: PowerShell Get-Process with MainWindowHandle filtering
- **Linux**: wmctrl -lx for window detection
- **macOS**: AppleScript frontmost application detection

### What Works Cross-Platform

**✅ Fully Supported on All Platforms:**
- Mouse operations (move, click, drag, scroll) - via nut-js
- Keyboard operations (type, press, hold) - via nut-js
- Screenshots and screen info - via nut-js
- Application launching and window management
- Clipboard paste operations
- File read/write operations
- Element detection (Holo 1.5-7B works on all platforms)

**Platform-Specific Implementations:**
- Application launching: PowerShell (Windows), wmctrl (Linux), osascript (macOS)
- Clipboard: Set-Clipboard (Windows), xclip (Linux), pbcopy (macOS)
- Active window: Get-Process (Windows), wmctrl (Linux), osascript (macOS)

### Implementation Details

**Platform Detection** (`utils/platform.ts`)
```typescript
import { isWindows, isLinux, isMacOS } from '../utils/platform';

// Automatically routes to platform-specific implementation
if (isWindows()) {
  // Windows-specific code
} else if (isLinux()) {
  // Linux-specific code
} else if (isMacOS()) {
  // macOS-specific code
}
```

**Windows-Specific Notes:**
- Uses PowerShell for process management and clipboard
- Win32 API via PowerShell for window manipulation (ShowWindow, SetForegroundWindow)
- No external dependencies required (PowerShell built into Windows)
- Tested on Windows 11 (Tiny11/Nano11 containers)

**Linux-Specific Notes:**
- Requires wmctrl for window management (pre-installed in Linux desktop containers)
- Requires xclip for clipboard (pre-installed)
- Uses X11 DISPLAY environment variable (:0.0)

**macOS-Specific Notes:**
- Uses osascript (AppleScript) for window management
- Uses pbcopy for clipboard
- All tools work natively on macOS (no container required)

### Platform-Specific Native Modules

**Sharp (Image Processing):**
- Bytebotd uses `sharp` for image resizing/cropping (screenshot ROI extraction)
- Sharp contains platform-specific native binaries (`.node` files)
- **Windows containers**: install-prebaked.ps1 pre-installs Windows sharp binaries (@img/sharp-win32-x64)
- **Manual rebuild** (if needed): `npm rebuild sharp --platform=win32 --arch=x64`

**Other native modules:**
- `uiohook-napi`: Input tracking (keyboard/mouse events) - platform-specific
- `@nut-tree-fork/nut-js`: Keyboard shortcuts - requires interactive desktop (S4U scheduled task)

## Module Architecture

### bytebot-agent Main Modules
Key NestJS modules in `packages/bytebot-agent/src/`:
- `agent/agent.module.ts` - Core agent orchestration
- `tasks/tasks.module.ts` - Task management
- `messages/messages.module.ts` - Message handling
- `anthropic/anthropic.module.ts` - Claude API integration
- `openai/openai.module.ts` - OpenAI API integration
- `google/google.module.ts` - Gemini API integration
- `proxy/proxy.module.ts` - LiteLLM proxy integration
- `settings/settings.module.ts` - Configuration management
- `prisma/prisma.module.ts` - Database ORM
- `computer-vision/cv-activity.controller.ts` - CV telemetry endpoints

### bytebotd Main Modules
Key NestJS modules in `packages/bytebotd/src/`:
- `computer-use/computer-use.module.ts` - Desktop control (screenshot, click, type)
- `input-tracking/input-tracking.module.ts` - Mouse/keyboard tracking
- `nut/nut.module.ts` - Keyboard shortcut handling via nut-js
- `mcp/bytebot-mcp.module.ts` - Model Context Protocol integration

## Smart Focus System

Hawkeye's signature precision feature. See `docs/SMART_FOCUS_SYSTEM.md` for full details.

**Three-stage workflow:**
1. **Coarse** - Overview with `BYTEBOT_OVERVIEW_GRID` (default: 200px)
2. **Focus** - Zoom into region with `BYTEBOT_FOCUSED_GRID` (default: 25px)
3. **Click** - Final coordinate selection

**Configuration:**
- `BYTEBOT_SMART_FOCUS` - Enable/disable (default: true)
- `BYTEBOT_SMART_FOCUS_MODEL` - Model for focus reasoning (e.g., gpt-4o-mini)
- `BYTEBOT_OVERVIEW_GRID` - Coarse grid size
- `BYTEBOT_FOCUSED_GRID` - Fine grid size

## Set-of-Mark (SOM) Visual Annotations

**Status:** ✅ COMPLETE - Full implementation with vision/non-vision model support
**Click Accuracy:** 70-85% with SOM numbers vs 20-30% with raw element IDs

SOM is a visual grounding technique where UI elements are annotated with numbered bounding boxes on screenshots. This allows models to reference elements by visible numbers (e.g., "click element 5") instead of cryptic IDs.

### Implementation Phases (All Complete)

**Phase 1: Backend Infrastructure** ✅
- Python Service (bytebot-holo): `generate_som_image()` overlays numbered boxes
- TypeScript Client (bytebot-cv): Automatic SOM generation on every detection

**Phase 2: Agent Integration** ✅
- Vision models: Receive screenshots with numbered RED BOXES [0], [1], [2]
- Non-vision models: Receive numbered text lists in detection response
- Environment variable: `BYTEBOT_USE_SOM_SCREENSHOTS=true` (enabled by default)

**Phase 3: Element Number Resolution** ✅
- Backend automatically resolves number → element ID → coordinates
- `computer_click_element({ element_id: "0" })` - Click element [0]
- Supports flexible formats: "5", "element 3", "box 12"

**Phase 4: System Prompt Optimization** ✅
- Strong emphasis on SOM as PRIMARY clicking method
- Clear preference hierarchy: SOM numbers > element IDs > grid coordinates

**Phase 5: UI Enhancements** ✅
- Real-time CV activity indicators with Holo metadata
- Performance profile display (SPEED/BALANCED/QUALITY)
- Device type (NVIDIA GPU ⚡ / Apple GPU 🍎 / CPU 💻)

### Usage

**Vision Models (Claude Opus 4, GPT-4o):**
1. Run `computer_detect_elements({ description: "Install button" })`
2. See screenshot with RED BOXES: [0] Install, [1] Cancel, [2] Settings
3. Click: `computer_click_element({ element_id: "0" })`

**Non-Vision Models (GPT-3.5, Claude Haiku):**
1. Run `computer_detect_elements({ description: "Install button" })`
2. Receive: "Elements: [0] Install button, [1] Cancel button, [2] Settings gear icon"
3. Click: `computer_click_element({ element_id: "0" })`

### Configuration

```bash
# Enable/disable SOM (enabled by default)
BYTEBOT_USE_SOM_SCREENSHOTS=true
BYTEBOT_CV_USE_HOLO=true
```

### Performance Impact

- **Click Accuracy**: 70-85% with SOM numbers vs 20-30% with raw element IDs
- **Cognitive Load**: Reduced - use visible numbers instead of memorizing IDs
- **Processing Overhead**: Minimal - SOM generation adds <100ms

## CV Activity Monitoring

**Status:** ✅ COMPLETE - Real-time Holo metadata display in UI

**Features:**
- Active CV methods with live status (pulsing indicators)
- Performance profile display (SPEED/BALANCED/QUALITY with icons)
- Quantization level (Q4_K_M/Q8_0)
- Device type (NVIDIA GPU ⚡ / Apple GPU 🍎 / CPU 💻)
- Detection history with cache hit indicators
- Click success/failure tracking
- Statistics dashboard (total detections, clicks, success rate, cache hit rate)

**UI Components:**
- **Task Page Header**: Compact Holo status card with GPU info
- **Chat Panel**: Inline CV activity during agent execution
- **Direct Vision Mode**: Purple badge when CV is bypassed

**Backend APIs:**
```typescript
GET /api/cv-activity/stream       // Current CV activity snapshot
GET /api/cv-detection/summary     // Detection and click summary
```

**Direct Vision Mode:**
When using vision-capable models (Claude Opus 4, GPT-4o) with `directVisionMode=true`:
- CV indicators show "Direct Vision Mode" badge
- Holo 1.5-7B detection bypassed
- Model uses native vision directly on screenshots
- Faster performance, fewer intermediate steps
