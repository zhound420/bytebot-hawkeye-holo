FROM python:3.12-slim

# Get build platform for architecture-specific optimizations
ARG TARGETPLATFORM
ARG BUILDPLATFORM

# Install system dependencies (minimal for transformers)
RUN apt-get update && apt-get install -y \
    wget \
    curl \
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

# Install transformers and dependencies from requirements.txt
# transformers>=4.40.0 provides official Holo 1.5-7B support
# accelerate>=0.25.0 for efficient model loading
RUN pip install --no-cache-dir -r requirements.txt

# Verify transformers installation
RUN python -c "import transformers; print(f'✓ Transformers {transformers.__version__} installed')"

# Copy application code and runtime scripts
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY pyproject.toml .

# Create cache directory for HuggingFace models (transformers will cache models here)
# Holo 1.5-7B model (~14GB) will be downloaded on first API request
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
