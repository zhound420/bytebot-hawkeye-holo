# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

Bytebot Hawkeye is a precision-enhanced fork of the open-source AI Desktop Agent platform. It consists of these main packages:

1. **bytebot-agent** - NestJS service that orchestrates AI tasks, computer use, and precision targeting
2. **bytebot-agent-cc** - Claude Code integration variant with `@anthropic-ai/claude-code` SDK
3. **bytebot-ui** - Next.js frontend with desktop dashboard and task management
4. **bytebotd** - Desktop daemon providing computer control with enhanced coordinate accuracy
5. **bytebot-cv** - Computer vision package with OpenCV bindings for element detection
6. **bytebot-omniparser** - Python FastAPI service for semantic UI detection via OmniParser v2.0
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
- **Universal element detection**: CV pipeline with visual pattern detection + OCR enrichment
- **Coordinate telemetry**: Accuracy metrics and adaptive calibration
- **Grid overlay guidance**: Always-on coordinate grids with debug overlays

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

npm run build              # TypeScript compilation
npm run dev                # Watch mode
npm run verify             # Check OpenCV capabilities
npm run patch              # Patch OpenCV bindings

# Note: postinstall automatically runs:
# - patch-opencv-binding.js
# - strip-opencv-tracking.js
# - verify-opencv-capabilities.js
```

### bytebot-llm-proxy (LiteLLM Proxy)
```bash
cd packages/bytebot-llm-proxy

# Configuration in litellm-config.yaml
# Provides unified API routing for OpenAI, Anthropic, Gemini, OpenRouter, LMStudio
# Environment variables: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY
```

### bytebot-omniparser (Python Service)
```bash
cd packages/bytebot-omniparser

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

> **Note**: To disable OmniParser (e.g., on systems without GPU), set `BYTEBOT_CV_USE_OMNIPARSER=false` in `docker/.env`

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
- bytebot-omniparser: 9989 (OmniParser service)
- PostgreSQL: 5432

## OmniParser Platform Support

OmniParser v2.0 provides semantic UI detection using YOLOv8 + Florence-2 models. Performance varies by platform:

### Docker (Multi-Architecture)

| Platform | Device | Performance | Notes |
|----------|--------|-------------|-------|
| x86_64 (Intel/AMD) + NVIDIA GPU | CUDA | ~0.6s/frame ⚡ | **Recommended for production** |
| x86_64 (Intel/AMD) CPU-only | CPU | ~8-15s/frame | Works but slow |
| ARM64 (Apple Silicon) in Docker | CPU | ~8-15s/frame ⚠️ | **MPS not available in containers** |

**Auto-detection**: Set `OMNIPARSER_DEVICE=auto` (default) to automatically use the best available device.

### Native Execution (Apple Silicon)

For GPU acceleration on Apple Silicon (M1-M4), run OmniParser **natively outside Docker**:

- **Performance**: ~1-2s/frame with MPS (Metal Performance Shaders)
- **Setup Guide**: See `packages/bytebot-omniparser/NATIVE_MACOS.md`
- **Architecture**: Run OmniParser natively, connect from Docker via `host.docker.internal:9989`

**Why native?** Docker Desktop on macOS doesn't pass through MPS/Metal GPU access to containers.

### Configuration

```bash
# docker/.env
OMNIPARSER_DEVICE=auto  # Recommended: auto-detect (cuda > mps > cpu)
# OMNIPARSER_DEVICE=cpu   # Force CPU (slower but works everywhere)
# OMNIPARSER_DEVICE=cuda  # Force NVIDIA GPU (x86_64 only)
```

### Disabling OmniParser

To disable OmniParser and use only classical CV methods:

```bash
# docker/.env
BYTEBOT_CV_USE_OMNIPARSER=false
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

The bytebot-cv package provides five detection methods:
- **Template Matching** - Multi-scale OpenCV template matching
- **Feature Detection** - ORB/AKAZE feature-based matching
- **Contour Detection** - Morphological shape analysis
- **OCR** - Tesseract.js text extraction with preprocessing
- **OmniParser** (NEW) - Semantic UI detection via YOLOv8 + Florence-2

### CV Services Architecture
Core detection services in `packages/bytebot-cv/src/`:
- `services/enhanced-visual-detector.service.ts` - Multi-method orchestrator (5 methods)
- `services/omniparser-client.service.ts` - OmniParser REST client
- `services/element-detector.service.ts` - Universal element detection
- `services/visual-pattern-detector.service.ts` - Pattern recognition
- `services/text-semantic-analyzer.service.ts` - OCR text analysis
- `services/cv-activity-indicator.service.ts` - Real-time CV activity tracking
- `detectors/template/template-matcher.service.ts` - Template matching
- `detectors/feature/feature-matcher.service.ts` - ORB/AKAZE feature detection
- `detectors/contour/contour-detector.service.ts` - Shape-based detection

### OmniParser Integration
OmniParser v2.0 provides semantic UI element detection:
- **YOLOv8 Icon Detection** - ~50MB model, fine-tuned for UI elements
- **Florence-2 Captioning** - ~800MB model, generates functional descriptions
- **Performance** - ~0.6s/frame on A100, ~1-2s on consumer GPUs
- **Accuracy** - 39.6% on ScreenSpot Pro benchmark
- **License** - AGPL (icon detection), MIT (captioning)

Configuration:
```bash
BYTEBOT_CV_USE_OMNIPARSER=true
OMNIPARSER_URL=http://localhost:9989
OMNIPARSER_DEVICE=cuda  # cuda, mps (Apple Silicon), or cpu
OMNIPARSER_MIN_CONFIDENCE=0.3
```

## Testing

All NestJS packages use Jest:
- Test files: `*.spec.ts`
- E2E tests: `test/jest-e2e.json` config
- UI tests: Native Node.js test runner

## Key Technical Notes

- Node.js ≥20.0.0 required for all packages (Python 3.12 for bytebot-omniparser)
- TypeScript strict mode enabled
- Monorepo structure requires building shared package first
- OpenCV capabilities checked at startup with compatibility matrix
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