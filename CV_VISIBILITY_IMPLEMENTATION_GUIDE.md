# CV & OmniParser Visibility Implementation Guide

## Executive Summary

After reviewing the OmniParser and CV tool flow, I identified that **CV detection results are completely hidden from users**. While the system works correctly on the backend and the CVActivityIndicator shows real-time method execution, users cannot see:

- What elements were detected
- Which element IDs matched their query
- Detection method breakdown (OmniParser vs classical CV)
- Click success/failure details
- Semantic captions from OmniParser

**Recommended Approach:** Enhance the existing **TelemetryStatus** drawer to include a new "CV Detection Activity" section, rather than cluttering the chat with tool results.

## Current State Analysis

### ✅ What's Working

1. **Backend Pipeline:**
   - OmniParser integration functional
   - 5-method detection (OmniParser, OCR, Template, Feature, Contour)
   - Smart caching (2s TTL)
   - Element ID system working reliably
   - CV Activity tracking service operational

2. **UI Visibility:**
   - CVActivityIndicator shows live method execution
   - Tool USE requests visible (computer_detect_elements, computer_click_element)
   - Device and model info displayed (NVIDIA/Apple Silicon, YOLOv8/Florence-2)

### ❌ What's Hidden

**MessageContent.tsx filters out non-error tool results (lines 39-44):**

```typescript
if (
  isToolResultContentBlock(block) &&
  block.tool_use_id !== "set_task_status" &&
  !block.is_error
) {
  return false; // ❌ Detection results hidden from user
}
```

This means users never see:
- Detection payload with found elements
- Element IDs, coordinates, and confidence scores
- Semantic descriptions from OmniParser
- Click success messages with coordinates used
- Cache hit indicators

## Recommended Implementation: Telemetry Drawer Enhancement

### Phase 1: Add CV Detection Summary API

**File:** `packages/bytebot-agent/src/tasks/tasks.controller.ts`

Add new endpoint after existing telemetry endpoints:

```typescript
@Get('cv-detection/summary')
async cvDetectionSummary(
  @Query('session') session?: string,
): Promise<{
  detections: {
    total: number;
    cached: number;
    cacheHitRate: number;
  };
  methods: {
    omniparser: number;
    ocr: number;
    template: number;
    feature: number;
    contour: number;
  };
  clicks: {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
  };
  recentDetections: Array<{
    timestamp: Date;
    description: string;
    elementsFound: number;
    method: string;
    cached: boolean;
    duration: number;
  }>;
  recentClicks: Array<{
    timestamp: Date;
    elementId: string;
    coordinates: { x: number; y: number };
    success: boolean;
    method: string;
  }>;
}> {
  // Implementation will aggregate data from:
  // - CVActivityIndicatorService (method tracking)
  // - Agent processor's detection cache
  // - Click tracking from computer-use logs
}
```

### Phase 2: Enhance CV Activity Service

**File:** `packages/bytebot-cv/src/services/cv-activity-indicator.service.ts`

Add methods to track detection and click history:

```typescript
export interface DetectionHistoryEntry {
  timestamp: Date;
  description: string;
  elementsFound: number;
  primaryMethod: string; // omniparser, contour, etc.
  cached: boolean;
  duration: number;
  elements: Array<{
    id: string;
    semanticDescription?: string;
    confidence: number;
    coordinates: { x: number; y: number };
  }>;
}

export interface ClickHistoryEntry {
  timestamp: Date;
  elementId: string;
  coordinates: { x: number; y: number };
  success: boolean;
  detectionMethod: string;
}

// Add to CVActivityIndicatorService:
private detectionHistory: DetectionHistoryEntry[] = [];
private clickHistory: ClickHistoryEntry[] = [];
private readonly maxHistorySize = 50;

recordDetection(entry: DetectionHistoryEntry): void {
  this.detectionHistory.unshift(entry);
  if (this.detectionHistory.length > this.maxHistorySize) {
    this.detectionHistory = this.detectionHistory.slice(0, this.maxHistorySize);
  }
}

recordClick(entry: ClickHistoryEntry): void {
  this.clickHistory.unshift(entry);
  if (this.clickHistory.length > this.maxHistorySize) {
    this.clickHistory = this.clickHistory.slice(0, this.maxHistorySize);
  }
}

getDetectionSummary(): CVDetectionSummary {
  // Calculate stats from history
}
```

### Phase 3: Update Agent Processor to Track Detections

**File:** `packages/bytebot-agent/src/agent/agent.processor.ts`

In `runComputerDetectElements` method (around line 1326):

