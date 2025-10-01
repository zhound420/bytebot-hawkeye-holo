import { Injectable, Logger } from '@nestjs/common';
import { UniversalUIElement } from '../types/element.types';

/**
 * OmniParser detection result from the Python service
 */
export interface OmniParserElement {
  bbox: [number, number, number, number]; // [x, y, width, height]
  center: [number, number]; // [x, y]
  confidence: number;
  type: string;
  caption?: string;
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
}

/**
 * Parse request options
 */
export interface OmniParserOptions {
  includeCaptions?: boolean;
  minConfidence?: number;
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

      // Create request body
      const requestBody = {
        image: base64Image,
        include_captions: options.includeCaptions ?? true,
        min_confidence: options.minConfidence ?? 0.3,
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
      this.logger.debug(
        `OmniParser detected ${result.count} elements in ${elapsed}ms (service: ${result.processing_time_ms}ms)`,
      );

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
      let elementType = 'unknown';
      let role = 'interactive';

      if (element.caption) {
        const caption = element.caption.toLowerCase();
        if (
          caption.includes('button') ||
          caption.includes('btn') ||
          caption.includes('click')
        ) {
          elementType = 'button';
          role = 'button';
        } else if (
          caption.includes('input') ||
          caption.includes('text field') ||
          caption.includes('textbox')
        ) {
          elementType = 'input';
          role = 'textbox';
        } else if (
          caption.includes('link') ||
          caption.includes('hyperlink')
        ) {
          elementType = 'link';
          role = 'link';
        } else if (
          caption.includes('icon') ||
          caption.includes('image')
        ) {
          elementType = 'icon';
          role = 'img';
        } else if (
          caption.includes('menu') ||
          caption.includes('dropdown')
        ) {
          elementType = 'menu';
          role = 'menu';
        }
      }

      return {
        id: `omniparser_${index}`,
        type: elementType,
        role,
        bounds: {
          x,
          y,
          width,
          height,
        },
        center: {
          x: centerX,
          y: centerY,
        },
        confidence: element.confidence,
        text: element.caption || '',
        label: element.caption || '',
        metadata: {
          source: 'omniparser',
          omniparser_type: element.type,
          omniparser_caption: element.caption,
        },
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
