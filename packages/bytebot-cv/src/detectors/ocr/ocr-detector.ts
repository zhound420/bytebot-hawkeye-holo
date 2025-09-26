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

type WordLike = {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

type OCRAttemptConfig = {
  name: string;
  preprocess: (input: any) => { image: any; scale?: number };
  tessParams: Record<string, string>;
  minConfidence: number;
  minWordCount?: number;
};

let cv: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  cv = require('opencv4nodejs');
} catch (error) {
  // eslint-disable-next-line no-console
  console.warn(
    '[OCRDetector] opencv4nodejs not available. Falling back to basic OCR pipeline.',
    (error as Error)?.message ?? error,
  );
}

const CV = cv as any;

export class OCRDetector {
  private worker: Worker | null = null;
  private readonly cvAvailable = !!cv;
  private readonly debugEnabled =
    typeof process !== 'undefined' && process?.env?.BYTEBOT_OCR_DEBUG === 'true';

  async detect(screenshotBuffer: Buffer, region?: BoundingBox): Promise<DetectedElement[]> {
    if (!this.cvAvailable) {
      return this.basicDetect(screenshotBuffer, region);
    }

    return this.advancedDetect(screenshotBuffer, region);
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

      const originalWarn = console.warn;
      console.warn = (message?: unknown, ...rest: unknown[]) => {
        if (
          typeof message === 'string' &&
          (message.includes('`loadLanguage` is depreciated') ||
            message.includes('`initialize` is depreciated'))
        ) {
          return;
        }
        originalWarn.call(console, message as any, ...rest);
      };

      try {
        const workerAny = this.worker as unknown as {
          loadLanguage?: (lang: string) => Promise<void>;
          initialize?: (lang: string) => Promise<void>;
        };

        if (typeof workerAny.loadLanguage === 'function') {
          await workerAny.loadLanguage('eng');
        }

        if (typeof workerAny.initialize === 'function') {
          await workerAny.initialize('eng');
        }
      } finally {
        console.warn = originalWarn;
      }
    }

