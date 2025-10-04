#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}===================================${NC}"
echo -e "${BLUE}OmniParser Setup Script${NC}"
echo -e "${BLUE}===================================${NC}"
echo ""

cd "$PACKAGE_DIR"

# Check for conda
if command -v conda &> /dev/null; then
    echo -e "${GREEN}✓ Conda found${NC}"
    USE_CONDA=true
else
    echo -e "${YELLOW}! Conda not found, using pip/venv${NC}"
    USE_CONDA=false
fi

# Setup Python environment
if [ "$USE_CONDA" = true ]; then
    echo -e "${BLUE}Creating conda environment 'omniparser'...${NC}"
    conda env create -f environment.yml || conda env update -f environment.yml
    echo -e "${GREEN}✓ Conda environment created${NC}"
    echo -e "${YELLOW}Activate with: conda activate omniparser${NC}"
else
    echo -e "${BLUE}Creating Python virtual environment...${NC}"
    python3.12 -m venv venv || python3 -m venv venv
    source venv/bin/activate
    pip install --upgrade pip
    pip install -r requirements.txt
    echo -e "${GREEN}✓ Virtual environment created${NC}"
    echo -e "${YELLOW}Activate with: source venv/bin/activate${NC}"
fi

echo ""
echo -e "${BLUE}Cloning OmniParser repository...${NC}"
if [ ! -d "OmniParser" ]; then
    git clone https://github.com/microsoft/OmniParser.git
    echo -e "${GREEN}✓ OmniParser cloned${NC}"
else
    echo -e "${YELLOW}! OmniParser directory already exists${NC}"
fi

echo ""
echo -e "${BLUE}Patching OmniParser for compatibility...${NC}"
bash "$SCRIPT_DIR/patch-paddleocr.sh"

echo ""
echo -e "${BLUE}Downloading model weights...${NC}"
bash "$SCRIPT_DIR/download_models.sh"

echo ""
echo -e "${GREEN}===================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${GREEN}===================================${NC}"
echo ""
echo -e "Next steps:"
if [ "$USE_CONDA" = true ]; then
    echo -e "  1. ${BLUE}conda activate omniparser${NC}"
else
    echo -e "  1. ${BLUE}source venv/bin/activate${NC}"
fi
echo -e "  2. ${BLUE}python src/server.py${NC}"
echo ""
