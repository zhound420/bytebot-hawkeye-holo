import { TasksService } from '../tasks/tasks.service';
import { MessagesService } from '../messages/messages.service';
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { expandFunctionalQuery, scoreSemanticMatch } from './semantic-mapping';
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
import {
  isComputerToolUseContentBlock,
  isSetTaskStatusToolUseBlock,
  isCreateTaskToolUseBlock,
  isScreenshotToolUseBlock,
  isScreenshotRegionToolUseBlock,
  isScreenshotCustomRegionToolUseBlock,
  isComputerDetectElementsToolUseBlock,
  isComputerClickElementToolUseBlock,
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
  ElementDetectorService,
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
  buildAgentSystemPrompt,
  SCREENSHOT_OBSERVATION_GUARD_MESSAGE,
  SUMMARIZATION_SYSTEM_PROMPT,
} from './agent.constants';
import { SummariesService } from '../summaries/summaries.service';
import { handleComputerToolUse } from './agent.computer-use';
import { ProxyService } from '../proxy/proxy.service';

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

@Injectable()
export class AgentProcessor {
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
  private readonly SCREENSHOT_CACHE_TTL_MS = 2000; // 2 seconds - screens change fast

  // Store last enhanced detection result for telemetry
  private lastEnhancedResult: any = null;

  // SOM (Set-of-Mark) state: maps screenshot hash to SOM data
  private readonly somCache = new Map<string, {
    somImage: string; // Base64 encoded SOM-annotated image
    elementMapping: Map<number, string>; // element_number -> element_id
    elementDescriptions: Map<number, string>; // element_number -> description (for semantic matching)
    timestamp: number;
  }>();
  private readonly SOM_CACHE_TTL_MS = 30000; // 30 seconds - persist across multiple interactions