    return this.worker;
  }

  private toRecognizeOptions(region: BoundingBox): RecognizeRectangleOption {
    return {
      rectangle: {
        left: Math.max(0, Math.floor(region.x)),
        top: Math.max(0, Math.floor(region.y)),
        width: Math.max(1, Math.floor(region.width)),
        height: Math.max(1, Math.floor(region.height)),
      },
    };
  }

  private cleanRecognizedText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private async basicDetect(
    screenshotBuffer: Buffer,
    region?: BoundingBox,
  ): Promise<DetectedElement[]> {
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

      const text = this.cleanRecognizedText(word.text || '');
      if (!text) {
        continue;
      }

      const x0 = word.bbox.x0 + offsetX;
      const y0 = word.bbox.y0 + offsetY;
      const x1 = word.bbox.x1 + offsetX;
      const y1 = word.bbox.y1 + offsetY;
      const width = Math.max(1, x1 - x0);
      const height = Math.max(1, y1 - y0);

      elements.push({
        id: this.generateElementId('ocr'),
        type: this.inferElementType(text, width, height),
        coordinates: {
          x: x0,
          y: y0,
          width,
          height,
          centerX: x0 + width / 2,
          centerY: y0 + height / 2,
        },
        confidence: Math.min(Math.max(confidence / 100, 0), 1),
        text,
        description: `Text element: "${text}"`,
        metadata: {
          detectionMethod: 'ocr',
          ocrConfidence: confidence,
          ocrAttempt: 'basic_fallback',
        },
      });
    }

    return elements;
  }

  private advancedDecode(buffer: Buffer): any {
    return CV.imdecode(buffer);
  }

  private cropToRegion(mat: any, region?: BoundingBox): { image: any; offsetX: number; offsetY: number } {
    if (!region) {
      return { image: mat, offsetX: 0, offsetY: 0 };
    }

    const x = Math.max(0, Math.floor(region.x));
    const y = Math.max(0, Math.floor(region.y));
    const width = Math.min(mat.cols - x, Math.max(1, Math.floor(region.width)));
    const height = Math.min(mat.rows - y, Math.max(1, Math.floor(region.height)));

    const roi = mat.getRegion(new CV.Rect(x, y, width, height));
    return { image: roi, offsetX: x, offsetY: y };
  }

  private buildAttempts(): OCRAttemptConfig[] {
    const whitelist = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/\\"\'`~!@#$%^&*()_+={}[]|:;,.?<>';

    return [
      {
        name: 'clahe_psm8_scale_1.5',
        preprocess: (input) => {
          const scaled = this.scaleImage(input, 1.5);
          const gray = scaled.cvtColor(CV.COLOR_BGR2GRAY);
          const clahe = new CV.CLAHE(2, new CV.Size(8, 8));
          const equalized = clahe.apply(gray);
          const sharpened = this.sharpen(equalized);
          return { image: sharpened, scale: 1.5 };
        },
        tessParams: {
          tessedit_pageseg_mode: '8',
          tessedit_ocr_engine_mode: '1',
          tessedit_char_whitelist: whitelist,
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        },
        minConfidence: 65,
        minWordCount: 2,
      },
      {
        name: 'denoise_psm6_scale_1.2',
        preprocess: (input) => {
          const scaled = this.scaleImage(input, 1.2);
          const gray = scaled.cvtColor(CV.COLOR_BGR2GRAY);
          const denoised = gray.gaussianBlur(new CV.Size(3, 3), 1.1);
          const thresh = denoised.adaptiveThreshold(255, CV.ADAPTIVE_THRESH_GAUSSIAN_C, CV.THRESH_BINARY, 15, 2);
          return { image: thresh, scale: 1.2 };
        },
        tessParams: {
          tessedit_pageseg_mode: '6',
          tessedit_ocr_engine_mode: '1',
          tessedit_char_whitelist: whitelist,
          user_defined_dpi: '280',
        },
        minConfidence: 60,
        minWordCount: 2,
      },
      {
        name: 'edge_psm7_scale_1.8',
        preprocess: (input) => {
          const scaled = this.scaleImage(input, 1.8);
          const gray = scaled.cvtColor(CV.COLOR_BGR2GRAY);
          const bilateral = gray.bilateralFilter(7, 75, 75);
          const edges = bilateral.canny(60, 120);
          const morphKernel = CV.getStructuringElement(CV.MORPH_RECT, new CV.Size(2, 2));
          const enhanced = edges.morphologyEx(CV.MORPH_CLOSE, morphKernel);
          return { image: enhanced, scale: 1.8 };
        },
        tessParams: {
          tessedit_pageseg_mode: '7',
          tessedit_ocr_engine_mode: '1',
          tessedit_char_whitelist: whitelist,
          tessedit_char_blacklist: '@{}',
          user_defined_dpi: '320',
        },
        minConfidence: 55,
      },
      {
        name: 'ui_color_psm13',
        preprocess: (input) => {
          const enhanced = this.enhanceUiColors(input);
          const scale = 1.4;
          const resized = this.scaleImage(enhanced, scale);
          const lab = resized.cvtColor(CV.COLOR_BGR2LAB);
          const channels = lab.split();
          const clahe = new CV.CLAHE(2, new CV.Size(8, 8));
          channels[0] = clahe.apply(channels[0]);
          const merged = CV.merge(channels);
          const backToBgr = merged.cvtColor(CV.COLOR_Lab2BGR);
          const gray = backToBgr.cvtColor(CV.COLOR_BGR2GRAY);
          return { image: gray, scale };
        },
        tessParams: {
          tessedit_pageseg_mode: '13',
          tessedit_ocr_engine_mode: '1',
          tessedit_char_whitelist: whitelist,
          preserve_interword_spaces: '1',
          user_defined_dpi: '260',
        },
        minConfidence: 50,
      },
      {
        name: 'ui_buttons_psm8',
        preprocess: (input) => {
          const scaled = this.scaleImage(input, 1.3);
          const gray = scaled.cvtColor(CV.COLOR_BGR2GRAY);
          const median = gray.medianBlur(3);
          const thresh = median.adaptiveThreshold(
            255,
            CV.ADAPTIVE_THRESH_MEAN_C,
            CV.THRESH_BINARY_INV,
            21,
            4,
          );
          const kernel = CV.getStructuringElement(CV.MORPH_RECT, new CV.Size(3, 3));
          const closed = thresh.morphologyEx(CV.MORPH_CLOSE, kernel);
          const combined = CV.bitwiseOr(closed, median);
          return { image: combined, scale: 1.3 };
        },
        tessParams: {
          tessedit_pageseg_mode: '8',
          tessedit_ocr_engine_mode: '1',
          tessedit_char_whitelist: whitelist,
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        },
        minConfidence: 55,
        minWordCount: 1,
      },
    ];
  }

  private scaleImage(mat: any, scale: number): any {
    if (scale === 1) {
      return this.cloneMat(mat);
    }
    const size = new CV.Size(Math.max(1, Math.round(mat.cols * scale)), Math.max(1, Math.round(mat.rows * scale)));
    return mat.resize(size, 0, 0, CV.INTER_CUBIC);
  }

  private sharpen(mat: any): any {
    const kernel = new CV.Mat(
      [
        [0, -1, 0],
        [-1, 5, -1],
        [0, -1, 0],
      ],
      CV.CV_32F,
    );
    return mat.filter2D(kernel);
  }

  private enhanceUiColors(mat: any): any {
    const blurred = mat.gaussianBlur(new CV.Size(3, 3), 0);
    const sharpened = this.sharpen(blurred);
    return CV.addWeighted(sharpened, 1.2, mat, -0.2, 0);
  }

  private cloneMat(mat: any): any {
    if (!mat) {
      return mat;
    }

    if (typeof mat.copy === 'function') {
      return mat.copy();
    }

    if (typeof mat.clone === 'function') {
      return mat.clone();
    }

    if (!this.cvAvailable || !CV?.Mat) {
      return mat;
    }

    try {
      return new CV.Mat(mat);
    } catch (error) {
      this.debug(`cloneMat fallback failed: ${(error as Error)?.message ?? error}`);
      return mat;
    }
  }

  private wordsToElements(
    words: WordLike[],
    offsetX: number,
    offsetY: number,
    scale: number,
    attemptName: string,
  ): DetectedElement[] {
    const elements: DetectedElement[] = [];

    for (const word of words) {
      const confidence = word.confidence ?? 0;
      if (confidence <= 0) {
        continue;
      }

      const rawText = this.cleanRecognizedText(word.text || '');
      if (!rawText) {
        continue;
      }

      const x0 = word.bbox.x0 / scale + offsetX;
      const y0 = word.bbox.y0 / scale + offsetY;
      const x1 = word.bbox.x1 / scale + offsetX;
      const y1 = word.bbox.y1 / scale + offsetY;
      const width = Math.max(1, x1 - x0);
      const height = Math.max(1, y1 - y0);

      elements.push({
        id: this.generateElementId('ocr'),
        type: this.inferElementType(rawText, width, height),
        coordinates: {
          x: Math.round(x0),
          y: Math.round(y0),
          width: Math.round(width),
          height: Math.round(height),
          centerX: Math.round(x0 + width / 2),
          centerY: Math.round(y0 + height / 2),
        },
        confidence: Math.max(0, Math.min(confidence / 100, 1)),
        text: rawText,
        description: `Text element: "${rawText}"`,
        metadata: {
          detectionMethod: 'ocr',
          ocrConfidence: confidence,
          ocrAttempt: attemptName,
        },
      });
    }

    return elements;
  }

  private scoreAttempt(words: WordLike[]): number {
    if (words.length === 0) {
      return 0;
    }
    const avgConfidence = words.reduce((sum, w) => sum + (w.confidence ?? 0), 0) / words.length;
    const uniqueTexts = new Set(words.map((w) => this.cleanRecognizedText(w.text || '').toLowerCase())).size;
    return avgConfidence * 0.7 + uniqueTexts * 5;
  }

  private async advancedDetect(
    screenshotBuffer: Buffer,
    region?: BoundingBox,
  ): Promise<DetectedElement[]> {
    const worker = await this.getWorker();
    const baseImage = this.advancedDecode(screenshotBuffer);
    const { image: cropped, offsetX, offsetY } = this.cropToRegion(baseImage, region);

    const attempts = this.buildAttempts();
    const attemptResults: {
      config: OCRAttemptConfig;
      words: WordLike[];
      score: number;
      scale: number;
      durationMs: number;
    }[] = [];

    for (const attempt of attempts) {
      try {
        const startedAt = Date.now();
        const { image: processed, scale = 1 } = attempt.preprocess(this.cloneMat(cropped));
        const encoded = CV.imencode('.png', processed);

        const workerAny = worker as any;
        if (typeof workerAny.setParameters === 'function') {
          await workerAny.setParameters(attempt.tessParams);
        }
        const { data } = await worker.recognize(encoded);

        const words: WordLike[] = (data?.words ?? [])
          .filter((word) => (word.confidence ?? 0) >= attempt.minConfidence)
          .map((word) => ({
            text: word.text || '',
            confidence: word.confidence ?? 0,
            bbox: {
              x0: word.bbox.x0,
              y0: word.bbox.y0,
              x1: word.bbox.x1,
              y1: word.bbox.y1,
            },
          }));

        const score = this.scoreAttempt(words);

        const durationMs = Date.now() - startedAt;

        if (words.length > 0 || (attempt.minWordCount && words.length >= attempt.minWordCount)) {
          attemptResults.push({ config: attempt, words, score, scale, durationMs });
        } else if (this.debugEnabled) {
          this.debug(
            `Attempt ${attempt.name} produced no usable words (score=${score.toFixed(2)}, duration=${durationMs}ms)`,
          );
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(`OCR attempt ${attempt.name} failed: ${(error as Error).message}`);
      }
    }

    if (attemptResults.length === 0) {
      if (this.debugEnabled) {
        this.debug('All advanced OCR attempts failed; falling back to basic pipeline.');
      }
      return this.basicDetect(screenshotBuffer, region);
    }

    attemptResults.sort((a, b) => b.score - a.score);
    const best = attemptResults[0];

    if (this.debugEnabled) {
      const { config, score, durationMs, words } = best;
      this.debug(
        `Selected OCR attempt ${config.name} score=${score.toFixed(2)} duration=${durationMs}ms words=${words.length}`,
      );
    }

    const deduped = this.deduplicateWords(best.words);
    return this.wordsToElements(deduped, offsetX, offsetY, best.scale ?? 1, best.config.name);
  }

  private deduplicateWords(words: WordLike[]): WordLike[] {
    const seen = new Map<string, WordLike>();
    for (const word of words) {
      const key = `${Math.round(word.bbox.x0 / 5)}-${Math.round(word.bbox.y0 / 5)}-${this.cleanRecognizedText(word.text || '').toLowerCase()}`;
      const existing = seen.get(key);
      if (!existing || (word.confidence ?? 0) > (existing.confidence ?? 0)) {
        seen.set(key, word);
      }
    }
    return [...seen.values()];
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
      'download',
    ];

    if (buttonKeywords.some((keyword) => lowerText.includes(keyword))) {
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

  private debug(message: string): void {
    if (!this.debugEnabled) {
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`[OCRDetector] ${message}`);
  }
}
