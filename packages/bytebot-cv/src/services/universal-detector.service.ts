import { Injectable, Logger, Optional } from '@nestjs/common';
import { TextSemanticAnalyzerService } from './text-semantic-analyzer.service';
import { EnhancedVisualDetectorService } from './enhanced-visual-detector.service';
import {
  UniversalUIElement,
  DetectionResult,
  UniversalElementType,
} from '../interfaces/universal-element.interface';
import { DetectedElement, BoundingBox } from '../types';

/**
 * Universal element detector - now powered by OmniParser + OCR
 * OpenCV-based detection removed
 */
@Injectable()
export class UniversalDetectorService {
  private readonly logger = new Logger(UniversalDetectorService.name);

  constructor(
    private readonly textAnalyzer: TextSemanticAnalyzerService,
    @Optional() private readonly enhancedDetector?: EnhancedVisualDetectorService,
  ) {
    this.logger.log('UniversalDetectorService initialized with OmniParser + OCR pipeline');
  }

  async detectElements(screenshot: Buffer): Promise<DetectionResult> {
    const startTime = Date.now();

    try {
      // Use EnhancedVisualDetectorService which implements OmniParser (primary) + OCR (fallback)
      const detectionResult = await this.enhancedDetector?.detectElements(
        screenshot,
        null,
        {
          useOmniParser: true,
          useOCR: false, // OCR is expensive, only use if OmniParser fails
          confidenceThreshold: 0.5,
          maxResults: 50,
          combineResults: true,
        }
      );

      const detectedElements = detectionResult?.elements || [];

      // Convert DetectedElement to UniversalUIElement format
      const universalElements = detectedElements.map((el) => this.convertToUniversalElement(el));

      const processingTime = Date.now() - startTime;
      this.logger.log(`Detected ${universalElements.length} universal element(s) in ${processingTime}ms`);

      return {
        elements: universalElements,
        processingTime,
        method: 'hybrid',
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error('Universal detection failed', (error as Error)?.stack);
      return {
        elements: [],
        processingTime,
        method: 'hybrid',
      };
    }
  }

  async findElementsByRole(screenshot: Buffer, role: string): Promise<UniversalUIElement[]> {
    const result = await this.detectElements(screenshot);
    return result.elements.filter((element) => element.semanticRole === role);
  }

  async findElementsByText(screenshot: Buffer, searchText: string): Promise<UniversalUIElement[]> {
    const result = await this.detectElements(screenshot);
    const search = searchText.toLowerCase();
    return result.elements.filter((element) => element.text?.toLowerCase().includes(search));
  }

  private convertToUniversalElement(element: DetectedElement): UniversalUIElement {
    const semanticRole = this.textAnalyzer.analyzeSemanticRole(element.text || '');
    const description = element.description || element.metadata?.semantic_caption || '';

    const bounds = {
      x: element.coordinates.x,
      y: element.coordinates.y,
      width: element.coordinates.width,
      height: element.coordinates.height,
    };

    const clickPoint = {
      x: Math.round(element.coordinates.centerX),
      y: Math.round(element.coordinates.centerY),
    };

    return {
      id: element.id,
      type: this.mapElementType(element.type),
      bounds,
      clickPoint,
      confidence: element.confidence,
      text: element.text || '',
      semanticRole,
      description,
    };
  }

  private mapElementType(type: string): UniversalElementType {
    switch (type) {
      case 'button':
        return 'button';
      case 'input':
        return 'text_input';
      case 'link':
        return 'clickable';
      case 'text':
        return 'clickable';
      case 'icon':
        return 'button';
      default:
        return 'clickable';
    }
  }
}
