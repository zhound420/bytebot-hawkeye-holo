import { createWorker, Worker } from 'tesseract.js';
import { BoundingBox, DetectedElement, ElementType } from '../../types';

type RecognizeRectangleOption = {
  rectangle: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
};

export class OCRDetector {
  private worker: Worker | null = null;

  async detect(screenshotBuffer: Buffer, region?: BoundingBox): Promise<DetectedElement[]> {
    const worker = await this.getWorker();
    const options = region ? this.toRecognizeOptions(region) : undefined;
    const { data } = await worker.recognize(screenshotBuffer, options);

    if (!data?.words?.length) {
      return [];
    }

    const elements: DetectedElement[] = [];
    const offsetX = region ? Math.max(0, Math.floor(region.x)) : 0;
    const offsetY = region ? Math.max(0, Math.floor(region.y)) : 0;

    for (const word of data.words) {
      const confidence = word.confidence ?? 0;

      if (confidence <= 70) {
        continue;
      }

      const bbox = word.bbox;
      const x0 = bbox.x0 + offsetX;
      const y0 = bbox.y0 + offsetY;
      const x1 = bbox.x1 + offsetX;
      const y1 = bbox.y1 + offsetY;
      const width = x1 - x0;
      const height = y1 - y0;

      elements.push({
        id: this.generateElementId('ocr'),
        type: this.inferElementType(word.text, width, height),
        coordinates: {
          x: x0,
          y: y0,
          width,
          height,
          centerX: x0 + width / 2,
          centerY: y0 + height / 2
        },
        confidence: Math.min(Math.max(confidence / 100, 0), 1),
        text: word.text,
        description: `Text element: "${word.text}"`,
        metadata: {
          detectionMethod: 'ocr',
          ocrConfidence: confidence
        }
      });
    }

    return elements;
  }

  async cleanup(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }

  private async getWorker(): Promise<Worker> {
    if (!this.worker) {
      this.worker = await createWorker();
      await this.worker.loadLanguage('eng');
      await this.worker.initialize('eng');
    }

    return this.worker;
  }

  private toRecognizeOptions(region: BoundingBox): RecognizeRectangleOption {
    return {
      rectangle: {
        left: Math.max(0, Math.floor(region.x)),
        top: Math.max(0, Math.floor(region.y)),
        width: Math.max(1, Math.floor(region.width)),
        height: Math.max(1, Math.floor(region.height))
      }
    };
  }

  private inferElementType(text: string, width: number, height: number): ElementType {
    const lowerText = text.toLowerCase();
    const buttonKeywords = [
      'install',
      'save',
      'cancel',
      'ok',
      'submit',
      'login',
      'sign in',
      'download'
    ];

    if (buttonKeywords.some(keyword => lowerText.includes(keyword))) {
      return 'button';
    }

    if (lowerText.includes('http') || lowerText.includes('www') || lowerText.includes('.com')) {
      return 'link';
    }

    if (height < 40 && width > 100 && lowerText.length < 50) {
      return 'input';
    }

    return 'text';
  }

  private generateElementId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}
