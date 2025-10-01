FROM python:3.12-slim

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