```typescript
// After successful detection
const detectionEntry: DetectionHistoryEntry = {
  timestamp: new Date(),
  description: params.description,
  elementsFound: elements.length,
  primaryMethod: elements[0]?.metadata.detectionMethod || 'unknown',
  cached: !!cachedElements,
  duration: Date.now() - detectionStart,
  elements: elements.slice(0, 10).map(el => ({
    id: el.id,
    semanticDescription: el.metadata?.semantic_caption,
    confidence: el.confidence,
    coordinates: el.coordinates,
  })),
};

this.enhancedVisualDetector.cvActivity.recordDetection(detectionEntry);
```

In `runComputerClickElement` method:

```typescript
// After click attempt
const clickEntry: ClickHistoryEntry = {
  timestamp: new Date(),
  elementId: params.element_id,
  coordinates: clickedCoordinates,
  success: clickSuccess,
  detectionMethod: element.metadata.detectionMethod,
};

this.enhancedVisualDetector.cvActivity.recordClick(clickEntry);
```

### Phase 4: Enhance Telemetry Drawer UI

**File:** `packages/bytebot-ui/src/components/telemetry/TelemetryStatus.tsx`

Add new section in the drawer after "Learning metrics":

```tsx
{/* CV Detection Activity Section */}
<div className="mt-3">
  <div className="text-[11px] font-semibold text-card-foreground">CV Detection Activity</div>

  {/* Summary Cards */}
  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
    <div className="rounded border border-border bg-card/70 px-2 py-1">
      Detections: <span className="font-semibold">{cvData?.detections.total ?? 0}</span>
      <div className="text-[10px] text-muted-foreground">
        Cache: {formatPercent(cvData?.detections.cacheHitRate)}
      </div>
    </div>
    <div className="rounded border border-border bg-card/70 px-2 py-1">
      Clicks: <span className="font-semibold">{cvData?.clicks.total ?? 0}</span>
      <div className="text-[10px] text-muted-foreground">
        Success: {formatPercent(cvData?.clicks.successRate)}
      </div>
    </div>
    <div className="rounded border border-border bg-card/70 px-2 py-1">
      Methods: <span className="font-semibold">{Object.keys(cvData?.methods || {}).length}</span>
    </div>
  </div>

  {/* Method Breakdown */}
  <div className="mt-2 space-y-1">
    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      Detection Methods
    </div>
    <div className="flex flex-wrap gap-2">
      {cvData?.methods && Object.entries(cvData.methods).map(([method, count]) => (
        count > 0 && (
          <div key={method} className={cn(
            "rounded border px-2 py-1 text-[10px]",
            method === 'omniparser' && "border-pink-500/30 bg-pink-500/10 text-pink-600",
            method === 'ocr' && "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
            method === 'contour' && "border-green-500/30 bg-green-500/10 text-green-600",
            method === 'template' && "border-blue-500/30 bg-blue-500/10 text-blue-600",
            method === 'feature' && "border-purple-500/30 bg-purple-500/10 text-purple-600",
          )}>
            {method}: {count}
          </div>
        )
      ))}
    </div>
  </div>

  {/* Recent Detections */}
  <div className="mt-2 space-y-1">
    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      Recent Detections (Last 10)
    </div>
    {cvData?.recentDetections.length === 0 ? (
      <div className="rounded border border-dashed border-border/60 bg-muted/30 px-2 py-2 text-center text-[10px] text-muted-foreground">
        No detections yet
      </div>
    ) : (
      <div className="space-y-1 max-h-[200px] overflow-y-auto">
        {cvData?.recentDetections.slice(0, 10).map((detection, idx) => (
          <div key={idx} className="rounded border border-border bg-muted/30 px-2 py-1 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="font-medium truncate max-w-[180px]">
                "{detection.description}"
              </span>
              <span className="text-muted-foreground">
                {detection.elementsFound} found
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[9px] text-muted-foreground">
              <span className={cn(
                "px-1 rounded",
                detection.method === 'omniparser' && "bg-pink-500/20 text-pink-600",
                detection.method !== 'omniparser' && "bg-gray-500/20"
              )}>
                {detection.method}
              </span>
              {detection.cached && (
                <span className="bg-blue-500/20 text-blue-600 px-1 rounded">⚡ cached</span>
              )}
              <span>{detection.duration}ms</span>
              <span className="ml-auto">{format(detection.timestamp, 'HH:mm:ss')}</span>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>

  {/* Recent Clicks */}
  <div className="mt-2 space-y-1">
    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      Recent Clicks (Last 10)
    </div>
    {cvData?.recentClicks.length === 0 ? (
      <div className="rounded border border-dashed border-border/60 bg-muted/30 px-2 py-2 text-center text-[10px] text-muted-foreground">
        No clicks yet
      </div>
    ) : (
      <div className="space-y-1 max-h-[150px] overflow-y-auto">
        {cvData?.recentClicks.slice(0, 10).map((click, idx) => (
          <div key={idx} className={cn(
            "rounded border px-2 py-1 text-[10px]",
            click.success ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"
          )}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px]">[{click.elementId}]</span>
              <span className="text-muted-foreground">
                ({click.coordinates.x}, {click.coordinates.y})
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[9px] text-muted-foreground">
              <span>{click.success ? '✓' : '❌'}</span>
              <span>{click.method}</span>
              <span className="ml-auto">{format(click.timestamp, 'HH:mm:ss')}</span>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
</div>
```

