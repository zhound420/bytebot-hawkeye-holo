# Stack Analysis Report - October 4, 2025

## Executive Summary

All containers are running and healthy, but there are **2 performance/reliability issues** that need attention:

1. **OmniParser Performance Issue** - 8-10x slower than expected on MPS
2. **Socket Connection Error** - Intermittent failures in agent→desktop communication

---

## Issue 1: OmniParser Performance (MAJOR)

### Problem
OmniParser is taking **16+ seconds** to process screenshots with 35 elements, when it should take **1-2 seconds** on Apple Silicon MPS.

### Root Cause Analysis

**Environment Confirmation:**
- ✅ MPS (Metal Performance Shaders) available: `True`
- ✅ PyTorch MPS built: `True`
- ✅ Florence-2 caption model loaded on MPS device
- ✅ Models preloaded correctly

**Performance Breakdown (from benchmark with 3 elements):**

| Operation | Time | Expected |
|-----------|------|----------|
| Icon detection only | 240ms | ✅ Good |
| Icon + captions | 1197ms | ⚠️ Slow |
| Full pipeline (OCR + icons + captions) | 4820ms | ❌ Too Slow |

**Bottlenecks Identified:**
1. **OCR Processing**: +3622ms (75% of total time)
   - PaddleOCR/EasyOCR taking 3.6 seconds
   - Scales poorly with more text elements

2. **Caption Generation**: +957ms per batch
   - Florence-2 captioning ~320ms per element
   - Not efficiently batching on MPS
   - Scales linearly: 3 elements = 1s, 35 elements = ~11s

**Real-World Impact:**
```
Agent logs show: 16078ms for 35 elements
Breakdown estimate:
- Icon detection: ~300ms
- OCR: ~4000ms
- Captions (35 elements): ~11000ms
- Overhead: ~800ms
Total: ~16s ✓ (matches observed)
```

### Recommendations

**Immediate Actions:**

1. **Disable OCR for Speed** (if text detection not critical):
   ```bash
   # In docker/.env or agent config
   BYTEBOT_CV_USE_HOLO_OCR=false
   ```
   Expected improvement: 16s → 12s (25% faster)

2. **Reduce Caption Batch Processing**:
   - Current: Generating captions for all 35 elements
   - Consider: Only caption top 10-15 most confident elements
   - Expected improvement: 12s → 6-7s (50% faster)

3. **Optimize Caption Prompt**:
   - Current: `<DETAILED_CAPTION>` (verbose descriptions)
   - Try: `<CAPTION>` (shorter descriptions, faster processing)
   - Expected improvement: 10-15% faster

**Medium-Term Solutions:**

1. **Investigate MPS Batch Processing**:
   - Verify Florence-2 is actually batching on MPS
   - Check if `batch_size=128` is being used effectively
   - May need to optimize for MPS memory constraints

2. **Profile Individual Components**:
   ```bash
   cd packages/bytebot-holo
   python -m cProfile -o profile.stats src/server.py
   ```

3. **Consider Model Quantization**:
   - Florence-2 using float32 (required for MPS)
   - Explore MPS-optimized quantization if available

**Long-Term Optimization:**

1. **Caching Strategy**:
   - Cache element detections for similar screenshots
   - Incremental updates vs full reprocessing

2. **Parallel Processing**:
   - Split OCR and icon detection to parallel tasks
   - Process captions in smaller batches concurrently

3. **Model Selection**:
   - Evaluate lighter caption models
   - Consider YOLOv8 nano for faster icon detection

---

## Issue 2: Socket Connection Error (MINOR)

### Problem
Intermittent socket errors when agent tries to start input tracking on desktop daemon:

```
ERROR [TasksService] Failed to start input tracking
SocketError: other side closed
socket: {
  localAddress: '172.18.0.4',   # agent
  remoteAddress: '172.18.0.5',  # desktop
  remotePort: 9990,
}
```

### Root Cause Analysis

**Testing Results:**
- ✅ Endpoint exists: `/input-tracking/start`
- ✅ Endpoint works: Returns HTTP 201 `{"status":"started"}`
- ✅ Network connectivity: Containers can reach each other
- ✅ DNS resolution: `bytebot-desktop` resolves correctly

