import { Module, Global } from '@nestjs/common';
import { EnhancedVisualDetectorService } from './services/enhanced-visual-detector.service';
import { CVActivityIndicatorService } from './services/cv-activity-indicator.service';
import { OmniParserClientService } from './services/omniparser-client.service';

/**
 * Enhanced CV Module - OmniParser + OCR detection only
 * OpenCV-based detectors removed
 */
@Global()
@Module({
  providers: [
    CVActivityIndicatorService,
    OmniParserClientService,
    EnhancedVisualDetectorService,
  ],
  exports: [
    CVActivityIndicatorService,
    OmniParserClientService,
    EnhancedVisualDetectorService,
  ],
})
export class EnhancedCVModule {}
