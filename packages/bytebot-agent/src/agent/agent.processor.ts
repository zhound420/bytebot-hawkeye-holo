import { TasksService } from '../tasks/tasks.service';
import { TaskBlockerService } from '../tasks/task-blocker.service';
import { TaskOutcomeService } from '../tasks/task-outcome.service';
import { MessagesService } from '../messages/messages.service';
import { TasksGateway } from '../tasks/tasks.gateway';
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common/interfaces';
import * as fs from 'fs';
import * as path from 'path';
import { expandFunctionalQuery, scoreSemanticMatch, levenshteinSimilarity } from './semantic-mapping';
import { CaptionTrainingDataCollector } from './caption-training-data';
import {
  Message,
  Role,
  Task,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { AnthropicService } from '../anthropic/anthropic.service';
import { ModelCapabilityService } from '../models/model-capability.service';
import { ModelTier } from '../models/model-capabilities.config';
import { LoopDetectionService } from './loop-detection.service';
import {
  isComputerToolUseContentBlock,
  isSetTaskStatusToolUseBlock,
  isCreateTaskToolUseBlock,
  isScreenshotToolUseBlock,
  isScreenshotRegionToolUseBlock,
  isScreenshotCustomRegionToolUseBlock,
  isComputerDetectElementsToolUseBlock,
  isComputerClickElementToolUseBlock,
  isClickMouseToolUseBlock,
  SetTaskStatusToolUseBlock,
} from '@bytebot/shared';

import {
  MessageContentBlock,
  MessageContentType,
  ToolResultContentBlock,
  TextContentBlock,
  ImageContentBlock,
  ComputerDetectElementsToolUseBlock,
  ComputerClickElementToolUseBlock,
  ComputerToolUseContentBlock,
  Coordinates,
} from '@bytebot/shared';
import {
  DetectedElement,
  BoundingBox,
  ClickTarget,
  EnhancedVisualDetectorService,
  CVActivityIndicatorService,
  DetectionHistoryEntry,
  ClickHistoryEntry,
} from '@bytebot/cv';
import {
  ComputerClickElementInput,
  ComputerDetectElementsInput,
  computerDetectElementsSchema,
} from '../tools/computer-vision-tools';
import { InputCaptureService } from './input-capture.service';
import { OnEvent } from '@nestjs/event-emitter';
import { OpenAIService } from '../openai/openai.service';
import { GoogleService } from '../google/google.service';
import {
  BytebotAgentModel,
  BytebotAgentService,
  BytebotAgentResponse,
} from './agent.types';
import {
  SCREENSHOT_OBSERVATION_GUARD_MESSAGE,
  SUMMARIZATION_SYSTEM_PROMPT,
  buildAgentSystemPrompt,
} from './agent.constants';
import { buildTierSpecificAgentSystemPrompt } from './tier-specific-prompts';
import { supportsVision } from './vision-capability.util';
import { SummariesService } from '../summaries/summaries.service';
import { handleComputerToolUse } from './agent.computer-use';
import { ProxyService } from '../proxy/proxy.service';
import { isSOMEnabled } from './som-enhancement.util';
import { formatSOMAsText, formatSOMSummary } from './som-text-formatter';
import {
  estimateTotalTokens,
  estimateContentBlockTokens,
  canAddMessage,
} from './token-estimator.util';

type CachedDetectedElement = {
  element: DetectedElement;
  timestamp: number;
  taskId: string | null;
};

type DetectElementsResponse =
  | {
      elements: DetectedElement[];
      count: number;
      totalDetected: number;
      includeAll: boolean;
      description?: string;
      topCandidates?: Array<{ element: DetectedElement; score: number }>;
    }
  | {
      elements: DetectedElement[];
      count: number;
      error: string;
      totalDetected?: number;
      includeAll?: boolean;
      description?: string;
      topCandidates?: Array<{ element: DetectedElement; score: number }>;
    };

type ClickElementResponse =
  | {
      success: true;
      element_id: string;
      coordinates_used: Coordinates;
      detection_method?: string;
      confidence?: number;
      element_text?: string | null;
    }
  | {
      success: false;
      element_id: string;
      error: string;
      coordinates_used?: Coordinates;
      detection_method?: string;
      confidence?: number;
      element_text?: string | null;
    };

type VisualDescriptionCacheEntry = {
  keywords: string[];
  description: string;
  timestamp: number;
  hits: number;
  confidence: number; // 0.0 - 1.0, starts at 0.5, adjusted by success/failure
  successCount: number;
  failureCount: number;
  lastUsed: number;
};

type VisualDescriptionCache = {
  version: string;
  description: string;
  cache: Record<string, Record<string, VisualDescriptionCacheEntry>>;
};

type CacheUsageTracking = {
  elementDescription: string;
  applicationName: string;
  usedCachedKeywords: boolean;
};

// Global Direct Vision Mode override
const FORCE_DIRECT_VISION_MODE = process.env.BYTEBOT_FORCE_DIRECT_VISION_MODE === 'true';

@Injectable()
export class AgentProcessor implements OnModuleDestroy {
  private readonly logger = new Logger(AgentProcessor.name);
  private currentTaskId: string | null = null;
  private isProcessing = false;
  private abortController: AbortController | null = null;
  private services: Record<string, BytebotAgentService> = {};
  private pendingScreenshotObservation = false;
  private readonly elementCache = new Map<string, CachedDetectedElement>();
  private readonly elementCacheTtlMs = 5 * 60 * 1000;

  // Stuck detection state
  private readonly taskIterationCount = new Map<string, number>();
  private readonly taskLastActionTime = new Map<string, Date>();
  private readonly MAX_ITERATIONS_WITHOUT_ACTION = 5; // Trigger intervention after 5 iterations without meaningful action

  // Timeout detection (Phase 1.1)
  private readonly TIMEOUT_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes without tool calls = timeout

  // Progress tracking (Phase 1.3)
  private readonly taskIterationStartTime = new Map<string, Date>();
  private readonly taskLastAction = new Map<string, string>();
  private readonly PROGRESS_UPDATE_INTERVAL_MS = 30 * 1000; // 30 seconds
  private readonly progressIntervals = new Map<string, NodeJS.Timeout>();

  // Visual description cache for LLM-assisted element identification
  private visualDescriptionCache: VisualDescriptionCache = {
    version: '1.0.0',
    description: 'Visual description cache for UI elements',
    cache: {}
  };
  private readonly visualDescriptionCachePath = path.join(__dirname, '../config/visual-descriptions.cache.json');
  private readonly CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  private readonly MIN_CONFIDENCE_THRESHOLD = 0.3; // Invalidate entries below this
  private readonly CONFIDENCE_BOOST_SUCCESS = 0.05; // Increase on successful click
  private readonly CONFIDENCE_PENALTY_FAILURE = 0.1; // Decrease on failed click
  private currentApplicationContext: string = 'desktop'; // Track current application context

  // Track which cache entries were used for each element (for feedback loop)
  private readonly elementCacheUsage = new Map<string, CacheUsageTracking>();

  // Training data collector for caption fine-tuning
  private readonly captionTrainingCollector: CaptionTrainingDataCollector;

  // Screenshot-level caching to avoid re-processing similar screens
  private screenshotCache = new Map<string, {
    elements: DetectedElement[];
    timestamp: number;
    screenshotHash: string;
  }>();
  private readonly SCREENSHOT_CACHE_TTL_MS = 30000; // 30 seconds - aligned with SOM cache (Phase 1.3)

  // Store last enhanced detection result for telemetry
  private lastEnhancedResult: any = null;

  // SOM (Set-of-Mark) state: maps screenshot hash to SOM data
  private readonly somCache = new Map<string, {
    somImage: string; // Base64 encoded SOM-annotated image
    elementMapping: Map<number, string>; // element_number -> element_id
    elementDescriptions: Map<number, string[]>; // element_number -> description variants (Phase 3.1)
    timestamp: number;
  }>();
  private readonly SOM_CACHE_TTL_MS = 30000; // 30 seconds - persist across multiple interactions

  // Background enrichment state: prevent race conditions and queue buildup
  private enrichmentPromise: Promise<void> | null = null;
  private lastEnrichmentTime = 0;
  private readonly ENRICHMENT_COOLDOWN_MS = 1000; // 1 second - prevent rapid enrichment pile-up

  // CV-First Workflow Enforcement: Track detection attempts to ensure CV is tried before fallback
  private readonly cvDetectionAttempts = new Map<string, {
    taskId: string;
    screenshotHash: string;
    description: string;
    attemptCount: number;
    lastAttemptTime: number;
  }[]>();
  private readonly CV_REQUIRED_ATTEMPTS = 2; // Default minimum CV attempts (overridden by model tier)
  private readonly enforceCVFirst = process.env.BYTEBOT_ENFORCE_CV_FIRST !== 'false'; // Default: true
  private currentModelName: string | null = null; // Track current model for tier-based enforcement
  private currentModel: BytebotAgentModel | null = null; // Store full model for vision capability checks

  // Pattern recognition: Track successful query patterns for learning feedback
  private readonly successfulQueryPatterns = new Map<string, {
    query: string;
    applicationContext?: string;
    successCount: number;
    totalAttempts: number;
    avgConfidence: number;
    lastSuccess: number;
  }>();
  private readonly MAX_PATTERN_HISTORY = 50; // Limit pattern storage

  constructor(
    private readonly tasksService: TasksService,
    private readonly messagesService: MessagesService,
    private readonly summariesService: SummariesService,
    private readonly anthropicService: AnthropicService,
    private readonly openaiService: OpenAIService,
    private readonly googleService: GoogleService,
    private readonly proxyService: ProxyService,
    private readonly inputCaptureService: InputCaptureService,
    private readonly enhancedVisualDetector: EnhancedVisualDetectorService,
    private readonly cvActivityService: CVActivityIndicatorService,
    private readonly modelCapabilityService: ModelCapabilityService,
    private readonly loopDetectionService: LoopDetectionService,
    private readonly taskBlockerService: TaskBlockerService,
    private readonly taskOutcomeService: TaskOutcomeService,
    @Inject(forwardRef(() => TasksGateway))
    private readonly tasksGateway: TasksGateway,
  ) {
    this.services = {
      anthropic: this.anthropicService,
      openai: this.openaiService,
      google: this.googleService,
      proxy: this.proxyService,
    };
    this.loadVisualDescriptionCache();
    this.captionTrainingCollector = new CaptionTrainingDataCollector();
    this.logger.log('AgentProcessor initialized');

    // Apply learned semantic mappings periodically (every 10 minutes)
    setInterval(() => this.applyLearnedSemanticMappings(), 10 * 60 * 1000);
    // Apply immediately on startup
    this.applyLearnedSemanticMappings();
  }

  /**
   * Apply high-confidence training data to visual description cache
   * This creates a feedback loop where successful matches improve future detection
   */
  private applyLearnedSemanticMappings(): void {
    try {
      const stats = this.captionTrainingCollector.getStats();
      if (stats.highConfidenceEntries === 0) {
        return;
      }

      this.logger.debug(
        `Applying learned semantic mappings: ${stats.highConfidenceEntries} high-confidence entries from ${stats.totalEntries} total`
      );

      // Get high-confidence mappings (70%+ confidence, 3+ verified clicks)
      const learnedMappings = this.captionTrainingCollector.getTrainingDataset(0.7);

      // Merge into visual description cache
      for (const mapping of learnedMappings) {
        const appCache = this.visualDescriptionCache.cache[mapping.applicationContext] || {};

        // Merge functional names into existing cache entries
        for (const functionalName of mapping.functionalNames) {
          if (!appCache[functionalName]) {
            // Create new cache entry from learned mapping
            appCache[functionalName] = {
              keywords: mapping.llmKeywords || mapping.functionalNames,
              description: mapping.llmDescription || `Learned from ${mapping.clickCount} interactions`,
              timestamp: Date.now(),
              hits: mapping.clickCount,
              confidence: mapping.confidence,
              successCount: mapping.successCount,
              failureCount: mapping.failureCount,
              lastUsed: Date.now(),
            };
          } else {
            // Update existing entry with learned data
            const existing = appCache[functionalName];
            if (mapping.confidence > existing.confidence) {
              // Merge keywords
              const mergedKeywords = [...new Set([
                ...existing.keywords,
                ...(mapping.llmKeywords || mapping.functionalNames)
              ])];
              existing.keywords = mergedKeywords;
              existing.confidence = Math.max(existing.confidence, mapping.confidence);
              existing.successCount += mapping.successCount;
              existing.hits += mapping.clickCount;
            }
          }
        }

        this.visualDescriptionCache.cache[mapping.applicationContext] = appCache;
      }

      this.saveVisualDescriptionCache();
      this.logger.debug(`Applied ${learnedMappings.length} learned semantic mappings`);
    } catch (error) {
      this.logger.warn(`Failed to apply learned semantic mappings: ${error.message}`);
    }
  }

  /**
   * Compute a simple hash of screenshot buffer for caching
   * Uses first/middle/last 1KB of buffer to balance speed vs accuracy
   */
  private computeScreenshotHash(buffer: Buffer): string {
    const size = buffer.length;
    const sampleSize = 1024;

    // Sample from beginning, middle, and end
    const samples = [
      buffer.subarray(0, Math.min(sampleSize, size)),
      buffer.subarray(Math.floor(size / 2), Math.floor(size / 2) + Math.min(sampleSize, size)),
      buffer.subarray(Math.max(0, size - sampleSize), size)
    ];

    // Simple hash: sum of bytes at key positions
    let hash = 0;
    for (const sample of samples) {
      for (let i = 0; i < sample.length; i += 16) {
        hash = ((hash << 5) - hash) + sample[i];
        hash |= 0; // Convert to 32bit integer
      }
    }

    return `${hash}_${size}`;
  }

  /**
   * Check screenshot cache and return cached elements if available
   * Implements hierarchical cache invalidation (Phase 1.3):
   * - If SOM cache expired, screenshot cache also invalidated
   * - Prevents stale element references
   */
  private getScreenshotCacheEntry(screenshotBuffer: Buffer): DetectedElement[] | null {
    const hash = this.computeScreenshotHash(screenshotBuffer);
    const cached = this.screenshotCache.get(hash);

    if (!cached) {
      return null;
    }

    // Check if SOM cache expired - if so, invalidate screenshot cache too
    const somData = this.somCache.get(hash);
    if (somData && Date.now() - somData.timestamp >= this.SOM_CACHE_TTL_MS) {
      this.logger.debug('SOM cache expired - invalidating screenshot cache for consistency');
      this.screenshotCache.delete(hash);
      this.somCache.delete(hash);
      return null;
    }

    // Check screenshot cache TTL
    if (Date.now() - cached.timestamp < this.SCREENSHOT_CACHE_TTL_MS) {
      this.logger.debug(`Screenshot cache hit (${cached.elements.length} elements, age: ${Date.now() - cached.timestamp}ms)`);
      return cached.elements;
    }

    // Clean up expired entries
    this.screenshotCache.delete(hash);
    if (somData) {
      this.somCache.delete(hash);
    }

    return null;
  }

  /**
   * Store detected elements in screenshot cache
   */
  private setScreenshotCacheEntry(screenshotBuffer: Buffer, elements: DetectedElement[]): void {
    const hash = this.computeScreenshotHash(screenshotBuffer);
    this.screenshotCache.set(hash, {
      elements,
      timestamp: Date.now(),
      screenshotHash: hash,
    });

    // Limit cache size to prevent memory bloat
    if (this.screenshotCache.size > 10) {
      const oldestKey = Array.from(this.screenshotCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
      this.screenshotCache.delete(oldestKey);
    }
  }

  /**
   * Track CV detection attempt for CV-first enforcement
   */
  private trackCVDetectionAttempt(screenshotBuffer: Buffer, description: string): void {
    if (!this.enforceCVFirst || !this.currentTaskId) return;

    const screenshotHash = this.computeScreenshotHash(screenshotBuffer);
    const key = `${this.currentTaskId}_${screenshotHash}_${description}`;

    const attempts = this.cvDetectionAttempts.get(key) || [];
    attempts.push({
      taskId: this.currentTaskId,
      screenshotHash,
      description,
      attemptCount: attempts.length + 1,
      lastAttemptTime: Date.now(),
    });

    this.cvDetectionAttempts.set(key, attempts);

    this.logger.debug(`CV detection attempt ${attempts.length} tracked for "${description}"`);
  }

  /**
   * Get number of CV detection attempts for current screenshot + description
   */
  private getCVAttemptCount(screenshotBuffer: Buffer, description: string): number {
    if (!this.enforceCVFirst || !this.currentTaskId) return 999; // Skip enforcement if disabled

    const screenshotHash = this.computeScreenshotHash(screenshotBuffer);
    const key = `${this.currentTaskId}_${screenshotHash}_${description}`;
    const attempts = this.cvDetectionAttempts.get(key) || [];

    return attempts.length;
  }

  /**
   * Check if description suggests a UI element (vs coordinates or non-UI)
   */
  private isUIElementDescription(description: string | undefined): boolean {
    if (!description || description.trim().length === 0) return false;

    // UI element keywords that suggest this should use CV detection
    const uiKeywords = [
      'button', 'icon', 'field', 'input', 'text', 'search', 'menu', 'link',
      'tab', 'dropdown', 'checkbox', 'radio', 'toggle', 'switch', 'slider',
      'dialog', 'modal', 'popup', 'window', 'panel', 'sidebar', 'toolbar',
      'header', 'footer', 'navigation', 'list', 'item', 'option', 'label',
      'form', 'select', 'textarea', 'scroll', 'bar', 'badge', 'chip', 'card'
    ];

    const descLower = description.toLowerCase();
    return uiKeywords.some(keyword => descLower.includes(keyword));
  }

  /**
   * Get model-specific CV enforcement rules
   */
  private getModelEnforcementRules() {
    if (!this.currentModelName) {
      // Default rules if no model set (Tier 2 balanced)
      return {
        maxCvAttempts: this.CV_REQUIRED_ATTEMPTS,
        allowClickViolations: false,
        enforceCvFirst: true,
        loopDetectionThreshold: 3,
        tier: 'tier2' as const,
      };
    }

    const rules = this.modelCapabilityService.getEnforcementRules(this.currentModelName);
    const tier = this.modelCapabilityService.getModelTier(this.currentModelName);

    return {
      ...rules,
      tier,
    };
  }

  /**
   * Get tool names for logging purposes
   * @param directVisionMode - If true, return direct vision mode tools (no CV)
   * @returns Array of tool names
   */
  private getToolsForLogging(directVisionMode: boolean): string[] {
    const { getToolsForTask } = require('./agent.tools');
    const tools = getToolsForTask(directVisionMode);
    return tools.map((tool: any) => tool.name);
  }

  /**
   * Check if task has timed out (Phase 1.1)
   * Returns timeout info if >2 minutes since last tool call
   */
  private checkTaskTimeout(taskId: string): {
    timedOut: boolean;
    elapsedMs?: number;
    message?: string;
  } {
    const lastActionTime = this.taskLastActionTime.get(taskId);

    if (!lastActionTime) {
      // No action time recorded yet, task just started
      return { timedOut: false };
    }

    const elapsedMs = Date.now() - lastActionTime.getTime();

    if (elapsedMs > this.TIMEOUT_THRESHOLD_MS) {
      const elapsedMinutes = Math.floor(elapsedMs / 60000);
      const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);

      const message = `⏱️ **TIMEOUT DETECTED** ⏱️

The model has been processing for ${elapsedMinutes}m ${elapsedSeconds}s without making any tool calls.

**What This Means:**
- The model may be stuck in a reasoning loop
- There may be a blocker preventing progress (e.g., modal dialog, permission issue)
- The task may be too complex for the current approach

**Recommended Actions:**
1. Review the current screenshot to identify any blockers
2. Try a different approach or break down the task into smaller steps
3. If you're unsure how to proceed, provide specific details about what's blocking you

**Status:** Task automatically set to NEEDS_HELP. Please provide guidance to continue.`;

      return { timedOut: true, elapsedMs, message };
    }

    return { timedOut: false, elapsedMs };
  }

  /**
   * Start progress tracking for a task (Phase 1.3)
   */
  private startProgressTracking(taskId: string): void {
    // Clear any existing interval
    this.stopProgressTracking(taskId);

    // Record start time
    this.taskIterationStartTime.set(taskId, new Date());

    // Emit initial progress
    this.emitProgress(taskId);

    // Set up periodic progress updates
    const interval = setInterval(() => {
      this.emitProgress(taskId);
    }, this.PROGRESS_UPDATE_INTERVAL_MS);

    this.progressIntervals.set(taskId, interval);
    this.logger.debug(`Started progress tracking for task ${taskId}`);
  }

  /**
   * Stop progress tracking for a task (Phase 1.3)
   */
  private stopProgressTracking(taskId: string): void {
    const interval = this.progressIntervals.get(taskId);
    if (interval) {
      clearInterval(interval);
      this.progressIntervals.delete(taskId);
      this.logger.debug(`Stopped progress tracking for task ${taskId}`);
    }
    this.taskIterationStartTime.delete(taskId);
  }

  /**
   * Emit progress update via WebSocket (Phase 1.3)
   */
  private emitProgress(taskId: string): void {
    const startTime = this.taskIterationStartTime.get(taskId);
    if (!startTime) return;

    const elapsedMs = Date.now() - startTime.getTime();
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const lastAction = this.taskLastAction.get(taskId);

    try {
      this.tasksGateway.emitTaskProgress(taskId, {
        type: 'thinking',
        elapsedSeconds,
        lastAction,
        timestamp: new Date().toISOString(),
      });

      this.logger.debug(
        `Progress update: ${elapsedSeconds}s elapsed${lastAction ? `, last: ${lastAction}` : ''}`,
      );
    } catch (error) {
      this.logger.warn(`Failed to emit progress update: ${error.message}`);
    }
  }

  /**
   * Update last action description (Phase 1.3)
   */
  private updateLastAction(taskId: string, action: string): void {
    this.taskLastAction.set(taskId, action);
  }

  /**
   * Check CV-first enforcement: Reject computer_click_mouse for UI elements if CV not tried
   * Uses model-specific enforcement rules based on model tier
   */
  private checkCVFirstEnforcement(
    screenshotBuffer: Buffer,
    description: string | undefined,
    hasCoordinates: boolean,
  ): { allowed: boolean; reason?: string } {
    // Get model-specific enforcement rules
    const rules = this.getModelEnforcementRules();

    // Skip enforcement if disabled globally or for this model tier
    if (!this.enforceCVFirst || !rules.enforceCvFirst) {
      return { allowed: true };
    }

    // Vision-aware enforcement: Check if current model supports vision
    const hasVision = this.currentModel ? supportsVision(this.currentModel) : true;

    // For non-vision models, enforce CV-first less strictly
    // They need text-based element lists from Holo, but can't use SOM annotations
    if (!hasVision) {
      const attemptCount = this.getCVAttemptCount(screenshotBuffer, description || '');
      if (attemptCount < 1) { // Require only 1 CV attempt for non-vision models
        const reason = `⚠️ CV-First Workflow Required (Non-Vision Model)

Your model cannot see images but can use text-based element detection.

REQUIRED WORKFLOW:
1. computer_detect_elements({ description: "", includeAll: true })
   → Get text list of ALL UI elements detected by Holo 1.5-7B
2. Review element list and identify target by description
3. computer_click_element({ element_id: "X" }) or computer_click_mouse()

Current CV attempts: ${attemptCount}/1

💡 **TIP:** Non-vision models get text-based element lists instead of SOM screenshots. Use includeAll mode to see all available elements.`;
        return { allowed: false, reason };
      }
      // Non-vision model has tried CV at least once, allow click
      return { allowed: true };
    }

    // Allow if coordinates provided without description (grid-based clicking)
    if (hasCoordinates && !description) {
      return { allowed: true };
    }

    // Allow if description doesn't suggest UI element
    if (!this.isUIElementDescription(description)) {
      return { allowed: true };
    }

    // Check CV attempt count against model-specific max attempts
    const attemptCount = this.getCVAttemptCount(screenshotBuffer, description || '');

    if (attemptCount < rules.maxCvAttempts) {
      // Tier-specific messaging
      const tierNote = rules.tier === 'tier3'
        ? '\n\n💡 TIP: Your current model has weaker CV capabilities. Consider using keyboard shortcuts or alternative approaches if CV detection repeatedly fails.'
        : rules.tier === 'tier1'
        ? '\n\n✅ Your model has strong CV capabilities. CV detection should work reliably for most UI elements.'
        : '';

      const reason = `⚠️ CV-First Workflow Required (Model Tier: ${rules.tier.toUpperCase()})

You MUST try computer_detect_elements at least ${rules.maxCvAttempts} times before using computer_click_mouse for UI elements.

Current CV attempts for "${description}": ${attemptCount}/${rules.maxCvAttempts}

REQUIRED WORKFLOW:
1. computer_detect_elements({ description: "${description}" })
2. If no match: computer_detect_elements({ description: "", includeAll: true })
3. If still fails (after ${rules.maxCvAttempts} attempts): computer_click_mouse({ description: "${description}" })${tierNote}

WHY: Holo 1.5-7B provides 89% click accuracy vs 60% for Smart Focus.
This is MANDATORY for reliable desktop automation.`;

      return { allowed: false, reason };
    }

    return { allowed: true };
  }

  /**
   * Check if the processor is currently processing a task
   */
  isRunning(): boolean {
    return this.isProcessing;
  }

  /**
   * Get the current task ID being processed
   */
  getCurrentTaskId(): string | null {
    return this.currentTaskId;
  }

  /**
   * Load visual description cache from disk
   */
  private loadVisualDescriptionCache(): void {
    try {
      if (fs.existsSync(this.visualDescriptionCachePath)) {
        const data = fs.readFileSync(this.visualDescriptionCachePath, 'utf-8');
        const loaded = JSON.parse(data);

        // Migrate old cache entries to include confidence scores
        for (const app in loaded.cache) {
          for (const element in loaded.cache[app]) {
            const entry = loaded.cache[app][element];
            if (!entry.confidence) {
              entry.confidence = 0.5; // Default confidence
              entry.successCount = entry.successCount || 0;
              entry.failureCount = entry.failureCount || 0;
              entry.lastUsed = entry.lastUsed || entry.timestamp;
            }
          }
        }

        this.visualDescriptionCache = loaded;
        this.logger.debug('Visual description cache loaded successfully');
      }
    } catch (error) {
      this.logger.warn('Failed to load visual description cache:', error);
    }
  }

  /**
   * Save visual description cache to disk
   */
  private saveVisualDescriptionCache(): void {
    try {
      const dir = path.dirname(this.visualDescriptionCachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.visualDescriptionCachePath,
        JSON.stringify(this.visualDescriptionCache, null, 2),
        'utf-8'
      );
      this.logger.debug('Visual description cache saved successfully');
    } catch (error) {
      this.logger.warn('Failed to save visual description cache:', error);
    }
  }

  /**
   * Get visual description from primary model for unknown UI elements
   * This is a fallback when all CV methods fail to find an element
   */
  private async getVisualDescriptionFromLLM(
    elementDescription: string,
    applicationName: string
  ): Promise<string[]> {
    const cacheKey = `${applicationName}:${elementDescription}`.toLowerCase();

    // Check cache first
    if (!this.visualDescriptionCache.cache[applicationName]) {
      this.visualDescriptionCache.cache[applicationName] = {};
    }

    const cached = this.visualDescriptionCache.cache[applicationName][elementDescription];
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      // Check if confidence is above threshold
      if (cached.confidence < this.MIN_CONFIDENCE_THRESHOLD) {
        this.logger.debug(
          `Cached entry for "${cacheKey}" has low confidence (${cached.confidence.toFixed(2)}), invalidating and re-querying`
        );
        delete this.visualDescriptionCache.cache[applicationName][elementDescription];
        this.saveVisualDescriptionCache();
        // Fall through to query model again
      } else {
        cached.hits++;
        cached.lastUsed = Date.now();
        this.saveVisualDescriptionCache();
        this.logger.debug(
          `Using cached visual description for "${cacheKey}" (${cached.hits} hits, confidence: ${cached.confidence.toFixed(2)})`
        );
        return cached.keywords;
      }
    }

    // Ask primary model for visual description
    this.logger.debug(`Asking primary model for visual description of "${elementDescription}" in ${applicationName}`);

    const prompt = `Describe the "${elementDescription}" in ${applicationName}. Include:
1. Visual shape/icon type (puzzle, gear, square, grid, etc.)
2. Common names or labels that might appear on or near it
3. What it's used for (brief function description)
4. Location (sidebar, toolbar, etc.)

Focus on words that would appear in UI element descriptions. Be specific and use common UI terminology. Keep response to 2-3 sentences max.`;

    try {
      // Use the current task's model to get visual description
      const task = await this.tasksService.findById(this.currentTaskId);
      if (!task) {
        throw new Error('No active task found');
      }

      const model = task.model as unknown as BytebotAgentModel;
      const service = this.services[model.provider];
      if (!service) {
        throw new Error(`Service ${model.provider} not available`);
      }

      // Make a single-turn stateless call with minimal system prompt
      const simpleSystemPrompt = 'You are a helpful assistant that describes UI elements visually.';
      const response = await service.generateMessage(
        simpleSystemPrompt,
        [
          {
            id: `visual_desc_${Date.now()}`,
            role: Role.USER,
            content: [
              {
                type: MessageContentType.Text,
                text: prompt
              }
            ],
            createdAt: new Date(),
            updatedAt: new Date(),
            taskId: this.currentTaskId,
            summaryId: null
          }
        ],
        model.name,
        model, // Pass model metadata for vision capability detection
        false, // No streaming needed
        this.abortController?.signal
      );

      // Extract text content from response
      const textContent = response.contentBlocks.find(
        (block) => block.type === MessageContentType.Text
      ) as TextContentBlock | undefined;

      if (!textContent) {
        throw new Error('No text response from model');
      }

      const description = textContent.text;

      // Extract keywords from description
      const keywords = this.extractVisualKeywords(description);

      // Cache the result with initial confidence of 0.5
      const now = Date.now();
      this.visualDescriptionCache.cache[applicationName][elementDescription] = {
        keywords,
        description,
        timestamp: now,
        hits: 1,
        confidence: 0.5, // Start at neutral confidence
        successCount: 0,
        failureCount: 0,
        lastUsed: now
      };

      this.saveVisualDescriptionCache();

      this.logger.debug(
        `Got visual description keywords: ${keywords.join(', ')} (initial confidence: 0.5)`
      );
      return keywords;
    } catch (error) {
      this.logger.warn(`Failed to get visual description from LLM: ${error.message}`);
      return [];
    }
  }

  /**
   * Extract visual keywords from model's description
   * Prioritizes nouns and functional terms over adjectives
   */
  private extractVisualKeywords(description: string): string[] {
    const keywords: string[] = [];
    const text = description.toLowerCase();

    // High priority: Shapes and UI element types (nouns)
    const shapes = ['puzzle', 'gear', 'magnifying', 'glass', 'hamburger', 'menu', 'arrow', 'circle', 'square', 'triangle', 'star', 'heart', 'bell', 'folder', 'file', 'document', 'search', 'settings', 'cog', 'wrench', 'tool', 'plus', 'minus', 'cross', 'check', 'checkmark', 'grid', 'list', 'icon', 'button'];
    for (const shape of shapes) {
      if (text.includes(shape)) {
        keywords.push(shape);
      }
    }

    // High priority: Functional terms (what it does)
    const functions = ['extension', 'extensions', 'plugin', 'addon', 'setting', 'search', 'find', 'open', 'close', 'save', 'edit', 'view', 'run', 'debug', 'terminal', 'explorer', 'source'];
    for (const func of functions) {
      if (text.includes(func)) {
        keywords.push(func);
      }
    }

    // Medium priority: Locations (but less specific for matching)
    const locations = ['left', 'right', 'top', 'bottom', 'sidebar', 'toolbar', 'statusbar', 'header', 'footer'];
    for (const location of locations) {
      if (text.includes(location)) {
        keywords.push(location);
      }
    }

    // Lower priority: Colors (less useful for matching)
    // Only add if explicitly mentioned in specific context
    if (text.includes('colored') || text.includes('color:')) {
      const colors = ['blue', 'red', 'green', 'yellow', 'orange', 'purple', 'pink', 'grey', 'gray'];
      for (const color of colors) {
        if (text.includes(color)) {
          keywords.push(color);
        }
      }
    }

    // Extract important nouns (3-12 characters, likely UI terms)
    // Avoid common words
    const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'are', 'was', 'were', 'been', 'being', 'its', "it's", 'typically', 'usually', 'often', 'may', 'can', 'will', 'would', 'should']);
    const words = text.match(/\b[a-z]{3,12}\b/g) || [];
    for (const word of words) {
      if (!stopWords.has(word) && !keywords.includes(word)) {
        // Add word if it appears more than once (likely important)
        const occurrences = (text.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
        if (occurrences > 1) {
          keywords.push(word);
        }
      }
    }

    return [...new Set(keywords)]; // Remove duplicates
  }

  /**
   * Set application context for visual descriptions
   */
  public setApplicationContext(applicationName: string): void {
    this.currentApplicationContext = applicationName.toLowerCase();
    this.logger.debug(`Application context set to: ${this.currentApplicationContext}`);
  }

  /**
   * Get the visual description cache (for UI/API exposure)
   */
  public getVisualDescriptionCache(): VisualDescriptionCache {
    return this.visualDescriptionCache;
  }

  /**
   * Reinforce cache entry confidence after successful click
   */
  private reinforceCacheEntry(elementId: string): void {
    const tracking = this.elementCacheUsage.get(elementId);
    if (!tracking || !tracking.usedCachedKeywords) {
      return; // Only reinforce if we actually used cached keywords
    }

    const { applicationName, elementDescription } = tracking;
    const entry = this.visualDescriptionCache.cache[applicationName]?.[elementDescription];

    if (!entry) {
      return;
    }

    // Increase confidence and success count
    const oldConfidence = entry.confidence;
    entry.confidence = Math.min(1.0, entry.confidence + this.CONFIDENCE_BOOST_SUCCESS);
    entry.successCount++;

    this.saveVisualDescriptionCache();

    this.logger.debug(
      `✓ Reinforced cache entry for "${elementDescription}" in ${applicationName}: ` +
      `confidence ${oldConfidence.toFixed(2)} → ${entry.confidence.toFixed(2)} ` +
      `(${entry.successCount} successes, ${entry.failureCount} failures)`
    );

    // Record successful click feedback for training data
    // Find the visual caption from element cache
    const cachedElement = this.elementCache.get(elementId);
    if (cachedElement) {
      const visualCaption = cachedElement.element.metadata?.semantic_caption || cachedElement.element.text || '';
      if (visualCaption) {
        this.captionTrainingCollector.recordClickFeedback(
          visualCaption,
          elementDescription,
          true, // success
          { application: applicationName }
        );

        this.logger.debug(
          `📊 Recorded successful click feedback for training data`
        );
      }
    }

    // Clean up tracking
    this.elementCacheUsage.delete(elementId);
  }

  /**
   * Downgrade cache entry confidence after failed click
   */
  private downgradeCacheEntry(elementId: string): void {
    const tracking = this.elementCacheUsage.get(elementId);
    if (!tracking || !tracking.usedCachedKeywords) {
      return; // Only downgrade if we actually used cached keywords
    }

    const { applicationName, elementDescription } = tracking;
    const entry = this.visualDescriptionCache.cache[applicationName]?.[elementDescription];

    if (!entry) {
      return;
    }

    // Decrease confidence and increment failure count
    const oldConfidence = entry.confidence;
    entry.confidence = Math.max(0.0, entry.confidence - this.CONFIDENCE_PENALTY_FAILURE);
    entry.failureCount++;

    // Record failed click feedback for training data
    const cachedElement = this.elementCache.get(elementId);
    if (cachedElement) {
      const visualCaption = cachedElement.element.metadata?.semantic_caption || cachedElement.element.text || '';
      if (visualCaption) {
        this.captionTrainingCollector.recordClickFeedback(
          visualCaption,
          elementDescription,
          false, // failure
          { application: applicationName }
        );

        this.logger.debug(
          `📊 Recorded failed click feedback for training data`
        );
      }
    }

    // If confidence dropped below threshold, delete the entry
    if (entry.confidence < this.MIN_CONFIDENCE_THRESHOLD) {
      this.logger.debug(
        `✗ Cache entry for "${elementDescription}" in ${applicationName} dropped below threshold, invalidating`
      );
      delete this.visualDescriptionCache.cache[applicationName][elementDescription];
    } else {
      this.logger.debug(
        `✗ Downgraded cache entry for "${elementDescription}" in ${applicationName}: ` +
        `confidence ${oldConfidence.toFixed(2)} → ${entry.confidence.toFixed(2)} ` +
        `(${entry.successCount} successes, ${entry.failureCount} failures)`
      );
    }

    this.saveVisualDescriptionCache();

    // Clean up tracking
    this.elementCacheUsage.delete(elementId);
  }

  @OnEvent('task.takeover')
  handleTaskTakeover({ taskId }: { taskId: string }) {
    this.logger.log(`Task takeover event received for task ID: ${taskId}`);

    // If the agent is still processing this task, abort any in-flight operations
    if (this.currentTaskId === taskId && this.isProcessing) {
      this.abortController?.abort();
    }

    // Always start capturing user input so that emitted actions are received
    this.inputCaptureService.start(taskId);
  }

  @OnEvent('task.resume')
  handleTaskResume({ taskId }: { taskId: string }) {
    if (this.currentTaskId === taskId && this.isProcessing) {
      this.logger.log(`Task resume event received for task ID: ${taskId}`);
      this.abortController = new AbortController();

      void this.runIteration(taskId);
    }
  }

  @OnEvent('task.cancel')
  async handleTaskCancel({ taskId }: { taskId: string }) {
    this.logger.log(`Task cancel event received for task ID: ${taskId}`);

    if (this.currentTaskId !== taskId) {
      this.logger.log(
        `Ignoring cancel event for task ID: ${taskId} because current task is ${this.currentTaskId}`,
      );
      return;
    }

    await this.stopProcessing();
  }

  // Phase 3.3: Record task outcomes for empirical model learning
  @OnEvent('task.completed')
  async handleTaskCompleted({ taskId }: { taskId: string }) {
    this.logger.log(`Task completed event received for task ID: ${taskId}`);
    await this.taskOutcomeService.recordTaskOutcome(taskId);
  }

  @OnEvent('task.failed')
  async handleTaskFailed({ taskId }: { taskId: string }) {
    this.logger.log(`Task failed event received for task ID: ${taskId}`);
    await this.taskOutcomeService.recordTaskOutcome(taskId);
  }

  processTask(taskId: string) {
    this.logger.log(`Starting processing for task ID: ${taskId}`);

    if (this.isProcessing) {
      this.logger.warn('AgentProcessor is already processing another task');
      return;
    }

    this.isProcessing = true;
    this.currentTaskId = taskId;
    this.abortController = new AbortController();
    this.pendingScreenshotObservation = false;

    // Initialize stuck detection state
    this.taskIterationCount.set(taskId, 0);
    this.taskLastActionTime.set(taskId, new Date());

    // Kick off the first iteration without blocking the caller
    void this.runIteration(taskId);
  }

  /**
   * Runs a single iteration of task processing and schedules the next
   * iteration via setImmediate while the task remains RUNNING.
   */
  private async runIteration(taskId: string): Promise<void> {
    if (!this.isProcessing) {
      return;
    }

    try {
      const task: Task = await this.tasksService.findById(taskId);

      if (task.status !== TaskStatus.RUNNING) {
        this.logger.log(
          `Task processing completed for task ID: ${taskId} with status: ${task.status}`,
        );

        // Release lock when task completes
        await this.tasksService.releaseLock(taskId);

        this.isProcessing = false;
        this.currentTaskId = null;
        this.currentModelName = null; // Clear model name on task completion

        // Clean up stuck detection state
        this.taskIterationCount.delete(taskId);
        this.taskLastActionTime.delete(taskId);

        // Clean up loop detection history
        this.loopDetectionService.clearTaskHistory(taskId);

        // Clean up progress tracking (Phase 1.3)
        this.stopProgressTracking(taskId);
        this.taskLastAction.delete(taskId);

        return;
      }

      this.logger.log(`Processing iteration for task ID: ${taskId}`);

      // Start progress tracking (Phase 1.3)
      this.startProgressTracking(taskId);

      // Refresh abort controller for this iteration to avoid accumulating
      // "abort" listeners on a single AbortSignal across iterations.
      this.abortController = new AbortController();

      const latestSummary = await this.summariesService.findLatest(taskId);
      const unsummarizedMessages =
        await this.messagesService.findUnsummarized(taskId);

      // Proactive Context Window Check: Estimate tokens BEFORE constructing messages
      const model = task.model as unknown as BytebotAgentModel;
      const contextWindow = model.contextWindow || 200000;
      const unsummarizedTokens = estimateTotalTokens(unsummarizedMessages);
      const shouldProactivelySummarize =
        unsummarizedTokens >= contextWindow * 0.70; // Trigger at 70% instead of 75%

      this.logger.debug(
        `Context window usage: ${unsummarizedTokens}/${contextWindow} tokens (${Math.round((unsummarizedTokens / contextWindow) * 100)}%)`,
      );

      let messages: Message[];

      if (shouldProactivelySummarize && unsummarizedMessages.length > 5) {
        this.logger.warn(
          `Proactive summarization triggered: ${unsummarizedTokens} tokens (${Math.round((unsummarizedTokens / contextWindow) * 100)}% of context window)`,
        );
        await this.performSummarization(
          taskId,
          model,
          unsummarizedMessages,
        );
        // After summarization, refresh messages
        const newLatestSummary = await this.summariesService.findLatest(taskId);
        const newUnsummarizedMessages =
          await this.messagesService.findUnsummarized(taskId);

        messages = [
          ...(newLatestSummary
            ? [
                {
                  id: '',
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  taskId,
                  summaryId: null,
                  role: Role.USER,
                  content: [
                    {
                      type: MessageContentType.Text,
                      text: newLatestSummary.content,
                    },
                  ],
                } as Message,
              ]
            : []),
          ...newUnsummarizedMessages,
        ];

        // Continue with iteration using summarized messages
        this.logger.log(
          `Context window optimized: ${messages.length} messages after summarization`,
        );
      } else {
        // Normal flow: use unsummarized messages
        messages = [
          ...(latestSummary
            ? [
                {
                  id: '',
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  taskId,
                  summaryId: null,
                  role: Role.USER,
                  content: [
                    {
                      type: MessageContentType.Text,
                      text: latestSummary.content,
                    },
                  ],
                } as Message,
              ]
            : []),
          ...unsummarizedMessages,
        ];
      }

      // Timeout detection (Phase 1.1): Check if model stuck without making tool calls
      const timeoutCheck = this.checkTaskTimeout(taskId);
      if (timeoutCheck.timedOut) {
        this.logger.warn(
          `Task ${taskId} timed out after ${Math.floor(timeoutCheck.elapsedMs! / 60000)}m without tool calls. Auto-setting to NEEDS_HELP.`,
        );

        // Inject timeout message into conversation
        messages.push({
          id: `timeout_${Date.now()}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          taskId,
          summaryId: null,
          role: Role.USER,
          content: [
            {
              type: MessageContentType.Text,
              text: timeoutCheck.message!,
            },
          ],
        });

        // Auto-set to NEEDS_HELP with context (Phase 1.2)
        const helpContext = {
          reason: 'timeout',
          blockerType: 'timeout',
          elapsedMs: timeoutCheck.elapsedMs,
          message: timeoutCheck.message,
          timestamp: new Date().toISOString(),
          suggestedActions: [
            'Review current screenshot for modal dialogs or blockers',
            'Try breaking down the task into smaller steps',
            'Switch to a different model if current approach is not working',
          ],
        };

        await this.tasksService.update(taskId, {
          status: TaskStatus.NEEDS_HELP,
          helpContext,
        });

        // Phase 3.1: Record blocker for cross-model learning
        await this.taskBlockerService.detectAndRecordFromHelpContext(
          taskId,
          helpContext,
          model.name,
        );

        // Create message with timeout info
        await this.messagesService.create({
          content: [
            {
              type: MessageContentType.Text,
              text: timeoutCheck.message!,
            },
          ],
          role: Role.USER,
          taskId,
        });

        // Stop processing this task
        this.isProcessing = false;
        this.currentTaskId = null;
        this.taskIterationCount.delete(taskId);
        this.taskLastActionTime.delete(taskId);
        this.stopProgressTracking(taskId); // Phase 1.3
        this.taskLastAction.delete(taskId); // Phase 1.3
        await this.tasksService.releaseLock(taskId);
        return;
      }

      // Stuck detection: track iteration count and inject intervention if needed
      const iterationCount = (this.taskIterationCount.get(taskId) || 0) + 1;
      this.taskIterationCount.set(taskId, iterationCount);

      // Check if we should inject an intervention prompt
      const shouldIntervene = iterationCount % this.MAX_ITERATIONS_WITHOUT_ACTION === 0;
      if (shouldIntervene) {
        this.logger.warn(
          `Task ${taskId} has been running for ${iterationCount} iterations without completion. Injecting intervention prompt.`,
        );

        // Inject system message forcing the agent to make a decision
        messages.push({
          id: `intervention_${Date.now()}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          taskId,
          summaryId: null,
          role: Role.USER,
          content: [
            {
              type: MessageContentType.Text,
              text: `**SYSTEM INTERVENTION**: You have been processing this task for ${iterationCount} iterations. You must now make a clear decision:

1. If the task is COMPLETE and verified (e.g., via screenshot showing success), call \`set_task_status\` with status="completed" and provide a summary.

2. If you are STUCK or need human guidance, call \`set_task_status\` with status="needs_help" and explain what's blocking you.

3. If the task is NOT complete, take ONE concrete action right now (click, type, open app, etc.) that makes clear progress toward the goal.

Do NOT take screenshots without acting. Do NOT repeat previous actions. Choose one of the three options above immediately.`,
            },
          ],
        });
      }

      this.logger.debug(
        `Sending ${messages.length} messages to LLM for processing`,
      );

      // Reuse model variable from line 1041 (already in scope)

      // Set current model name for tier-based CV enforcement
      this.currentModelName = model.name;
      this.currentModel = model; // Store full model for vision capability checks
      const modelTier = this.modelCapabilityService.getModelTier(model.name);
      this.logger.debug(`Processing task with model: ${model.name} (tier: ${modelTier})`);

      let agentResponse: BytebotAgentResponse;

      const service = this.services[model.provider];
      if (!service) {
        this.logger.warn(
          `No service found for model provider: ${model.provider}`,
        );
        await this.tasksService.update(taskId, {
          status: TaskStatus.FAILED,
        });
        this.isProcessing = false;
        this.currentTaskId = null;
        return;
      }

      const now = new Date();
      const currentDate = now.toLocaleDateString();
      const currentTime = now.toLocaleTimeString();
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // Get model-specific enforcement rules for tier-based prompts
      const rules = this.getModelEnforcementRules();

      // Calculate effective mode considering global override
      const effectiveDirectVisionMode = FORCE_DIRECT_VISION_MODE || task.directVisionMode || false;

      // Log Direct Vision Mode status for visibility
      this.logger.log(
        `Task ${task.id}: Direct Vision Mode = ${effectiveDirectVisionMode} ` +
        `(task.directVisionMode=${task.directVisionMode}, FORCE=${FORCE_DIRECT_VISION_MODE})`,
      );

      // Use direct vision prompt if enabled, otherwise use tier-specific CV-first prompt
      let systemPrompt = effectiveDirectVisionMode
        ? buildAgentSystemPrompt(currentDate, currentTime, timeZone, true)
        : buildTierSpecificAgentSystemPrompt(
            rules.tier,
            rules.maxCvAttempts,
            currentDate,
            currentTime,
            timeZone,
            supportsVision(model),  // Pass vision capability for appropriate prompts
          );

      // Phase 3.1: Inject blocker context from previous failed attempts
      const blockerContext = await this.taskBlockerService.getBlockerContext(taskId);
      if (blockerContext) {
        systemPrompt = systemPrompt + '\n\n' + blockerContext;
        this.logger.log(
          `Task ${taskId}: Injected blocker context from previous failed attempts`,
        );
      }

      // Log which prompt system is being used
      this.logger.log(
        `Task ${task.id}: Using ${effectiveDirectVisionMode ? 'Direct Vision' : `Tier ${rules.tier} CV-First`} prompt system`,
      );

      // Log tools available to model (for debugging)
      const toolsForLogging = effectiveDirectVisionMode
        ? this.getToolsForLogging(true)
        : this.getToolsForLogging(false);
      this.logger.log(
        `Task ${task.id}: Tools provided to model: ${toolsForLogging.join(', ')}`,
      );

      agentResponse = await service.generateMessage(
        systemPrompt,
        messages,
        model.name,
        model, // Pass model metadata for vision capability detection
        true,
        this.abortController.signal,
        effectiveDirectVisionMode, // Pass directVisionMode to exclude CV tools
      );

      const messageContentBlocks = agentResponse.contentBlocks;

      this.logger.debug(
        `Received ${messageContentBlocks.length} content blocks from LLM`,
      );

      if (messageContentBlocks.length === 0) {
        this.logger.warn(
          `Task ID: ${taskId} received no content blocks from LLM, marking as failed`,
        );
        await this.tasksService.update(taskId, {
          status: TaskStatus.FAILED,
        });
        this.isProcessing = false;
        this.currentTaskId = null;
        return;
      }

      await this.messagesService.create({
        content: messageContentBlocks,
        role: Role.ASSISTANT,
        taskId,
      });

      // Reactive summarization (fallback if proactive didn't trigger)
      // This is now less likely to fire since we proactively summarize at 70%
      const contextThreshold = contextWindow * 0.75;
      const shouldReactivelySummarize =
        agentResponse.tokenUsage.totalTokens >= contextThreshold;

      if (shouldReactivelySummarize) {
        this.logger.warn(
          `Reactive summarization triggered: ${agentResponse.tokenUsage.totalTokens}/${contextWindow} tokens (${Math.round((agentResponse.tokenUsage.totalTokens / contextWindow) * 100)}%)`,
        );
        await this.performSummarization(taskId, model, messages);
      }

      this.logger.debug(
        `Token usage for task ${taskId}: ${agentResponse.tokenUsage.totalTokens}/${contextWindow} (${Math.round((agentResponse.tokenUsage.totalTokens / contextWindow) * 100)}%)`,
      );

      const generatedToolResults: ToolResultContentBlock[] = [];

      let mustClearObservationThisReply = this.pendingScreenshotObservation;
      let observationBlockedInReply = false;

      let setTaskStatusToolUseBlock: SetTaskStatusToolUseBlock | null = null;

      for (const block of messageContentBlocks) {
        if (
          this.pendingScreenshotObservation &&
          mustClearObservationThisReply
        ) {
          if (block.type === MessageContentType.Text) {
            const textBlock = block as TextContentBlock;
            const text = (textBlock.text || '').trim();
            if (text.length > 0 && !observationBlockedInReply) {
              this.pendingScreenshotObservation = false;
              mustClearObservationThisReply = false;
            }
          } else if (isComputerToolUseContentBlock(block)) {
            observationBlockedInReply = true;
            generatedToolResults.push({
              type: MessageContentType.ToolResult,
              tool_use_id: block.id,
              is_error: true,
              content: [
                {
                  type: MessageContentType.Text,
                  text: SCREENSHOT_OBSERVATION_GUARD_MESSAGE,
                },
              ],
            });
            continue;
          }
        }

        if (isComputerToolUseContentBlock(block)) {
          // Record tool call for loop detection
          if (this.currentTaskId) {
            this.loopDetectionService.recordToolCall(
              this.currentTaskId,
              block.name,
              block.input as Record<string, any>,
            );
          }

          if (isComputerDetectElementsToolUseBlock(block)) {
            const result = await this.handleComputerDetectElements(block);
            generatedToolResults.push(result);
            continue;
          }

          if (isComputerClickElementToolUseBlock(block)) {
            const result = await this.handleComputerClickElement(block);
            generatedToolResults.push(result);
            continue;
          }

          // CV-First Enforcement: Check if computer_click_mouse requires CV detection first
          if (isClickMouseToolUseBlock(block)) {
            try {
              const screenshotBuffer = await this.captureScreenshotBuffer();
              const hasCoordinates = !!block.input.coordinates;
              const description = block.input.description;

              const enforcement = this.checkCVFirstEnforcement(
                screenshotBuffer,
                description,
                hasCoordinates,
              );

              if (!enforcement.allowed) {
                // Reject click with helpful error message
                this.logger.warn(`CV-first enforcement blocked computer_click_mouse: ${description || 'coordinates'}`);
                generatedToolResults.push({
                  type: MessageContentType.ToolResult,
                  tool_use_id: block.id,
                  content: [
                    {
                      type: MessageContentType.Text,
                      text: enforcement.reason || 'CV-first workflow required',
                    },
                  ],
                  is_error: true,
                });
                continue;
              }
            } catch (enforcementError) {
              this.logger.error(`CV-first enforcement check failed: ${enforcementError.message}`);
              // Continue with click if enforcement check fails (failsafe)
            }
          }

          // Screenshot Loop Prevention for Non-Vision Models
          if (isScreenshotToolUseBlock(block) && this.currentModel && !supportsVision(this.currentModel)) {
            // Count recent screenshot calls in the last 5 messages
            const recentMessages = await this.messagesService.findEvery(taskId);
            const lastFiveMessages = recentMessages.slice(-5);

            const screenshotCalls = lastFiveMessages.filter(msg => {
              if (msg.role !== Role.ASSISTANT) return false;
              const blocks = Array.isArray(msg.content) ? (msg.content as any[]) : [];
              return blocks.some((block: any) =>
                block.type === 'tool_use' && block.name === 'computer_screenshot'
              );
            }).length;

            if (screenshotCalls >= 2) {
              // Block third+ screenshot call for non-vision models
              this.logger.warn(`Screenshot loop blocked for non-vision model (${screenshotCalls} calls in last 5 messages)`);
              generatedToolResults.push({
                type: MessageContentType.ToolResult,
                tool_use_id: block.id,
                content: [
                  {
                    type: MessageContentType.Text,
                    text: `❌ BLOCKED: You've called computer_screenshot ${screenshotCalls} times already.

⚠️ YOU CANNOT SEE SCREENSHOTS - they appear as text to you.

**Required workflow:**
1. computer_detect_elements({ description: "target element", includeAll: true })
   → This returns a TEXT LIST of UI elements with coordinates
2. computer_click_element({ element_id: "0" })
   → Click the element from the list

Taking more screenshots will NOT help. Use computer_detect_elements to find UI elements instead.`,
                  },
                ],
                is_error: true,
              });
              continue;
            }
          }

          const result = await handleComputerToolUse(block, this.logger);

          // Inject SOM (Set-of-Mark) annotated image if available
          const somResult = await this.injectSomImageIfAvailable(result, block);
          generatedToolResults.push(somResult);

          if (
            isScreenshotToolUseBlock(block) ||
            isScreenshotRegionToolUseBlock(block) ||
            isScreenshotCustomRegionToolUseBlock(block)
          ) {
            // Only require observation for vision models
            // Non-vision models receive text descriptions and can proceed immediately
            if (this.currentModel && supportsVision(this.currentModel)) {
              this.pendingScreenshotObservation = true;
              mustClearObservationThisReply = true;
              observationBlockedInReply = false;

              // Skip auto-enrichment in Direct Vision Mode
              // In Direct Vision Mode, the model has full control without CV assistance
              // Check if task is in Direct Vision Mode by looking ahead in the task object
              const currentTask = await this.tasksService.findById(taskId);
              const effectiveDirectVisionMode = FORCE_DIRECT_VISION_MODE || currentTask?.directVisionMode || false;

              if (!effectiveDirectVisionMode) {
                // Automatically enrich screenshots with Holo detection in the background
                // Only for CV-first mode - Direct Vision Mode bypasses all CV tools
                // This runs async and doesn't block the iteration
                this.enrichScreenshotWithOmniParser().catch(err => {
                  this.logger.warn(`Background Holo enrichment failed: ${err.message}`);
                });
              } else {
                this.logger.debug('Direct Vision Mode: Skipping auto-enrichment (model has full control without CV assistance)');
              }
            }
          }
        }

        if (isCreateTaskToolUseBlock(block)) {
          const type = block.input.type?.toUpperCase() as TaskType;
          const priority = block.input.priority?.toUpperCase() as TaskPriority;

          await this.tasksService.create({
            description: block.input.description,
            type,
            createdBy: Role.ASSISTANT,
            ...(block.input.scheduledFor && {
              scheduledFor: new Date(block.input.scheduledFor),
            }),
            model: task.model,
            priority,
          });

          generatedToolResults.push({
            type: MessageContentType.ToolResult,
            tool_use_id: block.id,
            content: [
              {
                type: MessageContentType.Text,
                text: 'The task has been created',
              },
            ],
          });
        }

        if (isSetTaskStatusToolUseBlock(block)) {
          setTaskStatusToolUseBlock = block;

          generatedToolResults.push({
            type: MessageContentType.ToolResult,
            tool_use_id: block.id,
            is_error: block.input.status === 'failed',
            content: [
              {
                type: MessageContentType.Text,
                text: block.input.description,
              },
            ],
          });
        }
      }

      if (generatedToolResults.length > 0) {
        await this.messagesService.create({
          content: generatedToolResults,
          role: Role.USER,
          taskId,
        });

        // Update last action time (Phase 1.1): Model made tool calls, reset timeout timer
        this.taskLastActionTime.set(taskId, new Date());
        this.logger.debug(
          `Task ${taskId}: Updated last action time (${generatedToolResults.length} tool results)`,
        );

        // Update last action description (Phase 1.3)
        if (messageContentBlocks.length > 0) {
          const toolNames = messageContentBlocks
            .filter(block => isComputerToolUseContentBlock(block))
            .map(block => (block as ComputerToolUseContentBlock).name)
            .join(', ');
          if (toolNames) {
            this.updateLastAction(taskId, toolNames);
          }
        }
      }

      // Check for loop detection after tool execution
      if (this.currentTaskId) {
        const rules = this.getModelEnforcementRules();
        const loopResult = this.loopDetectionService.detectLoop(
          this.currentTaskId,
          rules.loopDetectionThreshold,
        );

        if (loopResult.isLoop) {
          // Inject loop warning into conversation
          this.logger.warn(
            `Loop detected in task ${this.currentTaskId}: ${loopResult.pattern} (${loopResult.loopCount} times)`,
          );

          const loopWarning: TextContentBlock = {
            type: MessageContentType.Text,
            text: `⚠️ **LOOP DETECTED** ⚠️

You've called the same tool with the same parameters ${loopResult.loopCount} times in a row.

${loopResult.suggestion}

**IMPORTANT:** Stop repeating the same action. Try a different approach or request help if you're stuck.`,
          };

          await this.messagesService.create({
            content: [loopWarning],
            role: Role.USER,
            taskId: this.currentTaskId,
          });
        }
      }

      // Surface internal CV activity (OmniParser detections) that aren't from explicit tool calls
      await this.surfaceInternalCVActivity(taskId, messageContentBlocks);

      // Update the task status after all tool results have been generated if we have a set task status tool use block
      if (setTaskStatusToolUseBlock) {
        const desired = setTaskStatusToolUseBlock.input.status;
        if (desired === 'completed') {
          const canComplete = await this.canMarkCompleted(taskId);
          if (canComplete) {
            await this.tasksService.update(taskId, {
              status: TaskStatus.COMPLETED,
              completedAt: new Date(),
            });
          } else {
            // Reject completion with guidance; keep task running
            await this.messagesService.create({
              content: [
                {
                  type: MessageContentType.ToolResult,
                  tool_use_id: setTaskStatusToolUseBlock.id,
                  is_error: true,
                  content: [
                    {
                      type: MessageContentType.Text,
                      text: 'Cannot mark as completed yet. Please perform concrete actions (e.g., open the app, click/type/paste, write_file) and provide verification (screenshot of the result or computer_read_file content). Then try completion again.',
                    },
                  ],
                } as any,
              ],
              role: Role.ASSISTANT,
              taskId,
            });
          }
        } else if (desired === 'needs_help') {
          // Store help context (Phase 1.2)
          const helpReason = setTaskStatusToolUseBlock.input.description || 'Model requested help without specific reason';
          const helpContext = {
            reason: 'model_request',
            blockerType: setTaskStatusToolUseBlock.input.blockerType || 'unknown',
            message: helpReason,
            timestamp: new Date().toISOString(),
            suggestedActions: [
              'Review the model\'s explanation above',
              'Provide specific guidance or take manual action',
              'Consider switching to a different model if stuck',
            ],
          };

          await this.tasksService.update(taskId, {
            status: TaskStatus.NEEDS_HELP,
            helpContext,
          });

          // Phase 3.1: Record blocker for cross-model learning
          await this.taskBlockerService.detectAndRecordFromHelpContext(
            taskId,
            helpContext,
            model.name,
          );
        } else if (desired === 'failed') {
          const failureTimestamp = new Date();
          const failureReason =
            setTaskStatusToolUseBlock.input.description ??
            'no description provided';
          this.logger.warn(
            `Task ${taskId} marked as failed via set_task_status tool: ${failureReason}`,
          );
          await this.tasksService.update(taskId, {
            status: TaskStatus.FAILED,
            completedAt: failureTimestamp,
            executedAt: task.executedAt ?? failureTimestamp,
          });
        }
      }

      // Schedule the next iteration without blocking
      if (this.isProcessing) {
        setImmediate(() => this.runIteration(taskId));
      }
    } catch (error: any) {
      if (error?.name === 'BytebotAgentInterrupt') {
        this.logger.warn(`Processing aborted for task ID: ${taskId}`);
      } else {
        this.logger.error(
          `Error during task processing iteration for task ID: ${taskId} - ${error.message}`,
          error.stack,
        );
        await this.tasksService.update(taskId, {
          status: TaskStatus.FAILED,
        });
        // Release lock on error
        await this.tasksService.releaseLock(taskId);

        this.isProcessing = false;
        this.currentTaskId = null;

        // Clean up stuck detection state
        this.taskIterationCount.delete(taskId);
        this.taskLastActionTime.delete(taskId);
      }
    }
  }

  /**
   * Generate tier-aware recommendations for detection failures
   * Adapts guidance based on model capabilities:
   * - Tier1: CV-first with detailed semantic matching
   * - Tier2: Balanced CV + keyboard fallback
   * - Tier3: Keyboard-first with simple CV backup
   */
  private getTierAwareRecommendations(
    description: string,
    topCandidateId?: string,
    hasSemanticScores: boolean = false,
  ): string {
    const tier = this.modelCapabilityService.getModelTier(this.currentModelName);

    // Tier 3: Keyboard-first with simple CV backup
    if (tier === 'tier3') {
      return `**RECOMMENDED ACTIONS (optimized for your model tier):**

⌨️ **1. FASTEST & MOST RELIABLE: Use keyboard shortcuts instead**
   Try these common approaches:
   • VS Code Extensions: Ctrl+Shift+X → Type name → Tab to Install → Enter
   • Firefox Address: Ctrl+L → Type URL → Enter
   • General Navigation: Ctrl+F to find, Tab/Shift+Tab to navigate, Enter to activate

🎯 **2. If keyboard doesn't work: Pick closest CV match**
   computer_click_element({ element_id: "${topCandidateId || 'see_above'}" })

🔍 **3. Or try simpler query:**
   computer_detect_elements({ description: "${description.split(' ')[0]}" })

💡 **TIP:** Your model works best with keyboard shortcuts (simpler reasoning required than CV orchestration)`;
    }

    // Tier 2: Balanced CV + keyboard fallback
    if (tier === 'tier2') {
      return `**RECOMMENDED ACTIONS:**

1. Pick closest match${hasSemanticScores ? ' (good semantic match found)' : ''}:
   computer_click_element({ element_id: "${topCandidateId || 'see_above'}" })

2. Try broader query:
   computer_detect_elements({ description: "${description.split(' ')[0]}" })

3. See all elements:
   computer_detect_elements({ description: "", includeAll: true })

⌨️ **4. If CV keeps failing: Try keyboard shortcuts**
   • Ctrl+P, Ctrl+Shift+P: Command palettes
   • Ctrl+F: Find/search
   • Tab/Shift+Tab: Navigate between elements

💡 **TIP:** Your model has good CV capabilities, but keyboard shortcuts are a reliable fallback for tricky elements`;
    }

    // Tier 1: CV-first with detailed semantic matching
    return `**RECOMMENDED ACTIONS:**

1. Pick closest match${hasSemanticScores ? ` (${Math.round((topCandidateId ? 0.75 : 0.5) * 100)}% semantic match)` : ''}:
   computer_click_element({ element_id: "${topCandidateId || 'see_above'}" })

2. Try broader query with visual synonyms:
   computer_detect_elements({ description: "${description.split(' ')[0]}" })

3. Use discovery mode for full element inventory:
   computer_detect_elements({ description: "", includeAll: true })

💡 **TIP:** Your model excels at semantic matching. Try rephrasing queries to focus on visual appearance (e.g., "gear icon" instead of "settings button")`;
  }

  /**
   * Generate detailed diagnostics and recovery actions for click failures
   * Helps models understand why clicks fail and what to try next
   */
  private getClickFailureDiagnostics(
    elementId: string,
    failureType: 'not_found' | 'verification_failed' | 'exception',
    element?: DetectedElement,
    coordinates?: Coordinates,
    errorMessage?: string,
  ): string {
    const tier = this.modelCapabilityService.getModelTier(this.currentModelName);
    let diagnosis = '';

    // Explain what happened
    if (failureType === 'not_found') {
      diagnosis = `❌ **Click failed:** Element "${elementId}" not found in cache\n\n`;
      diagnosis += `**Diagnosis:**\n`;
      diagnosis += `- Element may have expired from cache (30-60s lifetime)\n`;
      diagnosis += `- Detection may have failed or timed out\n`;
      diagnosis += `- Element ID may be incorrect\n\n`;
    } else if (failureType === 'verification_failed') {
      diagnosis = `❌ **Click failed:** Element "${element?.text || element?.description || elementId}" at (${coordinates?.x}, ${coordinates?.y})\n\n`;
      diagnosis += `**Diagnosis:**\n`;
      diagnosis += `- Target coordinates: (${coordinates?.x}, ${coordinates?.y})\n`;
      diagnosis += `- Click verification: UI unchanged after click\n`;
      diagnosis += `- Possible causes:\n`;
      diagnosis += `  1. Element moved between detection and click\n`;
      diagnosis += `  2. Coordinates slightly off (element edge vs center)\n`;
      diagnosis += `  3. Wrong element selected (${element?.text || 'similar element'} exists, but wrong instance)\n`;
      diagnosis += `  4. Element not interactive or disabled\n\n`;
    } else {
      diagnosis = `❌ **Click failed:** ${errorMessage || 'Unknown error'}\n\n`;
    }

    // Add tier-specific recovery actions
    if (tier === 'tier3') {
      diagnosis += `**RECOVERY ACTIONS (optimized for your model tier):**\n\n`;
      diagnosis += `⌨️ **1. RECOMMENDED: Use keyboard shortcuts instead**\n`;
      diagnosis += `   • More reliable than clicking for your model tier\n`;
      diagnosis += `   • VS Code: Ctrl+Shift+X (extensions), Ctrl+P (quick open), Ctrl+F (find)\n`;
      diagnosis += `   • General: Tab to navigate, Enter to activate, Ctrl+F to search\n\n`;

      if (failureType === 'not_found') {
        diagnosis += `🔍 **2. Re-detect with simpler query:**\n`;
        diagnosis += `   computer_detect_elements({ description: "install" })\n\n`;
        diagnosis += `🎯 **3. Use discovery mode to see all elements:**\n`;
        diagnosis += `   computer_detect_elements({ description: "", includeAll: true })`;
      } else {
        diagnosis += `🔍 **2. Re-detect and try again:**\n`;
        diagnosis += `   computer_detect_elements({ description: "${element?.text || 'install button'}" })\n`;
        diagnosis += `   → Fresh detection with current UI state\n\n`;
        diagnosis += `🎯 **3. If CV keeps failing: Grid-based click as last resort**\n`;
        diagnosis += `   Take new screenshot and manually identify coordinates`;
      }
    } else if (tier === 'tier2') {
      diagnosis += `**RECOVERY ACTIONS:**\n\n`;

      if (failureType === 'not_found') {
        diagnosis += `1. **Re-detect element:**\n`;
        diagnosis += `   computer_detect_elements({ description: "your query here" })\n\n`;
        diagnosis += `2. **Try broader query:**\n`;
        diagnosis += `   computer_detect_elements({ description: "button" })\n\n`;
        diagnosis += `3. **Use keyboard shortcut:**\n`;
        diagnosis += `   • Ctrl+Shift+P: Command palette\n`;
        diagnosis += `   • Ctrl+F: Find/search\n`;
        diagnosis += `   • Tab navigation + Enter`;
      } else {
        diagnosis += `1. **Re-detect with more specific query:**\n`;
        diagnosis += `   computer_detect_elements({ description: "${element?.text || 'target'} for [specific context]" })\n`;
        diagnosis += `   → Example: "install button for cline" instead of just "install"\n\n`;
        diagnosis += `2. **Try keyboard shortcut:**\n`;
        diagnosis += `   Often more reliable for tricky elements\n\n`;
        diagnosis += `3. **Use fallback coordinates:**\n`;
        diagnosis += `   computer_click_element({ element_id: "new_id", fallback_coordinates: { x: ${(coordinates?.x || 0) + 10}, y: ${(coordinates?.y || 0) + 5} } })`;
      }
    } else {
      // Tier 1: Detailed CV guidance
      diagnosis += `**RECOVERY ACTIONS:**\n\n`;

      if (failureType === 'not_found') {
        diagnosis += `1. **Re-detect with refined query:**\n`;
        diagnosis += `   computer_detect_elements({ description: "specific visual description" })\n`;
        diagnosis += `   → Use visual terms: colors, shapes, icons, text labels\n\n`;
        diagnosis += `2. **Use discovery mode for context:**\n`;
        diagnosis += `   computer_detect_elements({ description: "", includeAll: true })\n`;
        diagnosis += `   → See full UI element inventory\n\n`;
        diagnosis += `3. **Try semantic variations:**\n`;
        diagnosis += `   → "install button" vs "add button" vs "plus icon"`;
      } else {
        diagnosis += `1. **Re-detect with enhanced specificity:**\n`;
        diagnosis += `   computer_detect_elements({ description: "${element?.text || 'target'} [add context: location/color/size]" })\n`;
        diagnosis += `   → Example: "install button in extensions panel"\n`;
        diagnosis += `   → Fresh coordinates reflect current UI state\n\n`;
        diagnosis += `2. **Analyze element positioning:**\n`;
        diagnosis += `   - Detection coordinates: (${element?.coordinates.x}, ${element?.coordinates.y})\n`;
        diagnosis += `   - Detection confidence: ${element?.confidence ? (element.confidence * 100).toFixed(0) : 'unknown'}%\n`;
        diagnosis += `   - Element type: ${element?.type || 'unknown'}\n`;
        diagnosis += `   → Low confidence or wrong type may indicate incorrect match\n\n`;
        diagnosis += `3. **Use fallback with offset:**\n`;
        diagnosis += `   computer_click_element({ element_id: "new_id", fallback_coordinates: { x: ${(coordinates?.x || 0) + 10}, y: ${(coordinates?.y || 0) + 5} } })`;
      }
    }

    return diagnosis;
  }

  /**
   * Explain what keywords matched/missed in semantic matching
   * Helps models understand why certain elements scored higher
   */
  private getSemanticMatchExplanation(
    query: string,
    elementDescription: string,
    score: number
  ): string {
    if (score === 0) {
      return '';
    }

    // Normalize and split into keywords
    const normalize = (text: string) =>
      text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2); // Filter out very short words

    const queryKeywords = normalize(query);
    const elementKeywords = normalize(elementDescription);

    // Find matched and missed keywords
    const matched: string[] = [];
    const missed: string[] = [];

    for (const keyword of queryKeywords) {
      // Check for exact match or partial match (for synonyms/variations)
      const hasMatch = elementKeywords.some(
        ek => ek.includes(keyword) || keyword.includes(ek)
      );
      if (hasMatch) {
        matched.push(`"${keyword}"`);
      } else {
        missed.push(`"${keyword}"`);
      }
    }

    if (matched.length === 0 && missed.length === 0) {
      return '';
    }

    let explanation = '';
    if (matched.length > 0) {
      explanation += `   ✅ Matched: ${matched.join(', ')}`;
    }
    if (missed.length > 0) {
      if (explanation) explanation += '\n';
      explanation += `   ❌ Missed: ${missed.join(', ')}`;

      // Add context hint for why this might still be a good match
      if (score > 0.5 && missed.length > 0) {
        explanation += ` (element has related/synonymous terms)`;
      }
    }

    return explanation;
  }

  /**
   * Record successful query pattern for future learning suggestions
   */
  private recordSuccessfulPattern(
    query: string,
    confidence: number,
    applicationContext?: string
  ): void {
    const key = `${applicationContext || 'global'}:${query.toLowerCase().trim()}`;

    const existing = this.successfulQueryPatterns.get(key);
    if (existing) {
      existing.successCount++;
      existing.totalAttempts++;
      existing.avgConfidence =
        (existing.avgConfidence * (existing.successCount - 1) + confidence) /
        existing.successCount;
      existing.lastSuccess = Date.now();
    } else {
      // Limit pattern storage
      if (this.successfulQueryPatterns.size >= this.MAX_PATTERN_HISTORY) {
        // Remove oldest pattern
        let oldestKey: string | null = null;
        let oldestTime = Date.now();
        for (const [k, v] of this.successfulQueryPatterns) {
          if (v.lastSuccess < oldestTime) {
            oldestTime = v.lastSuccess;
            oldestKey = k;
          }
        }
        if (oldestKey) {
          this.successfulQueryPatterns.delete(oldestKey);
        }
      }

      this.successfulQueryPatterns.set(key, {
        query,
        applicationContext,
        successCount: 1,
        totalAttempts: 1,
        avgConfidence: confidence,
        lastSuccess: Date.now(),
      });
    }
  }

  /**
   * Get pattern-based suggestions for failed queries
   * Returns tips based on successful patterns in similar contexts
   */
  private getPatternSuggestions(
    failedQuery: string,
    applicationContext?: string
  ): string {
    // Find similar successful patterns
    const contextPatterns: Array<{
      pattern: any;
      similarity: number;
    }> = [];

    for (const [key, pattern] of this.successfulQueryPatterns) {
      // Filter by application context if available
      if (applicationContext && pattern.applicationContext === applicationContext) {
        // Calculate simple keyword similarity
        const failedKeywords = failedQuery.toLowerCase().split(/\s+/);
        const patternKeywords = pattern.query.toLowerCase().split(/\s+/);
        const commonKeywords = failedKeywords.filter(k =>
          patternKeywords.some(pk => pk.includes(k) || k.includes(pk))
        );
        const similarity = commonKeywords.length / Math.max(failedKeywords.length, 1);

        if (similarity > 0.3 && pattern.successCount > 2) {
          contextPatterns.push({ pattern, similarity });
        }
      }
    }

    if (contextPatterns.length === 0) {
      return '';
    }

    // Sort by success rate and similarity
    contextPatterns.sort((a, b) => {
      const scoreA =
        (a.pattern.successCount / a.pattern.totalAttempts) * a.similarity;
      const scoreB =
        (b.pattern.successCount / b.pattern.totalAttempts) * b.similarity;
      return scoreB - scoreA;
    });

    const topPattern = contextPatterns[0].pattern;
    const successRate = Math.round(
      (topPattern.successCount / topPattern.totalAttempts) * 100
    );

    return `\n\n💡 **TIP:** Similar queries like "${topPattern.query}" have ${successRate}% success rate in ${topPattern.applicationContext || 'this context'}. Try simpler, UI-focused descriptions.`;
  }

  private async handleComputerDetectElements(
    block: ComputerDetectElementsToolUseBlock,
  ): Promise<ToolResultContentBlock> {
    const parsedInput = computerDetectElementsSchema.safeParse(block.input);

    if (!parsedInput.success) {
      const issues = parsedInput.error.issues
        .map((issue) => issue.message)
        .join('; ');

      return {
        type: MessageContentType.ToolResult,
        tool_use_id: block.id,
        content: [
          {
            type: MessageContentType.Text,
            text: `Invalid computer_detect_elements input: ${issues}`,
          },
        ],
        is_error: true,
      };
    }

    const detection = await this.runComputerDetectElements(parsedInput.data);

    if ('error' in detection) {
      return {
        type: MessageContentType.ToolResult,
        tool_use_id: block.id,
        content: [
          {
            type: MessageContentType.Text,
            text: detection.error,
          },
        ],
        is_error: true,
      };
    }

    const description = detection.description?.trim() ?? '';
    const content: MessageContentBlock[] = [];

    if (detection.count === 0) {
      let text = detection.totalDetected === 0
        ? `No UI elements detected for description "${description}".`
        : `No exact match for "${description}". ${detection.totalDetected} element(s) detected overall.`;

      // Add top candidates if available
      if (detection.topCandidates && detection.topCandidates.length > 0) {
        const hasSemanticScores = detection.topCandidates.some(c => c.score > 0);
        const topMatches = detection.topCandidates.map((candidate, i) => {
          const el = candidate.element;
          const desc = el.metadata?.semantic_caption || el.text || el.description || 'unlabeled';
          const location = `(${el.coordinates.x}, ${el.coordinates.y})`;
          const matchStr = hasSemanticScores
            ? `match: ${Math.round(candidate.score * 100)}%`
            : `no semantic match`;

          // Add match explanation for top 3 candidates with semantic scores
          let matchLine = `${i + 1}. [${el.id}] "${desc}" (${matchStr}, conf: ${el.confidence.toFixed(2)}) at ${location}`;

          if (hasSemanticScores && i < 3 && candidate.score > 0) {
            const explanation = this.getSemanticMatchExplanation(
              description,
              desc,
              candidate.score
            );
            if (explanation) {
              matchLine += '\n' + explanation;
            }
          }

          return matchLine;
        }).join('\n');

        if (hasSemanticScores) {
          text += `\n\nTop ${detection.topCandidates.length} closest matches:\n${topMatches}\n\n`;
          text += this.getTierAwareRecommendations(
            description,
            detection.topCandidates[0].element.id,
            true
          );
          // Add pattern-based suggestions if available
          text += this.getPatternSuggestions(description, this.currentApplicationContext);
        } else {
          text += `\n\nYour query didn't match any element descriptions. Here are the ${detection.topCandidates.length} detected elements (sorted by confidence):\n${topMatches}\n\n`;
          text += this.getTierAwareRecommendations(
            description,
            detection.topCandidates[0]?.element.id,
            false
          );
          // Add pattern-based suggestions if available
          text += this.getPatternSuggestions(description, this.currentApplicationContext);
        }
      } else if (detection.totalDetected > 0) {
        text += `\n\n${detection.totalDetected} elements detected but no candidates to show.\n\n`;
        text += this.getTierAwareRecommendations(description, undefined, false);
      }

      content.push({
        type: MessageContentType.Text,
        text,
      });
    } else {
      // Build a detailed summary of what OmniParser found
      const detectionMethods = new Set(detection.elements.map(el => el.metadata?.detectionMethod));
      const methodsUsed = Array.from(detectionMethods).join(' + ');

      let summaryText = `🔍 **OmniParser Detection Results**\n\n`;
      summaryText += `**Query:** "${description || 'all elements'}"\n`;
      summaryText += `**Method:** ${methodsUsed || 'omniparser'}\n`;
      summaryText += `**Found:** ${detection.count} matching / ${detection.totalDetected} total elements\n\n`;

      if (detection.count > 0 && detection.count <= 10) {
        summaryText += `**Detected Elements:**\n`;
        detection.elements.forEach((el, i) => {
          const caption = el.metadata?.semantic_caption || el.text || el.description || 'unlabeled';
          const method = el.metadata?.detectionMethod === 'omniparser' ? '🤖' : '📝';
          summaryText += `${i + 1}. ${method} **${caption}**\n`;
          summaryText += `   • ID: \`${el.id}\`\n`;
          summaryText += `   • Type: ${el.type} | Confidence: ${(el.confidence * 100).toFixed(0)}%\n`;
          summaryText += `   • Location: (${el.coordinates.x}, ${el.coordinates.y})\n\n`;
        });
      } else if (detection.count > 10) {
        summaryText += `**Top 10 Elements:**\n`;
        detection.elements.slice(0, 10).forEach((el, i) => {
          const caption = el.metadata?.semantic_caption || el.text || el.description || 'unlabeled';
          const method = el.metadata?.detectionMethod === 'omniparser' ? '🤖' : '📝';
          summaryText += `${i + 1}. ${method} ${caption} (\`${el.id}\`)\n`;
        });
        summaryText += `\n...and ${detection.count - 10} more elements.\n\n`;
      }

      summaryText += detection.includeAll
        ? `Use \`computer_click_element({ element_id: "..." })\` with any ID above.`
        : `Found ${detection.count} matching element(s) for "${description}". Use \`computer_click_element({ element_id: "..." })\` to click.`;

      content.push({
        type: MessageContentType.Text,
        text: summaryText,
      });
    }

    const payload = {
      description,
      includeAll: detection.includeAll,
      count: detection.count,
      total_detected: detection.totalDetected,
      elements: detection.elements.map((element) => ({
        id: element.id,
        type: element.type,
        text: element.text ?? null,
        semantic_description: element.metadata?.semantic_caption ?? element.description ?? null,
        confidence: Number(element.confidence.toFixed(3)),
        coordinates: element.coordinates,
        detectionMethod: element.metadata.detectionMethod,
      })),
    };

    content.push({
      type: MessageContentType.Text,
      text: `\n<details>\n<summary>📊 Raw Detection Data (JSON)</summary>\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n</details>`,
    });

    // Add SOM (Set-of-Mark) guidance - different formats for vision vs non-vision models
    const screenshotBuffer = await this.captureScreenshotBuffer();
    const screenshotHash = this.computeScreenshotHash(screenshotBuffer);
    const somData = this.somCache.get(screenshotHash);

    if (somData && Date.now() - somData.timestamp < this.SOM_CACHE_TTL_MS && isSOMEnabled()) {
      const isVisionModel = this.currentModel && supportsVision(this.currentModel);

      if (isVisionModel) {
        // Vision models: Send SOM-annotated screenshot with numbered boxes
        this.logger.log(`📍 Including SOM-annotated screenshot for vision model (${somData.elementMapping.size} numbered elements)`);
        content.push({
          type: MessageContentType.Image,
          source: {
            data: somData.somImage,
            media_type: 'image/png',
            type: 'base64',
          },
        });
        content.push({
          type: MessageContentType.Text,
          text: `\n**📍 Visual Guide:** The screenshot above shows detected elements with numbered boxes [0], [1], [2], etc. You can reference elements by their visible number for easier identification.\n\n💡 To click an element, use: \`computer_click_element({ element_id: "N" })\` where N is the visible number (e.g., "0", "1", "2").`,
        });
      } else {
        // Non-vision models: Send structured text list of numbered elements
        this.logger.log(`📍 Including SOM element list for non-vision model (${somData.elementMapping.size} numbered elements)`);

        // Convert element mapping to element list using IDs from detection.elements
        const elementById = new Map(detection.elements.map(el => [el.id, el]));
        const somElements: DetectedElement[] = [];

        // Build element list from mapping (maintaining number order)
        const sortedEntries = Array.from(somData.elementMapping.entries()).sort((a, b) => a[0] - b[0]);
        for (const [, elementId] of sortedEntries) {
          const element = elementById.get(elementId);
          if (element) {
            somElements.push(element);
          }
        }

        // Format as structured text
        const somText = formatSOMAsText(somData.elementMapping, somElements);
        content.push({
          type: MessageContentType.Text,
          text: `\n${somText}`,
        });
      }
    }

    return {
      type: MessageContentType.ToolResult,
      tool_use_id: block.id,
      content,
    };
  }

  private async handleComputerClickElement(
    block: ComputerClickElementToolUseBlock,
  ): Promise<ToolResultContentBlock> {
    const clickResult = await this.runComputerClickElement(block.input);

    const content: MessageContentBlock[] = [];

    if (clickResult.success) {
      const coordinates = clickResult.coordinates_used;
      const method = clickResult.detection_method ?? 'computer vision';
      const elementText = clickResult.element_text || 'unlabeled';
      const confidence = clickResult.confidence ? `${(clickResult.confidence * 100).toFixed(0)}%` : 'N/A';

      let clickSummary = `✅ **Element Clicked Successfully**\n\n`;
      clickSummary += `**Element:** "${elementText}"\n`;
      clickSummary += `**ID:** \`${clickResult.element_id}\`\n`;
      clickSummary += `**Method:** ${method === 'omniparser' ? '🤖 OmniParser' : method}\n`;
      clickSummary += `**Confidence:** ${confidence}\n`;
      clickSummary += `**Coordinates:** (${coordinates.x}, ${coordinates.y})`;

      content.push({
        type: MessageContentType.Text,
        text: clickSummary,
      });
    } else {
      content.push({
        type: MessageContentType.Text,
        text: `❌ Click element failed: ${'error' in clickResult ? clickResult.error : 'Unknown error'}`,
      });
    }

    content.push({
      type: MessageContentType.Text,
      text: `\n<details>\n<summary>📊 Raw Click Data (JSON)</summary>\n\n\`\`\`json\n${JSON.stringify(clickResult, null, 2)}\n\`\`\`\n</details>`,
    });

    return {
      type: MessageContentType.ToolResult,
      tool_use_id: block.id,
      content,
      is_error: !clickResult.success,
    };
  }

  private async runComputerDetectElements(
    params: ComputerDetectElementsInput,
  ): Promise<DetectElementsResponse> {
    try {
      // Wait for background enrichment if in progress (Phase 1.2)
      // This prevents duplicate Holo detections and leverages cached results
      if (this.enrichmentPromise) {
        this.logger.debug('Waiting for background enrichment to complete (max 3s)...');
        await Promise.race([
          this.enrichmentPromise,
          new Promise(resolve => setTimeout(resolve, 3000)) // 3 second timeout
        ]);
      }

      const screenshotBuffer = await this.captureScreenshotBuffer();

      // Check screenshot cache first (30s TTL - Phase 1.3)
      const cachedElements = this.getScreenshotCacheEntry(screenshotBuffer);
      let elements: DetectedElement[];

      if (cachedElements) {
        // Use cached elements - skip expensive CV processing
        elements = cachedElements;
        this.logger.debug(`Using cached detection results (${elements.length} elements)`);
      } else {
        // NEW: Try semantic cache matching for task-specific queries
        // If we have SOM data with descriptions, try to match the query against cached descriptions
        if (params.description && !params.includeAll) {
          const screenshotHash = this.computeScreenshotHash(screenshotBuffer);
          const somData = this.somCache.get(screenshotHash);

          if (somData && Date.now() - somData.timestamp < this.SOM_CACHE_TTL_MS) {
            // We have cached SOM data - try semantic matching with fuzzy fallback (Phase 2.2 + 3.1)
            let bestMatch: { elementId: string; score: number; description: string; matchType: string } | null = null;

            for (const [elementNumber, elementId] of somData.elementMapping) {
              const descriptionVariants = somData.elementDescriptions.get(elementNumber);
              if (descriptionVariants && descriptionVariants.length > 0) {
                // Try matching against all variants and keep the best score (Phase 3.1)
                for (const variant of descriptionVariants) {
                  // Try semantic matching first
                  const semanticScore = scoreSemanticMatch(params.description, variant);
                  // Try fuzzy matching as fallback
                  const fuzzyScore = levenshteinSimilarity(params.description, variant);
                  // Use the better score
                  const combinedScore = Math.max(semanticScore, fuzzyScore);
                  const matchType = semanticScore > fuzzyScore ? 'semantic' : 'fuzzy';

                  if (!bestMatch || combinedScore > bestMatch.score) {
                    bestMatch = { elementId, score: combinedScore, description: variant, matchType };
                  }
                }
              }
            }

            // If we found a good match (>50%, lowered from 60% - Phase 2.2), use cached elements
            if (bestMatch && bestMatch.score > 0.50) {
              // Get from screenshot cache (should exist since SOM is cached)
              const maybeElements = this.getScreenshotCacheEntry(screenshotBuffer);
              if (maybeElements) {
                elements = maybeElements;
                this.logger.log(
                  `🎯 ${bestMatch.matchType === 'semantic' ? 'Semantic' : 'Fuzzy'} cache hit: "${params.description}" matched "${bestMatch.description}" (${Math.round(bestMatch.score * 100)}% similarity)`
                );
                // Continue to response formatting
              }
            }
          }
        }

        // If semantic matching didn't succeed, run full detection
        if (!elements) {
        // Cache miss - run full detection pipeline
        const searchRegion = params.region
          ? this.normalizeRegion(params.region)
          : undefined;

        // Use enhanced CV detection with OmniParser-first strategy
        // The enhanced-visual-detector now automatically:
        // 1. Runs OmniParser (semantic) as primary method
        // 2. Falls back to classical CV (geometric) if needed
        // 3. Runs slow methods (OmniParser + OCR) in parallel
        // OpenCV removed - screenshot buffer used directly by OmniParser/OCR
        const screenshot = screenshotBuffer;

        const enhancedResult = await this.enhancedVisualDetector.detectElements(
          screenshot,
          null, // No template for general detection
          {
            // ALWAYS use multi-element mode for better coverage and semantic matching
            // Single-shot mode was limiting results to 1 element; multi-element returns 20-100
            // Filtering by description happens client-side after detection
            holoTask: undefined,  // Always multi-element mode
            // Let enhanced-visual-detector handle method selection automatically
            // OmniParser defaults to enabled when service is available
            confidenceThreshold: 0.5,
            maxResults: params.includeAll ? 100 : 20,  // More elements for discovery mode
            ocrRegion: searchRegion,
          }
        );

        elements = enhancedResult.elements;

        // Store enhanced result for telemetry
        this.lastEnhancedResult = enhancedResult;

        // Track CV detection attempt for enforcement (if description provided)
        if (params.description) {
          this.trackCVDetectionAttempt(screenshotBuffer, params.description);
        }

        // Store SOM data if available
        if (enhancedResult.somImage && enhancedResult.elementMapping) {
          const screenshotHash = this.computeScreenshotHash(screenshotBuffer);

          // Build element descriptions map with variants for better semantic matching (Phase 3.1)
          const elementDescriptions = new Map<number, string[]>();
          for (const [elementNumber, elementId] of enhancedResult.elementMapping) {
            // Find the element by ID
            const element = elements.find(el => el.id === elementId);
            if (element) {
              // Store multiple description variants for better matching
              const variants = [
                element.text || '',
                element.description || '',
                element.metadata?.task_caption || element.metadata?.semantic_caption || '',
                this.extractKeywords(element),
                `${element.type} element`
              ].filter(v => v && v.trim().length > 0); // Remove empty variants

              elementDescriptions.set(elementNumber, variants);
            }
          }

          this.somCache.set(screenshotHash, {
            somImage: enhancedResult.somImage,
            elementMapping: enhancedResult.elementMapping,
            elementDescriptions,
            timestamp: Date.now(),
          });
          this.logger.debug(`📍 Stored SOM data for screenshot (${enhancedResult.elementMapping.size} elements with ${Array.from(elementDescriptions.values()).reduce((sum, variants) => sum + variants.length, 0)} description variants)`);
        }

        // Cache the results for future requests
        this.setScreenshotCacheEntry(screenshotBuffer, elements);
        } // Close if (!elements) block from semantic matching
      }
      this.cacheDetectedElements(elements);

      // SIMPLIFIED: Return all Holo elements directly - let the AI model choose
      // No semantic matching, no filtering, no LLM fallback
      // The model is smart enough to pick from a numbered SOM list

      // Record detection for telemetry
      // Extract primary method from: elements metadata, or enhancedResult.methodsUsed
      let primaryMethod = elements[0]?.metadata?.detectionMethod || 'unknown';
      if (primaryMethod === 'unknown' && this.lastEnhancedResult?.methodsUsed?.[0]) {
        primaryMethod = this.lastEnhancedResult.methodsUsed[0];
      }

      const detectionEntry: DetectionHistoryEntry = {
        timestamp: new Date(),
        description: params.description || '(all elements)',
        elementsFound: elements.length,
        primaryMethod,
        cached: !!cachedElements,
        duration: this.lastEnhancedResult?.performance?.totalTime || 0,
        elements: elements.slice(0, 10).map(el => ({
          id: el.id,
          semanticDescription: el.metadata?.semantic_caption || el.text,
          confidence: el.confidence,
          coordinates: { x: el.coordinates.x, y: el.coordinates.y },
        })),
      };
      this.cvActivityService.recordDetection(detectionEntry);

      this.logger.debug(
        `Returning all ${elements.length} detected elements with SOM numbering - model will choose`
      );

      // Return ALL elements - model chooses from SOM numbered list [0], [1], [2]...
      return {
        elements,
        count: elements.length,
        totalDetected: elements.length,
        includeAll: true,  // Signal that we're returning all elements
        description: params.description,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Element detection failed: ${message}`);
      return {
        error: `Element detection failed: ${message}`,
        elements: [],
        count: 0,
        description: params.description,
      };
    }
  }

  private async runComputerClickElement(
    params: ComputerClickElementInput,
  ): Promise<ClickElementResponse> {
    // Handle SOM element number references (e.g., "element 5", "5", "number 3")
    // Declare outside try block so it's accessible in catch
    let elementId = params.element_id;

    try {
      const somNumberMatch = elementId.match(/(?:element|number|box)?\s*(\d+)/i);

      if (somNumberMatch) {
        const elementNumber = parseInt(somNumberMatch[1], 10);

        // Find the most recent SOM cache entry with this element number
        let foundMapping: string | undefined;
        let newestTimestamp = 0;

        for (const [, somData] of this.somCache) {
          if (somData.timestamp > newestTimestamp && somData.elementMapping.has(elementNumber)) {
            foundMapping = somData.elementMapping.get(elementNumber);
            newestTimestamp = somData.timestamp;
          }
        }

        if (foundMapping) {
          this.logger.log(`📍 SOM element reference detected: "${params.element_id}" → element ID "${foundMapping}"`);
          elementId = foundMapping;
        } else if (!isNaN(elementNumber) && elementNumber >= 0) {
          // Element number provided but no mapping found
          this.logger.warn(`📍 SOM element number ${elementNumber} not found in cache. Using element_id as-is.`);
        }
      }

      let element = this.getElementFromCache(elementId);

      if (!element) {
        this.logger.warn(
          `Element ${elementId} missing from cache; refreshing detections via includeAll scan.`,
        );

        try {
          await this.runComputerDetectElements({
            description: '',
            includeAll: true,
          });
        } catch (refreshError) {
          this.logger.warn(
            `Failed to refresh detection cache before click: ${(refreshError as Error).message}`,
          );
        }

        element = this.getElementFromCache(elementId);
      }

      if (!element) {
        const explicitFallback = params.fallback_coordinates;

        if (explicitFallback) {
          const fallbackResult = await this.handleComputerClickMouse({
            x: explicitFallback.x,
            y: explicitFallback.y,
            button: 'left',
            clickCount: 1,
          });

          if (fallbackResult.success) {
            // Record fallback click (element not cached)
            const fallbackClickEntry: ClickHistoryEntry = {
              timestamp: new Date(),
              elementId,
              coordinates: explicitFallback,
              success: true,
              detectionMethod: 'fallback_coordinates',
            };
            this.cvActivityService.recordClick(fallbackClickEntry);

            return {
              success: true,
              element_id: elementId,
              coordinates_used: explicitFallback,
              detection_method: 'fallback_coordinates',
            };
          }

          // Record failed fallback click
          const failedFallbackEntry: ClickHistoryEntry = {
            timestamp: new Date(),
            elementId,
            coordinates: explicitFallback,
            success: false,
            detectionMethod: 'fallback_coordinates',
          };
          this.cvActivityService.recordClick(failedFallbackEntry);

          return {
            success: false,
            element_id: elementId,
            error: this.getClickFailureDiagnostics(
              elementId,
              'not_found',
              undefined,
              params.fallback_coordinates,
              'Fallback coordinates failed'
            ),
            coordinates_used: params.fallback_coordinates,
            detection_method: 'fallback_coordinates',
          };
        }

        throw new Error(
          `Element with ID ${elementId} not found. Run computer_detect_elements first.`,
        );
      }

      // Extract click coordinates from element's center point
      const clickTarget: ClickTarget = {
        coordinates: {
          x: Math.round(element.coordinates.centerX),
          y: Math.round(element.coordinates.centerY),
        },
        method: element.metadata.detectionMethod,
        confidence: element.confidence,
      };

      const fallbackCoordinates =
        params.fallback_coordinates ?? clickTarget.coordinates;

      const result = await this.handleComputerClickMouse({
        x: clickTarget.coordinates.x,
        y: clickTarget.coordinates.y,
        button: 'left',
        clickCount: 1,
        description: `CV-detected ${element.type}: "${element.text || element.description}"`,
      });

      if (result.success) {
        // Reinforce cache entry on successful click
        this.reinforceCacheEntry(elementId);

        // Record click for telemetry
        const clickEntry: ClickHistoryEntry = {
          timestamp: new Date(),
          elementId,
          coordinates: clickTarget.coordinates,
          success: true,
          detectionMethod: element.metadata.detectionMethod || 'unknown',
        };
        this.cvActivityService.recordClick(clickEntry);

        return {
          success: true,
          element_id: elementId,
          coordinates_used: clickTarget.coordinates,
          detection_method: element.metadata.detectionMethod,
          confidence: element.confidence,
          element_text: element.text ?? null,
        };
      }

      if (fallbackCoordinates) {
        const fallbackResult = await this.handleComputerClickMouse({
          x: fallbackCoordinates.x,
          y: fallbackCoordinates.y,
          button: 'left',
          clickCount: 1,
        });

        if (fallbackResult.success) {
          // Still reinforce even if fallback worked (element was detected, just coords were slightly off)
          this.reinforceCacheEntry(elementId);

          // Record fallback click success for telemetry
          const fallbackClickEntry: ClickHistoryEntry = {
            timestamp: new Date(),
            elementId,
            coordinates: fallbackCoordinates,
            success: true,
            detectionMethod: `${element.metadata.detectionMethod}_fallback`,
          };
          this.cvActivityService.recordClick(fallbackClickEntry);

          return {
            success: true,
            element_id: elementId,
            coordinates_used: fallbackCoordinates,
            detection_method: `${element.metadata.detectionMethod}_fallback`,
            confidence: element.confidence,
            element_text: element.text ?? null,
          };
        }
      }

      // Downgrade cache entry on failed click
      this.downgradeCacheEntry(elementId);

      // Record failed click for telemetry
      const failedClickEntry: ClickHistoryEntry = {
        timestamp: new Date(),
        elementId,
        coordinates: clickTarget.coordinates,
        success: false,
        detectionMethod: element.metadata.detectionMethod || 'unknown',
      };
      this.cvActivityService.recordClick(failedClickEntry);

      return {
        success: false,
        element_id: elementId,
        error: this.getClickFailureDiagnostics(
          elementId,
          'verification_failed',
          element,
          clickTarget.coordinates,
          'Click verification failed - UI unchanged'
        ),
        detection_method: element.metadata.detectionMethod,
        confidence: element.confidence,
        element_text: element.text ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Element click failed: ${message}`);

      // Downgrade cache entry on error (if element was tracked)
      // Note: elementId may not be defined if error occurred during parsing
      const idForCache = typeof elementId !== 'undefined' ? elementId : params.element_id;
      this.downgradeCacheEntry(idForCache);

      return {
        success: false,
        element_id: idForCache,
        error: this.getClickFailureDiagnostics(
          idForCache,
          'exception',
          undefined,
          undefined,
          message
        ),
      };
    }
  }

  /**
   * Inject SOM (Set-of-Mark) annotated image into screenshot tool results
   * Replaces regular screenshots with numbered, annotated versions when available
   */
  private async injectSomImageIfAvailable(
    result: ToolResultContentBlock,
    block: ComputerToolUseContentBlock,
  ): Promise<ToolResultContentBlock> {
    // Only inject SOM for screenshot tools
    if (
      !isScreenshotToolUseBlock(block) &&
      !isScreenshotRegionToolUseBlock(block) &&
      !isScreenshotCustomRegionToolUseBlock(block)
    ) {
      return result;
    }

    try {
      // Get the most recent screenshot (just captured)
      const screenshotBuffer = await this.captureScreenshotBuffer();
      const screenshotHash = this.computeScreenshotHash(screenshotBuffer);

      // Check if we have SOM data for this screenshot
      const somData = this.somCache.get(screenshotHash);
      if (!somData || Date.now() - somData.timestamp > this.SOM_CACHE_TTL_MS) {
        // No SOM data or expired - return original result
        return result;
      }

      // Found SOM data! Replace the image content with SOM-annotated version
      this.logger.log(`📍 Injecting SOM-annotated screenshot (${somData.elementMapping.size} numbered elements)`);

      const newContent: MessageContentBlock[] = result.content.map((contentBlock): MessageContentBlock => {
        if (contentBlock.type === MessageContentType.Image) {
          // Replace with SOM image - explicitly type as ImageContentBlock
          const somImageBlock: ImageContentBlock = {
            type: MessageContentType.Image,
            source: {
              type: 'base64' as const,
              media_type: 'image/png' as const,
              data: somData.somImage,
            },
          };
          return somImageBlock;
        }
        return contentBlock;
      });

      // Add a text block explaining the numbered elements
      newContent.push({
        type: MessageContentType.Text,
        text: `\n**Note:** This screenshot shows ${somData.elementMapping.size} UI elements marked with red numbered boxes. You can reference these elements by their numbers (e.g., "element 5") for precise clicking.`,
      });

      return {
        ...result,
        content: newContent,
      };
    } catch (error) {
      this.logger.warn(`Failed to inject SOM image: ${error.message}`);
      return result;
    }
  }

  private async captureScreenshotBuffer(): Promise<Buffer> {
    const baseUrl = this.getDesktopBaseUrl();
    const response = await fetch(`${baseUrl}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'screenshot',
        showCursor: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to take screenshot: ${response.statusText}`);
    }

    const payload = (await response.json()) as { image?: string };
    if (!payload.image) {
      throw new Error('Screenshot response did not include image data');
    }

    return Buffer.from(payload.image, 'base64');
  }

  /**
   * Automatically enriches the current screenshot with OmniParser detection
   * Runs in the background and populates caches for future detect_elements calls
   * This creates "internal activity" that will be surfaced to the user
   *
   * Optimizations:
   * - Prevents concurrent enrichments (only one at a time)
   * - Enforces cooldown period to prevent queue buildup
   * - Reduces maxResults from 100 to 30 for faster processing
   */
  private async enrichScreenshotWithOmniParser(): Promise<void> {
    // Check if enrichment already in progress
    if (this.enrichmentPromise) {
      this.logger.debug('Background enrichment already in progress, skipping duplicate');
      return this.enrichmentPromise;
    }

    // Check cooldown to prevent rapid enrichment pile-up
    const now = Date.now();
    if (now - this.lastEnrichmentTime < this.ENRICHMENT_COOLDOWN_MS) {
      this.logger.debug(`Background enrichment cooldown active (${this.ENRICHMENT_COOLDOWN_MS}ms), skipping`);
      return;
    }

    // Track enrichment promise to prevent race conditions
    this.enrichmentPromise = this._doEnrichment();

    try {
      await this.enrichmentPromise;
    } finally {
      this.enrichmentPromise = null;
      this.lastEnrichmentTime = Date.now();
    }
  }

  /**
   * Internal method that performs the actual enrichment work
   */
  private async _doEnrichment(): Promise<void> {
    try {
      const screenshotBuffer = await this.captureScreenshotBuffer();

      // Check if we already have cached elements for this screenshot
      const cached = this.getScreenshotCacheEntry(screenshotBuffer);
      if (cached) {
        this.logger.debug(`Screenshot already enriched (${cached.length} elements in cache)`);
        return;
      }

      // Run OmniParser detection in the background
      // This will automatically track activity via CVActivityIndicatorService
      const enhancedResult = await this.enhancedVisualDetector.detectElements(
        screenshotBuffer,
        null,
        {
          confidenceThreshold: 0.5,
          maxResults: 30,  // Reduced from 100 - matches typical on-demand usage (Phase 2.1)
        }
      );

      // Cache the results for future detect_elements calls
      this.setScreenshotCacheEntry(screenshotBuffer, enhancedResult.elements);
      this.cacheDetectedElements(enhancedResult.elements);

      this.logger.log(`🔍 Auto-enriched screenshot with ${enhancedResult.elements.length} elements (${enhancedResult.methodsUsed.join(', ')})`);
    } catch (error) {
      // Don't throw - this is background enrichment, shouldn't break the main flow
      this.logger.warn(`Failed to auto-enrich screenshot: ${error.message}`);
    }
  }

  /**
   * Extract keywords from element text/description for better semantic matching (Phase 3.1)
   * Filters out common stop words and keeps meaningful terms
   */
  private extractKeywords(element: DetectedElement): string {
    const text = (element.text || element.description || '').toLowerCase();
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'for', 'with', 'to', 'of', 'in', 'on', 'at']);

    const words = text.split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word))
      .join(' ');

    return words || element.type;
  }

  private normalizeRegion(region: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): BoundingBox {
    return {
      ...region,
      centerX: region.x + region.width / 2,
      centerY: region.y + region.height / 2,
    };
  }

  private cacheDetectedElements(elements: DetectedElement[]): void {
    this.pruneElementCache();

    const timestamp = Date.now();
    for (const element of elements) {
      this.elementCache.set(element.id, {
        element,
        timestamp,
        taskId: this.currentTaskId,
      });
    }
  }


  private getElementFromCache(elementId: string): DetectedElement | null {
    this.pruneElementCache();

    const cached = this.elementCache.get(elementId);
    if (!cached) {
      return null;
    }

    if (cached.taskId && cached.taskId !== this.currentTaskId) {
      return null;
    }

    cached.timestamp = Date.now();
    return cached.element;
  }

  private pruneElementCache(): void {
    const now = Date.now();
    for (const [id, cached] of this.elementCache.entries()) {
      if (
        now - cached.timestamp > this.elementCacheTtlMs ||
        (cached.taskId && cached.taskId !== this.currentTaskId)
      ) {
        this.elementCache.delete(id);
      }
    }
  }

  private async handleComputerClickMouse(params: {
    x: number;
    y: number;
    button: 'left' | 'right' | 'middle';
    clickCount: number;
    description?: string;
  }): Promise<{ success: boolean }> {
    const success = await this.attemptClickAt(
      { x: params.x, y: params.y },
      { button: params.button, clickCount: params.clickCount },
    );

    return { success };
  }

  private async attemptClickAt(
    coordinates: Coordinates,
    options?: {
      button?: 'left' | 'right' | 'middle';
      clickCount?: number;
    },
  ): Promise<boolean> {
    const baseUrl = this.getDesktopBaseUrl();
    try {
      const response = await fetch(`${baseUrl}/computer-use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'click_mouse',
          coordinates,
          button: options?.button ?? 'left',
          clickCount: options?.clickCount ?? 1,
        }),
      });

      if (!response.ok) {
        return false;
      }

      try {
        const payload = (await response.json()) as { success?: boolean };
        if (typeof payload.success === 'boolean') {
          return payload.success;
        }
      } catch {
        // Ignore JSON parsing errors; fall back to assuming success when HTTP 200
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Click request failed at (${coordinates.x}, ${coordinates.y}): ${
          (error as Error).message
        }`,
      );
      return false;
    }
  }

  private getDesktopBaseUrl(): string {
    const baseUrl = process.env.BYTEBOT_DESKTOP_BASE_URL;
    if (!baseUrl) {
      throw new Error('BYTEBOT_DESKTOP_BASE_URL is not configured');
    }
    return baseUrl;
  }

  /**
   * Basic completion gate: ensure at least one meaningful action occurred
   * (click/type/paste/press_keys/drag/application/write/read_file), optionally
   * with verification (document or screenshot present in history).
   */
  /**
   * Surface internal CV activity (OmniParser detections) that happened but weren't explicit tool calls
   * This shows the user what OmniParser detected even for internal operations like caching/smart focus
   */
  private async surfaceInternalCVActivity(
    taskId: string,
    messageContentBlocks: MessageContentBlock[]
  ): Promise<void> {
    try {
      // Check if there were any explicit computer_detect_elements calls
      const hadExplicitDetection = messageContentBlocks.some(
        block => isComputerDetectElementsToolUseBlock(block)
      );

      // If there was an explicit detection call, it already created messages
      if (hadExplicitDetection) {
        this.logger.debug('Skipping internal CV activity surfacing: explicit detection call found');
        return;
      }

      // Get recent CV activity from the activity service
      const methodHistory = this.cvActivityService.getMethodHistory();

      // Check for recent Holo 1.5-7B detections (within last 30 seconds - increased from 5s)
      const now = Date.now();
      const recentDetections = methodHistory.filter(entry => {
        const age = entry.startTime ? (now - entry.startTime) : Infinity;
        return entry.method === 'holo-1.5-7b' && age < 30000;
      });

      this.logger.debug(`CV Activity Check: ${recentDetections.length} recent Holo 1.5-7B detections in last 30s`);

      // If there were internal Holo 1.5-7B detections, create an informational message
      if (recentDetections.length > 0) {
        const latestDetection = recentDetections[recentDetections.length - 1];
        const elementCount = latestDetection.metadata?.elementCount || 0;

        this.logger.debug(`Latest detection: ${elementCount} elements, age: ${now - (latestDetection.startTime || 0)}ms`);

        if (elementCount > 0) {
          this.logger.log(`📊 Surfacing internal Holo 1.5-7B detection: ${elementCount} elements`);

          // Create system activity message
          await this.messagesService.create({
            content: [
              {
                type: MessageContentType.Text,
                text: `🔍 **Holo 1.5-7B Pre-Detection**\n\nAutomatically detected ${elementCount} UI ${elementCount === 1 ? 'element' : 'elements'} for faster future interactions\n\n💡 _These elements are cached and ready to use. Call \`computer_detect_elements\` to access them, then \`computer_click_element\` to interact._`
              }
            ],
            role: Role.ASSISTANT,
            taskId,
          });
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to surface internal CV activity: ${error.message}`);
    }
  }

  private async canMarkCompleted(taskId: string): Promise<boolean> {
    try {
      const history = await this.messagesService.findEvery(taskId);
      let hasAction = false;
      let hasFreshVerification = false;
      let latestActionPosition: {
        messageIndex: number;
        blockIndex: number;
      } | null = null;

      const ACTION_NAMES = new Set<string>([
        'computer_click_mouse',
        'computer_click_element',
        'computer_type_text',
        'computer_paste_text',
        'computer_press_keys',
        'computer_drag_mouse',
        'computer_application',
        'computer_write_file',
        'computer_read_file',
      ]);

      history.forEach((msg, messageIndex) => {
        const blocks = (msg.content as MessageContentBlock[]) || [];
        blocks.forEach((block, blockIndex) => {
          if (block.type === MessageContentType.ToolUse) {
            const name = (block as any).name as string;
            if (ACTION_NAMES.has(name)) {
              hasAction = true;
              hasFreshVerification = false;
              latestActionPosition = { messageIndex, blockIndex };
            }
          }
          if (block.type === MessageContentType.ToolResult) {
            const tr = block as any;
            // Evidence: any document result or any image result
            const content = (tr.content || []) as any[];
            const hasVerificationContent = content.some((c) =>
              [MessageContentType.Document, MessageContentType.Image].includes(
                c.type as MessageContentType,
              ),
            );
            if (
              hasVerificationContent &&
              latestActionPosition &&
              (messageIndex > latestActionPosition.messageIndex ||
                (messageIndex === latestActionPosition.messageIndex &&
                  blockIndex > latestActionPosition.blockIndex))
            ) {
              hasFreshVerification = true;
            }
          }
        });
      });

      // Minimal requirement: at least one action and some verification artifact
      return hasAction && hasFreshVerification;
    } catch (e) {
      this.logger.warn(
        `canMarkCompleted: fallback to allow completion due to error: ${(e as Error).message}`,
      );
      return true;
    }
  }

  /**
   * Perform summarization of messages to reduce context window usage
   * Extracted as a reusable method for both proactive and reactive summarization
   */
  private async performSummarization(
    taskId: string,
    model: BytebotAgentModel,
    messages: Message[],
  ): Promise<void> {
    try {
      const service = this.services[model.provider];
      if (!service) {
        this.logger.warn(`Cannot summarize: service ${model.provider} not available`);
        return;
      }

      this.logger.debug(`Generating summary for ${messages.length} messages`);

      const summaryResponse = await service.generateMessage(
        SUMMARIZATION_SYSTEM_PROMPT,
        [
          ...messages,
          {
            id: '',
            createdAt: new Date(),
            updatedAt: new Date(),
            taskId,
            summaryId: null,
            role: Role.USER,
            content: [
              {
                type: MessageContentType.Text,
                text: 'Respond with a summary of the messages above. Do not include any additional information.',
              },
            ],
          } as Message,
        ],
        model.name,
        model,
        false,
        this.abortController?.signal,
      );

      const summaryContentBlocks = summaryResponse.contentBlocks;
      const summaryContent = summaryContentBlocks
        .filter(
          (block: MessageContentBlock) =>
            block.type === MessageContentType.Text,
        )
        .map((block: TextContentBlock) => block.text)
        .join('\n');

      const summary = await this.summariesService.create({
        content: summaryContent,
        taskId,
      });

      await this.messagesService.attachSummary(taskId, summary.id, [
        ...messages.map((message) => message.id),
      ]);

      this.logger.log(
        `Generated summary for task ${taskId} (${messages.length} messages → ${summaryContent.length} characters)`,
      );
    } catch (error: any) {
      this.logger.error(
        `Error summarizing messages for task ID: ${taskId}`,
        error.stack,
      );
    }
  }

  async stopProcessing(): Promise<void> {
    if (!this.isProcessing) {
      return;
    }

    this.logger.log(`Stopping execution of task ${this.currentTaskId}`);

    // Signal any in-flight async operations to abort
    this.abortController?.abort();

    await this.inputCaptureService.stop();

    // Stop progress tracking (Phase 1.3)
    if (this.currentTaskId) {
      this.stopProgressTracking(this.currentTaskId);
      this.taskLastAction.delete(this.currentTaskId);
    }

    this.isProcessing = false;
    this.currentTaskId = null;
    this.currentModel = null; // Clear model reference
    this.pendingScreenshotObservation = false;
    this.elementCache.clear();
  }

  /**
   * Graceful Shutdown: Called when NestJS application is shutting down
   * Handles SIGTERM, SIGINT, and other shutdown signals
   * Ensures tasks are properly saved before process exits
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.warn('AgentProcessor shutting down gracefully...');

    try {
      // If a task is currently being processed, mark it as PENDING for recovery
      if (this.currentTaskId && this.isProcessing) {
        this.logger.warn(
          `Graceful shutdown: Saving current task ${this.currentTaskId} as PENDING for recovery`,
        );

        // Stop processing and abort any in-flight operations
        await this.stopProcessing();

        // Mark task as PENDING so it can be recovered on next startup
        await this.tasksService.update(this.currentTaskId, {
          status: TaskStatus.PENDING,
          executedAt: null, // Clear execution timestamp for clean restart
        });

        this.logger.log(
          `Task ${this.currentTaskId} saved successfully for recovery`,
        );
      }

      // Release all locks held by this worker (for concurrency support)
      const releasedCount =
        await this.tasksService.releaseAllLocksForThisWorker();
      if (releasedCount > 0) {
        this.logger.log(
          `Released ${releasedCount} task lock(s) held by this worker`,
        );
      }

      // Save visual description cache (may contain learned patterns)
      this.saveVisualDescriptionCache();

      this.logger.log('Graceful shutdown complete');
    } catch (error) {
      this.logger.error(
        `Error during graceful shutdown: ${error.message}`,
        error.stack,
      );
    }
  }
}
