FROM public.ecr.aws/docker/library/node:20 AS base

WORKDIR /app

COPY package.json ./
COPY ./packages ./packages
COPY ./config/universal-coordinates.yaml ./config/universal-coordinates.yaml

RUN apt-get update && apt-get install -y \
    libopencv-dev \
    tesseract-ocr \
    tesseract-ocr-eng \
    python3 \
    python3-pip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN npm pkg set dependencies."@bytebot/cv"=../bytebot-cv --workspace=packages/bytebot-agent \
    && npm pkg set dependencies."@bytebot/cv"=../bytebot-cv --workspace=packages/bytebotd \
    && npm install --workspace=packages/shared \
    --workspace=packages/bytebot-cv \
    --workspace=packages/bytebot-agent

WORKDIR /app/packages/bytebot-agent

RUN npm run build

WORKDIR /app
RUN npm prune --omit=dev --workspace=packages/shared \
    --workspace=packages/bytebot-cv \
    --workspace=packages/bytebot-agent

RUN npm pkg set dependencies."@bytebot/cv"=workspace:* --workspace=packages/bytebot-agent \
    && npm pkg set dependencies."@bytebot/cv"=workspace:* --workspace=packages/bytebotd


WORKDIR /app/packages/bytebot-agent

CMD ["sh", "-c", "npm run prisma:prod && node dist/main.js"]


