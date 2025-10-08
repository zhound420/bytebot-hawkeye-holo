#!/usr/bin/env bash
set -e
set -o pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Preparing Windows Container Artifacts${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Ensure we're in the repo root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$REPO_ROOT"

ARTIFACTS_DIR="docker/artifacts"

echo -e "${BLUE}Step 1: Cleaning existing artifacts...${NC}"
if [ -d "$ARTIFACTS_DIR" ]; then
    echo "Removing old artifacts: $ARTIFACTS_DIR"
    rm -rf "$ARTIFACTS_DIR"
fi
mkdir -p "$ARTIFACTS_DIR"
echo -e "${GREEN}✓ Cleaned${NC}"
echo ""

# Check if packages are built
echo -e "${BLUE}Step 2: Verifying packages are built...${NC}"

PACKAGES_TO_CHECK=(
    "packages/shared/dist"
    "packages/bytebot-cv/dist"
    "packages/bytebotd/dist"
)

missing_packages=()
for pkg in "${PACKAGES_TO_CHECK[@]}"; do
    if [ ! -d "$pkg" ]; then
        missing_packages+=("$pkg")
    fi
done

if [ ${#missing_packages[@]} -gt 0 ]; then
    echo -e "${RED}✗ Missing built packages:${NC}"
    for pkg in "${missing_packages[@]}"; do
        echo "  - $pkg"
    done
    echo ""
    echo -e "${YELLOW}Please build packages first:${NC}"
    echo "  cd packages/shared && npm run build"
    echo "  cd ../bytebot-cv && npm install && npm run build"
    echo "  cd ../bytebotd && npm install && npm run build"
    echo ""
    echo "Or run the automated build:"
    echo "  ./scripts/fresh-build.sh"
    exit 1
fi

echo -e "${GREEN}✓ All packages built${NC}"
echo ""

# Function to copy package with symlinks resolved
copy_package_resolved() {
    local pkg_name="$1"
    local pkg_path="packages/$pkg_name"
    local dest_path="$ARTIFACTS_DIR/$pkg_name"

    echo -e "${BLUE}Copying $pkg_name (resolving symlinks)...${NC}"

    mkdir -p "$dest_path"

    # Copy dist directory (compiled code)
    if [ -d "$pkg_path/dist" ]; then
        echo "  - dist/"
        cp -rL "$pkg_path/dist" "$dest_path/"
    fi

    # Copy package.json (required for npm)
    if [ -f "$pkg_path/package.json" ]; then
        echo "  - package.json"
        cp "$pkg_path/package.json" "$dest_path/"
    fi

    # Copy tsconfig.json if exists
    if [ -f "$pkg_path/tsconfig.json" ]; then
        echo "  - tsconfig.json"
        cp "$pkg_path/tsconfig.json" "$dest_path/"
    fi

    # Copy node_modules with special handling for symlinks
    # For bytebotd: Use workspace root node_modules (npm workspace hoisting)
    # For other packages: Use package-local node_modules if exists
    if [ "$pkg_name" = "bytebotd" ]; then
        # Bytebotd uses workspace root node_modules (hoisted dependencies)
        if [ -d "$REPO_ROOT/node_modules" ]; then
            echo "  - node_modules/ (from workspace root - hoisted dependencies, ~1.4GB, may take 5-10 minutes...)"

            # Create node_modules directory
            mkdir -p "$dest_path/node_modules"

            # Copy workspace root node_modules resolving all symlinks
            if command -v rsync >/dev/null 2>&1; then
                rsync -aL --info=progress2 "$REPO_ROOT/node_modules/" "$dest_path/node_modules/"
            else
                # cp -rL follows symlinks and copies the actual files
                cp -rL "$REPO_ROOT/node_modules" "$dest_path/"
            fi
        else
            echo -e "${RED}✗ Workspace root node_modules not found!${NC}"
            echo "Run 'npm install' in project root first"
            exit 1
        fi
    else
        # For shared and bytebot-cv: Use package-local node_modules if exists
        if [ -d "$pkg_path/node_modules" ]; then
            echo "  - node_modules/ (package-local)"

            # Create node_modules directory
            mkdir -p "$dest_path/node_modules"

            # Copy node_modules resolving all symlinks
            if command -v rsync >/dev/null 2>&1; then
                rsync -aL --info=progress2 "$pkg_path/node_modules/" "$dest_path/node_modules/"
            else
                # cp -rL follows symlinks and copies the actual files
                cp -rL "$pkg_path/node_modules" "$dest_path/"
            fi
        fi
    fi

    echo -e "${GREEN}✓ $pkg_name copied${NC}"
    echo ""
}

# Copy packages in dependency order
echo -e "${BLUE}Step 3: Copying packages with resolved symlinks...${NC}"
echo ""

copy_package_resolved "shared"
copy_package_resolved "bytebot-cv"
copy_package_resolved "bytebotd"

# Verify critical files exist
echo -e "${BLUE}Step 4: Verifying artifacts...${NC}"

CRITICAL_FILES=(
    "$ARTIFACTS_DIR/bytebotd/dist/main.js"
    "$ARTIFACTS_DIR/bytebotd/package.json"
    "$ARTIFACTS_DIR/shared/dist"
    "$ARTIFACTS_DIR/bytebot-cv/dist"
)

all_present=true
for file in "${CRITICAL_FILES[@]}"; do
    if [ ! -e "$file" ]; then
        echo -e "${RED}✗ Missing: $file${NC}"
        all_present=false
    else
        echo -e "${GREEN}✓${NC} $file"
    fi
done

if [ "$all_present" = false ]; then
    echo ""
    echo -e "${RED}Artifact preparation failed - missing critical files${NC}"
    exit 1
fi

echo ""

# Calculate artifact size
ARTIFACT_SIZE=$(du -sh "$ARTIFACTS_DIR" | cut -f1)

echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}   Artifacts Prepared Successfully!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "Artifacts location: $ARTIFACTS_DIR"
echo "Total size: $ARTIFACT_SIZE"
echo ""
echo "All symlinks have been resolved to real files."
echo "The Windows container can now use these artifacts."
echo ""
echo "Next steps:"
echo "  1. Start Windows container: ./scripts/start-stack.sh --os windows"
echo "  2. Monitor progress: docker logs -f bytebot-windows"
echo "  3. Access Windows: http://localhost:8006"
echo ""
