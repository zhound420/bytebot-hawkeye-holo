#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}Patching OmniParser for PaddleOCR 3.x compatibility...${NC}"

UTILS_FILE="$PACKAGE_DIR/OmniParser/util/utils.py"

if [ ! -f "$UTILS_FILE" ]; then
    echo -e "${YELLOW}! utils.py not found, skipping patch${NC}"
    exit 0
fi

# Check if already patched
if grep -q "Simplified init for PaddleOCR 3.2.0" "$UTILS_FILE" && grep -q "paddle_ocr.ocr(image_np)\[0\]" "$UTILS_FILE"; then
    echo -e "${GREEN}✓ Already patched${NC}"
    exit 0
fi

echo -e "${BLUE}Applying PaddleOCR 3.x compatibility patches...${NC}"

# Patch 1: PaddleOCR initialization
# Remove deprecated parameters: use_gpu, use_angle_cls, show_log, max_batch_size, use_dilation, det_db_score_mode, rec_batch_num
echo -e "${BLUE}  - Fixing PaddleOCR initialization...${NC}"
sed -i.bak '/^paddle_ocr = PaddleOCR(/,/)$/{
    s/paddle_ocr = PaddleOCR(/paddle_ocr = PaddleOCR(/
    s/^    lang=.*/    lang='\''en'\''  # Simplified init for PaddleOCR 3.2.0 compatibility/
    /use_angle_cls/d
    /use_gpu/d
    /show_log/d
    /max_batch_size/d
    /use_dilation/d
    /det_db_score_mode/d
    /rec_batch_num/d
}' "$UTILS_FILE"

# Patch 2: Remove cls parameter from paddle_ocr.ocr() call
# PaddleOCR 3.x doesn't support the cls parameter
echo -e "${BLUE}  - Fixing paddle_ocr.ocr() call...${NC}"
sed -i.bak2 's/paddle_ocr\.ocr(image_np, cls=False)/paddle_ocr.ocr(image_np)/g' "$UTILS_FILE"

# Clean up backups
rm -f "$UTILS_FILE.bak" "$UTILS_FILE.bak2"

echo -e "${GREEN}✓ Patched PaddleOCR initialization and ocr() call${NC}"