### Phase 5: Create API Route in UI

**File:** `packages/bytebot-ui/src/app/api/tasks/cv-detection/summary/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const session = request.nextUrl.searchParams.get('session');
  const baseUrl = process.env.NEXT_PUBLIC_BYTEBOT_AGENT_BASE_URL || 'http://localhost:9991';

  const url = new URL(`${baseUrl}/tasks/cv-detection/summary`);
  if (session) {
    url.searchParams.set('session', session);
  }

  const response = await fetch(url.toString(), {
    cache: 'no-store',
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: 'Failed to fetch CV detection summary' },
      { status: response.status }
    );
  }

  const data = await response.json();
  return NextResponse.json(data);
}
```

## Implementation Priority

1. **Phase 2** (Backend tracking) - Start here, enables data collection
2. **Phase 3** (Agent integration) - Record detections and clicks
3. **Phase 1** (API endpoint) - Expose data to frontend
4. **Phase 5** (UI API route) - Proxy to backend
5. **Phase 4** (UI drawer) - Display in telemetry

## Benefits of This Approach

✅ **Clean UI:** Chat remains focused on conversation, not cluttered with CV details
✅ **Comprehensive:** All CV activity in one dedicated panel
✅ **Consistent:** Matches existing telemetry drawer pattern
✅ **Performant:** Polling-based updates like existing telemetry
✅ **Debuggable:** Users can see exactly what OmniParser detected and why clicks succeed/fail

## Additional Improvements (Lower Priority)

### Agent Instructions Enhancement

**File:** `packages/bytebot-agent/src/agent/agent.constants.ts`

Add section about efficient detection patterns:

```markdown
#### Efficient Element Detection Patterns

**✅ RECOMMENDED: Detect once, click multiple**
1. Call `computer_detect_elements({ description: "", includeAll: true })`
2. Review all detected elements
3. Click multiple elements by ID without re-detecting

Example workflow:
- Detect all elements once → get list with IDs
- "I see Install button [omniparser_abc123] and Save button [omniparser_def456]"
- Click Install button using its ID
- Click Save button using its ID (detection cached for 2s)

**❌ AVOID: Detect before every click**
- Wastes OmniParser compute (~1-2s each time)
- Results are cached anyway
- Prefer: one detection → multiple clicks
```

### Response Format Optimization

**File:** `packages/bytebot-agent/src/agent/agent.processor.ts`

Make detection responses more concise (lines 1280-1283):

```typescript
// Current: Verbose JSON payload
content.push({
  type: MessageContentType.Text,
  text: `Detection payload: ${JSON.stringify(payload, null, 2)}`,
});

// Proposed: Concise summary
content.push({
  type: MessageContentType.Text,
  text: `✓ Found ${detection.count} elements. Check Details drawer for full breakdown.`,
});
```

## Testing Checklist

After implementation:

- [ ] CV Detection summary API returns data
- [ ] Detection history populated on each `computer_detect_elements`
- [ ] Click history populated on each `computer_click_element`
- [ ] Cache hits tracked correctly
- [ ] Method breakdown shows OmniParser vs classical CV
- [ ] Telemetry drawer displays CV section
- [ ] Recent detections list updates
- [ ] Recent clicks list updates with success/failure
- [ ] Semantic captions visible from OmniParser
- [ ] Performance acceptable (polling every 10s like existing telemetry)

## Success Metrics

- **Visibility:** Users can see what CV methods detected
- **Debuggability:** Users understand why clicks succeed/fail
- **Efficiency:** Agent uses batch detection pattern more often
- **Performance:** Cache hit rate improves (target: >30%)
- **User Satisfaction:** Reduced confusion about CV behavior
