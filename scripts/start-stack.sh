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
USE_PREBAKED=false  # Use pre-baked Windows image

# Parse command-line arguments
TARGET_OS_FROM_FLAG=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --os)
            TARGET_OS="$2"
            TARGET_OS_FROM_FLAG=true
            shift 2
            ;;
        --prebaked)
            USE_PREBAKED=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown argument: $1${NC}"
            echo "Usage: $0 [--os linux|windows|macos] [--prebaked]"
            exit 1
            ;;
    esac
done

# Interactive OS selection if not specified via flag
if [[ "$TARGET_OS_FROM_FLAG" == "false" ]]; then
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}   Target OS Selection${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════${NC}"
    echo ""
    echo "Which OS stack would you like to start?"
    echo "  1) Linux (desktop container - default)"
    echo "  2) Windows 11 (requires KVM)"
    echo "  3) macOS (requires KVM, Apple hardware)"
    echo ""
    read -p "Select option [1-3] (default: 1): " -n 1 -r OS_CHOICE
    echo ""

    case $OS_CHOICE in
        2)
            TARGET_OS="windows"
            echo -e "${YELLOW}✓ Windows 11 selected${NC}"
            ;;
        3)
            TARGET_OS="macos"
            echo -e "${YELLOW}✓ macOS selected${NC}"
            ;;
        1|"")
            TARGET_OS="linux"
            echo -e "${GREEN}✓ Linux selected${NC}"
            ;;
        *)
            echo -e "${YELLOW}Invalid choice, defaulting to Linux${NC}"
            TARGET_OS="linux"
            ;;
    esac
    echo ""

    # If Windows selected, ask about pre-baked image
    if [[ "$TARGET_OS" == "windows" ]]; then
        echo -e "${BLUE}Use pre-baked Windows image?${NC}"
        echo "  • Pre-baked: 30-60 seconds startup (96% faster)"
        echo "  • Runtime:   8-15 minutes startup"
        read -p "Use pre-baked image? [Y/n] " -n 1 -r PREBAKED_CHOICE
        echo ""
        if [[ ! $PREBAKED_CHOICE =~ ^[Nn]$ ]]; then
            USE_PREBAKED=true
            echo -e "${GREEN}✓ Using pre-baked image${NC}"
        else
            echo -e "${YELLOW}✓ Using runtime installation${NC}"
        fi
        echo ""
    fi

    # If macOS selected, ask about pre-baked image
    if [[ "$TARGET_OS" == "macos" ]]; then
        echo -e "${BLUE}Use pre-baked macOS image?${NC}"
        echo "  • Pre-baked: 30-60 seconds startup (96% faster)"
        echo "  • Runtime:   One-time manual setup + 5-8 min automated install"
        echo "  • Note: macOS requires one-time Setup Assistant completion (Apple licensing)"
        read -p "Use pre-baked image? [Y/n] " -n 1 -r PREBAKED_CHOICE
        echo ""
        if [[ ! $PREBAKED_CHOICE =~ ^[Nn]$ ]]; then
            USE_PREBAKED=true
            echo -e "${GREEN}✓ Using pre-baked image${NC}"
        else
            echo -e "${YELLOW}✓ Using runtime installation${NC}"
        fi
        echo ""
    fi
fi

# Validate TARGET_OS
if [[ "$TARGET_OS" != "linux" && "$TARGET_OS" != "windows" && "$TARGET_OS" != "macos" ]]; then
    echo -e "${RED}Invalid OS: $TARGET_OS${NC}"
    echo "Valid options: linux, windows, macos"
    exit 1
fi

# LMStudio configuration prompt (for all OS types)
echo ""
echo -e "${BLUE}════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   LMStudio Local Models (Optional)${NC}"
echo -e "${BLUE}════════════════════════════════════════════════${NC}"
echo ""
echo "Would you like to configure LMStudio for local models?"
echo "  • Runs models locally (FREE, no API costs)"
echo "  • Requires LMStudio server running on network"
echo "  • Models appear in UI under 'Local Models'"
echo ""
read -p "Configure LMStudio? [y/N] " -n 1 -r LMSTUDIO_CHOICE
echo ""
echo ""

if [[ $LMSTUDIO_CHOICE =~ ^[Yy]$ ]]; then
    # Get script directory
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    if [[ -f "$SCRIPT_DIR/setup-lmstudio.sh" ]]; then
        bash "$SCRIPT_DIR/setup-lmstudio.sh"
        if [ $? -ne 0 ]; then
            echo -e "${YELLOW}⚠ LMStudio setup failed or was cancelled${NC}"
            echo -e "${YELLOW}You can run it later: ./scripts/setup-lmstudio.sh${NC}"
            echo ""
        fi
    else
        echo -e "${RED}✗ LMStudio setup script not found${NC}"
        echo "Expected: $SCRIPT_DIR/setup-lmstudio.sh"
        echo ""
    fi
