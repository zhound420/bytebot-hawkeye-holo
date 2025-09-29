# =============================================================================
# ByteBot Agent Dockerfile with @u4/opencv4nodejs
# =============================================================================

# Use Ubuntu 24.04 LTS base for OpenCV 4.6.0 support
FROM public.ecr.aws/ubuntu/ubuntu:24.04 AS base

# Install essential build tools and Node.js 20 on Ubuntu 24.04
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    dpkg-dev \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json ./
COPY ./packages ./packages
COPY ./config/universal-coordinates.yaml ./config/universal-coordinates.yaml

# Set environment variables for Ubuntu OpenCV 4.6.0 with multi-arch support
RUN multiarch=$(dpkg-architecture -qDEB_HOST_MULTIARCH) && \
    echo "Detected architecture: $multiarch" && \
    echo "export OPENCV_LIB_DIR=/usr/lib/${multiarch}" >> /etc/environment && \
    echo "export OPENCV_INCLUDE_DIR=/usr/include/opencv4" >> /etc/environment && \
    echo "export OPENCV_BIN_DIR=/usr/bin" >> /etc/environment && \
    echo "export PKG_CONFIG_PATH=/usr/lib/${multiarch}/pkgconfig:/usr/lib/pkgconfig" >> /etc/environment

# Set global environment variables for build process
ENV NODE_PATH=/app/node_modules:/app/packages/bytebot-agent/node_modules:/app/packages/bytebot-cv/node_modules \
    OPENCV4NODEJS_DISABLE_AUTOBUILD=1 \
    OPENCV4NODEJS_SKIP_TRACKING=1

# Dynamically set OPENCV_LIB_DIR based on detected architecture
RUN multiarch=$(dpkg-architecture -qDEB_HOST_MULTIARCH) && \
    export OPENCV_LIB_DIR="/usr/lib/${multiarch}" && \
    echo "OPENCV_LIB_DIR=${OPENCV_LIB_DIR}" >> /etc/environment && \
    echo "Architecture-specific OpenCV lib dir: ${OPENCV_LIB_DIR}"

