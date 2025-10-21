#!/bin/bash

# LMStudio Model Capability Validator
# Tests which models actually support function calling vs. those that just ignore tools
#
# Usage: ./scripts/validate-lmstudio-capabilities.sh [LMSTUDIO_URL]

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default LMStudio URL
LMSTUDIO_URL="${1:-http://192.168.4.112:1234}"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   LMStudio Function Calling Capability Validator          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Test function calling capability
test_function_calling() {
    local model_id="$1"
    local model_name="$2"

    echo -e "${CYAN}Testing: ${model_name}${NC}"

    # Create a simple test request with a function call
    local test_request=$(cat <<EOF
{
  "model": "${model_id}",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant. When the user asks for the current time, use the get_time tool."
    },
    {
      "role": "user",
      "content": "What time is it?"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_time",
        "description": "Get the current time",
        "parameters": {
          "type": "object",
          "properties": {},
          "required": []
        }
      }
    }
  ],
  "tool_choice": "auto",
  "max_tokens": 100
}
EOF
)

    # Make the request
    local response=$(curl -sf --max-time 30 \
        -H "Content-Type: application/json" \
        -d "${test_request}" \
        "${LMSTUDIO_URL}/v1/chat/completions" 2>/dev/null || echo "")

    if [[ -z "$response" ]]; then
        echo -e "  ${RED}✗ Request failed${NC}"
        return 1
    fi

    # Check if response contains tool_calls
    if echo "$response" | jq -e '.choices[0].message.tool_calls' > /dev/null 2>&1; then
        local tool_calls=$(echo "$response" | jq -r '.choices[0].message.tool_calls')
        if [[ "$tool_calls" != "null" ]] && [[ "$tool_calls" != "[]" ]]; then
            echo -e "  ${GREEN}✓ Function calling SUPPORTED${NC}"
            return 0
        fi
    fi

    # Check if response contains content (text response instead of tool call)
    local content=$(echo "$response" | jq -r '.choices[0].message.content // empty')
    if [[ -n "$content" ]]; then
        echo -e "  ${YELLOW}⚠ Function calling NOT supported (text response: \"${content:0:50}...\")${NC}"
        return 2
    fi

    echo -e "  ${RED}✗ Unexpected response format${NC}"
    return 1
}

# Main execution
echo -e "${BLUE}Testing connection to ${LMSTUDIO_URL}...${NC}"

# Get list of models
if ! MODELS_JSON=$(curl -sf --max-time 10 "${LMSTUDIO_URL}/v1/models" 2>/dev/null); then
    echo -e "${RED}✗ Failed to connect to LMStudio server at ${LMSTUDIO_URL}${NC}"
    echo ""
    echo "Please ensure:"
    echo "  1. LMStudio is running"
    echo "  2. At least one model is loaded"
    echo "  3. Server is accessible at ${LMSTUDIO_URL}"
    exit 1
fi

# Parse model list
MODEL_IDS=$(echo "$MODELS_JSON" | jq -r '.data[].id')
MODEL_COUNT=$(echo "$MODEL_IDS" | wc -l)

if [[ $MODEL_COUNT -eq 0 ]]; then
    echo -e "${RED}✗ No models found${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Found ${MODEL_COUNT} model(s)${NC}"
echo ""

# Results tracking
declare -a SUPPORTED_MODELS
declare -a UNSUPPORTED_MODELS
declare -a FAILED_MODELS

# Test each model
while IFS= read -r model_id; do
    # Extract friendly name (remove path, keep last part)
    model_name=$(echo "$model_id" | awk -F'/' '{print $NF}')

    # Test function calling
    if test_function_calling "$model_id" "$model_name"; then
        SUPPORTED_MODELS+=("$model_id")
    elif [[ $? -eq 2 ]]; then
        UNSUPPORTED_MODELS+=("$model_id")
    else
        FAILED_MODELS+=("$model_id")
    fi

    echo ""
done <<< "$MODEL_IDS"

# Summary report
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Test Results Summary                                     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${GREEN}✓ Function Calling SUPPORTED (${#SUPPORTED_MODELS[@]} models):${NC}"
for model in "${SUPPORTED_MODELS[@]}"; do
    echo -e "  - $model"
done
echo ""

echo -e "${YELLOW}⚠ Function Calling NOT SUPPORTED (${#UNSUPPORTED_MODELS[@]} models):${NC}"
for model in "${UNSUPPORTED_MODELS[@]}"; do
    echo -e "  - $model"
done
echo ""

if [[ ${#FAILED_MODELS[@]} -gt 0 ]]; then
    echo -e "${RED}✗ Test FAILED (${#FAILED_MODELS[@]} models):${NC}"
    for model in "${FAILED_MODELS[@]}"; do
        echo -e "  - $model"
    done
    echo ""
fi

# Generate configuration recommendation
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Configuration Recommendations                            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [[ ${#SUPPORTED_MODELS[@]} -gt 0 ]]; then
    echo -e "${GREEN}Recommended models for Bytebot:${NC}"
    for model in "${SUPPORTED_MODELS[@]}"; do
        echo -e "  ✓ $model"
    done
    echo ""
fi

if [[ ${#UNSUPPORTED_MODELS[@]} -gt 0 ]]; then
    echo -e "${YELLOW}⚠ These models will use fallback mode (prompt injection):${NC}"
    for model in "${UNSUPPORTED_MODELS[@]}"; do
        echo -e "  • $model"
    done
    echo ""
    echo -e "${YELLOW}Note: Fallback mode is less reliable and may not follow instructions correctly.${NC}"
    echo ""
fi

# Save results to JSON for programmatic access
RESULTS_FILE="scripts/lmstudio-capabilities.json"
cat > "$RESULTS_FILE" <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "lmstudio_url": "${LMSTUDIO_URL}",
  "supported_models": $(printf '%s\n' "${SUPPORTED_MODELS[@]}" | jq -R . | jq -s .),
  "unsupported_models": $(printf '%s\n' "${UNSUPPORTED_MODELS[@]}" | jq -R . | jq -s .),
  "failed_models": $(printf '%s\n' "${FAILED_MODELS[@]}" | jq -R . | jq -s .)
}
EOF

echo -e "${GREEN}✓ Results saved to: ${RESULTS_FILE}${NC}"
echo ""

# Exit with appropriate code
if [[ ${#SUPPORTED_MODELS[@]} -eq 0 ]]; then
    echo -e "${RED}⚠ Warning: No models with function calling support found!${NC}"
    exit 1
fi

exit 0
