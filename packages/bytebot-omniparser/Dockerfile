FROM python:3.12-slim

# Get build platform for architecture-specific optimizations
ARG TARGETPLATFORM
ARG BUILDPLATFORM

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    wget \
    curl \
    libgl1 \
    libglib2.0-0 \
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
        pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu; \
    else \
        echo "Building for AMD64 - installing CUDA 12.1 PyTorch"; \
        pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu121; \
    fi

# Install remaining requirements
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY pyproject.toml .

# Clone OmniParser repository
RUN git clone https://github.com/microsoft/OmniParser.git

# Create weights directory
RUN mkdir -p weights

# Download models (this will be done at build time)
# In production, you might want to mount these or download at runtime
RUN chmod +x scripts/download_models.sh && \
    bash scripts/download_models.sh || echo "Model download skipped - will download at runtime"

# Expose port
EXPOSE 9989

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:9989/health || exit 1

# Run the server
CMD ["python", "-m", "src.server"]
