# =============================================================================
# ByteBot Agent Dockerfile - Streamlined without OpenCV
# =============================================================================

FROM node:20.19.5-slim AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    tesseract-ocr \
    tesseract-ocr-eng \
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
    # Build tools
    build-essential \
    python3 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files for dependency resolution
COPY package.json ./
COPY ./packages ./packages
COPY ./config/universal-coordinates.yaml ./config/universal-coordinates.yaml

# Set environment variables
ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=warn \
    NPM_CONFIG_IGNORE_ENGINES=true

# Install shared dependencies first
WORKDIR /app/packages/shared
RUN echo "=== Installing shared dependencies ===" && \
    npm install --omit=dev --no-audit --no-fund

# Build shared package
RUN echo "=== Building shared package ===" && \
    npm run build

# Install bytebot-cv dependencies (no OpenCV)
WORKDIR /app/packages/bytebot-cv
RUN echo "=== Installing bytebot-cv dependencies ===" && \
    npm install --include=dev --no-audit --no-fund && \
    echo "=== Building bytebot-cv ===" && \
    npm run build && \
    echo "✓ bytebot-cv built successfully (OmniParser + Tesseract.js only)"

# Install and build bytebot-agent
WORKDIR /app/packages/bytebot-agent
RUN echo "=== Installing bytebot-agent dependencies ===" && \
    npm install --include=dev --no-audit --no-fund --ignore-engines --ignore-scripts && \
    echo "✓ bytebot-agent dependencies installed successfully"

# Generate Prisma client
RUN echo "=== Generating Prisma client ===" && \
    npx prisma generate

# Build the application
RUN echo "=== Building bytebot-agent application ===" && \
    npm run build:dist

RUN echo "=== Build completed successfully ===" && \
    echo "Node version: $(node --version)" && \
    echo "CV detection: OmniParser + Tesseract.js" && \
    echo "Prisma client generated successfully"

# Add health check (simplified, no OpenCV)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "console.log('Health check: Node.js OK'); process.exit(0);"

WORKDIR /app/packages/bytebot-agent

# Start the application with enhanced startup script
CMD ["node", "scripts/enhanced-startup.js"]

ENV BYTEBOT_OCR_DEBUG=false
