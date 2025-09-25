FROM public.ecr.aws/docker/library/node:20 AS base

WORKDIR /app

COPY package.json ./
COPY ./packages ./packages
COPY ./config/universal-coordinates.yaml ./config/universal-coordinates.yaml

ENV NODE_PATH=/app/node_modules:/app/packages/bytebot-agent/node_modules:/app/packages/bytebot-cv/node_modules
ENV OPENCV4NODEJS_DISABLE_AUTOBUILD=1 \
    OPENCV_LIB_DIR=/usr/lib/opencv \
    OPENCV_INCLUDE_DIR="/usr/include/opencv4" \
    OPENCV_BIN_DIR=/usr/bin \
    OPENCV4NODEJS_SKIP_TRACKING=1 \
    LD_LIBRARY_PATH=/usr/lib/opencv \
    PKG_CONFIG_PATH=/usr/lib/opencv/pkgconfig

RUN apt-get update && apt-get install -y \
    libopencv-dev \
    tesseract-ocr \
    tesseract-ocr-eng \
    python3 \
    python3-pip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN multiarch=$(dpkg-architecture -qDEB_HOST_MULTIARCH) && \
    ln -sf /usr/lib/${multiarch} /usr/lib/opencv

RUN npm pkg set dependencies."@bytebot/cv"=../bytebot-cv --workspace=packages/bytebot-agent \
    && npm pkg set dependencies."@bytebot/cv"=../bytebot-cv --workspace=packages/bytebotd \
    && npm install --workspace=packages/shared \
    --workspace=packages/bytebot-cv \
    --workspace=packages/bytebot-agent

WORKDIR /app/packages/bytebot-cv

RUN npm rebuild opencv4nodejs --build-from-source --loglevel verbose \
    && npm run build

WORKDIR /app/packages/bytebot-agent

RUN npm run build

WORKDIR /app
RUN npm prune --omit=dev --workspace=packages/shared \
    --workspace=packages/bytebot-cv

RUN npm pkg set dependencies."@bytebot/cv"=workspace:* --workspace=packages/bytebot-agent \
    && npm pkg set dependencies."@bytebot/cv"=workspace:* --workspace=packages/bytebotd

WORKDIR /app/packages/bytebot-agent

CMD ["sh", "-c", "npm run prisma:prod && node scripts/start-prod.js"]
