FROM python:3.12-slim

# Get build platform for architecture-specific optimizations
ARG TARGETPLATFORM
ARG BUILDPLATFORM

# Install system dependencies (including build tools for llama-cpp-python)
RUN apt-get update && apt-get install -y \
    git \
    wget \
    curl \
    build-essential \
    cmake \
    libopenblas-dev \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install PyTorch based on target platform
# arm64 (Apple Silicon in Docker): CPU-only since MPS doesn't pass through
# amd64 (x86_64): Full CUDA support (12.1 - backward compatible with 11.8+)
RUN if [ "$TARGETPLATFORM" = "linux/arm64" ]; then \
        echo "Building for ARM64 - installing CPU-only PyTorch"; \
        pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu; \
    else \
        echo "Building for AMD64 - installing CUDA 12.1 PyTorch"; \
        pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu121; \
    fi

# Install llama-cpp-python with CUDA support for amd64, CPU-only for arm64
# This will compile llama.cpp with GPU acceleration on supported platforms
RUN if [ "$TARGETPLATFORM" != "linux/arm64" ]; then \
        echo "Installing llama-cpp-python with CUDA support..."; \
        CMAKE_ARGS="-DGGML_CUDA=on" pip install --no-cache-dir llama-cpp-python>=0.3.0 || { \
            echo "⚠ CUDA build failed, falling back to CPU-only llama-cpp-python"; \
            pip install --no-cache-dir llama-cpp-python>=0.3.0; \
        }; \
    else \
        echo "Installing llama-cpp-python for ARM64 (CPU-only)"; \
        pip install --no-cache-dir llama-cpp-python>=0.3.0; \
    fi

# Install remaining requirements
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src/ ./src/
COPY pyproject.toml .

# Create cache directory for HuggingFace models (GGUF files will be cached here)
RUN mkdir -p /root/.cache/huggingface

# Expose port
EXPOSE 9989

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:9989/health || exit 1

# Create startup script with GPU diagnostics
RUN echo '#!/bin/bash\n\
echo "========================================"\n\
echo "Holo 1.5-7B GGUF Service Starting"\n\
echo "========================================"\n\
\n\
# Check for NVIDIA runtime\n\
if [ -d "/proc/driver/nvidia" ]; then\n\
    echo "✓ NVIDIA driver detected in container"\n\
    ls -la /proc/driver/nvidia/\n\
else\n\
    echo "⚠ No NVIDIA driver in /proc/driver/nvidia"\n\
fi\n\
\n\
# Check for NVIDIA devices\n\
if [ -e "/dev/nvidia0" ]; then\n\
    echo "✓ GPU device /dev/nvidia0 available"\n\
    ls -la /dev/nvidia*\n\
else\n\
    echo "⚠ No GPU devices found in /dev/"\n\
fi\n\
\n\
# Check CUDA libraries\n\
if ldconfig -p | grep -q libcuda.so; then\n\
    echo "✓ CUDA libraries found"\n\
    ldconfig -p | grep libcuda\n\
else\n\
    echo "⚠ No CUDA libraries in ldconfig"\n\
fi\n\
\n\
# Run PyTorch GPU check\n\
echo ""\n\
echo "PyTorch GPU Detection:"\n\
python3 -c "import torch; print(f\"  CUDA Available: {torch.cuda.is_available()}\"); print(f\"  CUDA Version: {torch.version.cuda if torch.cuda.is_available() else \"N/A\"}\"); print(f\"  GPU Count: {torch.cuda.device_count() if torch.cuda.is_available() else 0}\"); [print(f\"  GPU {i}: {torch.cuda.get_device_name(i)}\") for i in range(torch.cuda.device_count())] if torch.cuda.is_available() else None"\n\
\n\
echo ""\n\
echo "Model: Holo1.5-7B-GGUF (Q4_K_M quantization)"\n\
echo "Backend: llama-cpp-python with GPU acceleration"\n\
echo "Models will be downloaded from HuggingFace on first request"\n\
echo "========================================"\n\
echo "Starting Holo Service..."\n\
echo "========================================"\n\
\n\
# Start the actual service\n\
exec python -m src.server\n\
' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Run the server with diagnostics
CMD ["/app/entrypoint.sh"]
