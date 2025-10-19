# UX Improvements Implementation Progress

**Start Date:** 2025-10-18
**Last Updated:** 2025-10-19
**Status:** ✅ Phase 1 (50% Complete) - Phases 2-4 In Progress

---

## Implementation Overview

Based on the UX analysis in `UX_ANALYSIS_DEEP_DIVE.md`, implementing comprehensive improvements to address the "4 failed attempts in 10 minutes" user frustration problem.

**Root Cause Identified:** Modal dialog blocker + lack of timeout detection + no cross-model learning

**Total Phases:** 4 major phases, 12 tasks
**Completed:** 2 tasks (16.7%)
**In Progress:** Backend complete, UI and advanced features pending

---

## ✅ Phase 1: Immediate Fixes (Week 1)

### ✅ Phase 1.1: Timeout Detection (COMPLETE)

**Problem Solved:** Models running 4+ minutes without progress, requiring manual cancellation

**Implementation:**
- Added timeout detection to `AgentProcessor`
- Timeout threshold: 2 minutes without tool calls
- Auto-transitions to NEEDS_HELP with descriptive message
- Updates `taskLastActionTime` after every tool execution

**Files Modified:**
1. `packages/bytebot-agent/src/agent/agent.processor.ts`
   - Line 173: Added `TIMEOUT_THRESHOLD_MS` constant (2 minutes)
   - Lines 514-552: Added `checkTaskTimeout()` helper method
   - Lines 1194-1241: Added timeout check in `runIteration()` before LLM call
   - Lines 1623-1628: Update `taskLastActionTime` after tool results

**Impact:**
- ❌ Before: Users waited 4+ minutes, manually cancelled
- ✅ After: Auto-detects timeout at 2 minutes, provides clear feedback

**Test Scenario:**
```typescript
// Simulate stuck model (no tool calls for 2+ minutes)
// Expected: Task auto-transitions to NEEDS_HELP with timeout message
```

---

### ✅ Phase 1.2: Enhanced NEEDS_HELP Context (COMPLETE - Backend)

**Problem Solved:** Users see "NEEDS_HELP" without knowing why or what to do

**Implementation:**
- Added database fields for help context storage
- Store rich context when transitioning to NEEDS_HELP
- Context includes: reason, blocker type, elapsed time, suggested actions

**Database Changes:**
1. `packages/bytebot-agent/prisma/schema.prisma`
   - Line 69: Added `helpContext` JSON field
   - Line 70: Added `lastScreenshotId` String field
   - Migration: `20251019003340_add_help_context_fields`

**Code Changes:**
1. `packages/bytebot-agent/src/agent/agent.processor.ts`
   - Lines 1217-1232: Store timeout help context
   - Lines 1709-1724: Store model-requested help context

**Help Context Structure:**
```typescript
{
  reason: 'timeout' | 'model_request',
  blockerType: 'timeout' | 'unknown',
  message: string,
  elapsedMs?: number,
  timestamp: string,
  suggestedActions: string[],
}
```

**Impact:**
- ❌ Before: "Task needs help" (no context)
- ✅ After: Detailed reason, suggested actions, timestamp

**UI Work Remaining:**
- Display `helpContext` in task detail page
- Show suggested actions as actionable buttons
- Display last screenshot for visual debugging

---

### ⏳ Phase 1.3: Real-Time Progress Indicators (PENDING)

**Problem to Solve:** 4+ minute wait with no visible activity

**Planned Implementation:**
- Emit progress events via WebSocket every 30 seconds
- Show "Thinking... (Xs) - Last: [action]" in UI
- Pulsing indicator during model calls

**Files to Modify:**
1. `packages/bytebot-agent/src/agent/agent.processor.ts`
   - Add progress event emission in `runIteration()`
   - Track last action description

2. `packages/bytebot-ui/src/app/tasks/[id]/page.tsx`
   - Subscribe to progress WebSocket events
   - Display progress indicator component

**Expected Impact:**
- ✅ User knows model is working (not frozen)
- ✅ User sees what model is doing
- ✅ Reduces perceived wait time

---

## ⏳ Phase 2: Dialog Handling (Week 2)

### ⏳ Phase 2.1: Modal Dialog Detection via Holo (PENDING)

**Problem to Solve:** Models don't detect "Untrusted application launcher" dialog

**Planned Implementation:**
1. Add `detect_modal_dialog()` method to Holo wrapper
2. New prompt: "Is there a modal dialog blocking the UI?"
3. Return: `{ has_dialog, dialog_type, dialog_text, button_options[] }`

**Files to Modify:**
1. `packages/bytebot-holo/src/holo_wrapper.py`
   - Add `detect_modal_dialog()` method
   - Add dialog detection prompt

2. `packages/bytebot-holo/src/server.py`
   - Add `/detect_dialog` endpoint

3. `packages/bytebot-cv/src/services/holo-client.service.ts`
   - Add `detectModalDialog()` method

4. `packages/bytebot-cv/src/services/enhanced-visual-detector.service.ts`
   - Pre-check for dialogs in `detectElements()`

