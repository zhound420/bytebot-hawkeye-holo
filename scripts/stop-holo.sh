#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Stopping Holo 1.5-7B...${NC}"

# Check if PID file exists
if [[ -f "logs/holo.pid" ]]; then
    PID=$(cat logs/holo.pid)
    if ps -p $PID > /dev/null 2>&1; then
        kill $PID
        echo -e "${GREEN}✓ Stopped Holo 1.5-7B (PID: $PID)${NC}"
        rm logs/holo.pid
    else
        echo -e "${YELLOW}⚠ Process not running (stale PID file)${NC}"
        rm logs/holo.pid
    fi
else
    # Also check for old omniparser.pid for backward compatibility
    if [[ -f "logs/omniparser.pid" ]]; then
        PID=$(cat logs/omniparser.pid)
        if ps -p $PID > /dev/null 2>&1; then
            kill $PID
            echo -e "${GREEN}✓ Stopped Holo 1.5-7B (PID: $PID)${NC}"
        fi
        rm logs/omniparser.pid
    fi

    # Try to find by port
    PID=$(lsof -ti:9989)
    if [[ -n "$PID" ]]; then
        kill $PID
        echo -e "${GREEN}✓ Stopped process on port 9989 (PID: $PID)${NC}"
    else
        echo -e "${YELLOW}⚠ Holo 1.5-7B not running${NC}"
    fi
fi
