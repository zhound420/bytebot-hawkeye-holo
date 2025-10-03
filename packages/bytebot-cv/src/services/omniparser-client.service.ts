import { Injectable, Logger } from '@nestjs/common';
import { UniversalUIElement } from '../interfaces/universal-element.interface';

/**
 * OmniParser detection result from the Python service
 */
export interface OmniParserElement {
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
 * OmniParser API response
 */
export interface OmniParserResponse {
  elements: OmniParserElement[];
  count: number;
  processing_time_ms: number;
  image_size: {
    width: number;
    height: number;
  };
  device: string;
  som_image?: string; // Base64 encoded Set-of-Mark annotated image
  ocr_detected?: number; // Number of OCR text elements detected
  icon_detected?: number; // Number of icon elements detected
  text_detected?: number; // Number of text elements in final result
  interactable_count?: number; // Number of interactable elements
}

/**
 * Parse request options
 */
export interface OmniParserOptions {
  includeCaptions?: boolean;
  includeSom?: boolean;
  includeOcr?: boolean; // Run OCR text detection (default: true)
  useFullPipeline?: boolean; // Use full OmniParser pipeline (default: true)
  minConfidence?: number;
  iouThreshold?: number; // IoU threshold for overlap removal (default: 0.7)
  usePaddleOcr?: boolean; // Use PaddleOCR vs EasyOCR (default: true)
}

/**
 * OmniParser model status
 */
export interface OmniParserModelStatus {
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
 * Client service for OmniParser REST API
 *
 * Integrates with the Python FastAPI service to provide semantic UI element detection
 * using YOLOv8 icon detection and Florence-2 captioning.
 */
@Injectable()
export class OmniParserClientService {
  private readonly logger = new Logger(OmniParserClientService.name);
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly enabled: boolean;
  private isHealthy: boolean = false;
  private modelStatus: OmniParserModelStatus | null = null;

  constructor() {
    this.baseUrl = process.env.OMNIPARSER_URL || 'http://localhost:9989';
    this.timeout = parseInt(process.env.OMNIPARSER_TIMEOUT || '30000', 10);
    this.enabled = process.env.BYTEBOT_CV_USE_OMNIPARSER === 'true';

    if (this.enabled) {
      this.logger.log(`OmniParser client initialized: ${this.baseUrl}`);
      // Check health on startup
      this.checkHealth().catch((err) => {
        this.logger.warn(`OmniParser health check failed: ${err.message}`);
      });
    } else {
      this.logger.log('OmniParser integration disabled');
    }
  }

  /**
   * Check if OmniParser service is available
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
   * Check health of OmniParser service
   */
  async checkHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

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
   * Fetch model status from OmniParser service
   */
  async fetchModelStatus(): Promise<OmniParserModelStatus | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

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
  getModelStatus(): OmniParserModelStatus | null {
    return this.modelStatus;
  }

  /**
   * Parse screenshot using OmniParser
   *
   * @param imageBuffer - Screenshot image buffer
   * @param options - Parsing options
   * @returns Detected UI elements with semantic information
   */
  async parseScreenshot(
    imageBuffer: Buffer,
    options: OmniParserOptions = {},
  ): Promise<OmniParserResponse> {
    if (!this.enabled) {
      throw new Error('OmniParser is disabled');
    }

    const startTime = Date.now();

    try {
      // Convert buffer to base64
      const base64Image = imageBuffer.toString('base64');

      // Create request body (using official OmniParser demo defaults)
      const requestBody = {
        image: base64Image,
        include_captions: options.includeCaptions ?? true,
        include_som: options.includeSom ?? true,
        include_ocr: options.includeOcr ?? true,
        use_full_pipeline: options.useFullPipeline ?? true,
        min_confidence: options.minConfidence ?? 0.05, // Official demo default (was 0.3)
        iou_threshold: options.iouThreshold ?? 0.1, // Official demo default (was 0.7)
        use_paddleocr: options.usePaddleOcr ?? true,
      };

      // Send request to OmniParser service
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
          `OmniParser request failed: ${response.status} ${errorText}`,
        );
      }

      const result: OmniParserResponse = await response.json();

      const elapsed = Date.now() - startTime;

      // Log detailed stats if full pipeline was used
      if (options.useFullPipeline !== false && result.ocr_detected !== undefined) {
        this.logger.debug(
          `OmniParser detected ${result.count} elements (${result.icon_detected} icons, ${result.text_detected} text, ${result.interactable_count} interactable) in ${elapsed}ms (service: ${result.processing_time_ms}ms)`,
        );
      } else {
        this.logger.debug(
          `OmniParser detected ${result.count} elements in ${elapsed}ms (service: ${result.processing_time_ms}ms)`,
        );
      }

      return result;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.logger.error(
        `OmniParser error after ${elapsed}ms: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Convert OmniParser elements to UniversalUIElement format
   *
   * @param elements - OmniParser elements
   * @returns Universal UI elements
   */
  convertToUniversalElements(
    elements: OmniParserElement[],
  ): UniversalUIElement[] {
    return elements.map((element, index) => {
      const [x, y, width, height] = element.bbox;
      const [centerX, centerY] = element.center;

      // Infer element type from caption if available
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
        : `${elementType} element detected by OmniParser`;

      return {
        id: `omniparser_${index}`,
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
   * Get OmniParser service status
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
