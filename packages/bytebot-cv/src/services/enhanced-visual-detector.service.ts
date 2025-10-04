import { Injectable, Logger, Optional } from '@nestjs/common';
import { OCRDetector } from '../detectors/ocr/ocr-detector';
import { CVActivityIndicatorService } from './cv-activity-indicator.service';
import { OmniParserClientService } from './omniparser-client.service';
import { DetectedElement, BoundingBox } from '../types';

export interface EnhancedDetectionOptions {
  useOCR?: boolean;
  useOmniParser?: boolean;

  // OCR options
  ocrRegion?: BoundingBox;

  // OmniParser options
  omniParserCaptions?: boolean;
  omniParserConfidence?: number;

  // General options
  confidenceThreshold?: number;
  maxResults?: number;
  combineResults?: boolean;
}

export interface EnhancedDetectionResult {
  elements: DetectedElement[];
  methodsUsed: string[];
  performance: {
    totalTime: number;
    ocrTime?: number;
    omniParserTime?: number;
  };
  confidence: number;
}

@Injectable()
export class EnhancedVisualDetectorService {
  private readonly logger = new Logger(EnhancedVisualDetectorService.name);
  private readonly ocrDetector: OCRDetector;

  constructor(
    private readonly cvActivity: CVActivityIndicatorService,
    @Optional() private readonly omniParserClient?: OmniParserClientService,
  ) {
    this.ocrDetector = new OCRDetector();
    this.logger.log('Enhanced Visual Detector Service initialized (OmniParser + OCR only)');

    if (this.omniParserClient) {
      this.omniParserClient.isAvailable().then((available) => {
        if (available) {
          this.logger.log('✓ OmniParser integration enabled');
        } else {
          this.logger.warn('OmniParser client registered but service unavailable');
        }
      });
    }
  }

  /**
   * UI element detection using OmniParser (semantic) and OCR (text)
   */
  async detectElements(
    screenshotBuffer: Buffer,
    _template: any,
    options: EnhancedDetectionOptions = {}
  ): Promise<EnhancedDetectionResult> {
    if (!screenshotBuffer) {
      this.logger.warn('Enhanced detection unavailable: missing screenshot buffer');
      return this.createEmptyResult();
    }

    const startTime = Date.now();
    const methodsUsed: string[] = [];
    const allElements: DetectedElement[] = [];
    const performance: any = {};

    // Default OmniParser to enabled when service is available
    const omniParserAvailable = await this.omniParserClient?.isAvailable() ?? false;

    const {
      useOCR = false, // OCR is expensive, use as fallback only
      useOmniParser = omniParserAvailable, // Default to enabled when service is healthy
      confidenceThreshold = 0.6,
      maxResults = 20,
      combineResults = true
    } = options;

    try {
      // Run OmniParser and OCR in parallel since both are I/O-bound
      const [omniParserResults, ocrResults] = await Promise.all([
        useOmniParser && this.omniParserClient
          ? (async () => {
              const omniParserStart = Date.now();
              const results = await this.runOmniParserDetection(screenshotBuffer, options);
              performance.omniParserTime = Date.now() - omniParserStart;
              return results;
            })()
          : Promise.resolve([]),
        useOCR
          ? (async () => {
              const ocrStart = Date.now();
              const results = await this.runOCRDetection(screenshotBuffer, options);
              performance.ocrTime = Date.now() - ocrStart;
              return results;
            })()
          : Promise.resolve([])
      ]);

      if (omniParserResults.length > 0) {
        methodsUsed.push('omniparser');
        allElements.push(...omniParserResults);
        // Log at INFO level so it's visible in logs (not just DEBUG)
        this.logger.log(`🔍 OmniParser detected ${omniParserResults.length} semantic elements`);
      }

      if (ocrResults.length > 0) {
        methodsUsed.push('ocr');
        allElements.push(...ocrResults);
      }

      // Process results
      const filteredElements = allElements.filter(el => el.confidence >= confidenceThreshold);
      const finalElements = combineResults
        ? this.combineOverlappingElements(filteredElements)
        : filteredElements;

      // Sort by confidence and limit results
      finalElements.sort((a, b) => b.confidence - a.confidence);
      const limitedElements = finalElements.slice(0, maxResults);

      performance.totalTime = Date.now() - startTime;

      const avgConfidence = limitedElements.length > 0
        ? limitedElements.reduce((sum, el) => sum + el.confidence, 0) / limitedElements.length
        : 0;

      return {
        elements: limitedElements,
        methodsUsed,
        performance,
        confidence: avgConfidence
      };

    } catch (error) {
      this.logger.error('Enhanced detection failed:', error.message);
      return this.createEmptyResult();
    }
  }

  /**
   * Quick UI element detection using OmniParser only
   * Optimized for speed over comprehensiveness
   */
  async quickDetectElements(
    screenshotBuffer: Buffer,
    options: Partial<EnhancedDetectionOptions> = {}
  ): Promise<EnhancedDetectionResult> {
    return this.detectElements(screenshotBuffer, null, {
      useOCR: false,
      maxResults: 10,
      ...options
    });
  }

  /**
   * Specialized button detection using OmniParser for semantic understanding
   */
  async detectButtons(screenshotBuffer: Buffer): Promise<EnhancedDetectionResult> {
    return this.detectElements(screenshotBuffer, null, {
      useOmniParser: true,
      useOCR: false,
    });
  }

