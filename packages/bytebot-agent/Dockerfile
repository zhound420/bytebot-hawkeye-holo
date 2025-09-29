# =============================================================================
# ByteBot Agent Dockerfile using urielch/opencv-nodejs pre-built image
# =============================================================================

# Use urielch/opencv-nodejs as base - has @u4/opencv4nodejs precompiled
FROM urielch/opencv-nodejs:latest AS base

# Install additional tools needed for bytebot
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    dpkg-dev \
    tesseract-ocr \
    tesseract-ocr-eng \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json ./
COPY ./packages ./packages
COPY ./config/universal-coordinates.yaml ./config/universal-coordinates.yaml

# Set environment to use globally installed @u4/opencv4nodejs
ENV NODE_PATH=/usr/lib/node_modules

# Set up workspace dependencies
RUN node -e "const fs=require('fs'); const path=require('path'); const update=(workspace,value)=>{const file=path.join('packages',workspace,'package.json'); const pkg=JSON.parse(fs.readFileSync(file,'utf8')); pkg.dependencies['@bytebot/cv']=value; fs.writeFileSync(file, JSON.stringify(pkg, null, 2)+'\n');}; update('bytebot-agent','../bytebot-cv'); update('bytebotd','../bytebot-cv');" \
    && npm install --prefix packages/shared

# Install bytebot-cv dependencies and link to global @u4/opencv4nodejs
RUN cd packages/bytebot-cv \
    && echo "Installing bytebot-cv dependencies..." \
    && echo "Removing @u4/opencv4nodejs from package.json (using global install)..." \
    && npm remove @u4/opencv4nodejs 2>/dev/null || true \
    && npm install --include=dev \
    && echo "Linking to globally installed @u4/opencv4nodejs..." \
    && npm link @u4/opencv4nodejs \
    && echo "Testing global @u4/opencv4nodejs..." \
    && node -e "try { \
        const cv = require('@u4/opencv4nodejs'); \
        console.log('✓ @u4/opencv4nodejs loaded from global install'); \
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
        console.log('✓ Global @u4/opencv4nodejs verified'); \
      } catch (e) { \
        console.error('✗ Global @u4/opencv4nodejs failed:', e.message); \
        process.exit(1); \
      }"

# Install bytebot-agent dependencies and link to global @u4/opencv4nodejs
RUN cd packages/bytebot-agent \
    && echo "Installing bytebot-agent dependencies..." \
    && npm install \
    && echo "Linking to global @u4/opencv4nodejs..." \
    && npm link @u4/opencv4nodejs \
    && mkdir -p dist/node_modules/@u4 \
    && ln -sf /usr/lib/node_modules/@u4/opencv4nodejs dist/node_modules/@u4/opencv4nodejs 2>/dev/null || true

# Build packages with TypeScript (available from --include=dev)
WORKDIR /app/packages/bytebot-cv
RUN rm -rf dist && npm run build

WORKDIR /app/packages/bytebot-agent
RUN rm -rf dist && npm run build

# Prune dev dependencies but preserve global @u4/opencv4nodejs links
WORKDIR /app
RUN echo "Pruning development dependencies..." && \
    npm prune --omit=dev --prefix packages/shared && \
    npm prune --omit=dev --prefix packages/bytebot-cv && \
    node -e "const fs=require('fs'); const path=require('path'); const update=(workspace,value)=>{const file=path.join('packages',workspace,'package.json'); const pkg=JSON.parse(fs.readFileSync(file,'utf8')); pkg.dependencies['@bytebot/cv']=value; fs.writeFileSync(file, JSON.stringify(pkg, null, 2)+'\n');}; update('bytebot-agent','workspace:*'); update('bytebotd','workspace:*');"

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "try { \
        const cv = require('@u4/opencv4nodejs'); \
        console.log('Health check: @u4/opencv4nodejs loaded'); \
        const testMat = new cv.Mat(5, 5, cv.CV_8UC3); \
        console.log('Health check: basic Mat operations work'); \
        process.exit(0); \
      } catch (error) { \
        console.error('Health check failed:', error.message); \
        process.exit(1); \
      }"

WORKDIR /app/packages/bytebot-agent

CMD ["sh", "-c", "npm run prisma:prod && node scripts/start-prod.js"]
ENV BYTEBOT_OCR_DEBUG=false
