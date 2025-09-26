import { createWorker, Worker } from 'tesseract.js';
import {
  BoundingBox,
  ClickTarget,
  DetectedElement,
  DetectionConfig,
  ElementType,
} from '../types';

type TemplateDetectorModule = typeof import('../detectors/template/template-detector');
type EdgeDetectorModule = typeof import('../detectors/edge/edge-detector');

type MatLike = {
  cols: number;
  rows: number;
  clone?: () => MatLike;
  copy?: () => MatLike;
  resize?: (size: any, fx?: number, fy?: number, interpolation?: number) => MatLike;
  cvtColor?: (code: number) => MatLike;
  gaussianBlur?: (size: any, sigma: number) => MatLike;
  medianBlur?: (ksize: number) => MatLike;
  bilateralFilter?: (diameter: number, sigmaColor: number, sigmaSpace: number) => MatLike;
  canny?: (threshold1: number, threshold2: number) => MatLike;
  getRegion?: (rect: any) => MatLike;
};

type PreprocessResult = {
  image: MatLike;
  scale: number;
};

type OcrStrategy = {
  name: string;
  preprocess: (source: MatLike) => PreprocessResult | null;
  tessParams: Record<string, string>;
  minConfidence: number;
};

let cv: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  cv = require('opencv4nodejs');
} catch (error) {
  // eslint-disable-next-line no-console
  console.warn(
    '[ElementDetectorService] opencv4nodejs not available. OCR pipeline will degrade gracefully.',
    (error as Error)?.message ?? error,
  );
}

const hasCv = !!cv;
const warnedMessages = new Set<string>();

