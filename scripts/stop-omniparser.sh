#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Stopping OmniParser...${NC}"

# Check if PID file exists
if [[ -f "logs/omniparser.pid" ]]; then
    PID=$(cat logs/omniparser.pid)
    if ps -p $PID > /dev/null 2>&1; then
        kill $PID
        echo -e "${GREEN}✓ Stopped OmniParser (PID: $PID)${NC}"
        rm logs/omniparser.pid
    else
        echo -e "${YELLOW}⚠ Process not running (stale PID file)${NC}"
        rm logs/omniparser.pid
    fi
else
    # Try to find by port
    PID=$(lsof -ti:9989)
    if [[ -n "$PID" ]]; then
        kill $PID
        echo -e "${GREEN}✓ Stopped process on port 9989 (PID: $PID)${NC}"
    else
        echo -e "${YELLOW}⚠ OmniParser not running${NC}"
    fi
fi
