#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Stopping Bytebot Hawkeye Stack...${NC}"
echo ""

cd docker

# Determine which compose file is active
if docker ps --format '{{.Names}}' | grep -q "bytebot-llm-proxy"; then
    COMPOSE_FILE="docker-compose.proxy.yml"
    echo "Detected: Proxy Stack"
else
    COMPOSE_FILE="docker-compose.yml"
    echo "Detected: Standard Stack"
fi

# Stop Docker services
docker compose -f $COMPOSE_FILE down

echo ""
echo -e "${GREEN}✓ Docker services stopped${NC}"

# Check if native OmniParser is running
if lsof -Pi :9989 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo ""
    echo -e "${YELLOW}Native OmniParser still running on port 9989${NC}"
    read -p "Stop native OmniParser too? [Y/n] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        cd ..
        ./scripts/stop-omniparser.sh
    fi
fi

echo ""
echo -e "${GREEN}Stack stopped${NC}"
