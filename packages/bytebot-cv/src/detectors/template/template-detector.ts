import * as cv from 'opencv4nodejs';
import * as fs from 'fs';
import * as path from 'path';
import { BoundingBox, DetectedElement, ElementType } from '../../types';
import { decodeImageBuffer } from '../../utils/cv-decode';

type CvMat = InstanceType<typeof cv.Mat>;

type TemplateEntry = {
  name: string;
  mat: CvMat;
  type: ElementType;
};

export class TemplateDetector {
  private templates: TemplateEntry[] = [];

  constructor() {
    this.loadCommonTemplates();
  }

  async detect(screenshotBuffer: Buffer, region?: BoundingBox): Promise<DetectedElement[]> {
    if (!screenshotBuffer?.length || !this.templates.length) {
      return [];
    }

    const screenshot = decodeImageBuffer(cv, screenshotBuffer, {
      source: 'TemplateDetector.detect',
    });
    const { mat: searchMat, offsetX, offsetY } = this.extractRegion(screenshot, region);
    const elements: DetectedElement[] = [];

    for (const template of this.templates) {
      if (searchMat.cols < template.mat.cols || searchMat.rows < template.mat.rows) {
        continue;
      }

      const result = searchMat.matchTemplate(template.mat, cv.TM_CCOEFF_NORMED);
      const { maxLoc, maxVal } = result.minMaxLoc();

      if (maxVal < 0.8) {
        continue;
      }

      const x = maxLoc.x + offsetX;
      const y = maxLoc.y + offsetY;
      const width = template.mat.cols;
      const height = template.mat.rows;

      elements.push({
        id: this.generateElementId('template'),
        type: template.type,
        coordinates: {
          x,
          y,
          width,
          height,
          centerX: x + width / 2,
          centerY: y + height / 2
        },
        confidence: Math.min(Math.max(maxVal, 0), 1),
        description: `Template match: ${template.name}`,
        metadata: {
          detectionMethod: 'template',
          templateMatch: maxVal
        }
      });
    }

    return elements;
  }

  private loadCommonTemplates(): void {
    const templateDir = path.join(__dirname, 'templates');
    const definitions: Array<{ name: string; file: string; type: ElementType }> = [
      { name: 'install-button', file: 'install-button.png', type: 'button' },
      { name: 'save-button', file: 'save-button.png', type: 'button' }
    ];

    for (const definition of definitions) {
      const templatePath = path.join(templateDir, definition.file);

      if (!fs.existsSync(templatePath)) {
        continue;
      }

      try {
        const mat = cv.imread(templatePath);
        this.templates.push({
          name: definition.name,
          mat,
          type: definition.type
        });
      } catch (error) {
        console.warn(`Failed to load template ${definition.name}:`, (error as Error).message);
      }
    }
  }

  private extractRegion(image: CvMat, region?: BoundingBox): {
    mat: CvMat;
    offsetX: number;
    offsetY: number;
  } {
    if (!region) {
      return { mat: image, offsetX: 0, offsetY: 0 };
    }

    const x = Math.max(0, Math.min(Math.floor(region.x), image.cols - 1));
    const y = Math.max(0, Math.min(Math.floor(region.y), image.rows - 1));
    const width = Math.max(1, Math.min(Math.floor(region.width), image.cols - x));
    const height = Math.max(1, Math.min(Math.floor(region.height), image.rows - y));

    if (width <= 0 || height <= 0) {
      return { mat: image, offsetX: 0, offsetY: 0 };
    }

    const rect = new cv.Rect(x, y, width, height);
    return { mat: image.getRegion(rect), offsetX: x, offsetY: y };
  }

  private generateElementId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}