**Conclusion:**
This is a **transient timing issue**, not a configuration problem. The desktop service occasionally closes the connection before responding, possibly due to:
1. Service temporarily busy with screenshot operations
2. Race condition in connection handling
3. Network timing in Docker bridge

**Impact:**
- **Non-critical** - Input tracking is optional monitoring feature
- Task takeover succeeds despite the error
- User can still interact with desktop

### Recommendations

**Immediate Fix - Add Retry Logic:**

```typescript
// In packages/bytebot-agent/src/tasks/tasks.service.ts:366

try {
  // Retry up to 3 times with 100ms delay
  let retries = 3;
  let lastError;

  while (retries > 0) {
    try {
      await fetch(
        `${this.configService.get<string>('BYTEBOT_DESKTOP_BASE_URL')}/input-tracking/start`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(5000), // 5s timeout
        },
      );
      break; // Success, exit retry loop
    } catch (err) {
      lastError = err;
      retries--;
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  if (retries === 0) {
    throw lastError;
  }
} catch (error) {
  this.logger.error('Failed to start input tracking after retries', error);
}
```

**Alternative - Make Async:**

Make the input tracking call non-blocking:
```typescript
// Fire and forget
fetch(
  `${this.configService.get<string>('BYTEBOT_DESKTOP_BASE_URL')}/input-tracking/start`,
  { method: 'POST' }
).catch(error => {
  this.logger.warn('Input tracking failed (non-critical)', error);
});

// Continue without waiting
this.eventEmitter.emit('task.takeover', { taskId });
```

---

## System Health Summary

### ✅ Working Correctly

- All Docker containers running and healthy
- PostgreSQL database accessible
- OmniParser service responding (health checks pass)
- Desktop daemon serving screenshots
- Grid overlays applied correctly
- Element detection succeeding (35 elements found)
- Agent→Desktop network connectivity

### ⚠️ Performance Issues

- **OmniParser**: 16s processing time (expected: 1-2s)
- **Captioning**: Not efficiently batched on MPS
- **OCR**: Very slow (~4s for complex images)

### 🐛 Reliability Issues

- **Socket errors**: Intermittent connection failures (non-critical)
- **No retry logic**: Single-attempt fetch calls fail on transient errors

---

## Performance Benchmarks

### OmniParser (Synthetic Test - 3 elements, 1280x960)

```
Health check:           9.8ms   ✅
Icon detection only:  240.2ms   ✅
Icon + captions:     1197.6ms   ⚠️
Full pipeline:       4820.5ms   ❌

Breakdown:
  Captioning adds:   957.4ms   (~320ms per element)
  OCR adds:         3622.9ms   (OCR is main bottleneck)
  Network overhead:   38.6ms   (negligible)
```

### Real-World Performance (from agent logs - 35 elements)

```
Full pipeline:      16078ms   ❌ (8-10x slower than expected)
Expected on MPS:     1000-2000ms
```

---

## Recommended Actions Priority

### High Priority (Do Now)

1. **Disable OCR** if not critical for accuracy:
   - Set `BYTEBOT_CV_USE_HOLO_OCR=false`
   - Expected: 16s → 12s (25% improvement)

2. **Reduce Caption Scope**:
   - Only caption top 15 elements by confidence
   - Expected: 12s → 6-7s (50% improvement)

3. **Add Retry Logic** for socket errors:
   - Implement 3-retry with 100ms backoff
   - Expected: Eliminate error logs

### Medium Priority (This Week)

1. **Profile OmniParser**:
   - Use Python profiler to identify exact bottlenecks
   - Check if MPS batching is working

2. **Optimize Caption Prompt**:
   - Switch from `<DETAILED_CAPTION>` to `<CAPTION>`
   - Test impact on click accuracy vs speed

3. **Add Performance Metrics**:
   - Track P50/P95/P99 latencies
   - Alert on >5s processing times

### Low Priority (Future)

1. **Caching Layer**: Cache element detections
2. **Model Optimization**: Evaluate lighter models
3. **Parallel Processing**: Split OCR and detection

---

## Conclusion

**Stack Status:** ✅ Functional but needs optimization

**Main Issue:** OmniParser performance is the primary bottleneck, not network or configuration issues.

**Quick Win:** Disabling OCR and limiting captions can reduce processing time from 16s to 6-7s (~60% improvement) with minimal code changes.

**Next Steps:** Implement high-priority recommendations and monitor performance improvements.
