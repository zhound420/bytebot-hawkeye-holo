import { Injectable, Logger } from '@nestjs/common';

// ============================================================================
// Official Holo 1.5 Navigation Types (from transformers implementation)
// ============================================================================

/**
 * Action types for NavigationStep
 */
export type ActionType =
  | 'click_element'
  | 'write_element_abs'
  | 'scroll'
  | 'go_back'
  | 'refresh'
  | 'goto'
  | 'wait'
  | 'restart'
  | 'answer';

/**
 * Base interface for all actions
 */
export interface BaseAction {
  action: ActionType;
}

/**
 * Click action - click at specific coordinates
 */
export interface ClickElementAction extends BaseAction {
  action: 'click_element';
  element: string; // Description of element
  x: number; // X coordinate (pixels from left)
  y: number; // Y coordinate (pixels from top)
}

/**
 * Write action - type text at specific coordinates
 */
export interface WriteElementAction extends BaseAction {
  action: 'write_element_abs';
  content: string; // Text to write
  element: string; // Description of element
  x: number;
  y: number;
}

/**
 * Scroll action
 */
export interface ScrollAction extends BaseAction {
  action: 'scroll';
  direction: 'up' | 'down' | 'left' | 'right';
}

/**
 * Go back action
 */
export interface GoBackAction extends BaseAction {
  action: 'go_back';
}

/**
 * Refresh action
 */
export interface RefreshAction extends BaseAction {
  action: 'refresh';
}

/**
 * Navigate to URL action
 */
export interface GotoAction extends BaseAction {
  action: 'goto';
  url: string;
}

/**
 * Wait action
 */
export interface WaitAction extends BaseAction {
  action: 'wait';
  seconds: number; // Duration to wait (0-10)
}

/**
 * Restart action
 */
export interface RestartAction extends BaseAction {
  action: 'restart';
}

/**
 * Answer action - return final answer
 */
export interface AnswerAction extends BaseAction {
  action: 'answer';
  content: string; // The answer
}

/**
 * Union of all possible actions
 */
export type Action =
  | ClickElementAction
  | WriteElementAction
  | ScrollAction
  | GoBackAction
  | RefreshAction
  | GotoAction
  | WaitAction
  | RestartAction
  | AnswerAction;

/**
 * Official Holo 1.5 NavigationStep format
 */
export interface NavigationStep {
  note: string; // Observation from screenshot
  thought: string; // Reasoning about next action
  action: Action; // Next action to take
}

/**
 * Navigation API request
 */
export interface NavigateRequest {
  image: string; // Base64 encoded screenshot
  task: string; // Task to complete
  step?: number; // Current step number (default: 1)
}

/**
 * Navigation API response
 */
export interface NavigateResponse {
  note: string;
  thought: string;
  action: Action;
  processing_time_ms: number;
  image_size: {
    width: number;
    height: number;
  };
  device: string;
}

// ============================================================================
// Legacy Types (for backward compatibility)
// ============================================================================

/**
 * Universal element types for cross-detection compatibility
 */
export type UniversalElementType = 'button' | 'text_input' | 'clickable' | 'menu_item';

/**
 * Universal UI element interface (used by Holo conversion methods)
 */
export interface UniversalUIElement {
  id: string;
  type: UniversalElementType;
  bounds: { x: number; y: number; width: number; height: number };
  clickPoint: { x: number; y: number };
  confidence: number;
  text?: string;
  semanticRole?: string;
  description: string;
}

/**
 * Holo 1.5-7B detection result from the Python service
 */
export interface HoloElement {
  bbox: [number, number, number, number]; // [x, y, width, height]
  center: [number, number]; // [x, y]
  confidence: number;
  type: string; // 'text' or 'icon'
  caption?: string;
  interactable?: boolean; // Whether element is clickable (from YOLO prediction)
  content?: string; // OCR text or caption content
  source?: string; // 'box_ocr_content_ocr' or 'box_yolo_content_yolo'
  element_id?: number; // Element index for SOM mapping
}

/**
 * Holo 1.5-7B API response
 */
