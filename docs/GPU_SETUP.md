# GPU Setup Guide

This guide explains how to enable GPU acceleration for OmniParser on different platforms.

## Apple Silicon (M1-M4)

**TL;DR**: Use native execution, not Docker.

### Why?

Docker Desktop on macOS **cannot** pass through Metal/MPS to containers. The only way to use Apple Silicon GPU is to run OmniParser natively on the host.

### Setup

```bash
# Automatic setup
./scripts/setup-omniparser.sh
./scripts/start-omniparser.sh
./scripts/start-stack.sh  # Auto-detects native OmniParser
```

### Performance

- **Native with MPS**: ~1-2s per frame ✅ (GPU-accelerated)
- **Docker with CPU**: ~8-15s per frame ❌ (slow)

---

## NVIDIA GPU (Linux/Windows)

**TL;DR**: Install nvidia-container-toolkit, then use Docker.

### Prerequisites

1. **NVIDIA GPU** with CUDA support
2. **nvidia-container-toolkit** installed on host
3. **Docker** version 19.03+ with GPU support

### Install nvidia-container-toolkit

#### Ubuntu/Debian

```bash
# Add NVIDIA package repository
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

# Install
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit

# Configure Docker
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# Test
sudo docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

#### Other Distributions

See: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html

### Verify GPU Detection

```bash
# Check if NVIDIA GPU is available
nvidia-smi

# Test GPU in Docker
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

### Start Stack with Automatic GPU

```bash
# Standard setup - auto-detects GPU
./scripts/setup-omniparser.sh
./scripts/start-stack.sh
```

**GPU configuration is now automatic!** The `docker/docker-compose.override.yml` file (automatically loaded) includes GPU configuration that:
- Uses NVIDIA GPU if nvidia-container-toolkit is installed
- Gracefully falls back to CPU if not available
- No errors if GPU not present

The override file includes:

```yaml
services:
  bytebot-omniparser:
    platform: linux/amd64
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

**Note:** `docker-compose.gpu.yml` is now redundant but kept for backward compatibility. The GPU config is in `docker-compose.override.yml` by default.

### Check OmniParser GPU Usage

```bash
# View container logs
docker logs bytebot-omniparser 2>&1 | grep -i "cuda\|gpu\|device"

# Expected output with GPU:
# ✓ CUDA available: 1 GPU(s) - NVIDIA GeForce RTX 3090
# → Auto-detected device: cuda

# Expected output without GPU:
# ⚠ No GPU acceleration available - using CPU on x86_64
# → Auto-detected device: cpu
```

### Performance

- **Docker with CUDA**: ~0.6s per frame ✅ (GPU-accelerated)
- **Docker with CPU**: ~8-15s per frame ❌ (slow fallback)

---

## Troubleshooting

### Mac: OmniParser container is running

If you see the OmniParser container running on Mac:

```bash
# Stop and remove the container
docker compose -f docker/docker-compose.proxy.yml stop bytebot-omniparser
docker compose -f docker/docker-compose.proxy.yml rm -f bytebot-omniparser

# Verify only native OmniParser is running
lsof -i :9989  # Should show Python process, not Docker
```

### PC: GPU not detected in container

```bash
# 1. Verify nvidia-container-toolkit is installed
nvidia-container-toolkit --version

# 2. Verify Docker can access GPU
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi

# 3. Check Docker daemon.json
cat /etc/docker/daemon.json
# Should contain:
# {
#   "runtimes": {
#     "nvidia": {
#       "path": "nvidia-container-runtime",
#       "runtimeArgs": []
#     }
#   }
# }

# 4. Restart Docker
sudo systemctl restart docker

# 5. Use explicit GPU overlay if automatic doesn't work
docker compose -f docker/docker-compose.proxy.yml -f docker/docker-compose.gpu.yml up -d --build
```

### Container shows "No GPU acceleration available"

**On Mac**: This is expected - use native execution instead.

**On PC**:
1. Verify nvidia-container-toolkit is installed: `nvidia-container-toolkit --version`
2. Restart Docker daemon: `sudo systemctl restart docker`
3. Rebuild OmniParser container to apply GPU config:
   ```bash
   docker compose -f docker/docker-compose.proxy.yml down bytebot-omniparser
   docker compose -f docker/docker-compose.proxy.yml up -d bytebot-omniparser
   ```
4. Check if GPU is being used:
   ```bash
   docker exec bytebot-omniparser python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"
   # Should output: CUDA available: True
   ```

### Performance is slow

Check which device OmniParser is using:

```bash
docker logs bytebot-omniparser 2>&1 | grep "Auto-detected device"
```

- `device: cuda` → GPU-accelerated ✅
- `device: mps` → GPU-accelerated (native Mac only) ✅
- `device: cpu` → Not using GPU ❌

---

## Summary

| Platform | Method | Performance | Setup |
|----------|--------|-------------|-------|
| **Apple Silicon** | Native OmniParser | ~1-2s/frame ✅ | `./scripts/setup-omniparser.sh` |
| **Apple Silicon** | Docker (CPU fallback) | ~8-15s/frame ❌ | Not recommended |
| **NVIDIA GPU** | Docker with CUDA | ~0.6s/frame ✅ | Install nvidia-container-toolkit |
| **x86_64 CPU** | Docker with CPU | ~8-15s/frame ⚠️ | Works everywhere, slow |

**Recommendation**:
- Mac M1-M4: Always use native execution
- PC with NVIDIA: Install nvidia-container-toolkit and use Docker
- PC without GPU: Accept CPU performance or get a GPU
