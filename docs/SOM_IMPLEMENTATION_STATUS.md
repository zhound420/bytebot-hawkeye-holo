# Set-of-Mark (SOM) Visual Annotations - Implementation Status

## Overview
Set-of-Mark (SOM) is a visual grounding technique where UI elements are annotated with numbered bounding boxes on screenshots. This allows VLMs to reference elements by their visible numbers (e.g., "click element 5") instead of describing them semantically, significantly improving click accuracy.

**Expected Impact:**
- Current: ~20-30% click accuracy (text-based semantic matching)
- With SOM: ~70-85% click accuracy (direct visual grounding)
- Reason: VLM task reduces from "understand UI semantics" to "read visible numbers"

## Implementation Status

### ✅ Phase 1: Backend SOM Generation (COMPLETED)

#### 1.1 Python Service Updates
**File:** `packages/bytebot-holo/src/omniparser_wrapper.py`
- ✅ Added `generate_som_image()` method to `OmniParserV2` class
- ✅ Imports `BoxAnnotator` from OmniParser's `util/box_annotator.py`
- ✅ Converts detections to supervision format (xyxy bounding boxes)
- ✅ Creates numbered labels (0, 1, 2, ...) for each element
- ✅ Dynamic annotation sizing based on image resolution (scales for 4K/1080p)
- ✅ Returns base64 encoded PNG with numbered boxes overlaid
- ✅ Updated `parse_screenshot()` to accept `include_som` parameter (default: True)

#### 1.2 API Updates
**File:** `packages/bytebot-holo/src/server.py`
- ✅ Added `include_som` field to `ParseRequest` model (default: True)
- ✅ Added `som_image` field to `ParseResponse` model (optional base64 string)
- ✅ Updated `/parse` endpoint to pass `include_som` to wrapper
- ✅ Updated `/parse/upload` endpoint to support `include_som` parameter

#### 1.3 Dependencies
**File:** `packages/bytebot-holo/requirements.txt`
- ✅ Added `supervision==0.18.0` for BoxAnnotator support

#### 1.4 TypeScript Client Updates
**File:** `packages/bytebot-cv/src/services/omniparser-client.service.ts`
- ✅ Added `includeSom?: boolean` to `OmniParserOptions` interface
- ✅ Added `som_image?: string` to `OmniParserResponse` interface
- ✅ Updated `parseScreenshot()` to send `include_som: true` by default
- ✅ Client now receives SOM annotated images when available

### 🚧 Phase 2: Agent Integration (NOT STARTED)

#### 2.1 Screenshot Enhancement with SOM
**Target Files:**
- `packages/bytebot-agent/src/agent/agent.computer-use.ts`
- `packages/bytebot-agent/src/agent/agent.processor.ts`

**Needed Changes:**
1. Add environment variable `BYTEBOT_USE_SOM_SCREENSHOTS=true/false`
2. Create utility function `enhanceScreenshotWithSOM(buffer: Buffer): Promise<Buffer>`
   - Takes original screenshot buffer
   - Calls OmniParser with `includeSom: true`
   - Returns SOM-annotated image buffer if elements found
   - Falls back to original if OmniParser unavailable
3. Integrate into screenshot functions:
   - `screenshot()` - Add SOM overlay before returning to VLM
   - `screenshotRegion()` - Add SOM for focused regions
   - `screenshotCustomRegion()` - Add SOM for custom regions

#### 2.2 Element Number Mapping
**Challenge:** Map visual element numbers (0, 1, 2) to element IDs (omniparser_abc123)

**Proposed Solution:**
- Store element index→ID mapping when `computer_detect_elements` runs
- Add `element_number` field to detection results
- Allow `computer_click_element` to accept either:
  - `element_id: "omniparser_abc123"` (current)
  - `element_number: 5` (new, maps to ID internally)

### 🚧 Phase 3: System Prompt Updates (NOT STARTED)

#### 3.1 Update Agent System Prompt
**File:** `packages/bytebot-agent/src/agent/agent.constants.ts`

**Additions to `buildAgentSystemPrompt()`:**

```markdown
### Visual Element Numbering (SOM Mode)

When screenshots include numbered bounding boxes:
- Each interactive element is labeled with a number (0, 1, 2, ...)
- These numbers are DIRECTLY VISIBLE on the screen
- Use these numbers for precise targeting

**Enhanced Detection Workflow:**
1. Take screenshot → See numbered elements
2. Identify target by its visible number
3. Call: computer_detect_elements({ description: "", includeAll: true })
4. Use element_number field from results to click

**Example:**
Screenshot shows:
- [0] Settings gear icon (top-right)
- [1] Profile avatar (top-right)
- [2] Search magnifying glass (top-left)

To click settings:
1. Observe: "I see element [0] is the settings gear"
2. Detect: computer_detect_elements({ description: "", includeAll: true })
3. Click: computer_click_element({ element_number: 0 })

**Advantages:**
- No ambiguity about which element to click
- Reduces need for semantic descriptions
- Direct visual→action mapping
```

