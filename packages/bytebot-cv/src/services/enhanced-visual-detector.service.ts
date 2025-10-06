import { Injectable, Logger, Optional } from '@nestjs/common';
import { OCRDetector } from '../detectors/ocr/ocr-detector';
import { CVActivityIndicatorService } from './cv-activity-indicator.service';
import { HoloClientService } from './holo-client.service';
import { DetectedElement, BoundingBox } from '../types';

export interface EnhancedDetectionOptions {
  useOCR?: boolean;
  useHolo?: boolean; // Use Holo 1.5-7B for UI element detection

  // OCR options
  ocrRegion?: BoundingBox;

  // Holo 1.5-7B options
  holoTask?: string; // Task-specific instruction for single-shot detection (e.g., "Find the VSCode icon")
  holoCaptions?: boolean; // Enable functional captions for detected elements
  holoConfidence?: number; // Minimum confidence threshold (0-1)
  holoPerformanceProfile?: 'speed' | 'balanced' | 'quality';

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
    holoTime?: number;
  };
  confidence: number;
  somImage?: string; // Base64 encoded Set-of-Mark annotated image from Holo
  elementMapping?: Map<number, string>; // Element number -> element ID mapping for SOM
}

@Injectable()
export class EnhancedVisualDetectorService {
  private readonly logger = new Logger(EnhancedVisualDetectorService.name);
  private readonly ocrDetector: OCRDetector;

  constructor(
    private readonly cvActivity: CVActivityIndicatorService,
    @Optional() private readonly holoClient?: HoloClientService,
  ) {
    this.ocrDetector = new OCRDetector();
    this.logger.log('Enhanced Visual Detector Service initialized (Holo 1.5-7B + OCR)');

    if (this.holoClient) {
      this.holoClient.isAvailable().then((available) => {
        if (available) {
          this.logger.log('✓ Holo 1.5-7B integration enabled');
        } else {
          this.logger.warn('Holo 1.5-7B client registered but service unavailable');
        }
      });
    }
  }

