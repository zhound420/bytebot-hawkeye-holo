#!/usr/bin/env bash
set -euo pipefail

# Download Holo 1.5-7B (GGUF) weights for llama.cpp inference.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
WEIGHTS_DIR="${PACKAGE_DIR}/weights/holo1.5"

MODEL_REPO="mradermacher/Holo1.5-7B-GGUF"
MODEL_FILE="Holo1.5-7B.Q4_K_M.gguf"
MMPROJ_FILE="mmproj-Q8_0.gguf"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}Downloading Holo 1.5-7B (GGUF) weights${NC}"
echo -e "${BLUE}Destination:${NC} ${WEIGHTS_DIR}"
echo -e "${BLUE}Repo:${NC} ${MODEL_REPO}"
echo -e "${BLUE}Model:${NC} ${MODEL_FILE}"
echo -e "${BLUE}Projector:${NC} ${MMPROJ_FILE}"
echo -e "${BLUE}=============================================${NC}"

mkdir -p "${WEIGHTS_DIR}"

if ! command -v huggingface-cli >/dev/null 2>&1; then
  echo -e "${RED}huggingface-cli not found. Installing into current environment...${NC}"
  python -m pip install --upgrade huggingface-hub >/dev/null
fi

echo -e "${GREEN}Fetching model weights...${NC}"
huggingface-cli download "${MODEL_REPO}" "${MODEL_FILE}" \
  --local-dir "${WEIGHTS_DIR}" --local-dir-use-symlinks False

echo -e "${GREEN}Fetching multimodal projector...${NC}"
huggingface-cli download "${MODEL_REPO}" "${MMPROJ_FILE}" \
  --local-dir "${WEIGHTS_DIR}" --local-dir-use-symlinks False

echo "" 
echo -e "${GREEN}✓ Download complete${NC}"
echo -e "${BLUE}Files:${NC}"
ls -lh "${WEIGHTS_DIR}" | sed '1d'

echo "" 
echo -e "${GREEN}Configure the server with:${NC}"
echo "  export HOLO_MODEL_PATH=${WEIGHTS_DIR}/${MODEL_FILE}"
echo "  export HOLO_MMPROJ_PATH=${WEIGHTS_DIR}/${MMPROJ_FILE}"
echo "  npm run start:dev --workspace bytebot-agent  # or equivalent"