const warnOnce = (message: string, error?: unknown) => {
  if (warnedMessages.has(message)) {
    return;
  }
  warnedMessages.add(message);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn(`[ElementDetectorService] ${message}: ${(error as Error)?.message ?? error}`);
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[ElementDetectorService] ${message}`);
  }
};

const MIN_WIDTH = 10;
const MIN_HEIGHT = 10;
const DEFAULT_CHAR_WHITELIST =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/\\"\'`~!@#$%^&*()_+={}[]|:;,.?<>';

export class ElementDetectorService {
  private readonly ocrConfidenceEarlyExit = 0.7;
  private worker: Worker | null = null;
  private workerPromise: Promise<Worker> | null = null;
  private templateDetector: InstanceType<TemplateDetectorModule['TemplateDetector']> | null = null;
  private edgeDetector: InstanceType<EdgeDetectorModule['EdgeDetector']> | null = null;
  private templateDetectorLoaded = false;
  private edgeDetectorLoaded = false;

  async detectElements(
    screenshotBuffer: Buffer,
    config: DetectionConfig = this.getDefaultConfig(),
  ): Promise<DetectedElement[]> {
    const detectionPromises: Array<Promise<DetectedElement[]>> = [];

    if (config.enableOCR) {
      detectionPromises.push(this.runOcrPipeline(screenshotBuffer, config.searchRegion));
    }

    if (config.enableTemplateMatching) {
      const templateDetector = await this.getTemplateDetector();
      if (templateDetector) {
        detectionPromises.push(templateDetector.detect(screenshotBuffer, config.searchRegion));
      }
    }

    if (config.enableEdgeDetection) {
      const edgeDetector = await this.getEdgeDetector();
      if (edgeDetector) {
        detectionPromises.push(edgeDetector.detect(screenshotBuffer, config.searchRegion));
      }
    }

    const detectionResults = await Promise.all(detectionPromises);
    const allElements = detectionResults.flat();
    const mergedElements = this.mergeOverlappingElements(allElements);

    return mergedElements.filter((el) => el.confidence >= config.confidenceThreshold);
  }

  async findElementByDescription(
    elements: DetectedElement[],
    description: string,
  ): Promise<DetectedElement | null> {
    const scoredElements = elements.map((element) => ({
      element,
      score: this.calculateDescriptionMatch(element, description),
    }));

    scoredElements.sort((a, b) => b.score - a.score);

    if (scoredElements.length > 0 && scoredElements[0].score > 0.6) {
      return scoredElements[0].element;
    }

    return null;
  }

  async getClickCoordinates(element: DetectedElement): Promise<ClickTarget> {
    const { coordinates } = element;

    let targetX = coordinates.centerX;
    let targetY = coordinates.centerY;

    switch (element.type) {
      case 'input':
        targetX = coordinates.x + coordinates.width * 0.1;
        break;
      case 'dropdown':
        targetX = coordinates.x + coordinates.width * 0.9;
        break;
      default:
        break;
    }

    const fallbackCoordinates = [
      { x: coordinates.centerX, y: coordinates.centerY },
      { x: coordinates.x + 10, y: coordinates.y + 10 },
      { x: coordinates.x + coordinates.width - 10, y: coordinates.centerY },
    ];

    return {
      coordinates: { x: Math.round(targetX), y: Math.round(targetY) },
      confidence: element.confidence,
      method: element.metadata.detectionMethod,
      fallbackCoordinates,
    };
  }

  async cleanup(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.workerPromise = null;
    }
  }

  private async runOcrPipeline(
    screenshotBuffer: Buffer,
    region?: BoundingBox,
  ): Promise<DetectedElement[]> {
    if (!Buffer.isBuffer(screenshotBuffer) || screenshotBuffer.length === 0) {
      warnOnce('Received invalid screenshot buffer for OCR processing');
      return [];
    }

    const worker = await this.getWorker();
    if (!worker) {
      warnOnce('Tesseract worker unavailable; OCR step skipped');
      return [];
    }

    const decoded = this.decodeImage(screenshotBuffer);
    if (!decoded) {
      return [];
    }

    const regionResult = this.extractRegion(decoded, region);
    if (!regionResult) {
      return [];
    }

    const { image: regionMat, offsetX, offsetY } = regionResult;
    if (!this.isValidSize(regionMat)) {
      return [];
    }

    const strategies = this.buildStrategies();
    const attemptResults: {
      name: string;
      elements: DetectedElement[];
      averageConfidence: number;
    }[] = [];

    for (const strategy of strategies) {
      try {
        const processed = strategy.preprocess(regionMat);
        if (!processed || !this.isValidSize(processed.image)) {
          continue;
        }

        const encoded = this.encodeMat(processed.image);
        if (!encoded) {
          continue;
        }

        const workerAny = worker as Worker & {
          setParameters?: (params: Record<string, string>) => Promise<void>;
        };

        if (typeof workerAny.setParameters === 'function') {
          await workerAny.setParameters(strategy.tessParams);
        }

        const { data } = await worker.recognize(encoded);
        const words = (data?.words ?? []).filter(
          (word) => (word.confidence ?? 0) >= strategy.minConfidence,
        );
        if (words.length === 0) {
          continue;
        }

        const elements = this.wordsToElements(
          words,
          offsetX,
          offsetY,
          processed.scale,
          strategy.name,
        );

        if (elements.length === 0) {
          continue;
        }

        const averageConfidence =
          elements.reduce((sum, element) => sum + element.confidence, 0) / elements.length;

        attemptResults.push({ name: strategy.name, elements, averageConfidence });

        if (averageConfidence >= this.ocrConfidenceEarlyExit) {
          break;
        }
      } catch (error) {
        warnOnce(`OCR strategy ${strategy.name} failed`, error);
        continue;
      }
    }

    if (attemptResults.length === 0) {
      return [];
    }

    attemptResults.sort((a, b) => b.averageConfidence - a.averageConfidence);
    return attemptResults[0].elements;
  }

  private buildStrategies(): OcrStrategy[] {
    if (!hasCv) {
      return [
        {
          name: 'basic_psm8',
          preprocess: (source) => ({ image: this.safeClone(source) ?? source, scale: 1 }),
          tessParams: {
            tessedit_pageseg_mode: '8',
            tessedit_char_whitelist: DEFAULT_CHAR_WHITELIST,
            preserve_interword_spaces: '1',
            user_defined_dpi: '300',
          },
          minConfidence: 65,
        },
      ];
    }

    return [
      {
        name: 'clahe_psm8_scale_1.5',
        preprocess: (source) => {
          const base = this.safeClone(source) ?? source;
          const scaled = this.scaleMat(base, 1.5);
          const gray = this.toGray(scaled);
          const claheApplied = this.applyClahe(gray, 2, 8);
          const sharpened = this.applySharpen(claheApplied);
          return { image: sharpened, scale: 1.5 };
        },
        tessParams: {
          tessedit_pageseg_mode: '8',
          tessedit_char_whitelist: DEFAULT_CHAR_WHITELIST,
          preserve_interword_spaces: '1',
          user_defined_dpi: '320',
        },
        minConfidence: 65,
      },
      {
        name: 'denoise_psm6_scale_1.2',
        preprocess: (source) => {
          const base = this.safeClone(source) ?? source;
          const scaled = this.scaleMat(base, 1.2);
          const gray = this.toGray(scaled);
          const denoised = this.applyDenoising(gray);
          return { image: denoised, scale: 1.2 };
        },
        tessParams: {
          tessedit_pageseg_mode: '6',
          tessedit_char_whitelist: DEFAULT_CHAR_WHITELIST,
          user_defined_dpi: '300',
        },
        minConfidence: 60,
      },
      {
        name: 'edge_psm7_scale_1.8',
        preprocess: (source) => {
          const base = this.safeClone(source) ?? source;
          const scaled = this.scaleMat(base, 1.8);
          const gray = this.toGray(scaled);
          const edges = this.applyEdgeDetection(gray);
          return { image: edges, scale: 1.8 };
        },
        tessParams: {
          tessedit_pageseg_mode: '7',
          tessedit_char_whitelist: DEFAULT_CHAR_WHITELIST,
          tessedit_char_blacklist: '@{}',
          user_defined_dpi: '340',
        },
        minConfidence: 55,
      },
      {
        name: 'basic_psm8',
        preprocess: (source) => ({ image: this.safeClone(source) ?? source, scale: 1 }),
        tessParams: {
          tessedit_pageseg_mode: '8',
          tessedit_char_whitelist: DEFAULT_CHAR_WHITELIST,
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        },
        minConfidence: 65,
      },
    ];
  }

  private decodeImage(buffer: Buffer): MatLike | null {
    if (!hasCv) {
      return null;
    }
    try {
      return cv.imdecode(buffer);
    } catch (error) {
      warnOnce('Failed to decode screenshot buffer', error);
      return null;
    }
  }

  private extractRegion(
    mat: MatLike,
    region?: BoundingBox,
  ): { image: MatLike; offsetX: number; offsetY: number } | null {
    if (!hasCv) {
      return { image: mat, offsetX: 0, offsetY: 0 };
    }

    if (!region) {
      const clone = this.safeClone(mat);
      return { image: clone ?? mat, offsetX: 0, offsetY: 0 };
    }

    const x = Math.max(0, Math.floor(region.x));
    const y = Math.max(0, Math.floor(region.y));
    const width = Math.max(1, Math.floor(region.width));
    const height = Math.max(1, Math.floor(region.height));

    if (mat.cols < x + width || mat.rows < y + height) {
      warnOnce('Requested OCR region exceeds screenshot bounds');
      return null;
    }

    try {
      if (typeof (mat as any).getRegion !== 'function') {
        warnOnce('Mat#getRegion unavailable; using full image for OCR');
        const clone = this.safeClone(mat);
        return { image: clone ?? mat, offsetX: 0, offsetY: 0 };
      }
      const rect = new cv.Rect(x, y, width, height);
      const roi = (mat as any).getRegion(rect);
      const clone = this.safeClone(roi);
      return { image: clone ?? roi, offsetX: x, offsetY: y };
    } catch (error) {
      warnOnce('Failed to extract OCR region', error);
      return null;
    }
  }

  private isValidSize(mat: MatLike): boolean {
    if (!mat || typeof mat.cols !== 'number' || typeof mat.rows !== 'number') {
      return false;
    }
    if (mat.cols < MIN_WIDTH || mat.rows < MIN_HEIGHT) {
      return false;
    }
    return true;
  }

  private safeClone(mat: MatLike | null | undefined): MatLike | null {
    if (!mat) {
      return null;
    }
    try {
      if (typeof mat.clone === 'function') {
        return mat.clone();
      }
      if (typeof mat.copy === 'function') {
        return mat.copy();
      }
      if (hasCv && cv?.Mat) {
        return new cv.Mat(mat);
      }
    } catch (error) {
      warnOnce('Mat clone failed', error);
    }
    return null;
  }

  private scaleMat(mat: MatLike, scale: number): MatLike {
    if (!hasCv || typeof mat.resize !== 'function' || scale === 1) {
      const clone = this.safeClone(mat);
      return clone ?? mat;
    }
    const width = Math.max(1, Math.round(mat.cols * scale));
    const height = Math.max(1, Math.round(mat.rows * scale));
    try {
      const size = new cv.Size(width, height);
      return mat.resize(size, 0, 0, cv.INTER_CUBIC ?? 0);
    } catch (error) {
      warnOnce('Mat resize failed', error);
      const clone = this.safeClone(mat);
      return clone ?? mat;
    }
  }

  private toGray(mat: MatLike): MatLike {
    if (!hasCv || typeof mat.cvtColor !== 'function') {
      return mat;
    }
    try {
      return mat.cvtColor(cv.COLOR_BGR2GRAY ?? cv.COLOR_RGB2GRAY ?? 6);
    } catch (error) {
      warnOnce('cvtColor to grayscale failed', error);
      return mat;
    }
  }

  private applyClahe(mat: MatLike, clipLimit: number, tileGridSize: number): MatLike {
    if (!hasCv) {
      return mat;
    }
    try {
      const clahe = new cv.CLAHE(clipLimit, new cv.Size(tileGridSize, tileGridSize));
      return clahe.apply(mat);
    } catch (error) {
      warnOnce('applyCLAHE failed', error);
      return mat;
    }
  }

  private applyDenoising(mat: MatLike): MatLike {
    if (!hasCv) {
      return mat;
    }
    try {
      if (typeof cv.fastNlMeansDenoising === 'function') {
        return cv.fastNlMeansDenoising(mat, 3, 7, 21);
      }
      return mat;
    } catch (error) {
      warnOnce('fastNlMeansDenoising failed', error);
      return mat;
    }
  }

  private applyEdgeDetection(mat: MatLike): MatLike {
    if (!hasCv) {
      return mat;
    }
    try {
      if (typeof mat.canny === 'function') {
        return mat.canny(60, 120);
      }
      if (typeof cv.Canny === 'function') {
        return cv.Canny(mat, 60, 120);
      }
      return mat;
    } catch (error) {
      warnOnce('Canny edge detection failed', error);
      return mat;
    }
  }

  private applySharpen(mat: MatLike): MatLike {
    if (!hasCv) {
      return mat;
    }
    try {
      const kernel = new cv.Mat(
        [
          [0, -1, 0],
          [-1, 5, -1],
          [0, -1, 0],
        ],
        cv.CV_32F ?? 5,
      );
      if (typeof cv.filter2D === 'function') {
        return cv.filter2D(mat, -1, kernel);
      }
      if (typeof (mat as any).filter2D === 'function') {
        return (mat as any).filter2D(kernel);
      }
      return mat;
    } catch (error) {
      warnOnce('filter2D sharpen failed', error);
      return mat;
    }
  }

  private encodeMat(mat: MatLike): Buffer | null {
    if (!hasCv) {
      return null;
    }
    try {
      return cv.imencode('.png', mat);
    } catch (error) {
      warnOnce('Failed to encode processed image for OCR', error);
      return null;
    }
  }

  private wordsToElements(
    words: Array<{ text: string; confidence?: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>,
    offsetX: number,
    offsetY: number,
    scale: number,
    strategyName: string,
  ): DetectedElement[] {
    const elements: DetectedElement[] = [];

    for (const word of words) {
      const confidence = Math.max(0, Math.min((word.confidence ?? 0) / 100, 1));
      if (confidence === 0) {
        continue;
      }

      const rawText = (word.text || '').replace(/\s+/g, ' ').trim();
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
        confidence,
        text: rawText,
        description: `Text element: "${rawText}"`,
        metadata: {
          detectionMethod: 'ocr',
          ocrConfidence: word.confidence ?? confidence * 100,
          ocrAttempt: strategyName,
        },
      });
    }

    return elements;
  }

  private inferElementType(text: string, width: number, height: number): ElementType {
    const lowerText = text.toLowerCase();
    const buttonKeywords = ['install', 'save', 'cancel', 'ok', 'submit', 'login', 'sign in', 'download'];

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

  private calculateDescriptionMatch(element: DetectedElement, description: string): number {
    const desc = description.toLowerCase();
    let score = 0;

    if (element.text) {
      const elementText = element.text.toLowerCase();
      if (elementText.includes(desc) || desc.includes(elementText)) {
        score += 0.8;
      } else {
        score += this.fuzzyMatch(elementText, desc) * 0.6;
      }
    }

    if (desc.includes('button') && element.type === 'button') score += 0.3;
    if (desc.includes('field') && element.type === 'input') score += 0.3;
    if (desc.includes('link') && element.type === 'link') score += 0.3;

    score *= element.confidence;

    return Math.min(score, 1.0);
  }

  private mergeOverlappingElements(elements: DetectedElement[]): DetectedElement[] {
    const merged: DetectedElement[] = [];

    for (const element of elements) {
      const overlapping = merged.find(
        (candidate) => this.calculateOverlap(candidate.coordinates, element.coordinates) > 0.7,
      );

      if (overlapping) {
        if (element.confidence > overlapping.confidence) {
          const index = merged.indexOf(overlapping);
          merged[index] = element;
        }
      } else {
        merged.push(element);
      }
    }

    return merged;
  }

  private calculateOverlap(box1: BoundingBox, box2: BoundingBox): number {
    const xOverlap = Math.max(0, Math.min(box1.x + box1.width, box2.x + box2.width) - Math.max(box1.x, box2.x));
    const yOverlap = Math.max(0, Math.min(box1.y + box1.height, box2.y + box2.height) - Math.max(box1.y, box2.y));
    const overlapArea = xOverlap * yOverlap;
    const totalArea = box1.width * box1.height + box2.width * box2.height - overlapArea;

    if (totalArea === 0) {
      return 0;
    }

    return overlapArea / totalArea;
  }

  private fuzzyMatch(text1: string, text2: string): number {
    const longer = text1.length > text2.length ? text1 : text2;
    const shorter = text1.length > text2.length ? text2 : text1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1,
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  private getDefaultConfig(): DetectionConfig {
    return {
      enableOCR: true,
      enableTemplateMatching: true,
      enableEdgeDetection: true,
      confidenceThreshold: 0.5,
    };
  }

  private async getWorker(): Promise<Worker | null> {
    if (this.worker) {
      return this.worker;
    }

    if (!this.workerPromise) {
      this.workerPromise = this.createWorker();
    }

    try {
      this.worker = await this.workerPromise;
    } catch (error) {
      warnOnce('Failed to initialise Tesseract worker', error);
      this.worker = null;
      this.workerPromise = null;
    }

    return this.worker;
  }

  private async createWorker(): Promise<Worker> {
    const worker = await createWorker();
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    return worker;
  }

  private async getTemplateDetector() {
    if (this.templateDetectorLoaded) {
      return this.templateDetector;
    }
    this.templateDetectorLoaded = true;
    try {
      const module: TemplateDetectorModule = await import('../detectors/template/template-detector');
      this.templateDetector = new module.TemplateDetector();
    } catch (error) {
      warnOnce('Template detector unavailable', error);
      this.templateDetector = null;
    }
    return this.templateDetector;
  }

  private async getEdgeDetector() {
    if (this.edgeDetectorLoaded) {
      return this.edgeDetector;
    }
    this.edgeDetectorLoaded = true;
    try {
      const module: EdgeDetectorModule = await import('../detectors/edge/edge-detector');
      this.edgeDetector = new module.EdgeDetector();
    } catch (error) {
      warnOnce('Edge detector unavailable', error);
      this.edgeDetector = null;
    }
    return this.edgeDetector;
  }
}