  /**
   * UI element detection using Holo 1.5-7B (semantic) and OCR (text)
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

    // Default Holo to enabled when service is available
    const holoAvailable = await this.holoClient?.isAvailable() ?? false;

    const {
      confidenceThreshold = 0.6,
      maxResults = 20,
      combineResults = true
    } = options;

    // Use let for useOCR to allow Phase 3.2 optimization (conditional skip)
    let useOCR = options.useOCR ?? false; // OCR is expensive, use as fallback only
    const useHolo = options.useHolo ?? holoAvailable; // Use Holo 1.5-7B, defaults to enabled when service healthy

    try {
      // Phase 3.2: Run Holo first, skip OCR if Holo succeeds with high confidence
      let holoResult: { elements: DetectedElement[]; somImage?: string; elementMapping?: Map<number, string> } =
        { elements: [], somImage: undefined, elementMapping: undefined };
      let ocrResults: DetectedElement[] = [];

      // Run Holo detection if enabled
      if (useHolo && this.holoClient) {
        const holoStart = Date.now();
        holoResult = await this.runHoloDetection(screenshotBuffer, options);
        performance.holoTime = Date.now() - holoStart;

        // Check if Holo succeeded with high confidence (Phase 3.2)
        // If so, skip OCR to save time
        if (holoResult.elements.length >= 5) {
          const avgConfidence = holoResult.elements.reduce((sum, el) => sum + el.confidence, 0) / holoResult.elements.length;
          if (avgConfidence >= 0.7) {
            this.logger.debug(`Holo succeeded with high confidence (${Math.round(avgConfidence * 100)}%, ${holoResult.elements.length} elements) - skipping OCR`);
            useOCR = false; // Override - skip OCR
          }
        }
      }

      // Run OCR only if needed (Phase 3.2)
      if (useOCR) {
        const ocrStart = Date.now();
        ocrResults = await this.runOCRDetection(screenshotBuffer, options);
        performance.ocrTime = Date.now() - ocrStart;
      }

      // Extract SOM data from Holo result
      let somImage: string | undefined;
      let elementMapping: Map<number, string> | undefined;

      if (holoResult.elements.length > 0) {
        methodsUsed.push('holo-1.5-7b');
        allElements.push(...holoResult.elements);
        somImage = holoResult.somImage;
        elementMapping = holoResult.elementMapping;
        // Log at INFO level so it's visible in logs (not just DEBUG)
        this.logger.log(`🔍 Holo 1.5-7B localized ${holoResult.elements.length} elements`);
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
        confidence: avgConfidence,
        somImage, // Pass through SOM image if available
        elementMapping, // Pass through element mapping if available
      };

    } catch (error) {
      this.logger.error('Enhanced detection failed:', error.message);
      return this.createEmptyResult();
    }
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

  private async runHoloDetection(screenshotBuffer: Buffer, options: EnhancedDetectionOptions) {
    // Track Holo 1.5-7B activity with device info
    const detectionMode = options.holoTask ? 'single-shot' : 'multi-element';
    const activityId = this.cvActivity.startMethod('holo-1.5-7b', {
      mode: detectionMode,
      task: options.holoTask || 'multi-element scan',
      captions: options.holoCaptions ?? true,
      confidence_threshold: options.holoConfidence ?? 0.3,
      device: 'loading',  // Will be updated after response
    });

    try {
      if (!this.holoClient) {
        throw new Error('Holo 1.5-7B client not available');
      }

      // Check if service is available
      const available = await this.holoClient.isAvailable();
      if (!available) {
        throw new Error('Holo 1.5-7B service is not responding');
      }

      // Call Holo 1.5-7B service with Buffer
      // Use task-specific mode if task is provided, otherwise multi-element scan
      const response = await this.holoClient.parseScreenshot(screenshotBuffer, {
        task: options.holoTask, // Task-specific instruction (e.g., "Find the VSCode icon")
        detectMultiple: !options.holoTask, // Single-shot if task provided, multi-element otherwise
        includeCaptions: options.holoCaptions ?? true,
        minConfidence: options.holoConfidence ?? 0.3,
        maxDetections: options.maxResults,
        returnRawOutputs: process.env.HOLO_DEBUG_RAW === 'true',
        performanceProfile: options.holoPerformanceProfile,
      });

      // Update metadata with device info for UI display
      this.cvActivity.updateMethodMetadata(activityId, {
        device: response.device,  // 'mps', 'cuda', or 'cpu'
        elementCount: response.count,
        processingTime: response.processing_time_ms,
        ocrDetected: response.ocr_detected,
        iconDetected: response.icon_detected,
        interactableCount: response.interactable_count,
        profile: response.profile,
        maxDetections: response.max_detections,
        minConfidence: response.min_confidence,
      });

      // Convert to DetectedElement format
      const elements = response.elements.map((element, index) => ({
        id: `holo_${Date.now()}_${index}`,
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
        description: element.caption ? `${element.caption} (Holo localized)` : 'Interactive element',
        metadata: {
          detectionMethod: 'holo-1.5-7b' as const,
          holo_type: element.type,
          task_caption: element.caption,
        }
      }));

      this.cvActivity.stopMethod(activityId, true, elements);

      // Create element number -> ID mapping for SOM
      const elementMapping = new Map<number, string>();
      elements.forEach((element, index) => {
        // Use element_id from response if available, otherwise use index
        const elementNumber = response.elements[index]?.element_id ?? index;
        elementMapping.set(elementNumber, element.id);
      });

      return {
        elements,
        somImage: response.som_image, // Base64 SOM-annotated image
        elementMapping,
      };
    } catch (error) {
      this.logger.warn('Holo 1.5-7B detection failed:', error.message);
      this.cvActivity.stopMethod(activityId, false, { error: error.message });
      return { elements: [], somImage: undefined, elementMapping: undefined };
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
      confidence: 0,
      somImage: undefined,
      elementMapping: undefined,
    };
  }

  async cleanup(): Promise<void> {
    await this.ocrDetector.cleanup();
  }
}