export interface HoloResponse {
  elements: HoloElement[];
  count: number;
  processing_time_ms: number;
  image_size: {
    width: number;
    height: number;
  };
  device: string;
  profile?: string;
  max_detections?: number;
  min_confidence?: number;
  som_image?: string; // Base64 encoded Set-of-Mark annotated image
  ocr_detected?: number; // Number of OCR text elements detected
  icon_detected?: number; // Number of icon elements detected
  text_detected?: number; // Number of text elements in final result
  interactable_count?: number; // Number of interactable elements
  // Enhanced transparency fields (new)
  timing?: {
    resize_ms?: number;
    inference_ms?: number;
    parse_ms?: number;
    total_ms?: number;
  };
  raw_output?: string; // Raw model output (debug mode only)
  output_length?: number; // Length of raw output
  parse_status?: 'success' | 'error'; // Parse status
  parse_error?: string; // Parse error message if applicable
}

/**
 * Parse request options
 */
export interface HoloOptions {
  task?: string; // Specific task instruction for single-element mode (e.g., "Find the VSCode icon")
  detectMultiple?: boolean; // Detect multiple elements using various prompts (default: true)
  includeCaptions?: boolean;
  includeSom?: boolean;
  includeOcr?: boolean; // Deprecated - maintained for compatibility
  useFullPipeline?: boolean; // Deprecated - maintained for compatibility
  minConfidence?: number;
  iouThreshold?: number; // Deprecated - maintained for compatibility
  usePaddleOcr?: boolean; // Deprecated - maintained for compatibility
  maxDetections?: number; // Cap detections server-side to reduce latency
  returnRawOutputs?: boolean; // Request raw model transcripts for debugging
  performanceProfile?: 'speed' | 'balanced' | 'quality';
}

/**
 * Holo 1.5-7B model status
 */
export interface HoloModelStatus {
  icon_detector: {
    loaded: boolean;
    type: string; // "YOLOv8"
    path: string;
  };
  caption_model: {
    loaded: boolean;
    type: string; // "Florence-2"
    path: string;
  };
  weights_path: string;
}

export interface HoloGPUInfo {
  device_type: string; // "cuda", "mps", or "cpu"
  gpu_name: string | null;
  memory_total_mb: number | null;
  memory_used_mb: number | null;
  memory_free_mb: number | null;
  memory_utilization_percent: number | null;
}

export type ModelTier = 'tier1' | 'tier2' | 'tier3';

/**
 * Client service for Holo 1.5-7B REST API
 *
 * Integrates with the Python FastAPI service to provide UI element localization
 * using Holo 1.5-7B (Qwen2.5-VL base) for precision coordinate prediction.
 */
@Injectable()
export class HoloClientService {
  private readonly logger = new Logger('HoloClientService');
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly enabled: boolean;
  private isHealthy: boolean = false;
  private modelStatus: HoloModelStatus | null = null;
  private gpuInfo: HoloGPUInfo | null = null;
  private gpuPollInterval: NodeJS.Timeout | null = null;
  private isPollingGpu: boolean = false; // Debounce flag for GPU polling
  private detectionInProgress: boolean = false; // Pause polling during detection (Phase 2.3)

  constructor() {
    this.baseUrl = process.env.HOLO_URL || 'http://localhost:9989';
    this.timeout = parseInt(process.env.HOLO_TIMEOUT || '120000', 10);
    this.enabled = process.env.BYTEBOT_CV_USE_HOLO === 'true';

    if (this.enabled) {
      this.logger.log(`Holo 1.5-7B client initialized: ${this.baseUrl}`);
      // Check health on startup
      this.checkHealth().catch((err) => {
        this.logger.warn(`Holo 1.5-7B health check failed: ${err.message}`);
      });

      // Start real-time GPU polling (every 3 seconds)
      this.startGPUPolling();
    } else {
      this.logger.log('Holo 1.5-7B integration disabled');
    }
  }

  /**
   * Start periodic GPU info polling for real-time VRAM updates
   * Optimized (Phase 2.3):
   * - Increased interval from 3s to 5s
   * - Pauses during detection to reduce service load
   */
  private startGPUPolling(): void {
    // Poll every 5 seconds for real-time GPU metrics (increased from 3s - Phase 2.3)
    this.gpuPollInterval = setInterval(async () => {
      // Skip if detection in progress (Phase 2.3)
      if (this.detectionInProgress) {
        this.logger.debug('Skipping GPU poll - detection in progress');
        return;
      }

      // Debounce: Skip if previous poll still running
      if (this.isPollingGpu) {
        this.logger.debug('Skipping GPU poll - previous request still in progress');
        return;
      }

      if (this.isHealthy) {
        this.isPollingGpu = true;
        await this.fetchGPUInfo().catch((err) => {
          this.logger.debug(`GPU polling failed: ${err.message}`);
        }).finally(() => {
          this.isPollingGpu = false;
        });
      }
    }, 5000);

    this.logger.debug('GPU polling started (5s interval, pauses during detection)');
  }

