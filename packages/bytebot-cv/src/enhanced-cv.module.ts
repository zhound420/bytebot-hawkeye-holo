import { Module, Global } from '@nestjs/common';
import { TemplateMatcherService } from './detectors/template/template-matcher.service';
import { FeatureMatcherService } from './detectors/feature/feature-matcher.service';
import { ContourDetectorService } from './detectors/contour/contour-detector.service';
import { EnhancedVisualDetectorService } from './services/enhanced-visual-detector.service';
import { CVActivityIndicatorService } from './services/cv-activity-indicator.service';
import { OmniParserClientService } from './services/omniparser-client.service';

@Global() // Ensure singleton behavior across all modules
@Module({
  providers: [
    CVActivityIndicatorService,
    TemplateMatcherService,
    FeatureMatcherService,
    ContourDetectorService,
    OmniParserClientService,
    EnhancedVisualDetectorService,
  ],
  exports: [
    CVActivityIndicatorService,
    TemplateMatcherService,
    FeatureMatcherService,
    ContourDetectorService,
    OmniParserClientService,
    EnhancedVisualDetectorService,
  ],
})
export class EnhancedCVModule {}