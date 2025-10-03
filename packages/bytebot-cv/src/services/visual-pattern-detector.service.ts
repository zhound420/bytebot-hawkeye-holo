import { Injectable, Logger } from '@nestjs/common';
import { UniversalUIElement } from '../interfaces/universal-element.interface';

/**
 * Stub implementation of VisualPatternDetectorService
 * OpenCV functionality removed - returns empty arrays
 * Use OmniParser via EnhancedVisualDetectorService for UI element detection
 */
@Injectable()
export class VisualPatternDetectorService {
  private readonly logger = new Logger(VisualPatternDetectorService.name);

  constructor() {
    this.logger.warn('VisualPatternDetectorService: OpenCV removed, returning empty results. Use OmniParser instead.');
  }

  async detectButtons(_screenshot: Buffer): Promise<UniversalUIElement[]> {
    return [];
  }

  async detectTextInputs(_screenshot: Buffer): Promise<UniversalUIElement[]> {
    return [];
  }
}
