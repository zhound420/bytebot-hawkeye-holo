#!/bin/bash
set -e
set -o pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

wait_for_container_health() {
    local container="$1"
    local timeout="${2:-360}"
    local interval="${3:-5}"

    if ! docker ps -a --format '{{.Names}}' | grep -qx "$container" 2>/dev/null; then
        echo -e "${YELLOW}Skipping health wait for ${container} (container not running)${NC}"
        return 0
    fi

    local waited=0
    echo -ne "${BLUE}Waiting for ${container} health${NC}"
    while (( waited < timeout )); do
        local status
        status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo "")

        case "$status" in
            healthy)
                echo -e " ${GREEN}✓${NC}"
                return 0
                ;;
            unhealthy)
                echo -e " ${RED}✗${NC} (reported unhealthy)"
                docker logs "$container" --tail 40 || true
                return 1
                ;;
            "")
                # container not ready yet
                ;;
            *)
                # still starting
                ;;
        esac

        echo -n "."
        sleep "$interval"
        waited=$((waited + interval))
    done

    echo -e " ${RED}✗${NC} (timeout after ${timeout}s)"
    docker logs "$container" --tail 40 || true
    return 1
}

wait_for_port() {
    local label="$1"
    local port="$2"
    local host="${3:-localhost}"
    local timeout="${4:-300}"
    local interval="${5:-5}"

    local waited=0
    echo -ne "${BLUE}Waiting for ${label} (port ${port})${NC}"
    while (( waited < timeout )); do
        if (exec 3<>/dev/tcp/"$host"/"$port") 2>/dev/null; then
            exec 3>&-
            echo -e " ${GREEN}✓${NC}"
            return 0
        fi
        echo -n "."
        sleep "$interval"
        waited=$((waited + interval))
    done

    echo -e " ${RED}✗${NC} (timeout after ${timeout}s)"
    return 1
}

wait_for_http() {
    local url="$1"
    local label="$2"
    local timeout="${3:-180}"
    local interval="${4:-5}"

    local waited=0
    echo -ne "${BLUE}Waiting for ${label}${NC}"
    while (( waited < timeout )); do
        if curl -sf --max-time 5 "$url" >/dev/null 2>&1; then
            echo -e " ${GREEN}✓${NC}"
            return 0
        fi
        echo -n "."
        sleep "$interval"
        waited=$((waited + interval))
    done

    echo -e " ${RED}✗${NC} (timeout after ${timeout}s)"
    return 1
}

set_service_status() {
    local label="$1"
    local new_status="$2"

    for i in "${!SERVICE_RESULTS[@]}"; do
        IFS='|' read -r existing_label existing_port existing_status <<< "${SERVICE_RESULTS[$i]}"
        if [[ "$existing_label" == "$label" ]]; then
            SERVICE_RESULTS[$i]="$existing_label|$existing_port|$new_status"
            return 0
        fi
    done

    SERVICE_RESULTS+=("$label||$new_status")
}

USE_NATIVE_HOLO=false
EXPECT_HOLO_CONTAINER=false
HOLO_PREWAIT=false
HOLO_PREWAIT_SUCCESS=false
ARCH=$(uname -m)
OS=$(uname -s)
TARGET_OS="linux"  # Default to Linux

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --os)
            TARGET_OS="$2"
            shift 2
            ;;
        *)
            echo -e "${RED}Unknown argument: $1${NC}"
            echo "Usage: $0 [--os linux|windows]"
            exit 1
            ;;
    esac
done

# Validate TARGET_OS
if [[ "$TARGET_OS" != "linux" && "$TARGET_OS" != "windows" && "$TARGET_OS" != "macos" ]]; then
    echo -e "${RED}Invalid OS: $TARGET_OS${NC}"
    echo "Valid options: linux, windows, macos"
    exit 1
