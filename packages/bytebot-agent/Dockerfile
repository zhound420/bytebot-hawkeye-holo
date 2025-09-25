FROM public.ecr.aws/docker/library/node:20 AS base

WORKDIR /app

COPY ./packages ./packages
COPY ./config/universal-coordinates.yaml ./config/universal-coordinates.yaml

WORKDIR /app/packages/bytebot-agent

RUN apt-get update && apt-get install -y \
    libopencv-dev \
    tesseract-ocr \
    tesseract-ocr-eng \
    python3 \
    python3-pip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN npm install

RUN npm run build

RUN npm prune --omit=dev

CMD ["sh", "-c", "npm run prisma:prod && node dist/main.js"]


