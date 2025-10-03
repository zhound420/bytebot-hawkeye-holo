declare module 'tesseract.js' {
  export interface Word {
    text: string;
    confidence?: number;
    bbox: { x0: number; x1: number; y0: number; y1: number };
  }

  export interface RecognizeResult {
    data: {
      text: string;
      confidence: number;
      words?: Word[];
    };
  }

  export interface Worker {
    load(): Promise<void>;
    loadLanguage(lang: string): Promise<void>;
    initialize(lang: string): Promise<void>;
    recognize(image: Buffer | string, options?: Record<string, unknown>): Promise<RecognizeResult>;
    terminate(): Promise<void>;
  }

  export function createWorker(options?: Record<string, unknown>): Promise<Worker>;
}
