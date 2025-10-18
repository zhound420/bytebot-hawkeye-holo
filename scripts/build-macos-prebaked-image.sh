#!/usr/bin/env bash
set -e
set -o pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   macOS Prebaked Image Builder${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""
echo "This script creates a prebaked macOS Docker image with bytebotd pre-installed."
echo "Similar to Windows prebaked images, this achieves ~30-60 second startup times."
echo ""
echo -e "${YELLOW}Important: This requires ONE-TIME manual Setup Assistant completion${NC}"
echo -e "${YELLOW}due to Apple licensing and technical constraints.${NC}"
echo ""

# Ensure we're in the repo root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$REPO_ROOT"

# Configuration
IMAGE_NAME="bytebot-macos-prebaked"
IMAGE_TAG="${MACOS_PREBAKED_VERSION:-latest}"
CONTAINER_NAME="bytebot-macos-builder"
VERSION_TAG="v$(date +%Y%m%d-%H%M%S)"

# Check if docker is available
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker not found${NC}"
    echo "Please install Docker first"
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null 2>&1; then
    echo -e "${RED}✗ Docker Compose not found${NC}"
    echo "Please install Docker Compose first"
    exit 1
fi

echo -e "${BLUE}Step 1: Preparing macOS installer package...${NC}"
echo ""

# Build the macOS package if it doesn't exist
if [[ ! -f "$REPO_ROOT/docker/macos-installer/bytebotd-macos-prebaked.tar.gz" ]]; then
    echo -e "${YELLOW}Building macOS installer package...${NC}"
    bash "$REPO_ROOT/scripts/build-macos-prebaked-package.sh"
    echo ""
else
    PACKAGE_SIZE=$(du -sh "$REPO_ROOT/docker/macos-installer/bytebotd-macos-prebaked.tar.gz" | cut -f1)
    echo -e "${GREEN}✓ Installer package already exists (${PACKAGE_SIZE})${NC}"
    echo ""
fi

# Ensure shared directory has all required files
echo -e "${BLUE}Copying installation files to shared directory...${NC}"
mkdir -p "$REPO_ROOT/docker/shared"

cp "$REPO_ROOT/docker/macos-installer/bytebotd-macos-prebaked.tar.gz" "$REPO_ROOT/docker/shared/" 2>/dev/null || true
cp "$REPO_ROOT/docker/oem/install-macos-prebaked.sh" "$REPO_ROOT/docker/shared/" 2>/dev/null || true
chmod +x "$REPO_ROOT/docker/shared/install-macos-prebaked.sh" 2>/dev/null || true

# Create first-time setup script if it doesn't exist
if [[ -f "$REPO_ROOT/scripts/setup-macos-first-time.sh" ]]; then
    cp "$REPO_ROOT/scripts/setup-macos-first-time.sh" "$REPO_ROOT/docker/shared/"
    chmod +x "$REPO_ROOT/docker/shared/setup-macos-first-time.sh"
fi

echo -e "${GREEN}✓ Installation files ready${NC}"
echo ""

echo -e "${BLUE}Step 2: Starting fresh macOS container...${NC}"
echo ""

# Check if builder container already exists
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME" 2>/dev/null; then
    echo -e "${YELLOW}Existing builder container found${NC}"
    read -p "Remove and start fresh? [Y/n] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        echo -e "${YELLOW}Removing existing container...${NC}"
        cd "$REPO_ROOT/docker"
        docker compose -f docker-compose.macos.yml down "$CONTAINER_NAME" 2>/dev/null || true
        docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
        cd "$REPO_ROOT"
        echo -e "${GREEN}✓ Removed${NC}"
    else
        echo -e "${YELLOW}Using existing container${NC}"
    fi
    echo ""
fi

# Start macOS container
cd "$REPO_ROOT/docker"
echo -e "${BLUE}Starting macOS container (this may take 5-10 minutes for first boot)...${NC}"
echo ""

# Rename service in docker-compose to match builder container name
docker compose -f docker-compose.macos.yml up -d bytebot-macos

# Wait for container to be running
echo -e "${BLUE}Waiting for container to start...${NC}"
sleep 10

# Get actual container ID/name
ACTUAL_CONTAINER=$(docker ps --filter "ancestor=dockurr/macos" --format "{{.Names}}" | head -n 1)
if [ -z "$ACTUAL_CONTAINER" ]; then
    ACTUAL_CONTAINER="bytebot-macos"
fi

echo -e "${GREEN}✓ Container started: $ACTUAL_CONTAINER${NC}"
echo ""

echo -e "${CYAN}================================================${NC}"
echo -e "${CYAN}   Manual Setup Assistant Required${NC}"
echo -e "${CYAN}================================================${NC}"
echo ""
echo -e "${YELLOW}Please complete the following steps:${NC}"
echo ""
echo "1. Access macOS at: ${CYAN}http://localhost:8006${NC}"
echo "   Or via VNC at: ${CYAN}vnc://localhost:5900${NC}"
echo ""
echo "2. Complete Setup Assistant (this is required by Apple):"
echo "   • Select your region and keyboard layout"
echo "   • ${YELLOW}SKIP${NC} Migration Assistant (click 'Not Now')"
echo "   • ${YELLOW}SKIP${NC} Apple ID (click 'Set Up Later' → 'Skip')"
echo "   • Create user account:"
echo "     - Full Name: ${CYAN}Docker User${NC}"
echo "     - Account Name: ${CYAN}docker${NC}"
echo "     - Password: ${CYAN}docker${NC} (or your choice)"
echo "   • ${YELLOW}SKIP${NC} iCloud Keychain"
echo "   • ${YELLOW}SKIP${NC} Analytics"
echo "   • ${YELLOW}SKIP${NC} Screen Time"
echo "   • ${YELLOW}SKIP${NC} Siri"
echo "   • Choose Light/Dark appearance (any)"
echo ""
echo "3. After reaching the desktop, open ${CYAN}Terminal${NC}:"
echo "   • Applications → Utilities → Terminal"
echo "   • OR use Spotlight (Cmd+Space) → type 'Terminal'"
echo ""
echo "4. In Terminal, run:"
echo -e "   ${GREEN}sudo bash /shared/setup-macos-first-time.sh${NC}"
echo ""
echo "5. Wait for installation to complete (~5-8 minutes)"
echo ""
echo -e "${YELLOW}Expected total time: 10-15 minutes${NC}"
echo ""

# Wait for user confirmation
read -p "Press Enter when installation is complete and bytebotd is running..."
echo ""

echo -e "${BLUE}Step 3: Verifying bytebotd installation...${NC}"
echo ""

# Check if bytebotd is responding
echo "Checking bytebotd health..."
MAX_ATTEMPTS=12
ATTEMPT=1

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    if docker exec "$ACTUAL_CONTAINER" curl -sf http://localhost:9990/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Bytebotd is healthy${NC}"
        break
    else
        echo "Attempt $ATTEMPT/$MAX_ATTEMPTS - bytebotd not responding yet..."
        sleep 5
        ATTEMPT=$((ATTEMPT + 1))
    fi
done

if [ $ATTEMPT -gt $MAX_ATTEMPTS ]; then
    echo -e "${RED}✗ Bytebotd health check failed${NC}"
    echo "Please check logs and try again"
    exit 1
fi

echo ""
echo -e "${BLUE}Step 4: Stopping container for commit...${NC}"
echo ""

# Stop the container gracefully
docker stop "$ACTUAL_CONTAINER"
echo -e "${GREEN}✓ Container stopped${NC}"
echo ""

echo -e "${BLUE}Step 5: Committing container to prebaked image...${NC}"
echo ""

# Commit container to new image
docker commit \
    --author "Bytebot Hawkeye <noreply@bytebot.ai>" \
    --message "macOS prebaked image with bytebotd pre-installed

Includes:
- macOS Sonoma (configured)
- User account: docker/docker
- Homebrew package manager
- Node.js 20
- Bytebotd packages (shared, bytebot-cv, bytebotd)
- LaunchAgent for auto-start
- All dependencies installed

Ready for instant deployment (30-60s startup)
" \
    "$ACTUAL_CONTAINER" \
    "$IMAGE_NAME:$IMAGE_TAG"

echo -e "${GREEN}✓ Image committed: $IMAGE_NAME:$IMAGE_TAG${NC}"
echo ""

# Tag with version
docker tag "$IMAGE_NAME:$IMAGE_TAG" "$IMAGE_NAME:$VERSION_TAG"
echo -e "${GREEN}✓ Tagged: $IMAGE_NAME:$VERSION_TAG${NC}"
echo ""

# Get image size
IMAGE_SIZE=$(docker images "$IMAGE_NAME:$IMAGE_TAG" --format "{{.Size}}")
echo -e "${BLUE}Image size: ${IMAGE_SIZE}${NC}"
echo ""

echo -e "${BLUE}Step 6: Cleaning up builder container...${NC}"
echo ""

# Remove builder container
docker rm "$ACTUAL_CONTAINER"
echo -e "${GREEN}✓ Builder container removed${NC}"
echo ""

echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}   Prebaked Image Created Successfully!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "Image: $IMAGE_NAME:$IMAGE_TAG"
echo "Size: $IMAGE_SIZE"
echo "Version tag: $IMAGE_NAME:$VERSION_TAG"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo ""
echo "1. Test the prebaked image:"
echo -e "   ${CYAN}./scripts/start-stack.sh --os macos --prebaked${NC}"
echo ""
echo "2. Expected startup time: ${GREEN}30-60 seconds${NC} (vs 10-15 minutes)"
echo ""
echo "3. Bytebotd will be available at: ${CYAN}http://localhost:9990${NC}"
echo ""
echo -e "${YELLOW}Note: To rebuild this image with updates, run this script again${NC}"
echo ""
