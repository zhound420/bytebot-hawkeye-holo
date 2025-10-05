# Bytebot Holo 1.5 Integration

Holo 1.5-7B (GGUF) localisation service for the Hawkeye desktop agent. The service wraps the Qwen2.5-VL based model distributed by the Holo project and exposes a REST API for click target discovery. The legacy OmniParser documentation is retained further below for historical context; the active pipeline now defaults to Holo.

## Quick Start (Holo 1.5)

```bash
cd packages/bytebot-holo
bash scripts/download_holo_models.sh          # grabs GGUF + projector (~5.5 GB)
export HOLO_MODEL_PATH="$PWD/weights/holo1.5/Holo1.5-7B.Q4_K_M.gguf"
export HOLO_MMPROJ_PATH="$PWD/weights/holo1.5/mmproj-Q8_0.gguf"
pip install -r requirements.txt               # or add to existing env
# Optional GPU acceleration
#   NVIDIA: CMAKE_ARGS="-DLLAMA_CUBLAS=on" pip install --force-reinstall llama-cpp-python
#   Apple M-series: CMAKE_ARGS="-DLLAMA_METAL=on" pip install --force-reinstall llama-cpp-python
python src/server.py
```

Set `HOLO_DEVICE=cuda|mps|cpu` to pin the runtime; omit to auto-detect.

---

# Bytebot OmniParser Integration

## Features

- **YOLOv8 Icon Detection**: Fine-tuned for UI element detection
- **Florence-2 Captioning**: Semantic descriptions of UI elements
- **REST API**: FastAPI service with OpenAPI documentation
- **GPU Support**: CUDA, Apple MPS (M1-M4), and CPU fallback
- **Fast Processing**: ~0.6s/frame on A100, optimized for real-time use

## Architecture

```
┌─────────────────────────────────────┐
│  FastAPI REST Service (Port 9989)   │
│  ├─ POST /parse (base64 image)     │
│  ├─ POST /parse/upload (file)       │
│  ├─ GET /health                      │
│  └─ GET /models/status              │
└─────────────────────────────────────┘
              │
    ┌─────────┴─────────┐
    │                   │
┌───▼────┐      ┌──────▼─────┐
│ YOLOv8 │      │ Florence-2 │
│ Icon   │      │ Caption    │
│ Detect │      │ Model      │
└────────┘      └────────────┘
```

## Setup

### 1. Run Setup Script (Recommended)

```bash
cd packages/bytebot-holo
bash scripts/setup.sh
```

This will:
- Create conda environment or Python venv
- Install dependencies (including openai, supervision for SOM)
- Clone OmniParser repository
- **Apply PaddleOCR 3.x compatibility patch** (automated)
- Download model weights (~850MB)

### 2. Manual Setup (Alternative)

```bash
# Create environment
conda env create -f environment.yml
conda activate omniparser

# OR use venv
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Clone OmniParser
git clone https://github.com/microsoft/OmniParser.git

# IMPORTANT: Apply PaddleOCR 3.x compatibility patch
bash scripts/patch-paddleocr.sh

# Download models
bash scripts/download_models.sh
```

**Note:** The patch script fixes PaddleOCR initialization for version 3.x compatibility. Required if setting up manually.

## Usage

### Start the Service

```bash
conda activate omniparser  # or: source venv/bin/activate
python src/server.py
```

Service runs on `http://localhost:9989`

### Test the API

```bash
# Health check
curl http://localhost:9989/health

# Model status
curl http://localhost:9989/models/status

# Parse screenshot (file upload)
curl -X POST http://localhost:9989/parse/upload \
  -F "file=@screenshot.png" \
  -F "include_captions=true"

# Parse screenshot (base64)
curl -X POST http://localhost:9989/parse \
  -H "Content-Type: application/json" \
  -d '{
    "image": "<base64_encoded_image>",
    "include_captions": true,
    "min_confidence": 0.3
  }'
```

### Example Response

