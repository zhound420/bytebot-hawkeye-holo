#!/usr/bin/env bash
set -o pipefail

echo "========================================"
echo "Holo 1.5-7B GGUF Service Starting"
echo "========================================"
echo

# Prime NVIDIA library paths when the container is started with GPU runtime
nvidia_conf="/etc/ld.so.conf.d/nvidia.conf"
lib_dirs=()
if [ -d "/usr/local/nvidia/lib" ]; then
  lib_dirs+=("/usr/local/nvidia/lib")
fi
if [ -d "/usr/local/nvidia/lib64" ]; then
  lib_dirs+=("/usr/local/nvidia/lib64")
fi

# Always export LD_LIBRARY_PATH so torch can resolve driver libraries when present
export LD_LIBRARY_PATH="/usr/local/nvidia/lib:/usr/local/nvidia/lib64:${LD_LIBRARY_PATH:-}"

if [ ${#lib_dirs[@]} -gt 0 ]; then
  echo "Configuring ldconfig cache for NVIDIA libraries"
  printf "%s\n" "${lib_dirs[@]}" > "${nvidia_conf}"
  ldconfig
fi

# Check for NVIDIA runtime
if [ -d "/proc/driver/nvidia" ]; then
  echo "\u2713 NVIDIA driver detected in container"
  ls -la /proc/driver/nvidia/
else
  echo "\u26a0 No NVIDIA driver in /proc/driver/nvidia"
fi

echo

# Check for NVIDIA devices
if ls /dev/nvidia* >/dev/null 2>&1; then
  echo "\u2713 GPU device nodes available"
  ls -la /dev/nvidia*
else
  echo "\u26a0 No GPU devices found in /dev/"
fi

echo

# Check CUDA libraries
if ldconfig -p | grep -q libcuda.so; then
  echo "\u2713 CUDA libraries found"
  ldconfig -p | grep libcuda
else
  echo "\u26a0 No CUDA libraries in ldconfig"
fi

echo

echo "PyTorch GPU Detection:"
python3 - <<'PY'
import torch
print(f"  CUDA Available: {torch.cuda.is_available()}")
print(f"  CUDA Version: {torch.version.cuda if torch.cuda.is_available() else 'N/A'}")
print(f"  GPU Count: {torch.cuda.device_count() if torch.cuda.is_available() else 0}")
if torch.cuda.is_available():
    for i in range(torch.cuda.device_count()):
        print(f"  GPU {i}: {torch.cuda.get_device_name(i)}")
PY

echo

echo "Model: Holo1.5-7B-GGUF (Q4_K_M quantization)"
echo "Backend: llama-cpp-python with GPU acceleration"
echo "Models will be downloaded from HuggingFace on first request"
echo "========================================"
echo "Starting Holo Service..."
echo "========================================"

echo

# Start the actual service
exec python -m src.server