else
    echo -e "${YELLOW}✓ Skipping LMStudio configuration${NC}"
    echo "To configure later: ${CYAN}./scripts/setup-lmstudio.sh${NC}"
    echo ""
fi

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Starting Bytebot Hawkeye Stack ($TARGET_OS)${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Windows-specific: Prepare artifacts or pre-baked image
if [[ "$TARGET_OS" == "windows" ]]; then
    # Get script directory and project root
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

    # Note: BTRFS compatibility now handled by DISK_IO=threads and DISK_CACHE=writeback
    # in docker-compose files. No loop device workaround needed.

    if [[ "$USE_PREBAKED" == "true" ]]; then
        echo -e "${BLUE}Using pre-baked Windows image (96% faster startup)${NC}"
        echo ""

        # Check if pre-baked image exists
        if ! docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "bytebot-windows-prebaked:latest"; then
            echo -e "${YELLOW}⚠ Pre-baked image not found${NC}"
            echo ""
            echo "Building pre-baked image now..."
            echo ""

            # Build pre-baked image (skip test to prevent test-bytebot-windows creation)
            bash "$PROJECT_ROOT/scripts/build-windows-prebaked-image.sh" --skip-test

            if [ $? -ne 0 ]; then
                echo -e "${RED}✗ Failed to build pre-baked image${NC}"
                echo ""
                echo "Fallback to runtime installation:"
                echo -e "  ${BLUE}./scripts/start-stack.sh --os windows${NC}"
                exit 1
            fi
        else
            echo -e "${GREEN}✓ Pre-baked image found${NC}"
        fi

        echo -e "${BLUE}Startup time: ~30-60 seconds (vs 8-15 minutes with runtime installation)${NC}"
        echo ""

    else
        echo -e "${BLUE}Preparing Windows container artifacts (runtime installation)...${NC}"

        # Check if Windows container already exists (need to remove for fresh /oem copy)
        if docker ps -a --format '{{.Names}}' | grep -qx "bytebot-windows" 2>/dev/null; then
            echo -e "${YELLOW}Existing Windows container found - removing to ensure fresh /oem mount...${NC}"
            cd "$PROJECT_ROOT/docker"
            docker compose -f docker-compose.windows.yml down bytebot-windows 2>/dev/null || true
            docker rm -f bytebot-windows 2>/dev/null || true
            cd "$PROJECT_ROOT"
            echo -e "${GREEN}✓ Old container removed${NC}"
        fi

        # Check if artifacts already exist and are up-to-date
        ARTIFACTS_EXIST=false
        # Check if Windows installer package exists
        if [[ -f "$PROJECT_ROOT/docker/windows-installer/bytebotd-windows-installer.zip" ]]; then
            INSTALLER_SIZE=$(du -sh "$PROJECT_ROOT/docker/windows-installer/bytebotd-windows-installer.zip" | cut -f1)
            echo -e "${YELLOW}Windows installer package already exists (${INSTALLER_SIZE})${NC}"
            echo -e "${BLUE}Using existing installer from previous build${NC}"
            echo -e "${BLUE}To force rebuild: rm -rf docker/windows-installer${NC}"
        else
            echo -e "${BLUE}Building Windows installer package...${NC}"
            echo ""

            # Run the installer build script
            if [[ -f "$PROJECT_ROOT/scripts/build-windows-installer.sh" ]]; then
                bash "$PROJECT_ROOT/scripts/build-windows-installer.sh"
            else
                echo -e "${RED}✗ Windows installer build script not found${NC}"
                echo ""
                echo "Expected: $PROJECT_ROOT/scripts/build-windows-installer.sh"
                exit 1
            fi
        fi

        echo -e "${BLUE}Installer will be available as \\\\host.lan\\Data\\bytebotd-windows-installer.zip in Windows container${NC}"
        echo ""
    fi

    # Windows ISO cache detection and management (supports multiple variants)
    ISO_CACHE_DIR="$PROJECT_ROOT/docker/iso-cache"

    # Detect ALL cached ISOs (both Tiny11 and Nano11)
    TINY11_CACHED=false
    NANO11_CACHED=false
    TINY11_SIZE=""
    NANO11_SIZE=""

    if [ -f "$ISO_CACHE_DIR/tiny11-2311-x64.iso" ]; then
        TINY11_CACHED=true
        TINY11_SIZE=$(du -sh "$ISO_CACHE_DIR/tiny11-2311-x64.iso" | cut -f1)
    fi

    if [ -f "$ISO_CACHE_DIR/nano11-25h2.iso" ]; then
        NANO11_CACHED=true
        NANO11_SIZE=$(du -sh "$ISO_CACHE_DIR/nano11-25h2.iso" | cut -f1)
    fi

    # Show interactive variant selection menu
    echo -e "${BLUE}════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}   Windows ISO Variant Selection${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════${NC}"
    echo ""
    echo "Which Windows ISO variant would you like to use?"
    echo ""

    # Build menu options dynamically based on what's cached
    if [[ "$TINY11_CACHED" == "true" ]] && [[ "$NANO11_CACHED" == "true" ]]; then
        # Both cached - offer both, redownload, or skip
        echo -e "${GREEN}1) Tiny11 2311 (${TINY11_SIZE} cached)${NC}"
        echo "   ✅ Serviceable and updateable"
        echo "   ✅ Windows Defender, Windows Update, Audio"
        echo "   ✅ Suitable for production/daily use"
        echo ""
        echo -e "${YELLOW}2) Nano11 25H2 (${NANO11_SIZE} cached)${NC}"
        echo "   ⚠️  Minimal footprint, testing/VMs only"
        echo "   ⚠️  NOT serviceable, no Windows Update, no Audio"
        echo ""
        echo -e "${BLUE}3) Redownload/replace existing ISO${NC}"
        echo ""
        echo -e "${BLUE}4) Skip (download during boot)${NC}"
        echo ""
        read -p "Select option [1-4] (default: 1): " -n 1 -r ISO_CHOICE
        echo ""
        echo ""

        case $ISO_CHOICE in
            2)
                ISO_FILENAME="nano11-25h2.iso"
                USE_CACHED_ISO=true
                echo -e "${YELLOW}✓ Using cached Nano11 25H2 (minimal variant)${NC}"
                ;;
            3)
                echo -e "${YELLOW}Choose variant to redownload:${NC}"
                if [ -f "$PROJECT_ROOT/scripts/download-windows-iso.sh" ]; then
                    bash "$PROJECT_ROOT/scripts/download-windows-iso.sh"
                    # Re-detect which ISO was downloaded
                    if [ -f "$ISO_CACHE_DIR/tiny11-2311-x64.iso" ]; then
                        ISO_FILENAME="tiny11-2311-x64.iso"
                    elif [ -f "$ISO_CACHE_DIR/nano11-25h2.iso" ]; then
                        ISO_FILENAME="nano11-25h2.iso"
                    fi
                    USE_CACHED_ISO=true
                else
                    echo -e "${RED}ERROR: Download script not found${NC}"
                    exit 1
                fi
                ;;
            4)
                echo -e "${YELLOW}✓ Skipping cached ISO - dockur/windows will download during boot${NC}"
                USE_CACHED_ISO=false
                ;;
            1|"")
                ISO_FILENAME="tiny11-2311-x64.iso"
                USE_CACHED_ISO=true
                echo -e "${GREEN}✓ Using cached Tiny11 2311 (recommended)${NC}"
                ;;
            *)
                echo -e "${YELLOW}Invalid choice, defaulting to Tiny11${NC}"
                ISO_FILENAME="tiny11-2311-x64.iso"
                USE_CACHED_ISO=true
                ;;
        esac

    elif [[ "$TINY11_CACHED" == "true" ]]; then
        # Only Tiny11 cached - offer Tiny11, download Nano11, redownload, or skip
        echo -e "${GREEN}1) Tiny11 2311 (${TINY11_SIZE} cached)${NC}"
        echo "   ✅ Serviceable and updateable"
        echo ""
        echo -e "${YELLOW}2) Nano11 25H2 (download ~2.3GB)${NC}"
        echo "   ⚠️  Minimal variant, testing only"
        echo ""
        echo -e "${BLUE}3) Redownload Tiny11${NC}"
        echo ""
        echo -e "${BLUE}4) Skip (download during boot)${NC}"
        echo ""
        read -p "Select option [1-4] (default: 1): " -n 1 -r ISO_CHOICE
        echo ""
        echo ""

        case $ISO_CHOICE in
            2)
                echo -e "${BLUE}Downloading Nano11 25H2...${NC}"
                if [ -f "$PROJECT_ROOT/scripts/download-windows-iso.sh" ]; then
                    bash "$PROJECT_ROOT/scripts/download-windows-iso.sh" --variant nano11
                    ISO_FILENAME="nano11-25h2.iso"
                    USE_CACHED_ISO=true
                else
                    echo -e "${RED}ERROR: Download script not found${NC}"
                    exit 1
                fi
                ;;
            3)
                echo -e "${YELLOW}Redownloading Tiny11...${NC}"
                rm -f "$ISO_CACHE_DIR/tiny11-2311-x64.iso"
                if [ -f "$PROJECT_ROOT/scripts/download-windows-iso.sh" ]; then
                    bash "$PROJECT_ROOT/scripts/download-windows-iso.sh" --variant tiny11
                    ISO_FILENAME="tiny11-2311-x64.iso"
                    USE_CACHED_ISO=true
                else
                    echo -e "${RED}ERROR: Download script not found${NC}"
                    exit 1
                fi
                ;;
            4)
                echo -e "${YELLOW}✓ Skipping cached ISO - dockur/windows will download during boot${NC}"
                USE_CACHED_ISO=false
                ;;
            1|"")
                ISO_FILENAME="tiny11-2311-x64.iso"
                USE_CACHED_ISO=true
                echo -e "${GREEN}✓ Using cached Tiny11 2311${NC}"
                ;;
            *)
                echo -e "${YELLOW}Invalid choice, defaulting to cached Tiny11${NC}"
                ISO_FILENAME="tiny11-2311-x64.iso"
                USE_CACHED_ISO=true
                ;;
        esac

    elif [[ "$NANO11_CACHED" == "true" ]]; then
        # Only Nano11 cached - offer Nano11, download Tiny11, redownload, or skip
        echo -e "${YELLOW}1) Nano11 25H2 (${NANO11_SIZE} cached)${NC}"
        echo "   ⚠️  Minimal variant, testing only"
        echo ""
        echo -e "${GREEN}2) Tiny11 2311 (download ~3.5GB)${NC}"
        echo "   ✅ Recommended for general use"
        echo ""
        echo -e "${BLUE}3) Redownload Nano11${NC}"
        echo ""
        echo -e "${BLUE}4) Skip (download during boot)${NC}"
        echo ""
        read -p "Select option [1-4] (default: 1): " -n 1 -r ISO_CHOICE
        echo ""
        echo ""

        case $ISO_CHOICE in
            2)
                echo -e "${BLUE}Downloading Tiny11 2311...${NC}"
                if [ -f "$PROJECT_ROOT/scripts/download-windows-iso.sh" ]; then
                    bash "$PROJECT_ROOT/scripts/download-windows-iso.sh" --variant tiny11
                    ISO_FILENAME="tiny11-2311-x64.iso"
                    USE_CACHED_ISO=true
                else
                    echo -e "${RED}ERROR: Download script not found${NC}"
                    exit 1
                fi
                ;;
            3)
                echo -e "${YELLOW}Redownloading Nano11...${NC}"
                rm -f "$ISO_CACHE_DIR/nano11-25h2.iso"
                if [ -f "$PROJECT_ROOT/scripts/download-windows-iso.sh" ]; then
                    bash "$PROJECT_ROOT/scripts/download-windows-iso.sh" --variant nano11
                    ISO_FILENAME="nano11-25h2.iso"
                    USE_CACHED_ISO=true
                else
                    echo -e "${RED}ERROR: Download script not found${NC}"
                    exit 1
                fi
                ;;
            4)
                echo -e "${YELLOW}✓ Skipping cached ISO - dockur/windows will download during boot${NC}"
                USE_CACHED_ISO=false
                ;;
            1|"")
                ISO_FILENAME="nano11-25h2.iso"
                USE_CACHED_ISO=true
                echo -e "${YELLOW}✓ Using cached Nano11 25H2${NC}"
                ;;
            *)
                echo -e "${YELLOW}Invalid choice, defaulting to cached Nano11${NC}"
                ISO_FILENAME="nano11-25h2.iso"
                USE_CACHED_ISO=true
                ;;
        esac

    else
        # No ISOs cached - offer download or skip
        echo -e "${GREEN}1) Tiny11 2311 (download ~3.5GB)${NC}"
        echo "   ✅ Recommended for general use"
        echo "   ✅ Serviceable, updateable, production-ready"
        echo ""
        echo -e "${YELLOW}2) Nano11 25H2 (download ~2.3GB)${NC}"
        echo "   ⚠️  Minimal variant, testing/VMs only"
        echo "   ⚠️  NOT serviceable, no Windows Update"
        echo ""
        echo -e "${BLUE}3) Skip (download during boot)${NC}"
        echo ""
        read -p "Select option [1-3] (default: 1): " -n 1 -r ISO_CHOICE
        echo ""
        echo ""

        case $ISO_CHOICE in
            2)
                echo -e "${BLUE}Downloading Nano11 25H2...${NC}"
                if [ -f "$PROJECT_ROOT/scripts/download-windows-iso.sh" ]; then
                    bash "$PROJECT_ROOT/scripts/download-windows-iso.sh" --variant nano11
                    ISO_FILENAME="nano11-25h2.iso"
                    USE_CACHED_ISO=true
                else
                    echo -e "${RED}ERROR: Download script not found${NC}"
                    exit 1
                fi
                ;;
            3)
                echo -e "${YELLOW}✓ Skipping ISO download - dockur/windows will download during boot${NC}"
                USE_CACHED_ISO=false
                ;;
            1|"")
                echo -e "${BLUE}Downloading Tiny11 2311...${NC}"
                if [ -f "$PROJECT_ROOT/scripts/download-windows-iso.sh" ]; then
                    bash "$PROJECT_ROOT/scripts/download-windows-iso.sh" --variant tiny11
                    ISO_FILENAME="tiny11-2311-x64.iso"
                    USE_CACHED_ISO=true
                else
                    echo -e "${RED}ERROR: Download script not found${NC}"
                    exit 1
                fi
                ;;
            *)
                echo -e "${YELLOW}Invalid choice, downloading Tiny11 (recommended)${NC}"
                if [ -f "$PROJECT_ROOT/scripts/download-windows-iso.sh" ]; then
                    bash "$PROJECT_ROOT/scripts/download-windows-iso.sh" --variant tiny11
                    ISO_FILENAME="tiny11-2311-x64.iso"
                    USE_CACHED_ISO=true
                else
                    echo -e "${RED}ERROR: Download script not found${NC}"
                    exit 1
                fi
                ;;
        esac
    fi
    echo ""

    # Export WINDOWS_ISO_URL for docker-compose.windows-prebaked.yml VERSION environment variable
    # This ensures the correct ISO URL is used based on user's variant selection
    if [[ "${USE_CACHED_ISO:-false}" == "true" ]] && [[ -n "${ISO_FILENAME:-}" ]]; then
        if [[ "$ISO_FILENAME" == "nano11-25h2.iso" ]]; then
            export WINDOWS_ISO_URL="https://archive.org/download/nano11_25h2/nano11%2025h2.iso"
            echo -e "${YELLOW}Using Nano11 25H2 ISO URL for prebaked image${NC}"
        else
            export WINDOWS_ISO_URL="https://archive.org/download/tiny11-2311/tiny11%202311%20x64.iso"
            echo -e "${GREEN}Using Tiny11 2311 ISO URL for prebaked image${NC}"
        fi
        echo ""
    fi