  /**
   * Stop GPU polling (cleanup)
   */
  stopGPUPolling(): void {
    if (this.gpuPollInterval) {
      clearInterval(this.gpuPollInterval);
      this.gpuPollInterval = null;
      this.logger.debug('GPU polling stopped');
    }
  }

  /**
   * Select optimal Holo performance profile based on UI complexity
   *
   * Holo 1.5-7B profiles control detection thoroughness vs speed tradeoffs:
   * - 'speed': Fast detection (20 elements, 256 tokens, ~2-3s) - simple UIs
   * - 'balanced': Moderate coverage (40 elements, 512 tokens, ~4-6s) - default for most UIs
   * - 'quality': Maximum coverage (100 elements, 1024 tokens, ~10-16s) - complex UIs
   *
   * NOTE: Profile selection should be based on UI complexity, NOT on VLM reasoning capability.
   * Holo 1.5-7B detection quality is independent of which VLM consumes the results.
   *
   * @param uiComplexity - UI complexity hint ('simple'/'moderate'/'complex')
   * @returns Recommended performance profile
   */
  selectProfileForUI(
    uiComplexity: 'simple' | 'moderate' | 'complex' = 'moderate',
  ): 'speed' | 'balanced' | 'quality' {
    switch (uiComplexity) {
      case 'simple':
        return 'speed'; // Fast detection for simple UIs (e.g., login screens, dialogs)
      case 'complex':
        return 'quality'; // Thorough detection for dense UIs (e.g., IDEs, dashboards)
      case 'moderate':
      default:
        return 'balanced'; // Good default for most applications
    }
  }

  /**
   * Get max detections for a given profile
   *
   * @param profile - Performance profile
   * @returns Max detections limit
   */
  getMaxDetectionsForProfile(
    profile: 'speed' | 'balanced' | 'quality',
  ): number {
    // Standard profile limits from Holo configuration
    return profile === 'speed' ? 20 : profile === 'balanced' ? 40 : 100;
  }

  /**
   * Check if Holo 1.5-7B service is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    try {
      await this.checkHealth();
      return this.isHealthy;
    } catch {
      return false;
    }
  }

  /**
   * Check health of Holo 1.5-7B service
   */
  async checkHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        // Accept service as healthy even if models not loaded yet (lazy loading)
        // Models will load on first API request
        this.isHealthy = data.status === 'healthy';

        // Fetch model status and GPU info if healthy
        if (this.isHealthy) {
          if (!this.modelStatus) {
            this.fetchModelStatus().catch((err) => {
              this.logger.warn(`Failed to fetch model status: ${err.message}`);
            });
          }
          if (!this.gpuInfo) {
            this.fetchGPUInfo().catch((err) => {
              this.logger.warn(`Failed to fetch GPU info: ${err.message}`);
            });
          }
        }

