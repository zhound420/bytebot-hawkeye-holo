# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🎯 Recent Changes: Holo 1.5-7B Integration

**OpenCV and OmniParser have been removed** to reduce complexity and improve maintainability. The system now relies on:
- **Holo 1.5-7B** (PRIMARY) - Qwen2.5-VL-based UI element localization (cross-platform: Windows/Linux/macOS)
- **Tesseract.js** (FALLBACK) - Pure JavaScript OCR for text extraction

**What was removed:**
- All OpenCV native bindings and build complexity
- Template matching, feature detection, contour detection services
- OpenCV preprocessing pipelines (CLAHE, morphology, filters)
- OmniParser v2.0 (replaced with Holo 1.5-7B)

**Benefits:**
- ✅ Simpler installation (no native bindings to compile)
- ✅ Smaller package size (~5.5GB Holo 1.5 GGUF vs multiple GB OmniParser + OpenCV)
- ✅ Better cross-platform compatibility (no C++ compilation issues)
- ✅ Superior detection accuracy (Holo 1.5 cross-platform UI understanding)

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

### Windows 11 Container (Optional)

Run Bytebot with a Windows 11 desktop environment instead of Linux:

```bash
# Start Windows 11 stack
./scripts/start-stack.sh --os windows
```

**Requirements:**
- KVM support (`/dev/kvm` must be available)
- 8GB+ RAM recommended
- 64GB+ disk space

**Setup Process:**
1. Stack starts Windows 11 container (may take 5-10 minutes for first boot)
2. Access Windows web viewer at `http://localhost:8006`
3. Download setup script from `/shared` folder inside Windows
4. Run PowerShell as Administrator and execute:
   ```powershell
   PowerShell -ExecutionPolicy Bypass -File setup-windows-bytebotd.ps1
   ```
5. Bytebotd will auto-start on subsequent boots

**Ports:**
- `8006` - Web-based VNC viewer
- `3389` - RDP access
- `9990` - Bytebotd API (after setup)
- `9991` - Bytebot Agent
- `9992` - Bytebot UI
- `9989` - Holo 1.5-7B

**Why Windows?**
- Test UI automation on Windows applications
- Holo 1.5-7B trained on Windows UI (same model, cross-platform)
- Resolution matched to Linux container (1280x960)

## Development Commands

### Build Dependencies
The shared package must be built first as other packages depend on it:
```bash
cd packages/shared && npm run build
```

### bytebot-agent (NestJS API service)
```bash
cd packages/bytebot-agent

# Development
npm run start:dev          # Watch mode with shared build
npm run prisma:dev         # Run migrations + generate client

# Testing
npm run test               # Jest unit tests
npm run test:watch         # Jest watch mode
npm run test:e2e           # End-to-end tests
npm run test -- <file>     # Run single test file

# Production
npm run build              # Build with shared dependencies
npm run start:prod         # Production server
npm run lint               # ESLint with --fix
```

### bytebot-agent-cc (Claude Code Integration)
```bash
cd packages/bytebot-agent-cc

# Same commands as bytebot-agent
# Includes @anthropic-ai/claude-code SDK integration
npm run start:dev          # Watch mode
npm run prisma:dev         # Migrations
npm run test               # Jest tests
npm run build              # Build
```

### bytebot-ui (Next.js frontend)
```bash
cd packages/bytebot-ui

npm run dev                # Development server
npm run build              # Production build
npm run start              # Production server
npm run lint               # Next.js linting
npm run test               # Native Node.js tests
```

### bytebotd (Desktop daemon)
```bash
cd packages/bytebotd

npm run start:dev          # Watch mode with shared build
npm run build              # Nest build
npm run start:prod         # Production server
npm run test               # Jest tests
npm run lint               # ESLint with --fix
```

### bytebot-cv (Computer vision)
```bash
cd packages/bytebot-cv

npm install                # Install dependencies (Tesseract.js, canvas)
npm run build              # TypeScript compilation
npm run dev                # Watch mode

# Note: OpenCV removed - now uses OmniParser + Tesseract.js only
```

### bytebot-llm-proxy (LiteLLM Proxy)
```bash
cd packages/bytebot-llm-proxy

# Configuration in litellm-config.yaml
# Provides unified API routing for OpenAI, Anthropic, Gemini, OpenRouter, LMStudio
# Environment variables: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY
```