fi

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Starting Bytebot Hawkeye Stack ($TARGET_OS)${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Windows-specific: Copy pre-built artifacts to /oem mount
if [[ "$TARGET_OS" == "windows" ]]; then
    echo -e "${BLUE}Preparing Windows container artifacts...${NC}"

    # Get script directory and project root
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

    # Check if packages are built
    if [[ ! -f "$PROJECT_ROOT/packages/bytebotd/dist/main.js" ]]; then
        echo -e "${RED}✗ Pre-built bytebotd not found${NC}"
        echo ""
        echo "Please build packages on host before starting Windows container:"
        echo -e "  ${BLUE}cd packages/shared && npm install && npm run build${NC}"
        echo -e "  ${BLUE}cd ../bytebot-cv && npm install && npm run build${NC}"
        echo -e "  ${BLUE}cd ../bytebotd && npm install && npm run build${NC}"
        exit 1
    fi

    # Check if Windows container already exists (need to remove for fresh /oem copy)
    if docker ps -a --format '{{.Names}}' | grep -qx "bytebot-windows" 2>/dev/null; then
        echo -e "${YELLOW}Existing Windows container found - removing to ensure fresh /oem mount...${NC}"
        cd "$PROJECT_ROOT/docker"
        docker compose -f docker-compose.windows.yml down bytebot-windows 2>/dev/null || true
        docker rm -f bytebot-windows 2>/dev/null || true
        cd "$PROJECT_ROOT"
        echo -e "${GREEN}✓ Old container removed${NC}"
    fi

    # Create artifacts directory in /oem mount
    mkdir -p "$PROJECT_ROOT/docker/oem/artifacts"/{bytebotd,shared,bytebot-cv}

    echo -e "${BLUE}Copying built artifacts to /oem mount...${NC}"

    # Copy bytebotd
    cp -r "$PROJECT_ROOT/packages/bytebotd/dist" "$PROJECT_ROOT/docker/oem/artifacts/bytebotd/"
    cp -r "$PROJECT_ROOT/packages/bytebotd/node_modules" "$PROJECT_ROOT/docker/oem/artifacts/bytebotd/"
    cp "$PROJECT_ROOT/packages/bytebotd/package.json" "$PROJECT_ROOT/docker/oem/artifacts/bytebotd/"

    # Copy shared
    cp -r "$PROJECT_ROOT/packages/shared/dist" "$PROJECT_ROOT/docker/oem/artifacts/shared/"
    cp -r "$PROJECT_ROOT/packages/shared/node_modules" "$PROJECT_ROOT/docker/oem/artifacts/shared/"
    cp "$PROJECT_ROOT/packages/shared/package.json" "$PROJECT_ROOT/docker/oem/artifacts/shared/"

    # Copy bytebot-cv
    cp -r "$PROJECT_ROOT/packages/bytebot-cv/dist" "$PROJECT_ROOT/docker/oem/artifacts/bytebot-cv/"
    cp -r "$PROJECT_ROOT/packages/bytebot-cv/node_modules" "$PROJECT_ROOT/docker/oem/artifacts/bytebot-cv/"
    cp "$PROJECT_ROOT/packages/bytebot-cv/package.json" "$PROJECT_ROOT/docker/oem/artifacts/bytebot-cv/"

    echo -e "${GREEN}✓ Artifacts prepared (will be copied to C:\OEM during Windows installation)${NC}"
    echo ""
fi

# Change to docker directory
cd docker

# Determine which compose file to use
if [[ -f ".env" ]]; then
    # Select compose file based on target OS
    if [[ "$TARGET_OS" == "windows" ]]; then
        COMPOSE_FILE="docker-compose.windows.yml"
        echo -e "${BLUE}Using: Windows Stack${NC}"
        DESKTOP_SERVICE="bytebot-windows"
    elif [[ "$TARGET_OS" == "macos" ]]; then
        COMPOSE_FILE="docker-compose.macos.yml"
        echo -e "${BLUE}Using: macOS Stack${NC}"
        DESKTOP_SERVICE="bytebot-macos"
    else
        # Check if using proxy or standard stack for Linux
        if [[ -f "docker-compose.proxy.yml" ]]; then
            COMPOSE_FILE="docker-compose.proxy.yml"
            echo -e "${BLUE}Using: Proxy Stack (with LiteLLM)${NC}"
        else
            COMPOSE_FILE="docker-compose.yml"
            echo -e "${BLUE}Using: Standard Stack${NC}"
        fi
        DESKTOP_SERVICE="bytebot-desktop"
    fi
else
    echo -e "${RED}✗ docker/.env not found${NC}"
    echo ""
    echo "Copy and configure the environment file:"
    echo -e "  ${BLUE}cp docker/.env.example docker/.env${NC}"
    exit 1
fi

STACK_SERVICES=($DESKTOP_SERVICE bytebot-agent bytebot-ui postgres)
if [[ "$COMPOSE_FILE" == "docker-compose.proxy.yml" ]]; then
    STACK_SERVICES+=(bytebot-llm-proxy)
fi

# OS-specific checks
if [[ "$TARGET_OS" == "windows" ]]; then
    echo -e "${YELLOW}Note: Windows container requires KVM support${NC}"
    echo -e "${YELLOW}  - Ensure /dev/kvm is available on host${NC}"
    echo -e "${YELLOW}  - After Windows boots, run setup script inside container${NC}"
    echo ""
elif [[ "$TARGET_OS" == "macos" ]]; then
    echo -e "${YELLOW}Note: macOS container requires KVM support${NC}"
    echo -e "${YELLOW}  - Ensure /dev/kvm is available on host${NC}"
    echo -e "${YELLOW}  - Should only run on Apple hardware (licensing)${NC}"
    echo -e "${YELLOW}  - After macOS boots, run setup script inside container${NC}"
    echo ""
fi

# Platform-specific configuration
if [[ "$ARCH" == "arm64" ]] && [[ "$OS" == "Darwin" ]]; then
    echo -e "${BLUE}Platform: Apple Silicon${NC}"
    echo ""
    USE_NATIVE_HOLO=true

    # Check if native Holo is running
    if lsof -Pi :9989 -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${GREEN}✓ Native Holo 1.5-7B detected on port 9989${NC}"

        # Update .env.defaults (system defaults) to use native Holo
        if grep -q "HOLO_URL=http://bytebot-holo:9989" .env.defaults 2>/dev/null; then
            echo -e "${BLUE}Updating system configuration to use native Holo...${NC}"
            sed -i.bak 's|HOLO_URL=http://bytebot-holo:9989|HOLO_URL=http://host.docker.internal:9989|' .env.defaults
            rm .env.defaults.bak
        fi

        # Copy Holo settings from .env.defaults to .env (Docker Compose reads .env)
        if [ -f ".env" ]; then
            echo -e "${BLUE}Syncing Holo settings to .env...${NC}"
            # Update or add HOLO_URL in .env
            if grep -q "^HOLO_URL=" .env; then
                sed -i.bak 's|^HOLO_URL=.*|HOLO_URL=http://host.docker.internal:9989|' .env
                rm .env.bak
            else
                echo "HOLO_URL=http://host.docker.internal:9989" >> .env
            fi
        fi

        echo ""
        echo -e "${BLUE}Starting Docker stack (without Holo container)...${NC}"

        # Start all services except Holo container
        # --no-deps prevents starting dependent services (bytebot-holo)
        # Add --build flag to rebuild if code changed
        docker compose -f "$COMPOSE_FILE" up -d --build --no-deps "${STACK_SERVICES[@]}"

    else
        echo -e "${YELLOW}⚠ Native Holo 1.5-7B not running${NC}"
        echo ""

        # Check if it's been set up
        if [[ ! -d "../packages/bytebot-holo/venv" ]] && [[ ! -d "../packages/bytebot-holo/weights/icon_detect" ]]; then
            echo -e "${BLUE}→ Setting up native Holo 1.5-7B automatically (recommended for M4 GPU)...${NC}"
            echo ""
            cd ..
            ./scripts/setup-holo.sh
            echo ""
            echo -e "${BLUE}→ Starting native Holo 1.5-7B...${NC}"
            ./scripts/start-holo.sh
            echo ""
            echo "Waiting for OmniParser to be ready..."
            sleep 3
            cd docker
        else
            echo -e "${BLUE}→ Starting native Holo 1.5-7B automatically...${NC}"
            cd ..
            ./scripts/start-holo.sh
            echo ""
            echo "Waiting for Holo to be ready..."
            sleep 3
            cd docker
        fi

        # Update .env.defaults (system defaults) to use native Holo
        if grep -q "HOLO_URL=http://bytebot-holo:9989" .env.defaults 2>/dev/null; then
            sed -i.bak 's|HOLO_URL=http://bytebot-holo:9989|HOLO_URL=http://host.docker.internal:9989|' .env.defaults
            rm .env.defaults.bak
        fi

        # Copy Holo settings from .env.defaults to .env (Docker Compose reads .env)
        if [ -f ".env" ]; then
            # Update or add HOLO_URL in .env
            if grep -q "^HOLO_URL=" .env; then
                sed -i.bak 's|^HOLO_URL=.*|HOLO_URL=http://host.docker.internal:9989|' .env
                rm .env.bak
            else
                echo "HOLO_URL=http://host.docker.internal:9989" >> .env
            fi
        fi

        # Start stack without container
        echo ""
        echo -e "${BLUE}Starting Docker stack (without Holo container)...${NC}"
        # --no-deps prevents starting dependent services (bytebot-holo)
        # Add --build flag to rebuild if code changed
        docker compose -f "$COMPOSE_FILE" up -d --build --no-deps "${STACK_SERVICES[@]}"

        # Native start handled above; continue to unified readiness checks
    fi

elif [[ "$ARCH" == "x86_64" ]] || [[ "$ARCH" == "amd64" ]]; then
    echo -e "${BLUE}Platform: x86_64${NC}"
    EXPECT_HOLO_CONTAINER=true

    # Check for NVIDIA GPU
    if command -v nvidia-smi &> /dev/null; then
        echo -e "${GREEN}✓ NVIDIA GPU detected${NC}"
        nvidia-smi --query-gpu=name --format=csv,noheader | head -1
    fi

    echo ""
    echo -e "${BLUE}Starting Holo container first (GPU/CPU Docker)${NC}"
    docker compose -f "$COMPOSE_FILE" up -d --build bytebot-holo

    if wait_for_container_health "bytebot-holo" 480 5; then
        HOLO_PREWAIT=true
        HOLO_PREWAIT_SUCCESS=true
    else
        HOLO_PREWAIT=true
        HOLO_PREWAIT_SUCCESS=false
        echo -e "${YELLOW}⚠ Holo container not healthy yet; continuing to start remaining services${NC}"
    fi

    echo ""
    echo -e "${BLUE}Starting remaining Bytebot containers...${NC}"
    docker compose -f "$COMPOSE_FILE" up -d --build --no-deps "${STACK_SERVICES[@]}"
fi

# Wait for services to be ready
echo ""
echo -e "${BLUE}Waiting for services to start...${NC}"

all_healthy=true
holo_status_recorded=false
SERVICE_RESULTS=()

# Core services exposed via HTTP/WebSocket
standard_services=("UI|9992" "Agent|9991" "Desktop|9990")
for entry in "${standard_services[@]}"; do
    IFS='|' read -r label port <<< "$entry"
    if wait_for_port "$label" "$port" "localhost"; then
        SERVICE_RESULTS+=("$label|$port|ready")
    else
        SERVICE_RESULTS+=("$label|$port|starting")
        all_healthy=false
    fi
done

# Promote agent status if container exposes Docker health checks
if docker ps -a --format '{{.Names}}' | grep -qx "bytebot-agent" 2>/dev/null; then
    if wait_for_container_health "bytebot-agent" 300 5; then
        set_service_status "Agent" "ready"
    else
        set_service_status "Agent" "starting"
        all_healthy=false
    fi
fi

# Holo readiness depends on platform
if [[ "$USE_NATIVE_HOLO" == "true" ]]; then
    if wait_for_http "http://localhost:9989/health" "Holo 1.5-7B (native health)" 300 6; then
        SERVICE_RESULTS+=("Holo 1.5-7B|9989|ready")
    else
        SERVICE_RESULTS+=("Holo 1.5-7B|9989|starting")
        all_healthy=false
    fi
    holo_status_recorded=true
elif [[ "$EXPECT_HOLO_CONTAINER" == "true" ]]; then
    if [[ "$HOLO_PREWAIT" == "true" ]]; then
        if [[ "$HOLO_PREWAIT_SUCCESS" == "true" ]]; then
            if wait_for_http "http://localhost:9989/health" "Holo 1.5-7B (container health)" 240 6; then
                SERVICE_RESULTS+=("Holo 1.5-7B|9989|ready")
            else
                SERVICE_RESULTS+=("Holo 1.5-7B|9989|starting")
                all_healthy=false
            fi
        else
            SERVICE_RESULTS+=("Holo 1.5-7B|9989|starting")
            all_healthy=false
        fi
    else
        if wait_for_container_health "bytebot-holo" 420 5; then
            if wait_for_http "http://localhost:9989/health" "Holo 1.5-7B (container health)" 240 6; then
                SERVICE_RESULTS+=("Holo 1.5-7B|9989|ready")
            else
                SERVICE_RESULTS+=("Holo 1.5-7B|9989|starting")
                all_healthy=false
            fi
        else
            SERVICE_RESULTS+=("Holo 1.5-7B|9989|starting")
            all_healthy=false
        fi
    fi
    holo_status_recorded=true
fi

if [[ "$holo_status_recorded" == "false" ]]; then
    SERVICE_RESULTS+=("Holo 1.5-7B|9989|skipped")
fi

echo ""
echo -e "${BLUE}Service Status:${NC}"
for entry in "${SERVICE_RESULTS[@]}"; do
    IFS='|' read -r label port status <<< "$entry"
    case "$status" in
        ready)
            echo -e "  ${GREEN}✓${NC} $label (port $port)"
            ;;
        skipped)
            echo -e "  ${YELLOW}-${NC} $label (not managed by this stack)"
            ;;
        *)
            echo -e "  ${YELLOW}...${NC} $label (port $port) - still starting"
            ;;
    esac
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
if [[ "$TARGET_OS" == "windows" ]]; then
    echo "  • Windows:  http://localhost:8006 (web viewer)"
    echo "              rdp://localhost:3389 (RDP)"
    echo "              http://localhost:9990 (bytebotd - after setup)"
