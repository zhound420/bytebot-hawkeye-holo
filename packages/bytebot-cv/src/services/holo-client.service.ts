import { Injectable, Logger } from '@nestjs/common';
import { UniversalUIElement } from '../interfaces/universal-element.interface';

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
    } else {
      this.logger.log('Holo 1.5-7B integration disabled');
    }
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
        this.isHealthy = data.status === 'healthy' && data.models_loaded;

        // Fetch model status if healthy
        if (this.isHealthy && !this.modelStatus) {
          this.fetchModelStatus().catch((err) => {
            this.logger.warn(`Failed to fetch model status: ${err.message}`);
          });
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