### bytebot-holo (Python Service)
```bash
cd packages/bytebot-holo

# Setup (one-time)
bash scripts/setup.sh       # Creates conda env, downloads models (~850MB)

# Development
conda activate omniparser   # or: source venv/bin/activate
python src/server.py        # Starts FastAPI service on port 9989

# Testing
curl http://localhost:9989/health
curl http://localhost:9989/models/status

# Note: Requires GPU (CUDA/MPS) or CPU fallback
# Models: YOLOv8 icon detection + Florence-2 captioning
```

## Docker Development

All stacks now include OmniParser v2.0 for semantic UI detection by default.

> **Note**: To disable OmniParser (e.g., on systems without GPU), set `BYTEBOT_CV_USE_HOLO=false` in `docker/.env`

### Full Stack (Standard)
```bash
docker compose -f docker/docker-compose.yml up -d --build
```

### Proxy Stack (with LiteLLM)
```bash
# Configure docker/.env with API keys and Hawkeye settings first
docker compose -f docker/docker-compose.proxy.yml up -d --build
```

### Optional Extension Stack (Legacy)
```bash
# Use docker-compose.omniparser.yml as an extension overlay
docker compose -f docker/docker-compose.yml -f docker/docker-compose.omniparser.yml up -d --build
```

### Service Ports
- bytebot-ui: 9992 (web interface)
- bytebot-agent: 9991 (API server)
- bytebotd: 9990 (desktop daemon + noVNC)
- bytebot-holo: 9989 (OmniParser service)
- PostgreSQL: 5432

## Holo 1.5-7B Platform Support

Holo 1.5-7B is a Qwen2.5-VL-based model trained on Windows, macOS, and Linux UI screenshots. Performance varies by platform:

### Docker (Multi-Architecture)

| Platform | Device | Performance | Notes |
|----------|--------|-------------|-------|
| x86_64 (Intel/AMD) + NVIDIA GPU | CUDA | ~0.6s/frame ⚡ | **Recommended for production** |
| x86_64 (Intel/AMD) CPU-only | CPU | ~8-15s/frame | Works but slow |
| ARM64 (Apple Silicon) in Docker | CPU | ~8-15s/frame ⚠️ | **MPS not available in containers** |

**Auto-detection**: Set `HOLO_DEVICE=auto` (default) to automatically use the best available device.

### Native Execution (Apple Silicon)

For GPU acceleration on Apple Silicon (M1-M4), run OmniParser **natively outside Docker**:

- **Performance**: ~1-2s/frame with MPS (Metal Performance Shaders)
- **Setup Guide**: See `packages/bytebot-holo/NATIVE_MACOS.md`
- **Architecture**: Run OmniParser natively, connect from Docker via `host.docker.internal:9989`

**Why native?** Docker Desktop on macOS doesn't pass through MPS/Metal GPU access to containers.

### Configuration

```bash
# docker/.env
HOLO_DEVICE=auto  # Recommended: auto-detect (cuda > mps > cpu)
# HOLO_DEVICE=cpu   # Force CPU (slower but works everywhere)
# HOLO_DEVICE=cuda  # Force NVIDIA GPU (x86_64 only)
```

### Disabling Holo 1.5-7B

To disable Holo 1.5-7B (will fall back to Tesseract.js OCR only):

```bash
# docker/.env
BYTEBOT_CV_USE_HOLO=false
```

**Note:** Classical OpenCV-based CV methods (template matching, feature detection, contour detection) have been removed. Holo 1.5-7B + Tesseract.js provide superior detection accuracy.

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

The Model Capability System provides adaptive CV-first enforcement based on each AI model's vision capabilities. Models are categorized into three tiers:

### Tier 1: Strong CV Capability (Strict Enforcement)
- **Models**: GPT-4o, Claude Sonnet 4.5, Claude Opus 4, Claude 3.5 Sonnet
- **CV Success Rate**: 90-95%
- **Enforcement**: Strict CV-first workflow, no click violations allowed
- **Testing**: GPT-4o showed 100% CV-first compliance, adaptive keyboard fallback
- **Max CV Attempts**: 2
- **Loop Detection**: After 3 identical failures