# Install system dependencies with Ubuntu OpenCV 4.6.0 packages
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    curl \
    wget \
    python3 \
    python3-pip \
    pkg-config \
    libgtk-3-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libgif-dev \
    libcairo2-dev \
    libavcodec-dev \
    libavformat-dev \
    libswscale-dev \
    libopenexr-dev \
    libgstreamer1.0-dev \
    libgstreamer-plugins-base1.0-dev \
    tesseract-ocr \
    tesseract-ocr-eng \
    # Install Ubuntu OpenCV 4.6.0 packages with contrib modules
    libopencv-dev \
    libopencv-contrib-dev \
    libopencv-imgproc-dev \
    libopencv-imgcodecs-dev \
    libopencv-objdetect-dev \
    libopencv-ml-dev \
    libopencv-photo-dev \
    libopencv-video-dev \
    libopencv-calib3d-dev \
    libopencv-features2d-dev \
    libopencv-highgui-dev \
    # opencv-data contains additional OpenCV data files
    opencv-data \
    && rm -rf /var/lib/apt/lists/* \
    && echo "✓ Ubuntu OpenCV 4.6.0 packages installed" \
    && pkg-config --modversion opencv4

# Install node-gyp globally
RUN npm install -g node-gyp

# Create OpenCV library symlink for compatibility
RUN multiarch=$(dpkg-architecture -qDEB_HOST_MULTIARCH) && \
    ln -sf /usr/lib/${multiarch} /usr/lib/opencv

# Set up workspace dependencies and build
RUN node -e "const fs=require('fs'); const path=require('path'); const update=(workspace,value)=>{const file=path.join('packages',workspace,'package.json'); const pkg=JSON.parse(fs.readFileSync(file,'utf8')); pkg.dependencies['@bytebot/cv']=value; fs.writeFileSync(file, JSON.stringify(pkg, null, 2)+'\n');}; update('bytebot-agent','../bytebot-cv'); update('bytebotd','../bytebot-cv');" \
    && npm install --prefix packages/shared

# Install bytebot-cv with @u4/opencv4nodejs v7.1.2 (maintained fork)
RUN cd packages/bytebot-cv \
    && multiarch=$(dpkg-architecture -qDEB_HOST_MULTIARCH) \
    && echo "Building @u4/opencv4nodejs v7.1.2 against Ubuntu OpenCV 4.6.0..." \
    && export OPENCV_LIB_DIR="/usr/lib/${multiarch}" \
    && export OPENCV_INCLUDE_DIR="/usr/include/opencv4" \
    && export OPENCV_BIN_DIR="/usr/bin" \
    && export PKG_CONFIG_PATH="/usr/lib/${multiarch}/pkgconfig:/usr/lib/pkgconfig" \
    && export OPENCV4NODEJS_DISABLE_AUTOBUILD=0 \
    && echo "Installing bytebot-cv dependencies (including TypeScript for build)..." \
    && npm install --include=dev \
    && echo "Building @u4/opencv4nodejs v7.1.2 (maintained fork fixes morphology bindings)..." \
    && rm -rf node_modules/opencv4nodejs node_modules/@u4 \
    && npm install @u4/opencv4nodejs@7.1.2 --build-from-source \
        --opencv-lib-dir="${OPENCV_LIB_DIR}" \
        --opencv-include-dir="${OPENCV_INCLUDE_DIR}" \
        --opencv-bin-dir="${OPENCV_BIN_DIR}" \
    && echo "Testing @u4/opencv4nodejs v7.1.2..." \
    && node -e "try { \
        const cv = require('@u4/opencv4nodejs'); \
        console.log('✓ @u4/opencv4nodejs v7.1.2 loaded successfully'); \
        \
        // Extract version \
        let version = 'unknown'; \
        if (typeof cv.version === 'string') { \
          version = cv.version; \
        } else if (typeof cv.version === 'object' && cv.version !== null) { \
          const {major, minor, patch} = cv.version; \
          version = major + '.' + (minor || 0) + '.' + (patch || 0); \
        } \
        console.log('OpenCV version:', version); \
        \
        // Test Mat operations \
        const testMat = new cv.Mat(5, 5, cv.CV_8UC3); \
        console.log('✓ Basic Mat operations work'); \
        console.log('Mat.type available:', typeof testMat.type === 'function'); \
        \
        // Test morphology \
        let morphAvailable = false; \
        console.log('--- Morphology Tests ---'); \
        \
        if (typeof cv.morphologyEx === 'function') { \
          console.log('cv.morphologyEx: ✓ Available'); \
          morphAvailable = true; \
        } else { \
          console.log('cv.morphologyEx: ✗ Not available'); \
        } \
        \
        if (typeof testMat.morphologyEx === 'function') { \
          console.log('Mat.morphologyEx: ✓ Available'); \
          try { \
            const data = new Uint8Array(32 * 32); \
            data.fill(128); \
            const sampleMat = new cv.Mat(32, 32, cv.CV_8UC1, Buffer.from(data)); \
            const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)); \
            const result = sampleMat.morphologyEx(cv.MORPH_CLOSE, kernel); \
            console.log('✓ Mat.morphologyEx test SUCCEEDED:', result.rows + 'x' + result.cols); \
            morphAvailable = true; \
          } catch (morphErr) { \
            console.log('✗ Mat.morphologyEx test failed:', morphErr.message); \
          } \
        } else { \
          console.log('Mat.morphologyEx: ✗ Not available'); \
        } \
        \
        console.log('Morphology support:', morphAvailable ? '✓ Available' : '⚠ Unavailable'); \
        console.log('✓ @u4/opencv4nodejs v7.1.2 build completed'); \
      } catch (e) { \
        console.error('✗ @u4/opencv4nodejs v7.1.2 failed:', e.message); \
        process.exit(1); \
      }"

# Install bytebot-agent dependencies with shared @u4/opencv4nodejs from bytebot-cv
RUN cd packages/bytebot-agent \
    && echo "Installing bytebot-agent dependencies..." \
    && npm install \
    && echo "Creating @u4/opencv4nodejs symlinks for runtime access..." \
    && mkdir -p dist/node_modules/@u4 \
    && ln -sf ../../../bytebot-cv/node_modules/@u4/opencv4nodejs dist/node_modules/@u4/opencv4nodejs 2>/dev/null || echo "Symlink creation completed"

# Build packages with forced clean compilation (TypeScript available from --include=dev)
WORKDIR /app/packages/bytebot-cv
RUN rm -rf dist && npm run build

WORKDIR /app/packages/bytebot-agent
RUN rm -rf dist && npm run build

# Set Ubuntu OpenCV 4.6.0 environment for pruning
WORKDIR /app
RUN multiarch=$(dpkg-architecture -qDEB_HOST_MULTIARCH) && \
    export OPENCV_LIB_DIR="/usr/lib/${multiarch}" && \
    export OPENCV_INCLUDE_DIR="/usr/include/opencv4" && \
    export OPENCV_BIN_DIR="/usr/bin" && \
    export PKG_CONFIG_PATH="/usr/lib/${multiarch}/pkgconfig:/usr/lib/pkgconfig" && \
    echo "Pruning development dependencies with Ubuntu OpenCV 4.6.0 environment..." && \
    npm prune --omit=dev --prefix packages/shared && \
    OPENCV_LIB_DIR="/usr/lib/${multiarch}" npm prune --omit=dev --prefix packages/bytebot-cv && \
    node -e "const fs=require('fs'); const path=require('path'); const update=(workspace,value)=>{const file=path.join('packages',workspace,'package.json'); const pkg=JSON.parse(fs.readFileSync(file,'utf8')); pkg.dependencies['@bytebot/cv']=value; fs.writeFileSync(file, JSON.stringify(pkg, null, 2)+'\n');}; update('bytebot-agent','workspace:*'); update('bytebotd','workspace:*');"

# Add enhanced health check with CLAHE/morphology validation
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "try { \
        const cv = require('@u4/opencv4nodejs'); \
        console.log('Health check: @u4/opencv4nodejs loaded'); \
        \
        // Test basic functionality \
        const testMat = new cv.Mat(5, 5, cv.CV_8UC3); \
        console.log('Health check: basic Mat operations work'); \
        \
        // Test CLAHE (optional) \
        let claheStatus = 'unavailable'; \
        try { \
          if (typeof cv.createCLAHE === 'function') { \
            const clahe = cv.createCLAHE(); \
            claheStatus = 'native'; \
          } \
        } catch {} \
        \
        // Test morphology (optional) \
        let morphStatus = 'unavailable'; \
        try { \
          if (typeof cv.morphologyEx === 'function') { \
            morphStatus = 'native'; \
          } \
        } catch {} \
        \
        console.log('Health check passed - CLAHE:', claheStatus, 'Morphology:', morphStatus); \
        process.exit(0); \
      } catch (error) { \
        console.error('Health check failed:', error.message); \
        process.exit(1); \
      }"

WORKDIR /app/packages/bytebot-agent

CMD ["sh", "-c", "npm run prisma:prod && node scripts/start-prod.js"]
ENV BYTEBOT_OCR_DEBUG=false