fi

# macOS-specific: Prepare prebaked image or installer package
if [[ "$TARGET_OS" == "macos" ]]; then
    # Get script directory and project root
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

    if [[ "$USE_PREBAKED" == "true" ]]; then
        echo -e "${BLUE}Using pre-baked macOS image (96% faster startup)${NC}"
        echo ""

        # Check if pre-baked image exists
        if ! docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "bytebot-macos-prebaked:latest"; then
            echo -e "${YELLOW}⚠ Pre-baked image not found${NC}"
            echo ""
            echo "To create the prebaked image, you must first run:"
            echo -e "  ${CYAN}./scripts/build-macos-prebaked-image.sh${NC}"
            echo ""
            echo "This requires ONE-TIME manual Setup Assistant completion (~10-15 minutes)."
            echo "After that, the prebaked image boots in 30-60 seconds."
            echo ""
            read -p "Build pre-baked image now? [Y/n] " -n 1 -r BUILD_CHOICE
            echo ""
            if [[ ! $BUILD_CHOICE =~ ^[Nn]$ ]]; then
                bash "$PROJECT_ROOT/scripts/build-macos-prebaked-image.sh"
                if [ $? -ne 0 ]; then
                    echo -e "${RED}✗ Failed to build pre-baked image${NC}"
                    echo ""
                    echo "Fallback to runtime installation:"
                    echo -e "  ${BLUE}./scripts/start-stack.sh --os macos${NC}"
                    exit 1
                fi
            else
                echo -e "${YELLOW}Cannot start without prebaked image. Exiting.${NC}"
                echo ""
                echo "Run this to build the prebaked image first:"
                echo -e "  ${CYAN}./scripts/build-macos-prebaked-image.sh${NC}"
                exit 1
            fi
        else
            echo -e "${GREEN}✓ Pre-baked image found${NC}"
        fi

        echo -e "${BLUE}Startup time: ~30-60 seconds (vs 10-15 minutes with runtime installation)${NC}"
        echo ""

    else
        echo -e "${BLUE}Preparing macOS runtime installation...${NC}"
        echo ""

        # Check if macOS package already exists
        if [[ -f "$PROJECT_ROOT/docker/macos-installer/bytebotd-macos-prebaked.tar.gz" ]]; then
            PACKAGE_SIZE=$(du -sh "$PROJECT_ROOT/docker/macos-installer/bytebotd-macos-prebaked.tar.gz" | cut -f1)
            echo -e "${YELLOW}macOS installer package already exists (${PACKAGE_SIZE})${NC}"
            echo -e "${BLUE}Using existing package from previous build${NC}"
            echo -e "${BLUE}To force rebuild: rm -rf docker/macos-installer${NC}"
            echo ""
        else
            echo -e "${BLUE}Building macOS installer package...${NC}"
            echo ""

            # Run the package build script
            if [[ -f "$PROJECT_ROOT/scripts/build-macos-prebaked-package.sh" ]]; then
                bash "$PROJECT_ROOT/scripts/build-macos-prebaked-package.sh"
            else
                echo -e "${RED}✗ macOS package build script not found${NC}"
                echo ""
                echo "Expected: $PROJECT_ROOT/scripts/build-macos-prebaked-package.sh"
                exit 1
            fi
        fi

        # Copy installation files to shared directory
        echo -e "${BLUE}Copying installation files to shared directory...${NC}"

        # Ensure shared directory exists
        mkdir -p "$PROJECT_ROOT/docker/shared"

        # Copy first-time setup script (new prebaked workflow)
        if [[ -f "$PROJECT_ROOT/scripts/setup-macos-first-time.sh" ]]; then
            cp "$PROJECT_ROOT/scripts/setup-macos-first-time.sh" "$PROJECT_ROOT/docker/shared/"
            chmod +x "$PROJECT_ROOT/docker/shared/setup-macos-first-time.sh"
            echo -e "${GREEN}  ✓ First-time setup script copied${NC}"
        fi

        # Copy package tarball
        if [[ -f "$PROJECT_ROOT/docker/macos-installer/bytebotd-macos-prebaked.tar.gz" ]]; then
            cp "$PROJECT_ROOT/docker/macos-installer/bytebotd-macos-prebaked.tar.gz" "$PROJECT_ROOT/docker/shared/"
            echo -e "${GREEN}  ✓ Package tarball copied${NC}"
        else
            echo -e "${RED}✗ Package tarball not found${NC}"
            exit 1
        fi

        echo -e "${GREEN}✓ Installation files ready${NC}"
        echo ""
        echo -e "${BLUE}Files available in macOS VM at /shared/:${NC}"
        echo "  • setup-macos-first-time.sh (bootstrap script - run after Setup Assistant)"
        echo "  • bytebotd-macos-prebaked.tar.gz ($(du -sh "$PROJECT_ROOT/docker/macos-installer/bytebotd-macos-prebaked.tar.gz" | cut -f1))"
        echo ""
    fi