  constructor(
    private readonly tasksService: TasksService,
    private readonly messagesService: MessagesService,
    private readonly summariesService: SummariesService,
    private readonly anthropicService: AnthropicService,
    private readonly openaiService: OpenAIService,
    private readonly googleService: GoogleService,
    private readonly proxyService: ProxyService,
    private readonly inputCaptureService: InputCaptureService,
    private readonly elementDetector: ElementDetectorService,
    private readonly enhancedVisualDetector: EnhancedVisualDetectorService,
    private readonly cvActivityService: CVActivityIndicatorService,
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
   */
  private getScreenshotCacheEntry(screenshotBuffer: Buffer): DetectedElement[] | null {
    const hash = this.computeScreenshotHash(screenshotBuffer);
    const cached = this.screenshotCache.get(hash);

    if (cached && Date.now() - cached.timestamp < this.SCREENSHOT_CACHE_TTL_MS) {
      this.logger.debug(`Screenshot cache hit (${cached.elements.length} elements, age: ${Date.now() - cached.timestamp}ms)`);
      return cached.elements;
    }

    // Clean up expired entries
    if (cached && Date.now() - cached.timestamp >= this.SCREENSHOT_CACHE_TTL_MS) {
      this.screenshotCache.delete(hash);
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
        this.isProcessing = false;
        this.currentTaskId = null;

        // Clean up stuck detection state
        this.taskIterationCount.delete(taskId);
        this.taskLastActionTime.delete(taskId);

        return;
      }

      this.logger.log(`Processing iteration for task ID: ${taskId}`);

      // Refresh abort controller for this iteration to avoid accumulating
      // "abort" listeners on a single AbortSignal across iterations.
      this.abortController = new AbortController();

      const latestSummary = await this.summariesService.findLatest(taskId);
      const unsummarizedMessages =
        await this.messagesService.findUnsummarized(taskId);
      const messages = [
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
              },
            ]
          : []),
        ...unsummarizedMessages,
      ];

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

      const model = task.model as unknown as BytebotAgentModel;
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

      agentResponse = await service.generateMessage(
        buildAgentSystemPrompt(currentDate, currentTime, timeZone),
        messages,
        model.name,
        true,
        this.abortController.signal,
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

      // Calculate if we need to summarize based on token usage
      const contextWindow = model.contextWindow || 200000; // Default to 200k if not specified
      const contextThreshold = contextWindow * 0.75;
      const shouldSummarize =
        agentResponse.tokenUsage.totalTokens >= contextThreshold;

      if (shouldSummarize) {
        try {
          // After we've successfully generated a response, we can summarize the unsummarized messages
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
              },
            ],
            model.name,
            false,
            this.abortController.signal,
          );

          const summaryContentBlocks = summaryResponse.contentBlocks;

          this.logger.debug(
            `Received ${summaryContentBlocks.length} summary content blocks from LLM`,
          );
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
            ...messages.map((message) => {
              return message.id;
            }),
          ]);

          this.logger.log(
            `Generated summary for task ${taskId} due to token usage (${agentResponse.tokenUsage.totalTokens}/${contextWindow})`,
          );
        } catch (error: any) {
          this.logger.error(
            `Error summarizing messages for task ID: ${taskId}`,
            error.stack,
          );
        }
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

          const result = await handleComputerToolUse(block, this.logger);

          // Inject SOM (Set-of-Mark) annotated image if available
          const somResult = await this.injectSomImageIfAvailable(result, block);
          generatedToolResults.push(somResult);

          if (
            isScreenshotToolUseBlock(block) ||
            isScreenshotRegionToolUseBlock(block) ||
            isScreenshotCustomRegionToolUseBlock(block)
          ) {
            this.pendingScreenshotObservation = true;
            mustClearObservationThisReply = true;
            observationBlockedInReply = false;

            // Automatically enrich screenshots with OmniParser detection in the background
            // This runs async and doesn't block the iteration
            this.enrichScreenshotWithOmniParser().catch(err => {
              this.logger.warn(`Background OmniParser enrichment failed: ${err.message}`);
            });
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
          await this.tasksService.update(taskId, {
            status: TaskStatus.NEEDS_HELP,
          });
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
        this.isProcessing = false;
        this.currentTaskId = null;

        // Clean up stuck detection state
        this.taskIterationCount.delete(taskId);
        this.taskLastActionTime.delete(taskId);
      }
    }
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
          return `${i + 1}. [${el.id}] "${desc}" (${matchStr}, conf: ${el.confidence.toFixed(2)}) at ${location}`;
        }).join('\n');

        if (hasSemanticScores) {
          text += `\n\nTop ${detection.topCandidates.length} closest matches:\n${topMatches}\n\n**RECOMMENDED ACTIONS:**\n1. Pick closest match: computer_click_element({ element_id: "${detection.topCandidates[0].element.id}" })\n2. Try broader query: computer_detect_elements({ description: "button" })\n3. See all: computer_detect_elements({ description: "", includeAll: true })`;
        } else {
          text += `\n\nYour query didn't match any element descriptions. Here are the ${detection.topCandidates.length} detected elements (sorted by confidence):\n${topMatches}\n\n**RECOMMENDED ACTIONS:**\n1. Use computer_detect_elements({ description: "", includeAll: true }) to see full list with descriptions\n2. Look at these element descriptions and pick one by ID\n3. Try a different query based on what you see`;
        }
      } else if (detection.totalDetected > 0) {
        text += `\n\n**RECOMMENDED ACTION:** Use computer_detect_elements({ description: "", includeAll: true }) to see all ${detection.totalDetected} elements with descriptions`;
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
      const screenshotBuffer = await this.captureScreenshotBuffer();

      // Check screenshot cache first (2s TTL)
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
            // We have cached SOM data - try semantic matching
            let bestMatch: { elementId: string; score: number; description: string } | null = null;

            for (const [elementNumber, elementId] of somData.elementMapping) {
              const description = somData.elementDescriptions.get(elementNumber);
              if (description) {
                const score = scoreSemanticMatch(params.description, description);
                if (!bestMatch || score > bestMatch.score) {
                  bestMatch = { elementId, score, description };
                }
              }
            }

            // If we found a good match (>60%), use cached elements
            if (bestMatch && bestMatch.score > 0.6) {
              // Get from screenshot cache (should exist since SOM is cached)
              const maybeElements = this.getScreenshotCacheEntry(screenshotBuffer);
              if (maybeElements) {
                elements = maybeElements;
                this.logger.log(
                  `🎯 Semantic cache hit: "${params.description}" matched "${bestMatch.description}" (${Math.round(bestMatch.score * 100)}% similarity)`
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
            // Use task-specific detection when searching for a specific element
            holoTask: params.description && !params.includeAll ? params.description : undefined,
            // Let enhanced-visual-detector handle method selection automatically
            // OmniParser defaults to enabled when service is available
            confidenceThreshold: 0.5,
            maxResults: 20,
            ocrRegion: searchRegion,
          }
        );

        elements = enhancedResult.elements;

        // Store enhanced result for telemetry
        this.lastEnhancedResult = enhancedResult;

        // Store SOM data if available
        if (enhancedResult.somImage && enhancedResult.elementMapping) {
          const screenshotHash = this.computeScreenshotHash(screenshotBuffer);

          // Build element descriptions map for semantic matching
          const elementDescriptions = new Map<number, string>();
          for (const [elementNumber, elementId] of enhancedResult.elementMapping) {
            // Find the element by ID
            const element = elements.find(el => el.id === elementId);
            if (element) {
              // Use text, description, or type as description
              const description = element.text || element.description || `${element.type} element`;
              elementDescriptions.set(elementNumber, description);
            }
          }

          this.somCache.set(screenshotHash, {
            somImage: enhancedResult.somImage,
            elementMapping: enhancedResult.elementMapping,
            elementDescriptions,
            timestamp: Date.now(),
          });
          this.logger.debug(`📍 Stored SOM data for screenshot (${enhancedResult.elementMapping.size} elements with descriptions)`);
        }

        // Cache the results for future requests
        this.setScreenshotCacheEntry(screenshotBuffer, elements);
        } // Close if (!elements) block from semantic matching
      }
      this.cacheDetectedElements(elements);

      if (params.includeAll) {
        // Record detection for telemetry (includeAll mode)
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

        return {
          elements,
          count: elements.length,
          totalDetected: elements.length,
          includeAll: true,
          description: params.description,
        };
      }

      let matchingElement =
        await this.elementDetector.findElementByDescription(
          elements,
          params.description,
        );

      // Track top candidates for helpful feedback when no match found
      const topCandidates: Array<{ element: any; score: number }> = [];

      // If no match found, try semantic matching with visual synonym expansion
      if (!matchingElement && elements.length > 0) {
        this.logger.debug(
          `No exact match for "${params.description}", trying semantic matching with visual synonym expansion`
        );

        // Expand functional query to include visual synonyms
        // Example: "extensions icon" → ["extensions", "icon", "puzzle", "piece", "addons", "plugins"]
        const expandedKeywords = expandFunctionalQuery(
          params.description,
          this.currentApplicationContext
        );

        this.logger.debug(
          `Expanded query keywords: ${expandedKeywords.join(', ')}`
        );

        // Find element with highest semantic match score and track top candidates
        let bestMatch: any = null;
        let bestScore = 0;

        for (const element of elements) {
          const elementText =
            element.metadata?.semantic_caption ||
            element.text ||
            element.description ||
            '';

          // Use semantic scoring that considers visual↔functional mappings
          const score = scoreSemanticMatch(
            elementText,
            params.description,
            this.currentApplicationContext
          );

          // Track all candidates with non-zero scores
          if (score > 0) {
            topCandidates.push({ element, score });
          }

          if (score > bestScore && score >= 0.25) {
            // Lowered threshold to 25% for better recall
            bestMatch = element;
            bestScore = score;
          }
        }

        // Sort top candidates by score
        topCandidates.sort((a, b) => b.score - a.score);

        if (bestMatch) {
          this.logger.debug(
            `Found semantic match with ${Math.round(bestScore * 100)}% confidence: "${bestMatch.metadata?.semantic_caption || bestMatch.text}"`
          );
          matchingElement = bestMatch;
        }
      }

      // If still no match found, ask primary model for visual description
      // This is the final fallback before returning empty result
      if (!matchingElement && params.description && elements.length > 0) {
        this.logger.debug(
          `No match found after all CV methods, asking primary model for visual description`
        );

        try {
          const enrichedKeywords = await this.getVisualDescriptionFromLLM(
            params.description,
            this.currentApplicationContext
          );

          if (enrichedKeywords.length > 0) {
            this.logger.debug(
              `Retrying element matching with enriched keywords: ${enrichedKeywords.join(', ')}`
            );

            // Try matching again with enriched keywords
            for (const element of elements) {
              const elementText = (
                element.metadata?.semantic_caption ||
                element.text ||
                element.description ||
                ''
              ).toLowerCase();

              // Check if any enriched keyword matches
              const matchCount = enrichedKeywords.filter(kw =>
                elementText.includes(kw.toLowerCase())
              ).length;

              if (matchCount > 0) {
                const score = matchCount / enrichedKeywords.length;
                this.logger.debug(
                  `Found match using LLM-enriched keywords with ${Math.round(score * 100)}% overlap: "${element.metadata?.semantic_caption || element.text}"`
                );
                matchingElement = element;

                // Track that this element was found using cached keywords for feedback loop
                this.elementCacheUsage.set(element.id, {
                  elementDescription: params.description,
                  applicationName: this.currentApplicationContext,
                  usedCachedKeywords: true
                });

                // Record this as training data for caption fine-tuning
                // The LLM provided better keywords than the visual caption alone
                const visualCaption = element.metadata?.semantic_caption || element.text || '';
                const cachedEntry = this.visualDescriptionCache.cache[this.currentApplicationContext]?.[params.description];

                if (visualCaption && cachedEntry) {
                  this.captionTrainingCollector.recordLLMCorrection(
                    visualCaption,
                    params.description,
                    cachedEntry.description,
                    enrichedKeywords,
                    {
                      application: this.currentApplicationContext,
                      coordinates: {
                        x: element.coordinates.x,
                        y: element.coordinates.y,
                        width: element.coordinates.width,
                        height: element.coordinates.height
                      }
                    }
                  );

                  this.logger.debug(
                    `📊 Recorded training data: visual="${visualCaption}" → functional="${params.description}"`
                  );
                }

                break;
              }
            }
          }
        } catch (error) {
          this.logger.warn(`Visual description fallback failed: ${error.message}`);
          // Continue without LLM assistance
        }
      }

      const matchingElements = matchingElement ? [matchingElement] : [];

      // If no match and topCandidates is empty (all scores = 0), show top elements by confidence
      let finalTopCandidates = topCandidates.slice(0, 10);
      if (matchingElements.length === 0 && finalTopCandidates.length === 0 && elements.length > 0) {
        this.logger.debug(
          `Semantic matching returned no scores, showing top ${Math.min(10, elements.length)} elements by confidence`
        );
        // Sort by confidence and show top 10 as candidates with score 0
        finalTopCandidates = elements
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 10)
          .map(el => ({ element: el, score: 0 }));
      }

      // Record detection for telemetry
      // Extract primary method from: elements metadata, or enhancedResult.methodsUsed
      let primaryMethod = elements[0]?.metadata?.detectionMethod || 'unknown';
      if (primaryMethod === 'unknown' && this.lastEnhancedResult?.methodsUsed?.[0]) {
        primaryMethod = this.lastEnhancedResult.methodsUsed[0];
      }

      const detectionEntry: DetectionHistoryEntry = {
        timestamp: new Date(),
        description: params.description || '',
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

      return {
        elements: matchingElements,
        count: matchingElements.length,
        totalDetected: elements.length,
        includeAll: false,
        description: params.description,
        topCandidates: matchingElements.length === 0 ? finalTopCandidates : undefined,
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

      const element = this.getElementFromCache(elementId);

      if (!element) {
        if (params.fallback_coordinates) {
          const fallbackResult = await this.handleComputerClickMouse({
            x: params.fallback_coordinates.x,
            y: params.fallback_coordinates.y,
            button: 'left',
            clickCount: 1,
          });

          if (fallbackResult.success) {
            // Record fallback click (element not cached)
            const fallbackClickEntry: ClickHistoryEntry = {
              timestamp: new Date(),
              elementId,
              coordinates: params.fallback_coordinates,
              success: true,
              detectionMethod: 'fallback_coordinates',
            };
            this.cvActivityService.recordClick(fallbackClickEntry);

            return {
              success: true,
              element_id: elementId,
              coordinates_used: params.fallback_coordinates,
              detection_method: 'fallback_coordinates',
            };
          }

          // Record failed fallback click
          const failedFallbackEntry: ClickHistoryEntry = {
            timestamp: new Date(),
            elementId,
            coordinates: params.fallback_coordinates,
            success: false,
            detectionMethod: 'fallback_coordinates',
          };
          this.cvActivityService.recordClick(failedFallbackEntry);

          return {
            success: false,
            element_id: elementId,
            error: `Element with ID ${elementId} not found; fallback coordinates failed`,
            coordinates_used: params.fallback_coordinates,
            detection_method: 'fallback_coordinates',
          };
        }

        throw new Error(
          `Element with ID ${elementId} not found. Run computer_detect_elements first.`,
        );
      }

      const clickTarget: ClickTarget =
        await this.elementDetector.getClickCoordinates(element);

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

      if (params.fallback_coordinates) {
        const fallbackResult = await this.handleComputerClickMouse({
          x: params.fallback_coordinates.x,
          y: params.fallback_coordinates.y,
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
            coordinates: params.fallback_coordinates,
            success: true,
            detectionMethod: `${element.metadata.detectionMethod}_fallback`,
          };
          this.cvActivityService.recordClick(fallbackClickEntry);

          return {
            success: true,
            element_id: elementId,
            coordinates_used: params.fallback_coordinates,
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
        error: `Failed to click element ${elementId}`,
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
        error: message,
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
   */
  private async enrichScreenshotWithOmniParser(): Promise<void> {
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
          maxResults: 100,  // Higher limit for background enrichment to improve cache coverage
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
                text: `🔍 **Internal Holo 1.5-7B Activity**\n\nDetected ${elementCount} UI elements during internal processing\n\n_This detection was performed automatically for caching/optimization and did not use \`computer_detect_elements\`. To interact with these elements, use \`computer_detect_elements\` followed by \`computer_click_element\`._`
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

  async stopProcessing(): Promise<void> {
    if (!this.isProcessing) {
      return;
    }

    this.logger.log(`Stopping execution of task ${this.currentTaskId}`);

    // Signal any in-flight async operations to abort
    this.abortController?.abort();

    await this.inputCaptureService.stop();

    this.isProcessing = false;
    this.currentTaskId = null;
    this.pendingScreenshotObservation = false;
    this.elementCache.clear();
  }
}
