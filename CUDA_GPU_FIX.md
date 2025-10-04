# CUDA GPU Not Detected - Quick Fix

## Problem
OmniParser container logs show:
```
⚠ No GPU acceleration available - using CPU on x86_64
PyTorch Version: 2.5.1+cu121
CUDA Available: False
```

PyTorch has CUDA support but can't detect GPU inside container.

## Root Cause
Docker not passing GPU access to containers despite nvidia-container-toolkit being installed.

---

## Fix Steps (Run on CUDA PC)

### 1. Run Diagnostics
```bash
./scripts/diagnose-cuda.sh
```

This will identify the specific issue. Common results:

#### If "nvidia-smi not found":
```bash
# Install NVIDIA drivers first
sudo ubuntu-drivers autoinstall
sudo reboot
```

#### If "nvidia-container-toolkit not installed":
```bash
# Ubuntu/Debian
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
```

### 2. Configure Docker Daemon

**Create/edit `/etc/docker/daemon.json`:**

```bash
sudo tee /etc/docker/daemon.json > /dev/null <<EOF
{
  "runtimes": {
    "nvidia": {
      "path": "nvidia-container-runtime",
      "runtimeArgs": []
    }
  },
  "default-runtime": "nvidia"
}
EOF
```

**Restart Docker:**
```bash
sudo systemctl restart docker
```

### 3. Test Docker GPU Access

```bash
# This should show your GPU
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi

# Should output something like:
# +-----------------------------------------------------------------------------+
# | NVIDIA-SMI 535.86.10    Driver Version: 535.86.10    CUDA Version: 12.2     |
# |-------------------------------+----------------------+----------------------+
# | GPU  Name        Persistence-M| Bus-Id        Disp.A | Volatile Uncorr. ECC |
# | Fan  Temp  Perf  Pwr:Usage/Cap|         Memory-Usage | GPU-Util  Compute M. |
# |===============================+======================+======================|
# |   0  NVIDIA GeForce ...  Off  | 00000000:01:00.0  On |                  N/A |
# | 30%   45C    P8    12W / 350W |    573MiB / 24576MiB |      0%      Default |
# +-------------------------------+----------------------+----------------------+
```

### 4. Rebuild OmniParser Container

```bash
cd docker

# Stop and remove old container
docker compose down bytebot-holo

# Clear any cached layers
docker builder prune -f

# Rebuild from scratch
docker compose build --no-cache bytebot-holo

# Start services
docker compose up -d
```

### 5. Verify GPU Detection

```bash
# Check startup logs
docker logs bytebot-holo | grep -A 15 "GPU Diagnostics"

# Should now show:
#   PyTorch Version: 2.5.1+cu121
#   CUDA Available: True          ← This should be True now!
#   CUDA Version: 12.1
#   GPU Count: 1
#   GPU 0: NVIDIA GeForce RTX 3090

# Run verification script
docker exec bytebot-holo python /app/scripts/verify-gpu.py

# Should show:
#   ✓ GPU Acceleration Available
```

---

## Alternative: Use Docker Compose v1 Syntax

If the above doesn't work, try using older GPU syntax:

**Edit `docker/docker-compose.override.yml`:**

```yaml
  bytebot-holo:
    platform: linux/amd64
    runtime: nvidia  # Add this line
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=compute,utility
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

Then rebuild:
```bash
docker compose down bytebot-holo
docker compose up -d --build bytebot-holo
```

---

## Troubleshooting

### "docker: Error response from daemon: could not select device driver"

**Fix:** Install nvidia-container-toolkit (see step 1)

### "Failed to initialize NVML: Driver/library version mismatch"

**Fix:** Reboot after driver install
```bash
sudo reboot
```

### Docker can access GPU but container still shows CPU

**Check if compose is using GPU config:**
```bash
docker inspect bytebot-holo | grep -i nvidia

# Should show:
#   "Runtime": "nvidia",
# OR
#   "DeviceRequests": [...]
```

**If nothing shows, force GPU access:**
```bash
# Stop container
docker compose down bytebot-holo

# Start with explicit GPU flag
docker run --rm --gpus all \
  --name bytebot-holo-test \
  -p 9989:9989 \
  -e HOLO_DEVICE=auto \
  bytebot-holo:local

# Check logs
docker logs -f bytebot-holo-test
```

---

## Expected Performance After Fix

| Metric | Before (CPU) | After (CUDA) | Improvement |
|--------|--------------|--------------|-------------|
| Detection Speed | ~8-15s/frame | ~0.6s/frame | **13x faster** |
| CUDA Available | False ❌ | True ✅ | Fixed |
| GPU Utilization | 0% | 40-60% | Active |

---

## Still Not Working?

1. **Check Docker version:**
   ```bash
   docker --version  # Should be >= 19.03
   docker compose version  # Use v2 (not docker-compose)
   ```

2. **Check NVIDIA driver:**
   ```bash
   nvidia-smi
   # Driver version should be >= 450.80.02 for CUDA 12.1
   ```

3. **Check kernel modules:**
   ```bash
   lsmod | grep nvidia
   # Should show nvidia, nvidia_uvm, nvidia_drm, etc.
   ```

4. **Full system restart:**
   ```bash
   sudo systemctl restart docker
   sudo reboot
   ```

5. **Contact support:**
   - Provide output of: `./scripts/diagnose-cuda.sh`
   - Docker logs: `docker logs bytebot-holo`
   - GPU test: `docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi`
