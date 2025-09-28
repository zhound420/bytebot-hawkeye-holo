type CvModule = Record<string, any>;

type LoadState = {
  module: CvModule | null;
  errorMessage: string | null;
};

type WarnTarget = Pick<Console, 'warn'> | { warn: (...args: any[]) => unknown };

let cachedState: LoadState | null = null;
const warnedContexts = new Set<string>();

function applyClahePolyfill(cv: CvModule | null): void {
  if (!cv) {
    return;
  }

  const claheCtor = (cv as any).CLAHE;
  if (typeof claheCtor !== 'function') {
    return;
  }

  const ensureFactory = (target: Record<string, any>) => {
    if (typeof target.createCLAHE !== 'function') {
      target.createCLAHE = (...args: any[]) => new claheCtor(...args);
    }
  };

  ensureFactory(cv as Record<string, any>);

  if (!(cv as any).imgproc) {
    (cv as any).imgproc = {};
  }
  ensureFactory((cv as any).imgproc);

  if (!(cv as any).xphoto) {
    (cv as any).xphoto = {};
  }
  ensureFactory((cv as any).xphoto);

  if (!(cv as any).ximgproc) {
    (cv as any).ximgproc = {};
  }
  ensureFactory((cv as any).ximgproc);
}

function ensureState(): LoadState {
  if (cachedState) {
    return cachedState;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const module = require('opencv4nodejs') as CvModule;
    applyClahePolyfill(module);
    cachedState = { module, errorMessage: null };
  } catch (error) {
    cachedState = { module: null, errorMessage: formatLoadError(error) };
  }

  return cachedState;
}

export function getOpenCvModule(): CvModule | null {
  return ensureState().module;
}

export function hasOpenCv(): boolean {
  return ensureState().module !== null;
}

export function getOpenCvErrorMessage(): string | null {
  return ensureState().errorMessage;
}

export function refreshOpenCvModule(): CvModule | null {
  cachedState = null;
  return getOpenCvModule();
}

export function logOpenCvWarning(
  context: string,
  target: WarnTarget = console,
): void {
  const state = ensureState();

  if (state.module || !state.errorMessage || warnedContexts.has(context)) {
    return;
  }

  warnedContexts.add(context);
  const message = `[${context}] ${state.errorMessage}`;

  if (typeof (target as Console).warn === 'function') {
    (target as Console).warn(message);
    return;
  }

  if (typeof (target as { warn?: (...args: any[]) => unknown }).warn === 'function') {
    (target as { warn?: (...args: any[]) => unknown }).warn!(message);
  }
}

function formatLoadError(error: unknown): string {
  const unavailableMessage =
    'OpenCV native bindings (opencv4nodejs) unavailable; vision features will degrade.';

  if (!error) {
    return unavailableMessage;
  }

  if (typeof error === 'string') {
    return `${unavailableMessage} ${stripRequireStack(error)}`.trim();
  }

  const err = error as NodeJS.ErrnoException;

  if (err.code === 'MODULE_NOT_FOUND') {
    return `${unavailableMessage} Module not found in the current runtime.`;
  }

  const detail = stripRequireStack(err.message ?? String(error));
  const codeSuffix = err.code ? ` (${err.code})` : '';

  if (!detail) {
    return `${unavailableMessage}${codeSuffix}`.trim();
  }

  return `Failed to initialise OpenCV native bindings${codeSuffix}: ${detail}`;
}

function stripRequireStack(message: string): string {
  if (!message) {
    return '';
  }

  const [firstLine] = message.split('\n');
  return firstLine?.trim() ?? '';
}