  private async runOCRDetection(screenshotBuffer: Buffer, options: EnhancedDetectionOptions) {
    return this.cvActivity.executeWithTracking(
      'ocr-detection',
      async () => {
        return await this.ocrDetector.detect(screenshotBuffer, options.ocrRegion);
      },
      {
        region: options.ocrRegion ? `${options.ocrRegion.width}x${options.ocrRegion.height}` : 'full-screen'
      }
    ).catch(error => {
      this.logger.warn('OCR detection failed:', error.message);
      return [];
    });
  }

  private async runOmniParserDetection(screenshotBuffer: Buffer, options: EnhancedDetectionOptions) {
    const activityId = this.cvActivity.startMethod('omniparser', {
      captions: options.omniParserCaptions ?? true,
      confidence_threshold: options.omniParserConfidence ?? 0.3,
    });

    try {
      if (!this.omniParserClient) {
        throw new Error('OmniParser client not available');
      }

      // Check if service is available
      const available = await this.omniParserClient.isAvailable();
      if (!available) {
        throw new Error('OmniParser service is not responding');
      }

      // Call OmniParser service with Buffer
      const response = await this.omniParserClient.parseScreenshot(screenshotBuffer, {
        includeCaptions: options.omniParserCaptions ?? true,
        minConfidence: options.omniParserConfidence ?? 0.3,
      });

      // Update metadata with device info for UI display
      this.cvActivity.updateMethodMetadata(activityId, {
        device: response.device,
        elementCount: response.count,
        processingTime: response.processing_time_ms,
      });

      // Convert to DetectedElement format
      const elements = response.elements.map((element, index) => ({
        id: `omniparser_${Date.now()}_${index}`,
        type: this.inferElementTypeFromCaption(element.caption),
        coordinates: {
          x: element.bbox[0],
          y: element.bbox[1],
          width: element.bbox[2],
          height: element.bbox[3],
          centerX: element.center[0],
          centerY: element.center[1],
        },
        confidence: element.confidence,
        text: element.caption || '',
        description: element.caption ? `${element.caption} (AI detected)` : 'Interactive element',
        metadata: {
          detectionMethod: 'omniparser' as const,
          omniparser_type: element.type,
          semantic_caption: element.caption,
        }
      }));

      this.cvActivity.stopMethod(activityId, true, elements);
      return elements;
    } catch (error) {
      this.logger.warn('OmniParser detection failed:', error.message);
      this.cvActivity.stopMethod(activityId, false, { error: error.message });
      return [];
    }
  }

  private inferElementTypeFromCaption(caption?: string): 'button' | 'input' | 'link' | 'text' | 'icon' {
    if (!caption) return 'button';

    const lowerCaption = caption.toLowerCase();

    if (lowerCaption.includes('button') || lowerCaption.includes('btn')) {
      return 'button';
    } else if (lowerCaption.includes('input') || lowerCaption.includes('field') || lowerCaption.includes('textbox')) {
      return 'input';
    } else if (lowerCaption.includes('link') || lowerCaption.includes('hyperlink')) {
      return 'link';
    } else if (lowerCaption.includes('text') || lowerCaption.includes('label')) {
      return 'text';
    } else if (lowerCaption.includes('icon') || lowerCaption.includes('image')) {
      return 'icon';
    }

    return 'button'; // Default
  }

  private combineOverlappingElements(elements: DetectedElement[]): DetectedElement[] {
    const combined: DetectedElement[] = [];
    const used = new Set<number>();

    for (let i = 0; i < elements.length; i++) {
      if (used.has(i)) continue;

      const base = elements[i];
      const overlapping = [base];

      for (let j = i + 1; j < elements.length; j++) {
        if (used.has(j)) continue;

        if (this.elementsOverlap(base, elements[j])) {
          overlapping.push(elements[j]);
          used.add(j);
        }
      }

      // Create combined element with best properties from overlapping elements
      const bestElement = overlapping.reduce((best, current) =>
        current.confidence > best.confidence ? current : best
      );

      // Merge metadata from all overlapping elements
      const allMethods = overlapping.map(el => el.metadata?.detectionMethod).filter(Boolean);
      bestElement.metadata = {
        ...bestElement.metadata,
        detectionMethod: allMethods.length > 1 ? 'hybrid' as const : bestElement.metadata?.detectionMethod,
        combinedFromMethods: allMethods.length > 1 ? allMethods : undefined
      };

      combined.push(bestElement);
      used.add(i);
    }

    return combined;
  }

  private elementsOverlap(a: DetectedElement, b: DetectedElement): boolean {
    const overlapThreshold = 0.5;

    const aArea = a.coordinates.width * a.coordinates.height;
    const bArea = b.coordinates.width * b.coordinates.height;

    const overlapX = Math.max(0, Math.min(
      a.coordinates.x + a.coordinates.width,
      b.coordinates.x + b.coordinates.width
    ) - Math.max(a.coordinates.x, b.coordinates.x));

    const overlapY = Math.max(0, Math.min(
      a.coordinates.y + a.coordinates.height,
      b.coordinates.y + b.coordinates.height
    ) - Math.max(a.coordinates.y, b.coordinates.y));

    const overlapArea = overlapX * overlapY;
    const overlapRatio = overlapArea / Math.min(aArea, bArea);

    return overlapRatio > overlapThreshold;
  }

  private createEmptyResult(): EnhancedDetectionResult {
    return {
      elements: [],
      methodsUsed: [],
      performance: { totalTime: 0 },
      confidence: 0
    };
  }

  async cleanup(): Promise<void> {
    await this.ocrDetector.cleanup();
  }
}
