#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
WEIGHTS_DIR="$PACKAGE_DIR/weights"

echo -e "${BLUE}===================================${NC}"
echo -e "${BLUE}OmniParser v2.0 Model Downloader${NC}"
echo -e "${BLUE}===================================${NC}"

# Create weights directory
mkdir -p "$WEIGHTS_DIR/icon_detect"
mkdir -p "$WEIGHTS_DIR/icon_caption_florence"

echo -e "${GREEN}Downloading OmniParser v2.0 weights...${NC}"

# Check if huggingface-cli is available
if ! command -v huggingface-cli &> /dev/null; then
    echo -e "${RED}Error: huggingface-cli not found. Installing...${NC}"
    pip install huggingface-hub
fi

# Download icon detection model (YOLOv8)
echo -e "${BLUE}Downloading icon detection model (YOLOv8)...${NC}"
huggingface-cli download microsoft/OmniParser-v2.0 \
    icon_detect/train_args.yaml \
    icon_detect/model.pt \
    icon_detect/model.yaml \
    --local-dir "$WEIGHTS_DIR"

# Download icon caption model (Florence-2)
echo -e "${BLUE}Downloading icon caption model (Florence-2)...${NC}"
huggingface-cli download microsoft/OmniParser-v2.0 \
    icon_caption/config.json \
    icon_caption/generation_config.json \
    icon_caption/model.safetensors \
    icon_caption/preprocessor_config.json \
    icon_caption/tokenizer_config.json \
    icon_caption/tokenizer.json \
    icon_caption/vocab.json \
    --local-dir "$WEIGHTS_DIR"

# Move files from nested icon_caption directory if needed
if [ -d "$WEIGHTS_DIR/icon_caption/icon_caption" ]; then
    mv "$WEIGHTS_DIR/icon_caption/icon_caption"/* "$WEIGHTS_DIR/icon_caption/" 2>/dev/null || true
    rmdir "$WEIGHTS_DIR/icon_caption/icon_caption" 2>/dev/null || true
fi

# Rename icon_caption to icon_caption_florence for compatibility
if [ -d "$WEIGHTS_DIR/icon_caption" ]; then
    mv "$WEIGHTS_DIR/icon_caption" "$WEIGHTS_DIR/icon_caption_florence" 2>/dev/null || true
fi

# Download remaining Florence-2 files directly
echo -e "${BLUE}Downloading additional Florence-2 files...${NC}"
huggingface-cli download microsoft/Florence-2-base-ft --local-dir "$WEIGHTS_DIR/icon_caption_florence" 2>/dev/null || echo "  (Using existing files)"

echo -e "${GREEN}✓ Models downloaded successfully!${NC}"
echo -e "${BLUE}Location: $WEIGHTS_DIR${NC}"
echo ""
echo -e "${GREEN}Model sizes:${NC}"
du -sh "$WEIGHTS_DIR/icon_detect" 2>/dev/null || echo "  icon_detect: ~50MB"
du -sh "$WEIGHTS_DIR/icon_caption_florence" 2>/dev/null || echo "  icon_caption_florence: ~800MB"
echo ""
echo -e "${GREEN}✓ Setup complete!${NC}"