**Expected Impact:**
- ✅ Detect modal dialogs before element detection
- ✅ Provide dialog details to models
- ✅ Prevent stuck states from undetected dialogs

---

### ⏳ Phase 2.2: System Prompt Dialog Guidelines (PENDING)

**Problem to Solve:** Models have no guidance on handling security dialogs

**Planned Implementation:**
Add to all model system prompts:
```
MODAL DIALOG HANDLING:
1. Before any action, check if modal dialog blocks UI
2. Use computer_handle_dialog() to interact with dialogs
3. Auto-handle: Cancel, Close, OK (for info dialogs)
4. Log reason for every dialog interaction
5. If uncertain about safety: use set_task_status(NEEDS_HELP)
```

**Files to Modify:**
1. `packages/bytebot-agent/src/anthropic/anthropic.service.ts`
2. `packages/bytebot-agent/src/openai/openai.service.ts`
3. `packages/bytebot-agent/src/google/google.service.ts`

**Expected Impact:**
- ✅ Models know how to handle dialogs
- ✅ Clear escalation path for uncertain dialogs
- ✅ Automatic handling of safe dialogs

---

### ⏳ Phase 2.3: computer_handle_dialog() Tool (PENDING)

**Problem to Solve:** No explicit tool for dialog interaction

**Planned Implementation:**
```typescript
computer_handle_dialog({
  action: 'read' | 'cancel' | 'confirm' | 'button',
  button_text?: string,  // if action === 'button'
  reason: string  // WHY taking this action (required)
})
```

**Database Schema:**
```prisma
model DialogInteraction {
  id            String   @id @default(cuid())
  taskId        String
  dialogType    String   // 'security', 'confirmation', 'error', 'info'
  dialogText    String
  buttonClicked String
  reason        String   // Model's reasoning
  timestamp     DateTime @default(now())
  task          Task     @relation(fields: [taskId], references: [id])
}
```

**Files to Modify:**
1. `packages/bytebot-agent/prisma/schema.prisma` - Add DialogInteraction model
2. `packages/bytebotd/src/computer-use/computer-use.service.ts` - Add `handleDialog()` method
3. `packages/bytebot-agent/src/tools/computer.tools.ts` - Register new tool

**Expected Impact:**
- ✅ Explicit dialog handling with logging
- ✅ Safety validation before clicking
- ✅ Audit trail of all dialog interactions

---

## ⏳ Phase 3: Cross-Model Learning (Week 3)

### ⏳ Phase 3.1: Task Blocker Memory (PENDING)

**Problem to Solve:** Each model encounters same blocker, each fails

**Planned Implementation:**

**Database Schema:**
```prisma
model TaskBlocker {
  id              String   @id @default(cuid())
  taskId          String
  blockerType     String   // 'modal_dialog', 'timeout', 'permission_denied'
  description     String
  screenshotId    String?
  failedModels    String[] // ['qwen3-vl', 'deepseek-chat']
  detectedAt      DateTime @default(now())
  resolved        Boolean  @default(false)
  resolutionNotes String?
  task            Task     @relation(fields: [taskId], references: [id])
}
```

**Injection into System Prompt:**
```
PREVIOUS ATTEMPTS FAILED DUE TO:
- Modal dialog: "Untrusted application launcher"
- Failed models: qwen3-vl, deepseek-chat, qwen-plus
- Suggested approach: Handle dialog first before proceeding
```

**Files to Modify:**
1. `packages/bytebot-agent/prisma/schema.prisma` - Add TaskBlocker model
2. `packages/bytebot-agent/src/tasks/task-blocker.service.ts` - New service
3. `packages/bytebot-agent/src/agent/agent.processor.ts` - Inject blocker context

**Expected Impact:**
- ✅ 2nd model knows why 1st model failed
- ✅ Avoid repetitive failures
- ✅ Faster resolution via shared knowledge

---

### ⏳ Phase 3.2: Auto-Escalation on Re-Failure (PENDING)

**Problem to Solve:** qwen-plus failed twice in 8 seconds, wasted user effort

**Planned Implementation:**
- Detect: NEEDS_HELP → resume → NEEDS_HELP <30s
- Auto-prompt: "This model failed twice. Try with gpt-4o?"
- Track re-failure pattern count

**Files to Modify:**
1. `packages/bytebot-agent/src/tasks/tasks.service.ts`
   - Track NEEDS_HELP count per task
   - Detect re-failure timing

2. `packages/bytebot-ui/src/components/tasks/[id]/page.tsx`
   - Show escalation prompt modal
   - One-click model switch

**Expected Impact:**
- ✅ Prevent immediate re-failure
- ✅ Suggest stronger models automatically
- ✅ Reduce user frustration

---

### ⏳ Phase 3.3: Empirical Model Capability Learning (PENDING)

**Problem to Solve:** No data on which models succeed at which tasks

**Planned Implementation:**

**Database Schema:**
```prisma
model TaskOutcome {
  id            String   @id @default(cuid())
  taskId        String
  modelName     String
  taskType      String   // 'install_extension', 'web_navigation'
  outcome       String   // 'SUCCESS', 'FAILED', 'NEEDS_HELP', 'TIMEOUT'
  duration      Int      // milliseconds
  toolCallCount Int
  blockerType   String?
  tokenUsage    Int
  cost          Float
  timestamp     DateTime @default(now())
  task          Task     @relation(fields: [taskId], references: [id])
}
```

