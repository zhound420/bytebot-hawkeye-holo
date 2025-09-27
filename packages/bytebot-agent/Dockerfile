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
    libopencv-contrib-dev \
    libopencv-core-dev \
    libopencv-imgproc-dev \
    libopencv-photo-dev \
    libopencv-highgui-dev \
    libopencv-imgcodecs-dev \
    libopencv-xphoto-dev \
    libopencv-ximgproc-dev \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    pkg-config \
    tesseract-ocr \
    tesseract-ocr-eng \
    python3 \
    python3-pip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN multiarch=$(dpkg-architecture -qDEB_HOST_MULTIARCH) && \
    ln -sf /usr/lib/${multiarch} /usr/lib/opencv

RUN node -e "const fs=require('fs'); const path=require('path'); const update=(workspace,value)=>{const file=path.join('packages',workspace,'package.json'); const pkg=JSON.parse(fs.readFileSync(file,'utf8')); pkg.dependencies['@bytebot/cv']=value; fs.writeFileSync(file, JSON.stringify(pkg, null, 2)+'\n');}; update('bytebot-agent','../bytebot-cv'); update('bytebotd','../bytebot-cv');" \
    && npm install --prefix packages/shared \
    && npm install --prefix packages/bytebot-cv \
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