fi

# Change to docker directory
cd docker

# Determine which compose file to use
if [[ -f ".env" ]]; then
    # Select compose file based on target OS
    if [[ "$TARGET_OS" == "windows" ]]; then
        if [[ "$USE_PREBAKED" == "true" ]]; then
            COMPOSE_FILE="docker-compose.windows-prebaked.yml"
            echo -e "${BLUE}Using: Windows Stack (Pre-baked Image)${NC}"
        else
            COMPOSE_FILE="docker-compose.windows.yml"
            echo -e "${BLUE}Using: Windows Stack (Runtime Installation)${NC}"
        fi
        DESKTOP_SERVICE="bytebot-windows"
    elif [[ "$TARGET_OS" == "macos" ]]; then
        if [[ "$USE_PREBAKED" == "true" ]]; then
            COMPOSE_FILE="docker-compose.macos-prebaked.yml"
            echo -e "${BLUE}Using: macOS Stack (Pre-baked Image)${NC}"
        else
            COMPOSE_FILE="docker-compose.macos.yml"
            echo -e "${BLUE}Using: macOS Stack (Runtime Installation)${NC}"
        fi
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

# Enable ISO cache mount if requested (Windows only)
if [[ "$TARGET_OS" == "windows" ]] && [[ "${USE_CACHED_ISO:-false}" == "true" ]] && [[ -n "${ISO_FILENAME:-}" ]]; then
    echo -e "${BLUE}Enabling cached Windows ISO mount ($ISO_FILENAME)...${NC}"
    # Uncomment and update the ISO mount line in the compose file with actual filename
    sed -i "s|^      # - \./iso-cache/.*\.iso:/custom.iso:ro|      - ./iso-cache/$ISO_FILENAME:/custom.iso:ro|" "$COMPOSE_FILE"
    echo -e "${GREEN}✓ ISO cache enabled (saves 5-10 min download)${NC}"
    echo ""