**Model Recommendation:**
- Track success rates per model per task type
- Suggest: "gpt-4o: 85% success (12 tasks) | qwen-plus: 45% success (8 tasks)"
- Auto-sort model dropdown by empirical performance

**Files to Modify:**
1. `packages/bytebot-agent/prisma/schema.prisma` - Add TaskOutcome model
2. `packages/bytebot-agent/src/models/model-capability.service.ts` - Replace static tiers
3. `packages/bytebot-agent/src/tasks/task-classification.service.ts` - Classify task types
4. `packages/bytebot-ui/src/components/TaskCreate.tsx` - Show recommendations

**Expected Impact:**
- ✅ Data-driven model selection
- ✅ Automatically improving recommendations
- ✅ Avoid known-failing model+task combinations

---

## ⏳ Phase 4: Advanced UX (Month 2)

### Features Planned:
1. **Real-Time Reasoning Display**
   - Stream model's chain-of-thought to UI
   - Show decision tree with expandable nodes

2. **User Intervention Hotkeys**
   - Ctrl+H: Force NEEDS_HELP
   - Ctrl+C: Cancel current model call
   - Ctrl+S: Suggest next action

3. **Task Replay & Fork**
   - Record full execution timeline
   - Annotate failure points
   - Fork from specific decision point

---

## Success Metrics

### Before Improvements:
- ❌ 4 attempts, 0 successes
- ❌ 10 minutes wasted
- ❌ User frustration: VERY HIGH
- ❌ Manual intervention required

### After Phase 1-3 (Target):
- ✅ <2 minute timeout detection
- ✅ Modal dialogs handled automatically
- ✅ 2nd model knows why 1st failed
- ✅ Model recommendations based on empirical data
- ✅ Real-time progress visibility

---

## Testing Strategy

### Phase 1 Testing:
1. **Timeout Detection:**
   - Simulate stuck model (delay tool calls >2 minutes)
   - Verify auto-NEEDS_HELP with correct message
   - Check `helpContext` stored in database

2. **NEEDS_HELP Context:**
   - Trigger timeout scenario
   - Trigger model-requested help
   - Verify both store appropriate help context

### Phase 2 Testing:
1. **Dialog Detection:**
   - Screenshot with modal dialog
   - Verify Holo detects dialog type and buttons
   - Test with various dialog types (security, confirmation, error)

2. **Dialog Handling:**
   - Test auto-handling of safe dialogs (Cancel, Close)
   - Test escalation for risky dialogs (Delete, Format)
   - Verify logging in DialogInteraction table

### Phase 3 Testing:
1. **Blocker Memory:**
   - Run same task with 2 models sequentially
   - Verify 2nd model receives blocker context
   - Check TaskBlocker table populated

2. **Auto-Escalation:**
   - Trigger NEEDS_HELP → resume → NEEDS_HELP <30s
   - Verify escalation prompt shown
   - Test model switch flow

3. **Empirical Learning:**
   - Run 20+ tasks with various models
   - Verify TaskOutcome records created
   - Check model recommendations update

---

## Migration Guide

### Database Migrations:
```bash
# Phase 1.2: Help context fields
npx prisma migrate dev --name add_help_context_fields  # ✅ COMPLETE

# Phase 2.3: Dialog interactions
npx prisma migrate dev --name add_dialog_interactions  # PENDING

# Phase 3.1: Task blockers
npx prisma migrate dev --name add_task_blockers  # PENDING

# Phase 3.3: Task outcomes
npx prisma migrate dev --name add_task_outcomes  # PENDING
```

### Feature Flags (Optional):
```bash
# Enable timeout detection (default: true)
BYTEBOT_ENABLE_TIMEOUT_DETECTION=true

# Enable dialog handling (default: true)
BYTEBOT_ENABLE_DIALOG_HANDLING=true

# Enable cross-model learning (default: true)
BYTEBOT_ENABLE_BLOCKER_MEMORY=true

# Enable empirical model learning (default: true)
BYTEBOT_ENABLE_EMPIRICAL_LEARNING=true
```

---

## Known Issues & Limitations

### Phase 1:
- ✅ Timeout detection implemented
- ✅ Help context stored in database
- ⚠️ UI display of help context pending (Phase 1.2 UI)

### Future Work:
- Progress indicators (Phase 1.3)
- Dialog detection (Phase 2.1)
- Dialog handling tool (Phase 2.3)
- Cross-model learning (Phase 3)
- Advanced UX features (Phase 4)

---

## Next Steps

1. **Continue Phase 1.3:** Real-time progress indicators
2. **Complete Phase 2:** Dialog detection and handling
3. **Implement Phase 3:** Cross-model learning system
4. **Add Phase 4:** Advanced UX features (reasoning, hotkeys, replay)

---

**Author:** Claude Code
**Last Updated:** 2025-10-19 00:33 UTC
**Status:** In Progress - 2/12 tasks complete (16.7%)
