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
if grep -q "PaddleOCR 3.x API compatibility" "$UTILS_FILE"; then
    echo -e "${GREEN}✓ Already patched${NC}"
    exit 0
fi

echo -e "${BLUE}Applying PaddleOCR 3.x compatibility patches...${NC}"

# Create comprehensive patch using Python to rewrite check_ocr_box function
python3 << EOF
import re
import sys

utils_file = "${UTILS_FILE}"

with open(utils_file, 'r') as f:
    content = f.read()

# Patch 1: Fix PaddleOCR initialization (remove deprecated params)
init_pattern = r'paddle_ocr = PaddleOCR\([^)]+\)'
init_replacement = "paddle_ocr = PaddleOCR(lang='en')  # PaddleOCR 3.x API compatibility"
content = re.sub(init_pattern, init_replacement, content, flags=re.DOTALL)

# Patch 2: Fix check_ocr_box function to handle new OCRResult format
old_ocr_logic = r'''    if use_paddleocr:
        if easyocr_args is None:
            text_threshold = 0.5
        else:
            text_threshold = easyocr_args\['text_threshold'\]
        result = paddle_ocr\.ocr\(image_np\)(\[0\])?
        coord = \[item\[0\] for item in result if item\[1\]\[1\] > text_threshold\]
        text = \[item\[1\]\[0\] for item in result if item\[1\]\[1\] > text_threshold\]'''

new_ocr_logic = '''    if use_paddleocr:
        if easyocr_args is None:
            text_threshold = 0.5
        else:
            text_threshold = easyocr_args['text_threshold']

        # PaddleOCR 3.x returns OCRResult object, not nested lists
        result = paddle_ocr.ocr(image_np)
        if result and len(result) > 0:
            ocr_result = result[0]
            # Handle new OCRResult format
            if hasattr(ocr_result, 'rec_boxes') and hasattr(ocr_result, 'rec_texts') and hasattr(ocr_result, 'rec_scores'):
                # Extract polygons, texts, and scores from OCRResult
                polygons = ocr_result.rec_boxes if len(ocr_result.rec_boxes) > 0 else ocr_result.dt_polys
                texts = ocr_result.rec_texts
                scores = ocr_result.rec_scores

                # Filter by confidence threshold
                coord = []
                text = []
                for i, score in enumerate(scores):
                    if score > text_threshold:
                        # Convert polygon to 4-point format if needed
                        poly = polygons[i] if i < len(polygons) else None
                        if poly is not None and len(poly) > 0:
                            coord.append(poly)
                            text.append(texts[i] if i < len(texts) else '')
            else:
                coord = []
                text = []
        else:
            coord = []
            text = []'''

content = re.sub(old_ocr_logic, new_ocr_logic, content, flags=re.DOTALL)

with open(utils_file, 'w') as f:
    f.write(content)

print("✓ Patched check_ocr_box function for PaddleOCR 3.x")
EOF

echo -e "${GREEN}✓ Patched PaddleOCR 3.x compatibility${NC}"
