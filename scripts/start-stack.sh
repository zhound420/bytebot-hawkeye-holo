#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ARCH=$(uname -m)
OS=$(uname -s)

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Starting Bytebot Hawkeye Stack${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Change to docker directory
cd docker

# Determine which compose file to use
if [[ -f ".env" ]]; then
    # Check if using proxy or standard stack
    if [[ -f "docker-compose.proxy.yml" ]]; then
        COMPOSE_FILE="docker-compose.proxy.yml"
        echo -e "${BLUE}Using: Proxy Stack (with LiteLLM)${NC}"
    else
        COMPOSE_FILE="docker-compose.yml"
        echo -e "${BLUE}Using: Standard Stack${NC}"
    fi
else
    echo -e "${RED}✗ docker/.env not found${NC}"
    echo ""
    echo "Copy and configure the environment file:"
    echo -e "  ${BLUE}cp docker/.env.example docker/.env${NC}"
    exit 1
fi

# Platform-specific configuration
if [[ "$ARCH" == "arm64" ]] && [[ "$OS" == "Darwin" ]]; then
    echo -e "${BLUE}Platform: Apple Silicon${NC}"
    echo ""

    # Check if native OmniParser is running
    if lsof -Pi :9989 -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${GREEN}✓ Native OmniParser detected on port 9989${NC}"

        # Update .env.defaults (system defaults) to use native OmniParser
        if grep -q "OMNIPARSER_URL=http://bytebot-omniparser:9989" .env.defaults 2>/dev/null; then
            echo -e "${BLUE}Updating system configuration to use native OmniParser...${NC}"
            sed -i.bak 's|OMNIPARSER_URL=http://bytebot-omniparser:9989|OMNIPARSER_URL=http://host.docker.internal:9989|' .env.defaults
            rm .env.defaults.bak
        fi

        # Copy OMNIPARSER settings from .env.defaults to .env (Docker Compose reads .env)
        if [ -f ".env" ]; then
            echo -e "${BLUE}Syncing OmniParser settings to .env...${NC}"
            # Update or add OMNIPARSER_URL in .env
            if grep -q "^OMNIPARSER_URL=" .env; then
                sed -i.bak 's|^OMNIPARSER_URL=.*|OMNIPARSER_URL=http://host.docker.internal:9989|' .env
                rm .env.bak
            else
                echo "OMNIPARSER_URL=http://host.docker.internal:9989" >> .env
            fi
        fi

        echo ""
        echo -e "${BLUE}Starting Docker stack (without OmniParser container)...${NC}"

        # Start all services except OmniParser container
        # --no-deps prevents starting dependent services (bytebot-omniparser)
        docker compose -f $COMPOSE_FILE up -d --no-deps \
            bytebot-desktop \
            bytebot-agent \
            bytebot-ui \
            postgres \
            $([ "$COMPOSE_FILE" = "docker-compose.proxy.yml" ] && echo "bytebot-llm-proxy" || echo "")

    else
        echo -e "${YELLOW}⚠ Native OmniParser not running${NC}"
        echo ""

        # Check if it's been set up
        if [[ ! -d "../packages/bytebot-omniparser/venv" ]] && [[ ! -d "../packages/bytebot-omniparser/weights/icon_detect" ]]; then
            echo -e "${BLUE}→ Setting up native OmniParser automatically (recommended for M4 GPU)...${NC}"
            echo ""
            cd ..
            ./scripts/setup-omniparser.sh
            echo ""
            echo -e "${BLUE}→ Starting native OmniParser...${NC}"
            ./scripts/start-omniparser.sh
            echo ""
            echo "Waiting for OmniParser to be ready..."
            sleep 3
            cd docker
        else
            echo -e "${BLUE}→ Starting native OmniParser automatically...${NC}"
            cd ..
            ./scripts/start-omniparser.sh
            echo ""
            echo "Waiting for OmniParser to be ready..."
            sleep 3
            cd docker
        fi

        # Update .env.defaults (system defaults) to use native OmniParser
        if grep -q "OMNIPARSER_URL=http://bytebot-omniparser:9989" .env.defaults 2>/dev/null; then
            sed -i.bak 's|OMNIPARSER_URL=http://bytebot-omniparser:9989|OMNIPARSER_URL=http://host.docker.internal:9989|' .env.defaults
            rm .env.defaults.bak
        fi

        # Copy OMNIPARSER settings from .env.defaults to .env (Docker Compose reads .env)
        if [ -f ".env" ]; then
            # Update or add OMNIPARSER_URL in .env
            if grep -q "^OMNIPARSER_URL=" .env; then
                sed -i.bak 's|^OMNIPARSER_URL=.*|OMNIPARSER_URL=http://host.docker.internal:9989|' .env
                rm .env.bak
            else
                echo "OMNIPARSER_URL=http://host.docker.internal:9989" >> .env
            fi
        fi

        # Start stack without container
        echo ""
        echo -e "${BLUE}Starting Docker stack (without OmniParser container)...${NC}"
        # --no-deps prevents starting dependent services (bytebot-omniparser)
        docker compose -f $COMPOSE_FILE up -d --no-deps \
            bytebot-desktop \
            bytebot-agent \
            bytebot-ui \
            postgres \
            $([ "$COMPOSE_FILE" = "docker-compose.proxy.yml" ] && echo "bytebot-llm-proxy" || echo "")

        # Exit here so we don't run the code below
        echo ""
        echo -e "${BLUE}Service Status:${NC}"
        services=("bytebot-ui:9992" "bytebot-agent:9991" "bytebot-desktop:9990" "OmniParser:9989")
        for service_port in "${services[@]}"; do
            IFS=: read -r service port <<< "$service_port"
            if nc -z localhost $port 2>/dev/null; then
                echo -e "  ${GREEN}✓${NC} $service (port $port)"
            else
                echo -e "  ${YELLOW}...${NC} $service (port $port) - starting..."
            fi
        done
        echo ""
        echo -e "${GREEN}Stack ready with native OmniParser (MPS GPU)!${NC}"
        echo ""
        echo "Services:"
        echo "  • UI:       http://localhost:9992"
        echo "  • Agent:    http://localhost:9991"
        echo "  • Desktop:  http://localhost:9990"
        echo "  • OmniParser: http://localhost:9989 (native MPS)"
        echo ""
        exit 0
    fi

elif [[ "$ARCH" == "x86_64" ]] || [[ "$ARCH" == "amd64" ]]; then
    echo -e "${BLUE}Platform: x86_64${NC}"

    # Check for NVIDIA GPU
    if command -v nvidia-smi &> /dev/null; then
        echo -e "${GREEN}✓ NVIDIA GPU detected${NC}"
        nvidia-smi --query-gpu=name --format=csv,noheader | head -1
    fi

    echo ""
    echo -e "${BLUE}Starting full Docker stack (includes OmniParser container)...${NC}"
    docker compose -f $COMPOSE_FILE up -d --build
fi

# Wait for services to be ready
echo ""
echo -e "${BLUE}Waiting for services to start...${NC}"
sleep 5

# Check service health
echo ""
echo -e "${BLUE}Service Status:${NC}"

# Check each service
services=("bytebot-ui:9992" "bytebot-agent:9991" "bytebot-desktop:9990")
if lsof -Pi :9989 -sTCP:LISTEN -t >/dev/null 2>&1; then
    services+=("OmniParser:9989")
fi

all_healthy=true
for service_port in "${services[@]}"; do
    IFS=: read -r service port <<< "$service_port"
    if nc -z localhost $port 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} $service (port $port)"
    else
        echo -e "  ${RED}✗${NC} $service (port $port) - starting..."
        all_healthy=false
    fi
done

echo ""
if $all_healthy; then
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}   Stack Ready!${NC}"
    echo -e "${GREEN}================================================${NC}"
else
    echo -e "${YELLOW}================================================${NC}"
    echo -e "${YELLOW}   Stack Starting (check logs if issues)${NC}"
    echo -e "${YELLOW}================================================${NC}"
fi

echo ""
echo "Services:"
echo "  • UI:       http://localhost:9992"
echo "  • Agent:    http://localhost:9991"
echo "  • Desktop:  http://localhost:9990"
echo "  • OmniParser: http://localhost:9989"
echo ""
echo "View logs:"
echo -e "  ${BLUE}docker compose -f docker/$COMPOSE_FILE logs -f${NC}"
echo ""
echo "Stop stack:"
echo -e "  ${BLUE}./scripts/stop-stack.sh${NC}"
echo ""
