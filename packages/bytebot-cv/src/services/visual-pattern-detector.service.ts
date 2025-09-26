import { Injectable, Logger } from '@nestjs/common';
import { UniversalUIElement } from '../interfaces/universal-element.interface';

// Lazy-load OpenCV so environments without the native bindings degrade gracefully.
type CvModule = typeof import('opencv4nodejs');
type RectLike = { x: number; y: number; width: number; height: number };

type MatLike = any;

// eslint-disable-next-line @typescript-eslint/no-var-requires
let cv: CvModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  cv = require('opencv4nodejs');
} catch (error) {
  // eslint-disable-next-line no-console
  console.warn(
    '[VisualPatternDetectorService] opencv4nodejs not available; visual heuristics disabled.',
    (error as Error)?.message ?? error,
  );
}

const hasCv = !!cv;

@Injectable()
export class VisualPatternDetectorService {
  private readonly logger = new Logger(VisualPatternDetectorService.name);

  async detectButtons(screenshot: Buffer): Promise<UniversalUIElement[]> {
    if (!this.ensureCv()) {
      return [];
    }

    try {
      const cvModule = cv!;
      const mat = cvModule.imdecode(screenshot);
      const gray = this.ensureGrayscale(mat, cvModule);
      const edges = gray.canny(50, 150);
      const contours = edges.findContours(cvModule.RETR_EXTERNAL, cvModule.CHAIN_APPROX_SIMPLE);
      const elements: UniversalUIElement[] = [];

      for (let i = 0; i < contours.length; i += 1) {
        const rect = contours[i].boundingRect();

        if (!this.isButtonSize(rect)) {
          continue;
        }

        const aspectRatio = rect.width / Math.max(rect.height, 1);
        if (aspectRatio < 1.2 || aspectRatio > 8) {
          continue;
        }

        const confidence = this.calculateButtonConfidence(rect, aspectRatio);
        if (confidence <= 0.5) {
          continue;
        }

        elements.push({
          id: `button_${i}`,
          type: 'button',
          bounds: this.toBounds(rect),
          clickPoint: {
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2),
          },
          confidence,
          description: `Button near (${rect.x}, ${rect.y})`,
        });
      }

      return elements;
    } catch (error) {
      this.logger.error('Button detection failed', (error as Error)?.stack);
      return [];
    }
  }

  async detectTextInputs(screenshot: Buffer): Promise<UniversalUIElement[]> {
    if (!this.ensureCv()) {
      return [];
    }

    try {
      const cvModule = cv!;
      const mat = cvModule.imdecode(screenshot);
      const gray = this.ensureGrayscale(mat, cvModule);
      const blurred = gray.gaussianBlur(new cvModule.Size(3, 3), 0);
      const thresh = blurred.threshold(200, 255, (cvModule as any).THRESH_BINARY ?? 0);
      const contours = thresh.findContours(cvModule.RETR_EXTERNAL, cvModule.CHAIN_APPROX_SIMPLE);
      const elements: UniversalUIElement[] = [];

      for (let i = 0; i < contours.length; i += 1) {
        const rect = contours[i].boundingRect();

        if (!this.isInputSize(rect)) {
          continue;
        }

        const aspectRatio = rect.width / Math.max(rect.height, 1);
        if (aspectRatio < 2 || aspectRatio > 15) {
          continue;
        }

        const confidence = this.calculateInputConfidence(rect, aspectRatio);
        if (confidence <= 0.6) {
          continue;
        }

        elements.push({
          id: `input_${i}`,
          type: 'text_input',
          bounds: this.toBounds(rect),
          clickPoint: {
            x: Math.round(rect.x + Math.min(20, rect.width / 2)),
            y: Math.round(rect.y + rect.height / 2),
          },
          confidence,
          description: `Text input near (${rect.x}, ${rect.y})`,
        });
      }

      return elements;
    } catch (error) {
      this.logger.error('Text input detection failed', (error as Error)?.stack);
      return [];
    }
  }

  private ensureCv(): boolean {
    if (!hasCv) {
      this.logger.warn('opencv4nodejs unavailable; skipping visual pattern detection.');
      return false;
    }
    return true;
  }

  private ensureGrayscale(mat: MatLike, cvModule: CvModule) {
    const channelCount =
      typeof (mat as any).channels === 'function'
        ? (mat as any).channels()
        : (mat as any).channels ?? 0;

    if (channelCount === 3 || channelCount === 4) {
      const conversionCode =
        (cvModule as any).COLOR_BGR2GRAY ?? (cvModule as any).COLOR_RGB2GRAY ?? 6;
      return (mat as any).cvtColor(conversionCode);
    }

    if (typeof (mat as any).clone === 'function') {
      return (mat as any).clone();
    }
    if (typeof (mat as any).copy === 'function') {
      return (mat as any).copy();
    }
    return mat;
  }

  private isButtonSize(rect: RectLike): boolean {
    return rect.width >= 30 && rect.width <= 300 && rect.height >= 15 && rect.height <= 80;
  }

  private isInputSize(rect: RectLike): boolean {
    return rect.width >= 50 && rect.width <= 500 && rect.height >= 20 && rect.height <= 50;
  }

  private toBounds(rect: RectLike): { x: number; y: number; width: number; height: number } {
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }

  private calculateButtonConfidence(bounds: RectLike, aspectRatio: number): number {
    let confidence = 0.5;

    if (bounds.width >= 60 && bounds.width <= 150 && bounds.height >= 25 && bounds.height <= 40) {
      confidence += 0.2;
    }

    if (aspectRatio >= 2 && aspectRatio <= 5) {
      confidence += 0.2;
    }

    if (bounds.y > 600) {
      confidence += 0.1;
    }

    return Math.min(confidence, 0.95);
  }

  private calculateInputConfidence(bounds: RectLike, aspectRatio: number): number {
    let confidence = 0.6;

    if (bounds.width >= 100 && bounds.width <= 300 && bounds.height >= 25 && bounds.height <= 35) {
      confidence += 0.2;
    }

    if (aspectRatio >= 4 && aspectRatio <= 10) {
      confidence += 0.15;
    }

    return Math.min(confidence, 0.95);
  }
}