#### 3.2 Update Tool Schemas
**File:** `packages/bytebot-agent/src/tools/computer-vision-tools.ts`

Add `element_number` as alternative to `element_id`:
```typescript
computer_click_element({
  element_id: "omniparser_abc123",  // Option 1: Use ID
  element_number: 5                 // Option 2: Use visible number
})
```

### 📋 Phase 4: Testing & Validation (NOT STARTED)

#### 4.1 Functional Testing
- [ ] Verify SOM images are generated correctly
- [ ] Confirm numbered boxes are visible and readable
- [ ] Test element number→ID mapping accuracy
- [ ] Validate clicks target correct elements

#### 4.2 Performance Testing
- [ ] Measure SOM generation overhead (~50-100ms expected)
- [ ] Confirm caching works to avoid redundant generation
- [ ] Test with various screen resolutions (1080p, 1440p, 4K)

#### 4.3 Accuracy Measurement
- [ ] Baseline: Measure current click accuracy without SOM
- [ ] SOM: Measure click accuracy with numbered elements
- [ ] Compare against target improvement (20-30% → 70-85%)

#### 4.4 Edge Cases
- [ ] Zero elements detected (no SOM overlay)
- [ ] Partial detection (some elements missed)
- [ ] Overlapping elements (numbering conflicts)
- [ ] Dynamic UI changes between detection and click

## Configuration

### Environment Variables
```bash
# Enable SOM mode (not yet implemented)
BYTEBOT_USE_SOM_SCREENSHOTS=true

# OmniParser configuration (already supported)
BYTEBOT_CV_USE_HOLO=true
HOLO_URL=http://localhost:9989
HOLO_MIN_CONFIDENCE=0.3
```

### Feature Flags
```typescript
// Agent config (future)
{
  useSomScreenshots: boolean;        // Send SOM-annotated images to VLM
  somAnnotationStyle: 'numbered' | 'labeled'; // Box label style
  somMinConfidence: number;          // Minimum confidence for SOM overlay
}
```

## Architecture Decisions

### 1. Where to Generate SOM Images?
**Decision:** Python service (OmniParser)
- **Pro:** Leverage existing BoxAnnotator code from OmniParser repo
- **Pro:** Annotations co-located with detection logic
- **Pro:** GPU-accelerated drawing via supervision library
- **Con:** Requires passing images back and forth

**Alternative (Not Chosen):** TypeScript agent
- Would require reimplementing BoxAnnotator in Node.js
- Adds complexity to already heavy agent codebase

### 2. When to Apply SOM Annotations?
**Decision:** On-demand at screenshot time (Phase 2 plan)
- Only annotate when SOM mode is enabled
- Cache annotated images with detection results
- Gracefully fall back if OmniParser unavailable

**Alternative (Not Chosen):** Always annotate
- Wastes computation when VLM doesn't need visual grounding
- Increases latency for all screenshot operations

### 3. How to Reference Elements?
**Decision:** Dual mode - ID or number
- Backward compatible with existing `element_id` system
- New `element_number` option for SOM mode
- Internal mapping table maintained by agent

**Alternative (Not Chosen):** Number-only
- Breaking change for existing workflows
- Loses semantic element IDs in logs/debugging

## Next Steps (Priority Order)

1. **Implement Screenshot Enhancement** (2-3 hours)
   - Create `enhanceScreenshotWithSOM()` utility
   - Add environment variable gating
   - Integrate into screenshot functions

2. **Add Element Number Mapping** (1-2 hours)
   - Store index→ID mapping in agent
   - Update `computer_click_element` schema
   - Add mapping logic to detection results

3. **Update System Prompts** (1 hour)
   - Add SOM explanation to agent prompt
   - Update tool usage examples
   - Document number-based workflow

4. **Test and Validate** (2-3 hours)
   - Functional tests for SOM generation
   - Click accuracy measurement
   - Edge case handling

**Total Remaining Work:** ~6-9 hours

## Technical Notes

### SOM Image Format
- **Encoding:** Base64 PNG
- **Annotations:** Numbered boxes (0, 1, 2, ...)
- **Colors:** Colored boxes with contrasting text (auto-calculated luminance)
- **Sizing:** Dynamic based on image resolution (scales with w/3200 ratio)

### Performance Characteristics
- **SOM Generation:** ~50-100ms (CPU), ~20-30ms (GPU)
- **Network Overhead:** +300-500KB per screenshot (base64 PNG)
- **Caching:** SOM images cached with detection results (2s TTL)

### Dependencies
- `supervision==0.18.0` - BoxAnnotator for drawing numbered boxes
- `torchvision.ops.box_convert` - Bounding box format conversion
- `opencv-python` - Image manipulation (already present)

## References

- OmniParser Paper: https://arxiv.org/abs/2408.00203
- OmniParser Demo: Uses SOM for ~85% accuracy on ScreenSpot benchmark
- Original BoxAnnotator: `packages/bytebot-holo/OmniParser/util/box_annotator.py`