elif [[ "$TARGET_OS" == "macos" ]]; then
    echo "  • macOS:    http://localhost:8006 (web viewer)"
    echo "              vnc://localhost:5900 (VNC)"
    echo "              http://localhost:9990 (bytebotd - after setup)"
else
    echo "  • Desktop:  http://localhost:9990"
fi
echo "  • Holo 1.5-7B: http://localhost:9989"
echo ""
if [[ "$TARGET_OS" == "windows" ]]; then
    echo -e "${BLUE}Windows Auto-Install Running:${NC}"
    echo "  • Wait 7-13 minutes for first boot + automated setup"
    echo "  • Monitor progress at http://localhost:8006"
    echo "  • Bytebotd will be available at http://localhost:9990 when complete"
    echo "  • ONLY if auto-install fails: Run C:\shared\scripts\setup-windows-bytebotd.ps1"
    echo ""
elif [[ "$TARGET_OS" == "macos" ]]; then
    echo -e "${YELLOW}macOS Setup Required:${NC}"
    echo "1. Access macOS at http://localhost:8006"
    echo "2. Download setup script from /shared folder"
    echo "3. Run: sudo bash setup-macos-bytebotd.sh"
    echo ""
fi
echo "View logs:"
echo -e "  ${BLUE}docker compose -f docker/$COMPOSE_FILE logs -f${NC}"
echo ""
echo "Stop stack:"
echo -e "  ${BLUE}./scripts/stop-stack.sh${NC}"
echo ""