fi

STACK_SERVICES=($DESKTOP_SERVICE bytebot-agent bytebot-ui postgres bytebot-llm-proxy)

# Always include proxy overlay (unless already the primary compose file)
COMPOSE_FILES=("-f" "$COMPOSE_FILE")
if [[ "$COMPOSE_FILE" != "docker-compose.proxy.yml" ]]; then
    COMPOSE_FILES+=("-f" "docker-compose.proxy.yml")
fi

# Set correct desktop URLs for Windows/macOS (prevents proxy.yml from using wrong defaults)
if [[ "$TARGET_OS" == "windows" ]]; then
    export BYTEBOT_DESKTOP_BASE_URL="http://bytebot-windows:9990"
    export BYTEBOT_DESKTOP_VNC_URL="http://bytebot-windows:8006/websockify"
elif [[ "$TARGET_OS" == "macos" ]]; then
    export BYTEBOT_DESKTOP_BASE_URL="http://bytebot-macos:9990"
    export BYTEBOT_DESKTOP_VNC_URL="http://bytebot-macos:8006/websockify"
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
        docker compose "${COMPOSE_FILES[@]}" up -d --build --no-deps "${STACK_SERVICES[@]}"

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
        docker compose "${COMPOSE_FILES[@]}" up -d --build --no-deps "${STACK_SERVICES[@]}"

        # Native start handled above; continue to unified readiness checks
    fi