```json
{
  "elements": [
    {
      "bbox": [100, 200, 80, 40],
      "center": [140, 220],
      "confidence": 0.95,
      "type": "interactive_element",
      "caption": "login button"
    }
  ],
  "count": 1,
  "processing_time_ms": 612.5,
  "image_size": {"width": 1920, "height": 1080},
  "device": "cuda"
}
```

## Configuration

Environment variables (prefix with `HOLO_` unless noted):

```bash
# Service
HOLO_HOST=0.0.0.0
HOLO_PORT=9989
HOLO_WORKERS=1

# Device
HOLO_DEVICE=cuda  # cuda, mps, cpu (auto-detected)

# Detection
HOLO_MIN_CONFIDENCE=0.3
HOLO_MAX_DETECTIONS=100

# Performance
HOLO_MODEL_DTYPE=float16  # float16, float32, bfloat16
                                 # Note: Automatically uses float32 on Apple Silicon MPS
HOLO_CACHE_MODELS=true

# Optional: point at pre-downloaded GGUF files
HOLO_MODEL_PATH=/abs/path/to/Holo1.5-7B.Q4_K_M.gguf
HOLO_MMPROJ_PATH=/abs/path/to/mmproj-Q8_0.gguf
```

## Integration with Bytebot

The TypeScript client service in `bytebotd` calls this REST API:

```typescript
// packages/bytebotd/src/omniparser/omniparser-client.service.ts
const result = await omniParserClient.parseScreenshot(imageBuffer);
```

Integrated into `EnhancedVisualDetectorService` as the fifth detection method alongside template matching, feature detection, contour detection, and OCR.

## Model Details

### Icon Detection (YOLOv8)
- **Size**: ~50MB
- **Architecture**: YOLOv8 fine-tuned on UI data
- **License**: AGPL-3.0

### Caption Model (Florence-2)
- **Size**: ~800MB
- **Architecture**: Florence-2 Base
- **License**: MIT

## Hardware Requirements

- **Minimum**: 4GB RAM, CPU only (slower)
- **Recommended**: 8GB VRAM (NVIDIA GPU or Apple Silicon M1-M4)
- **Optimal**: A100 GPU (~0.6s/frame)

## Performance

- **A100 GPU**: ~0.6s per frame
- **M1 Max**: ~1.2s per frame (estimated)
- **CPU**: ~3-5s per frame (not recommended for real-time)

## Troubleshooting

### Models not found
```bash
bash scripts/download_models.sh
```

### CUDA out of memory
```bash
export HOLO_MODEL_DTYPE=float32
export OMNIPARSER_MAX_DETECTIONS=50
```

### Apple Silicon MPS dtype mismatch
**Fixed automatically** - Service now uses float32 on MPS to avoid "Input type (float) and bias type (c10::Half)" errors. No configuration needed.

### PaddleOCR "Unknown argument" errors
**Fixed automatically** - The setup script now applies a compatibility patch for PaddleOCR 3.x. If you see `ValueError: Unknown argument: use_gpu`, run:
```bash
bash scripts/patch-paddleocr.sh
```

### NVIDIA GPU not detected in container
1. Confirm Docker is passing the device: `docker compose config bytebot-holo | grep -A2 DeviceRequests` should list the NVIDIA capabilities.
2. Restart the service: `docker compose up -d --build bytebot-holo` and check startup logs for `✓ GPU device nodes available` and `✓ CUDA libraries found`.
3. Run an explicit check: `docker exec bytebot-holo python /app/scripts/verify-gpu.py` should exit with `Status: GPU Acceleration Available ✓`.

### Apple Silicon: Service crashes on startup
If service fails with import errors, ensure all dependencies are installed:
```bash
source venv/bin/activate  # or: conda activate omniparser
pip install -r requirements.txt  # includes openai, supervision
```

## API Documentation

Interactive API docs available at:
- Swagger UI: `http://localhost:9989/docs`
- ReDoc: `http://localhost:9989/redoc`

## License

This integration package: MIT

OmniParser models:
- Icon detection: AGPL-3.0
- Caption models: MIT

See [Microsoft OmniParser](https://github.com/microsoft/OmniParser) for details.
