FROM public.ecr.aws/docker/library/node:20 AS base

WORKDIR /app

COPY package.json ./
COPY ./packages ./packages
COPY ./config/universal-coordinates.yaml ./config/universal-coordinates.yaml

ENV NODE_PATH=/app/node_modules:/app/packages/bytebot-agent/node_modules:/app/packages/bytebot-cv/node_modules
ENV OPENCV4NODEJS_AUTOBUILD_OPENCV_VERSION=4.6.0 \
    OPENCV4NODEJS_AUTOBUILD_WITHOUT_CONTRIB=0 \
    OPENCV4NODEJS_AUTOBUILD=1 \
    OPENCV4NODEJS_SKIP_TRACKING=1 \
    OPENCV4NODEJS_AUTOBUILD_FLAGS="-DWITH_FFMPEG=OFF -DBUILD_opencv_imgproc=ON -DBUILD_opencv_photo=ON -DBUILD_opencv_xphoto=ON -DBUILD_opencv_ximgproc=ON -DOPENCV_ENABLE_NONFREE=ON"

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
    && rm -rf /var/lib/apt/lists/*

# legacy symlink no longer required when using autobuild; keep for compatibility
RUN multiarch=$(dpkg-architecture -qDEB_HOST_MULTIARCH) && \
    ln -sf /usr/lib/${multiarch} /usr/lib/opencv || true

RUN node -e "const fs=require('fs'); const path=require('path'); const update=(workspace,value)=>{const file=path.join('packages',workspace,'package.json'); const pkg=JSON.parse(fs.readFileSync(file,'utf8')); pkg.dependencies['@bytebot/cv']=value; fs.writeFileSync(file, JSON.stringify(pkg, null, 2)+'\n');}; update('bytebot-agent','../bytebot-cv'); update('bytebotd','../bytebot-cv');" \
    && npm install --prefix packages/shared \
    && npm install --ignore-scripts --prefix packages/bytebot-cv opencv-build \
    && node -e "process.chdir('packages/bytebot-cv'); const { install } = require('opencv-build/build/install'); install().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });" \
    && OPENCV_LIB_DIR=/app/packages/bytebot-cv/node_modules/opencv-build/opencv/build/lib \
       OPENCV_INCLUDE_DIR=/app/packages/bytebot-cv/node_modules/opencv-build/opencv/build/include \
       OPENCV_BIN_DIR=/app/packages/bytebot-cv/node_modules/opencv-build/opencv/build/bin \
       npm install --prefix packages/bytebot-cv \
    && npm rebuild --build-from-source --prefix packages/bytebot-cv canvas \
    && npm install --prefix packages/bytebot-agent

WORKDIR /app/packages/bytebot-cv

RUN npm rebuild opencv4nodejs --build-from-source --loglevel verbose \
    && npm run build

WORKDIR /app/packages/bytebot-agent

RUN npm run build

WORKDIR /app
RUN npm prune --omit=dev --prefix packages/shared \
    && npm prune --omit=dev --prefix packages/bytebot-cv \
    && node -e "const fs=require('fs'); const path=require('path'); const update=(workspace,value)=>{const file=path.join('packages',workspace,'package.json'); const pkg=JSON.parse(fs.readFileSync(file,'utf8')); pkg.dependencies['@bytebot/cv']=value; fs.writeFileSync(file, JSON.stringify(pkg, null, 2)+'\n');}; update('bytebot-agent','workspace:*'); update('bytebotd','workspace:*');"

WORKDIR /app/packages/bytebot-agent

CMD ["sh", "-c", "npm run prisma:prod && node scripts/start-prod.js"]
ENV BYTEBOT_OCR_DEBUG=false