### Tier 2: Medium CV Capability (Balanced Enforcement)
- **Models**: GPT-4o-mini, Gemini 2.0 Flash, Gemini 1.5 Pro, Claude 3 Haiku
- **CV Success Rate**: 75-85%
- **Enforcement**: Relaxed (allow 1 click violation)
- **Emphasis**: Keyboard shortcut suggestions
- **Max CV Attempts**: 3
- **Loop Detection**: After 3 identical failures

### Tier 3: Weak CV Capability (Minimal Enforcement)
- **Models**: Qwen3-VL, LLaVA, CogVLM
- **CV Success Rate**: 40-50%
- **Enforcement**: Suggest CV-first but don't block
- **Testing**: Qwen3-VL showed 4 click violations, stuck in detect→click loops
- **Max CV Attempts**: 2
- **Loop Detection**: After 2 identical failures (more sensitive)

### Usage

```typescript
// In your service
import { ModelCapabilityService } from './models/model-capability.service';

// Get model tier
const tier = modelCapabilityService.getModelTier('gpt-4o'); // Returns 'tier1'

// Get enforcement rules
const rules = modelCapabilityService.getEnforcementRules('qwen3-vl');
// Returns: { maxCvAttempts: 2, allowClickViolations: true, ... }

// Check if strict enforcement
const strictMode = modelCapabilityService.shouldEnforceCvFirst('claude-opus-4'); // true
```

### Configuration

Model profiles are defined in `packages/bytebot-agent/src/models/model-capabilities.config.ts`:
- Exact model name matching
- Pattern-based fuzzy matching
- Default tier assignment (Tier 2) for unknown models
- Per-tier enforcement rules

### Real-World Performance Data

Based on analysis of production sessions:

**GPT-4o Session:**
- 8 assistant messages
- 2 CV detection attempts
- 0 click violations ✅
- Clean workflow with keyboard shortcuts

**Qwen3-VL Session:**
- 21 assistant messages (2.6x more)
- 6 CV detection attempts
- 4 click violations ❌
- Stuck in detect→click loops
- Self-diagnosed loop and requested help

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

# Progressive Zoom
BYTEBOT_PROGRESSIVE_ZOOM_USE_AI=true
BYTEBOT_ZOOM_REFINEMENT=true

# Universal Element Detection
BYTEBOT_UNIVERSAL_TEACHING=true
BYTEBOT_ADAPTIVE_CALIBRATION=true
```

## Computer Vision Pipeline

The bytebot-cv package provides two detection methods:
- **Holo 1.5-7B** (PRIMARY) - Qwen2.5-VL-based UI element localization (cross-platform)
- **OCR** (FALLBACK) - Tesseract.js text extraction

**Note:** OpenCV and OmniParser have been removed to reduce complexity. Holo 1.5-7B provides superior cross-platform semantic understanding trained on Windows, macOS, and Linux UI screenshots.

### CV Services Architecture
Core detection services in `packages/bytebot-cv/src/`:
- `services/enhanced-visual-detector.service.ts` - Holo 1.5 + OCR orchestrator
- `services/holo-client.service.ts` - Holo 1.5-7B REST client
- `services/cv-activity-indicator.service.ts` - Real-time CV activity tracking
- `services/element-detector.service.ts` - Stub (use Holo 1.5 instead)
- `services/visual-pattern-detector.service.ts` - Stub (use Holo 1.5 instead)
- `services/text-semantic-analyzer.service.ts` - OCR text analysis
- `services/universal-detector.service.ts` - Universal element detection
- `detectors/ocr/ocr-detector.ts` - Tesseract.js OCR implementation

### Holo 1.5-7B Integration

**Status: FULL INTEGRATION COMPLETE ✅** (Holo 1.5-7B replaces OmniParser)
**Documentation:** See `packages/bytebot-holo/README.md` for details

Holo 1.5-7B provides cross-platform semantic UI element localization with **full pipeline integration**:

**Core Features (All Implemented):**
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
- Element Coverage: High accuracy across platforms
- Cross-platform: Works identically on Windows/Linux/macOS

**Benchmarks:**
- ScreenSpot-Pro: 57.94 (Holo 1.5-7B) vs 29.00 (Qwen2.5-VL-7B base)
- Trained on ScreenSpot, ScreenSpot-V2, GroundUI-Web, WebClick datasets

Configuration:
```bash
# Holo 1.5-7B Settings
BYTEBOT_CV_USE_HOLO=true
HOLO_URL=http://localhost:9989
HOLO_DEVICE=auto  # auto, cuda, mps (Apple Silicon), or cpu
HOLO_MIN_CONFIDENCE=0.05
HOLO_PERFORMANCE_PROFILE=BALANCED  # SPEED, BALANCED, or QUALITY