elif [[ "$ARCH" == "x86_64" ]] || [[ "$ARCH" == "amd64" ]]; then
    echo -e "${BLUE}Platform: x86_64${NC}"

    # Detect GPU availability for Holo 1.5-7B
    HAS_GPU=false
    GPU_NAME=""

    if command -v nvidia-smi &> /dev/null && nvidia-smi &> /dev/null 2>&1; then
        HAS_GPU=true
        GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
        echo -e "${GREEN}✓ NVIDIA GPU detected: $GPU_NAME${NC}"
        echo -e "${GREEN}  → Holo 1.5-7B will use GPU acceleration (~0.6-2s/frame)${NC}"
    elif [ -f /proc/driver/nvidia/version ]; then
        # NVIDIA driver exists but nvidia-smi might not work (WSL edge case)
        HAS_GPU=true
        echo -e "${YELLOW}⚠ NVIDIA driver detected but nvidia-smi unavailable${NC}"
        echo -e "${YELLOW}  → Attempting GPU mode (may fall back to CPU)${NC}"
    else
        echo -e "${YELLOW}⚠ No NVIDIA GPU detected${NC}"
        echo -e "${YELLOW}  → Holo 1.5-7B disabled (CPU mode too slow: 15-30s/frame)${NC}"
        echo -e "${YELLOW}  → Computer vision will use Tesseract.js OCR fallback${NC}"
    fi

    echo ""

    if [[ "$HAS_GPU" == "true" ]]; then
        EXPECT_HOLO_CONTAINER=true
        echo -e "${BLUE}Starting Holo container first (GPU mode)${NC}"
        docker compose "${COMPOSE_FILES[@]}" up -d --build bytebot-holo
    else
        EXPECT_HOLO_CONTAINER=false
        # CPU-only mode: disable Holo and skip container
        export BYTEBOT_CV_USE_HOLO=false

        # Apply CPU-only compose overlay (removes Holo dependencies)
        COMPOSE_FILES+=("-f" "docker-compose.cpu-only.yml")

        # Persist setting to docker/.env
        if [ -f ".env" ]; then
            if grep -q "^BYTEBOT_CV_USE_HOLO=" .env; then
                sed -i.bak 's|^BYTEBOT_CV_USE_HOLO=.*|BYTEBOT_CV_USE_HOLO=false|' .env
                rm .env.bak
            else
                echo "BYTEBOT_CV_USE_HOLO=false" >> .env
            fi
        fi

        echo -e "${BLUE}Skipping Holo container (CPU-only mode)${NC}"
        echo -e "${YELLOW}  → Applied CPU-only compose overlay (removed Holo dependencies)${NC}"
        echo -e "${YELLOW}  → Set BYTEBOT_CV_USE_HOLO=false in docker/.env${NC}"
    fi

    if [[ "$HAS_GPU" == "true" ]]; then
        if wait_for_container_health "bytebot-holo" 480 5; then
            HOLO_PREWAIT=true
            HOLO_PREWAIT_SUCCESS=true
        else
            HOLO_PREWAIT=true
            HOLO_PREWAIT_SUCCESS=false
            echo -e "${YELLOW}⚠ Holo container not healthy yet; continuing to start remaining services${NC}"
        fi
    fi

    # Optimize Windows startup: start Windows early to parallelize installation with image builds
    # This saves 5-10 minutes by running Windows installation during agent/UI image compilation
    if [[ "$TARGET_OS" == "windows" ]]; then
        echo ""
        echo -e "${BLUE}Starting Windows container early (parallelizes installation with image builds)...${NC}"
        docker compose "${COMPOSE_FILES[@]}" up -d --no-deps bytebot-windows

        if [[ "$USE_PREBAKED" == "true" ]]; then
            echo -e "${YELLOW}Windows will boot (~30-60s) while other services build${NC}"
        else
            echo -e "${YELLOW}Windows will install (~8-15 min) while other services build${NC}"
        fi
    fi

    echo ""
    echo -e "${BLUE}Starting remaining Bytebot containers...${NC}"

    # If Windows already started, exclude it from the service list
    if [[ "$TARGET_OS" == "windows" ]]; then
        REMAINING_SERVICES=(bytebot-agent bytebot-ui postgres bytebot-llm-proxy)
        docker compose "${COMPOSE_FILES[@]}" up -d --build --no-deps "${REMAINING_SERVICES[@]}"
    else
        docker compose "${COMPOSE_FILES[@]}" up -d --build --no-deps "${STACK_SERVICES[@]}"
    fi
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
    if [[ "$USE_PREBAKED" == "true" ]]; then
        echo -e "${BLUE}Pre-baked Windows Image Starting:${NC}"
        echo "  • Expected startup: 30-60 seconds (96% faster!)"
        echo "  • MSI installer runs automatically during first boot"
        echo "  • Monitor progress at http://localhost:8006"
        echo "  • Bytebotd will be available at http://localhost:9990 when complete"
        echo ""
    else
        echo -e "${BLUE}Windows Auto-Install Running:${NC}"
        echo "  • Wait 8-15 minutes for first boot + automated setup"
        echo "  • Monitor progress at http://localhost:8006"
        echo "  • Bytebotd will be available at http://localhost:9990 when complete"
        echo "  • ONLY if auto-install fails: Run C:\shared\scripts\setup-windows-bytebotd.ps1"
        echo ""
    fi
