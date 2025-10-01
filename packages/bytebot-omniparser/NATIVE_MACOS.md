# Running OmniParser Natively on Apple Silicon

Docker Desktop on macOS doesn't support Metal Performance Shaders (MPS) passthrough to containers. For GPU acceleration on Apple Silicon (M1-M4), run OmniParser natively outside Docker.

## Performance Comparison

| Environment | Device | Performance |
|-------------|--------|-------------|
| Native macOS | MPS (M1-M4 GPU) | **~1-2s per frame** ✨ |
| Docker on Apple Silicon | CPU | ~8-15s per frame ⚠️ |
| Docker on NVIDIA | CUDA GPU | ~0.6s per frame ⚡ |

## Setup Instructions

### 1. Install Dependencies

```bash
cd packages/bytebot-omniparser

# Option A: Using Conda (Recommended)
bash scripts/setup.sh

# Option B: Using venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Download Models (~1GB)

```bash
source venv/bin/activate  # or: conda activate omniparser
bash scripts/download_models.sh
```

### 3. Configure Device

```bash
# Set MPS (Apple Silicon GPU)
export OMNIPARSER_DEVICE=mps

# Or use auto-detection (recommended)
export OMNIPARSER_DEVICE=auto
```

### 4. Start OmniParser Service

```bash
source venv/bin/activate  # or: conda activate omniparser
python -m src.server
```

The service will start on `http://localhost:9989`

### 5. Connect from Docker Stack

Update `docker/.env`:

```bash
# Point to native OmniParser instead of container
OMNIPARSER_URL=http://host.docker.internal:9989
```

**On Linux:** Use `http://172.17.0.1:9989` instead of `host.docker.internal`

### 6. Start Docker Stack (without OmniParser container)

```bash
cd docker

# Standard stack (excludes bytebot-omniparser service)
docker compose up -d bytebot-desktop bytebot-agent bytebot-ui postgres

# Proxy stack
docker compose -f docker-compose.proxy.yml up -d bytebot-desktop bytebot-agent bytebot-ui bytebot-llm-proxy postgres
```

## Verification

Test OmniParser health:

```bash
curl http://localhost:9989/health
```

Expected response:
```json
{
  "status": "healthy",
  "device": "mps",
  "models_loaded": true
}
```

## Troubleshooting

### MPS Not Available

**Error:** `MPS backend is not available`

**Solution:** Ensure you're running natively (not in Docker) and have macOS 12.3+

```bash
python3 -c "import torch; print(f'MPS available: {torch.backends.mps.is_available()}')"
```

### Out of Memory

**Error:** `RuntimeError: MPS backend out of memory`

**Solution:** Reduce model precision or batch size:

```bash
export OMNIPARSER_MODEL_DTYPE=float32  # Use float32 instead of float16
```

### Port Conflict

**Error:** `Address already in use: 9989`

**Solution:** Change port or kill existing process:

```bash
export OMNIPARSER_PORT=9988
# Or find and kill:
lsof -ti:9989 | xargs kill -9
```

## Performance Tuning

### Model Precision

```bash
# float16 (default) - faster, less memory
export OMNIPARSER_MODEL_DTYPE=float16

# float32 - slower, more accurate
export OMNIPARSER_MODEL_DTYPE=float32
```

### Confidence Threshold

```bash
# Lower = more detections (slower)
export OMNIPARSER_MIN_CONFIDENCE=0.2

# Higher = fewer detections (faster)
export OMNIPARSER_MIN_CONFIDENCE=0.5
```

## Autostart with launchd (Optional)

Create `~/Library/LaunchAgents/com.bytebot.omniparser.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bytebot.omniparser</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/YOUR_USERNAME/path/to/venv/bin/python</string>
        <string>-m</string>
        <string>src.server</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/YOUR_USERNAME/path/to/bytebot-hawkeye-cv/packages/bytebot-omniparser</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/omniparser.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/omniparser.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>OMNIPARSER_DEVICE</key>
        <string>auto</string>
    </dict>
</dict>
</plist>
```

Load the service:

```bash
launchctl load ~/Library/LaunchAgents/com.bytebot.omniparser.plist
```

## Hybrid Setup (Best of Both Worlds)

Run OmniParser natively for GPU acceleration while keeping the rest of the stack in Docker:

```
┌─────────────────────────────────────┐
│         Native macOS                │
│  ┌──────────────────────────────┐  │
│  │  OmniParser (MPS GPU)        │  │
│  │  Port: 9989                  │  │
│  └──────────────────────────────┘  │
└─────────────────┬───────────────────┘
                  │ http://host.docker.internal:9989
┌─────────────────┴───────────────────┐
│         Docker Desktop              │
│  ┌──────────────────────────────┐  │
│  │  bytebot-desktop (bytebotd)  │  │
│  │  bytebot-agent (NestJS)      │  │
│  │  bytebot-ui (Next.js)        │  │
│  │  postgres                    │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
```

This gives you:
- ✅ MPS GPU acceleration for OmniParser (~1-2s/frame)
- ✅ Easy Docker management for main stack
- ✅ No container complexity for Python/PyTorch