        return this.isHealthy;
      }

      this.isHealthy = false;
      return false;
    } catch (error) {
      this.logger.debug(`Health check failed: ${error.message}`);
      this.isHealthy = false;
      return false;
    }
  }

  /**
   * Fetch model status from Holo 1.5-7B service
   */
  async fetchModelStatus(): Promise<HoloModelStatus | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/models/status`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        this.modelStatus = await response.json();
        return this.modelStatus;
      }

      return null;
    } catch (error) {
      this.logger.debug(`Model status fetch failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get cached model status
   */
  getModelStatus(): HoloModelStatus | null {
    return this.modelStatus;
  }

  /**
   * Fetch GPU information from Holo 1.5-7B service
   */
  async fetchGPUInfo(): Promise<HoloGPUInfo | null> {
    try {
      const controller = new AbortController();
      // Use shorter timeout for GPU info (should be fast)
      const gpuTimeout = 5000; // 5 seconds - GPU info should respond quickly
      const timeoutId = setTimeout(() => controller.abort(), gpuTimeout);

      const response = await fetch(`${this.baseUrl}/gpu-info`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        this.gpuInfo = await response.json();
        return this.gpuInfo;
      }

      return null;
    } catch (error) {
      this.logger.debug(`GPU info fetch failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get cached GPU information
   */
  getGPUInfo(): HoloGPUInfo | null {
    return this.gpuInfo;
  }

  /**
   * Localize a specific UI element using task-specific instruction (single-shot mode)
   * This is faster and more accurate than multi-element scanning when you know what you're looking for.
   *
   * @param imageBuffer - Screenshot image buffer
   * @param task - Specific task instruction (e.g., "Find the VSCode icon on the desktop")
   * @param includeSom - Generate Set-of-Mark annotated image (default: true)
   * @returns Detection result with 1 element (or 0 if not found)
   *
   * @example
   * const result = await holoClient.localizeElement(screenshot, "Find the Extensions icon in the activity bar");
   * if (result.count > 0) {
   *   const element = result.elements[0];
   *   console.log(`Found at: (${element.center[0]}, ${element.center[1]})`);
   * }
   */
  async localizeElement(
    imageBuffer: Buffer,
    task: string,
    includeSom: boolean = true,
  ): Promise<HoloResponse> {
    return this.parseScreenshot(imageBuffer, {
      task,
      detectMultiple: false, // Single-shot mode
      includeSom,
    });
  }

  /**
   * Parse screenshot with tier-aware optimizations (DEPRECATED)
   *
   * @deprecated Use parseScreenshot() with explicit performanceProfile instead.
   * Holo profile should be based on UI complexity, not VLM reasoning tier.
   *
   * Example migration:
   * ```typescript
   * // Old approach (coupled to VLM tier)
   * const result = await holoClient.parseScreenshotWithTier(buffer, 'tier1');
   *
   * // New approach (based on UI complexity)
   * const result = await holoClient.parseScreenshot(buffer, {
   *   performanceProfile: 'balanced' // or 'speed'/'quality' based on UI
   * });
   * ```
   *
   * @param imageBuffer - Screenshot image buffer
   * @param tier - Model tier (ignored, use performanceProfile in options instead)
   * @param options - Parsing options
   * @returns Detected UI elements
   */
  async parseScreenshotWithTier(
    imageBuffer: Buffer,
    tier: ModelTier,
    options: HoloOptions = {},
  ): Promise<HoloResponse> {
    this.logger.warn(
      'parseScreenshotWithTier() is deprecated. Use parseScreenshot() with explicit performanceProfile.',
    );

    // Default to balanced profile if not specified
    if (!options.performanceProfile) {
      options.performanceProfile = 'balanced';
    }

    // Default to standard max detections if not specified
    if (!options.maxDetections) {
      options.maxDetections = this.getMaxDetectionsForProfile(
        options.performanceProfile,
      );
    }

    return this.parseScreenshot(imageBuffer, options);
  }

  /**
   * Parse screenshot using Holo 1.5-7B (multi-element or single-element mode)
   *
   * @param imageBuffer - Screenshot image buffer
   * @param options - Parsing options
   * @returns Detected UI elements with localized coordinates
   */
  async parseScreenshot(
    imageBuffer: Buffer,
    options: HoloOptions = {},
  ): Promise<HoloResponse> {
    if (!this.enabled) {
      throw new Error('Holo 1.5-7B is disabled');
    }

    const startTime = Date.now();

    // Pause GPU polling during detection (Phase 2.3)
    this.detectionInProgress = true;

    try {
      // Convert buffer to base64
      const base64Image = imageBuffer.toString('base64');

      // Create request body for Holo 1.5-7B API
      const requestBody = {
        image: base64Image,
        task: options.task ?? null, // Task-specific instruction for single-element mode
        detect_multiple: options.detectMultiple ?? true, // Multi-element scan mode
        include_som: options.includeSom ?? true, // Set-of-Mark annotations
        min_confidence: options.minConfidence ?? 0.3, // Higher confidence for quality results
        max_detections: options.maxDetections ?? undefined, // Server-side detection cap
        return_raw_outputs: options.returnRawOutputs ?? false, // Include raw model outputs
        performance_profile: options.performanceProfile ?? 'balanced', // Balanced profile for production use
      };

      // Send request to Holo 1.5-7B service
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/parse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Holo 1.5-7B request failed: ${response.status} ${errorText}`,
        );
      }

      const result: HoloResponse = await response.json();

      const elapsed = Date.now() - startTime;

      // Log detection stats
      this.logger.debug(
        `Holo 1.5-7B localized ${result.count} elements in ${elapsed}ms (service: ${result.processing_time_ms}ms)`,
      );

      return result;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.logger.error(
        `Holo 1.5-7B error after ${elapsed}ms: ${error.message}`,
      );
      throw error;
    } finally {
      // Resume GPU polling after detection completes (Phase 2.3)
      this.detectionInProgress = false;
    }
  }

  /**
   * Navigate using official Holo 1.5 transformers implementation
   *
   * This is the new navigation endpoint that returns note, thought, and action
   * using the official format from the HuggingFace demo.
   *
   * @param imageBuffer - Screenshot as Buffer
   * @param task - Task to complete (e.g., "Find the search bar")
   * @param step - Current step number (default: 1)
   * @returns NavigateResponse with note, thought, and action
   */
  async navigate(
    imageBuffer: Buffer,
    task: string,
    step: number = 1,
  ): Promise<NavigateResponse> {
    if (!this.enabled) {
      throw new Error('Holo 1.5-7B is disabled');
    }

    const startTime = Date.now();

    // Pause GPU polling during detection
    this.detectionInProgress = true;

    try {
      // Convert buffer to base64
      const base64Image = imageBuffer.toString('base64');

      // Create request body for navigation API
      const requestBody: NavigateRequest = {
        image: base64Image,
        task,
        step,
      };

      // Send request to Holo 1.5-7B navigation endpoint
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/navigate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Holo 1.5-7B navigation failed: ${response.status} ${errorText}`,
        );
      }

      const result: NavigateResponse = await response.json();

      const elapsed = Date.now() - startTime;

      // Log navigation result
      this.logger.log(
        `Holo 1.5-7B navigation: action="${result.action.action}" ` +
        `(thought: "${result.thought.substring(0, 50)}...") ` +
        `in ${elapsed}ms (service: ${result.processing_time_ms}ms)`,
      );

      return result;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.logger.error(
        `Holo 1.5-7B navigation error after ${elapsed}ms: ${error.message}`,
      );
      throw error;
    } finally {
      // Resume GPU polling
      this.detectionInProgress = false;
    }
  }

  /**
   * Convert Holo 1.5 elements to UniversalUIElement format
   *
   * @param elements - Holo 1.5 localized elements
   * @returns Universal UI elements
   */
  convertToUniversalElements(
    elements: HoloElement[],
  ): UniversalUIElement[] {
    return elements.map((element, index) => {
      const [x, y, width, height] = element.bbox;
      const [centerX, centerY] = element.center;

      // Infer element type from caption/task if available
      let elementType: 'button' | 'text_input' | 'clickable' | 'menu_item' = 'clickable';
      let semanticRole = 'interactive';

      if (element.caption) {
        const caption = element.caption.toLowerCase();
        if (
          caption.includes('button') ||
          caption.includes('btn') ||
          caption.includes('click')
        ) {
          elementType = 'button';
          semanticRole = 'button';
        } else if (
          caption.includes('input') ||
          caption.includes('text field') ||
          caption.includes('textbox')
        ) {
          elementType = 'text_input';
          semanticRole = 'textbox';
        } else if (
          caption.includes('menu') ||
          caption.includes('dropdown')
        ) {
          elementType = 'menu_item';
          semanticRole = 'menu';
        }
      }

      // Create description from caption or element type
      const description = element.caption
        ? `${elementType}: ${element.caption}`
        : `${elementType} element localized by Holo 1.5-7B`;

      return {
        id: `holo_${index}`,
        type: elementType,
        bounds: {
          x,
          y,
          width,
          height,
        },
        clickPoint: {
          x: centerX,
          y: centerY,
        },
        confidence: element.confidence,
        text: element.caption || undefined,
        semanticRole,
        description,
      };
    });
  }

  /**
   * Get Holo 1.5-7B service status
   */
  async getStatus(): Promise<{
    enabled: boolean;
    healthy: boolean;
    url: string;
  }> {
    return {
      enabled: this.enabled,
      healthy: this.isHealthy,
      url: this.baseUrl,
    };
  }
}
