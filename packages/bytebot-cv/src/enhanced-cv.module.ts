import { Module, Global } from '@nestjs/common';
import { EnhancedVisualDetectorService } from './services/enhanced-visual-detector.service';
import { CVActivityIndicatorService } from './services/cv-activity-indicator.service';
import { HoloClientService } from './omniparser-client.service';

/**
 * Enhanced CV Module - Holo 1.5-7B + OCR detection
 * Provides precision UI localization via Holo 1.5-7B VLM
 */
@Global()
@Module({
  providers: [
    CVActivityIndicatorService,
    HoloClientService,
    EnhancedVisualDetectorService,
  ],
  exports: [
    CVActivityIndicatorService,
    HoloClientService,
    EnhancedVisualDetectorService,
  ],
})
export class EnhancedCVModule {}
