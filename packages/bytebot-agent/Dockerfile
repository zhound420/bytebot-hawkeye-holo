# =============================================================================
# ByteBot Agent Dockerfile - Fixed for Node 20 and streamlined builds
# =============================================================================

# Use Node 20 with OpenCV pre-built capabilities
FROM node:20-bullseye AS base

# Install system dependencies including OpenCV and Canvas dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    dpkg-dev \
    tesseract-ocr \
    tesseract-ocr-eng \
    # OpenCV dependencies (as specified in bytebot-cv requirements)
    libopencv-dev \
    libopencv-contrib-dev \
    python3-opencv \
    # Canvas/Cairo dependencies
    libcairo2-dev \
    libpango1.0-dev \
    libpangocairo-1.0-0 \
    libglib2.0-dev \
    libfontconfig1-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    pkg-config \
    # Additional build tools
    build-essential \
    cmake \
    git \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files for dependency resolution
COPY package.json ./
COPY ./packages ./packages
COPY ./config/universal-coordinates.yaml ./config/universal-coordinates.yaml

# Set environment variables (including OpenCV build requirements from bytebot-cv)
ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=warn \
    OPENCV4NODEJS_SKIP_TRACKING=1 \
    CXXFLAGS="-DOPENCV_ENABLE_NONFREE"

# Check OpenCV installation and set library paths
RUN echo "=== Checking OpenCV installation ===" && \
    echo "Architecture: $(uname -m)" && \
    echo "Searching for OpenCV libraries..." && \
    find /usr -name "*opencv*" -type f 2>/dev/null | head -20 && \
    echo "Checking pkg-config..." && \
    pkg-config --modversion opencv4 || echo "pkg-config opencv4 not found" && \
    echo "Listing /usr/lib directories..." && \
    ls -la /usr/lib/ | grep -E "(x86_64|aarch64|arm)" || echo "No arch-specific lib dirs found"

# Set OpenCV library paths based on architecture
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then \
        OPENCV_LIB_DIR="/usr/lib/x86_64-linux-gnu"; \
    elif [ "$ARCH" = "aarch64" ]; then \
        OPENCV_LIB_DIR="/usr/lib/aarch64-linux-gnu"; \
    else \
        OPENCV_LIB_DIR="/usr/lib"; \
    fi && \
    echo "OPENCV_LIB_DIR=$OPENCV_LIB_DIR" >> /etc/environment && \
    echo "Set OpenCV paths: LIB=$OPENCV_LIB_DIR, INCLUDE=/usr/include/opencv4"

# Set environment variables based on architecture
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then \
        echo "export OPENCV_LIB_DIR=/usr/lib/x86_64-linux-gnu" >> ~/.bashrc; \
    elif [ "$ARCH" = "aarch64" ]; then \
        echo "export OPENCV_LIB_DIR=/usr/lib/aarch64-linux-gnu" >> ~/.bashrc; \
    else \
        echo "export OPENCV_LIB_DIR=/usr/lib" >> ~/.bashrc; \
    fi

ENV OPENCV_INCLUDE_DIR=/usr/include/opencv4

# Install shared dependencies first
WORKDIR /app/packages/shared
RUN echo "=== Installing shared dependencies ===" && \
    npm install --omit=dev --no-audit --no-fund

# Build shared package
RUN echo "=== Building shared package ===" && \
    npm run build

# Install bytebot-cv dependencies  
WORKDIR /app/packages/bytebot-cv
RUN echo "=== Installing bytebot-cv dependencies ===" && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then \
        export OPENCV_LIB_DIR="/usr/lib/x86_64-linux-gnu"; \
    elif [ "$ARCH" = "aarch64" ]; then \
        export OPENCV_LIB_DIR="/usr/lib/aarch64-linux-gnu"; \
    else \
        export OPENCV_LIB_DIR="/usr/lib"; \
    fi && \
    echo "Using OPENCV_LIB_DIR=$OPENCV_LIB_DIR for architecture $ARCH" && \
    npm install --include=dev --no-audit --no-fund && \
    echo "=== Building bytebot-cv ===" && \
    npm run build

# Install and build bytebot-agent
WORKDIR /app/packages/bytebot-agent
RUN echo "=== Installing bytebot-agent dependencies ===" && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then \
        export OPENCV_LIB_DIR="/usr/lib/x86_64-linux-gnu"; \
    elif [ "$ARCH" = "aarch64" ]; then \
        export OPENCV_LIB_DIR="/usr/lib/aarch64-linux-gnu"; \
    else \
        export OPENCV_LIB_DIR="/usr/lib"; \
    fi && \
    export OPENCV_INCLUDE_DIR="/usr/include/opencv4" && \
    echo "Building with OPENCV_LIB_DIR=$OPENCV_LIB_DIR OPENCV_INCLUDE_DIR=$OPENCV_INCLUDE_DIR" && \
    npm install --include=dev --no-audit --no-fund && \
    echo "=== Verifying opencv4nodejs installation ===" && \
    ls -la node_modules/ | grep opencv || echo "opencv4nodejs not found in node_modules"

# Generate Prisma client
RUN echo "=== Generating Prisma client ===" && \
    npx prisma generate

# Build the application
RUN echo "=== Building bytebot-agent application ===" && \
    npm run build:dist

# Note: Skipping npm prune to avoid OpenCV rebuild issues
# The container size is acceptable without pruning, and this prevents
# opencv4nodejs from trying to rebuild during prune operations

# Note: OpenCV verification skipped in build - will be validated at runtime
RUN echo "=== Build completed successfully ===" && \
    echo "Node version: $(node --version)" && \
    echo "OpenCV libraries installed via system packages" && \
    echo "Prisma client generated successfully"

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "try { \
        const cv = require('opencv4nodejs'); \
        console.log('Health check: opencv4nodejs loaded'); \
        const testMat = new cv.Mat(5, 5, cv.CV_8UC3); \
        console.log('Health check: basic Mat operations work'); \
        process.exit(0); \
      } catch (error) { \
        console.error('Health check failed:', error.message); \
        process.exit(1); \
      }"

WORKDIR /app/packages/bytebot-agent

# Start the application with enhanced startup script
CMD ["node", "scripts/enhanced-startup.js"]

ENV BYTEBOT_OCR_DEBUG=false
