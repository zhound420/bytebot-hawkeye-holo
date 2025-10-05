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

# Install minimal CUDA runtime libraries when targeting NVIDIA GPUs
RUN if [ "$TARGETPLATFORM" != "linux/arm64" ]; then \
        set -eux; \
        wget https://developer.download.nvidia.com/compute/cuda/repos/debian12/x86_64/cuda-keyring_1.1-1_all.deb; \
        dpkg -i cuda-keyring_1.1-1_all.deb; \
        rm cuda-keyring_1.1-1_all.deb; \
        apt-get update; \
        apt-get install -y --no-install-recommends cuda-cudart-12-6 libcublas-12-6; \
        rm -rf /var/lib/apt/lists/*; \
    fi

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
        echo "Installing llama-cpp-python CUDA wheel (cu121)..."; \
        pip install --no-cache-dir --prefer-binary \
            --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121 \
            llama-cpp-python>=0.3.0 || { \
            echo "⚠ CUDA wheel install failed, falling back to source build"; \
            CMAKE_ARGS="-DGGML_CUDA=on -DLLAMA_VISION=on" pip install --no-cache-dir llama-cpp-python>=0.3.0 || { \
                echo "⚠ CUDA build failed, falling back to CPU-only llama-cpp-python"; \
                pip install --no-cache-dir llama-cpp-python>=0.3.0; \
            }; \
        }; \
    else \
        echo "Installing llama-cpp-python for ARM64 (CPU-only)"; \
        pip install --no-cache-dir llama-cpp-python>=0.3.0; \
    fi

# Install remaining requirements
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code and runtime scripts
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY pyproject.toml .

# Create cache directory for HuggingFace models (GGUF files will be cached here)
RUN mkdir -p /root/.cache/huggingface

# Expose port
EXPOSE 9989

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:9989/health || exit 1

# Copy startup script with GPU diagnostics
COPY scripts/docker-entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Run the server with diagnostics
CMD ["/app/entrypoint.sh"]