elif [[ "$TARGET_OS" == "macos" ]]; then
    if [[ "$USE_PREBAKED" == "true" ]]; then
        echo -e "${BLUE}Pre-baked macOS Image Starting:${NC}"
        echo "  • Expected startup: 30-60 seconds (96% faster!)"
        echo "  • Bytebotd starts automatically via LaunchAgent"
        echo "  • Monitor progress at http://localhost:8006"
        echo "  • Bytebotd will be available at http://localhost:9990 when complete"
        echo ""
    else
        echo -e "${BLUE}macOS Runtime Installation:${NC}"
        echo "  1. Wait for macOS to boot (first-time: ~5-10 minutes)"
        echo "  2. Access macOS at http://localhost:8006 or vnc://localhost:5900"
        echo "  3. Complete Setup Assistant manually (~5 minutes):"
        echo "     • Select region and keyboard"
        echo "     • SKIP Migration Assistant, Apple ID, iCloud"
        echo "     • Create user: docker/docker"
        echo "     • SKIP Analytics, Screen Time, Siri"
        echo "  4. Open Terminal and run ONE command:"
        echo -e "     ${CYAN}sudo bash /shared/setup-macos-first-time.sh${NC}"
        echo ""
        echo "  The setup script will:"
        echo "  • Install Homebrew and Node.js (~3-5 minutes)"
        echo "  • Extract and configure bytebotd (~2-3 minutes)"
        echo "  • Set up LaunchAgent for auto-start"
        echo ""
        echo "  After installation:"
        echo "  • Bytebotd will be available at http://localhost:9990"
        echo "  • Auto-starts on future boots"
        echo "  • Total time: ~10-15 minutes (one-time only)"
        echo ""
    fi
fi
echo "View logs:"
echo -e "  ${BLUE}docker compose -f docker/$COMPOSE_FILE logs -f${NC}"
echo ""
echo "Stop stack:"
echo -e "  ${BLUE}./scripts/stop-stack.sh${NC}"
echo ""
