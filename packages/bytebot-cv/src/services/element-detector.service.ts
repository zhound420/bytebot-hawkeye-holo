import { Injectable, Logger } from '@nestjs/common';
import { DetectedElement, BoundingBox } from '../types';

/**
 * Stub implementation of ElementDetectorService
 * OpenCV functionality removed - returns empty arrays
 * Use OmniParser via EnhancedVisualDetectorService for UI element detection
 */
@Injectable()
export class ElementDetectorService {
  private readonly logger = new Logger(ElementDetectorService.name);

  constructor() {
    this.logger.warn('ElementDetectorService: OpenCV removed, returning empty results. Use OmniParser instead.');
  }

  async performOCR(_screenshot: Buffer, _region?: BoundingBox): Promise<DetectedElement[]> {
    return [];
  }

  async detectElement(_screenshot: Buffer, _targetDescription: string): Promise<DetectedElement | null> {
    return null;
  }

  async detectElements(_screenshot: Buffer): Promise<DetectedElement[]> {
    return [];
  }
}
