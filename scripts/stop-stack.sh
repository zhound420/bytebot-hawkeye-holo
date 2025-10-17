#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
REMOVE_VOLUMES=false
for arg in "$@"; do
    case $arg in
        --remove-volumes|-v)
            REMOVE_VOLUMES=true
            shift
            ;;
    esac
done

echo -e "${BLUE}Stopping Bytebot Hawkeye Stack...${NC}"
echo ""

# First, stop any orphaned containers (from different compose projects or manual starts)
echo "Checking for orphaned bytebot containers..."
ORPHANED=$(docker ps -a --format '{{.Names}}' | grep -E "(bytebot|postgres|holo|test-.*windows|test-.*macos)" || true)
if [ -n "$ORPHANED" ]; then
    echo -e "${YELLOW}Found orphaned containers:${NC}"
    echo "$ORPHANED" | while read container; do
        echo "  • $container"
    done
    echo ""
    echo "Stopping orphaned containers..."
    echo "$ORPHANED" | xargs -r docker rm -f
    echo -e "${GREEN}✓ Orphaned containers removed${NC}"
    echo ""
fi

cd docker

# Stop all possible compose stacks
COMPOSE_FILES=(
    "docker-compose.yml"
    "docker-compose.proxy.yml"
    "docker-compose.windows.yml"
    "docker-compose.windows-prebaked.yml"
    "docker-compose.macos.yml"
)

echo "Stopping all active stacks..."

for COMPOSE_FILE in "${COMPOSE_FILES[@]}"; do
    if [ -f "$COMPOSE_FILE" ]; then
        # Check if any containers from this stack are running
        PROJECT_NAME=$(docker compose -f "$COMPOSE_FILE" ps -q 2>/dev/null | wc -l || echo "0")
        if [ "$PROJECT_NAME" -gt 0 ] || docker ps -a --format '{{.Names}}' | grep -q "bytebot\|postgres\|windows"; then
            echo "  Stopping: $COMPOSE_FILE"
            if [ "$REMOVE_VOLUMES" = true ]; then
                docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
            else
                docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true
            fi
        fi
    fi
done

# Clean up orphaned volumes from all compose projects
# Match ALL volume prefixes (bytebot_, docker_, test-) and patterns
if [ "$REMOVE_VOLUMES" = true ]; then
    echo -e "${YELLOW}⚠️  Cleaning up all bytebot volumes (including Windows/macOS stacks)${NC}"
    docker volume ls --format "{{.Name}}" | grep -E "(bytebot|postgres|windows|holo)" | xargs -r docker volume rm 2>/dev/null || true
    echo -e "${GREEN}✓ Volumes removed${NC}"
fi

# Clean up all bytebot-related networks
echo ""
echo "Cleaning up Docker networks..."
docker network ls --format "{{.Name}}" | grep -E "bytebot" | xargs -r docker network rm 2>/dev/null || true
echo -e "${GREEN}✓ Networks cleaned${NC}"

echo ""
echo -e "${GREEN}✓ Docker services stopped${NC}"

# Check if native Holo is running
if lsof -Pi :9989 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo ""
    echo -e "${YELLOW}Native Holo 1.5-7B still running on port 9989${NC}"
    read -p "Stop native Holo too? [Y/n] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        cd ..
        ./scripts/stop-holo.sh
    fi
fi

echo ""
echo -e "${GREEN}Stack stopped${NC}"