# Set-of-Mark Visual Grounding
BYTEBOT_USE_SOM_SCREENSHOTS=true  # Enable numbered element annotations
```

**API Usage:**
```typescript
// Parse screenshot with Holo 1.5-7B
const result = await holoClient.parseScreenshot(buffer, {
  task: 'click on submit button',  // Optional: specific task
  detect_multiple: true,            // Detect multiple elements
  include_som: true,                // Include SOM annotations
  performance_profile: 'BALANCED',  // Performance mode
});

// Result includes rich metadata
console.log(`Elements: ${result.count}`);
console.log(`Processing time: ${result.processing_time_ms}ms`);
console.log(`Model: ${result.model}`); // "holo-1.5-7b"
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
- **OpenCV removed** - system now uses OmniParser (primary) + Tesseract.js (fallback)
- Universal coordinates stored in `config/universal-coordinates.yaml`
- Desktop accuracy metrics available at `/desktop` UI route
- OmniParser requires 8-10GB VRAM (NVIDIA GPU, Apple Silicon M1-M4, or CPU fallback)

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

Three-stage workflow:
1. **Coarse** - Overview with `BYTEBOT_OVERVIEW_GRID` (default: 200px)
2. **Focus** - Zoom into region with `BYTEBOT_FOCUSED_GRID` (default: 25px)
3. **Click** - Final coordinate selection

Configuration via environment variables:
- `BYTEBOT_SMART_FOCUS` - Enable/disable (default: true)
- `BYTEBOT_SMART_FOCUS_MODEL` - Model for focus reasoning (e.g., gpt-4o-mini)
- `BYTEBOT_OVERVIEW_GRID` - Coarse grid size
- `BYTEBOT_REGION_GRID` - Region grid size
- `BYTEBOT_FOCUSED_GRID` - Fine grid size

## Set-of-Mark (SOM) Visual Annotations

**Status:** Phase 1 Complete (backend infrastructure ready)
**Documentation:** See `docs/SOM_IMPLEMENTATION_STATUS.md` for full details

SOM is a visual grounding technique where UI elements are annotated with numbered bounding boxes on screenshots. This allows VLMs to reference elements by visible numbers (e.g., "click element 5") instead of semantic descriptions, significantly improving click accuracy.

### Current Implementation (Phase 1 - DONE)

**Python Service (bytebot-holo):**
- `generate_som_image()` method overlays numbered boxes on screenshots
- API returns `som_image` field with base64-encoded annotated images
- BoxAnnotator from OmniParser's util library handles rendering
- Dynamic sizing based on image resolution

**TypeScript Client (bytebot-cv):**
- `OmniParserClientService.parseScreenshot()` accepts `includeSom: true` (default)
- `OmniParserResponse` interface includes optional `som_image` field
- Client automatically requests SOM images from Python service

### Remaining Work (Phase 2-4)

**Phase 2: Agent Integration** (3-4 hours remaining)
- Create `enhanceScreenshotWithSOM()` utility in `agent.computer-use.ts`
- Add `BYTEBOT_USE_SOM_SCREENSHOTS` environment variable
- Modify screenshot functions to return SOM-annotated images to VLM

**Phase 3: Element Number Mapping** (2-3 hours remaining)
- Store element number→ID mapping when detection runs
- Update `computer_click_element` to accept `element_number` parameter
- Update system prompts in `agent.constants.ts` to explain numbered elements

**Phase 4: Testing** (1-2 hours remaining)
- Verify SOM images display correctly
- Measure click accuracy improvement (target: 20-30% → 70-85%)
- Test edge cases and performance

### Testing SOM Generation

```bash
# Start OmniParser service
cd packages/bytebot-holo
python src/server.py

# Test SOM endpoint
curl -X POST http://localhost:9989/parse \
  -H "Content-Type: application/json" \
  -d '{"image":"<base64_screenshot>","include_som":true}'
```

Response includes `som_image` field with numbered boxes overlaid on detected elements.