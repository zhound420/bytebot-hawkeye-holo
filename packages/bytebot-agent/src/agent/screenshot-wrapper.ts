/**
 * Screenshot wrapper for bytebotd service
 *
 * Simple wrapper around bytebotd screenshot endpoints.
 * Note: SOM (Set-of-Mark) enhancement happens at detection time, not screenshot time.
 */

import { Logger } from '@nestjs/common';

const logger = new Logger('ScreenshotWrapper');

export interface ScreenshotOptions {
  gridOverlay?: boolean;
  gridSize?: number;
  highlightRegions?: boolean;
  showCursor?: boolean;
  progressStep?: number;
  progressMessage?: string;
  progressTaskId?: string;
  markTarget?: {
    coordinates: { x: number; y: number };
    label?: string;
  };
}

export interface ScreenshotResult {
  image: string; // Base64 image
  offset?: { x: number; y: number };
  region?: { x: number; y: number; width: number; height: number };
  zoomLevel?: number;
}

const BYTEBOT_DESKTOP_BASE_URL = process.env.BYTEBOT_DESKTOP_BASE_URL as string;

/**
 * Fetch screenshot from bytebotd
 */
export async function getScreenshot(
  options?: ScreenshotOptions,
): Promise<ScreenshotResult> {
  logger.debug('Taking screenshot');

  try {
    const response = await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'screenshot',
        gridOverlay: options?.gridOverlay ?? undefined,
        gridSize: options?.gridSize ?? undefined,
        highlightRegions: options?.highlightRegions ?? undefined,
        showCursor: options?.showCursor ?? true,
        progressStep: options?.progressStep ?? undefined,
        progressMessage: options?.progressMessage ?? undefined,
        progressTaskId: options?.progressTaskId ?? undefined,
        markTarget: options?.markTarget ?? undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`Screenshot failed: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      image: data.image,
      offset: data.offset,
    };
  } catch (error) {
    logger.error('Error in screenshot action:', error);
    throw error;
  }
}

/**
 * Fetch region screenshot from bytebotd
 */
export async function getScreenshotRegion(
  input: {
    region: 'top-left' | 'top-center' | 'top-right' | 'center-left' | 'center' | 'center-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
    gridSize?: number;
    enhance?: boolean;
    includeOffset?: boolean;
    addHighlight?: boolean;
    showCursor?: boolean;
    progressStep?: number;
    progressMessage?: string;
    progressTaskId?: string;
    zoomLevel?: number | null;
  },
): Promise<ScreenshotResult> {
  logger.debug(`Taking focused screenshot for region: ${input.region}`);

  try {
    const response = await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'screenshot_region',
        region: input.region,
        gridSize: input.gridSize ?? undefined,
        enhance: input.enhance ?? undefined,
        includeOffset: input.includeOffset ?? undefined,
        addHighlight: input.addHighlight ?? undefined,
        showCursor: input.showCursor ?? true,
        progressStep: input.progressStep ?? undefined,
        progressMessage: input.progressMessage ?? undefined,
        progressTaskId: input.progressTaskId ?? undefined,
        zoomLevel: input.zoomLevel ?? undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`Screenshot region failed: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      image: data.image,
      offset: data.offset,
      region: data.region,
      zoomLevel: data.zoomLevel,
    };
  } catch (error) {
    logger.error('Error in screenshot_region action:', error);
    throw error;
  }
}

/**
 * Fetch custom region screenshot from bytebotd
 */
export async function getScreenshotCustomRegion(
  input: {
    x: number;
    y: number;
    width: number;
    height: number;
    gridSize?: number;
    zoomLevel?: number | null;
    includeOffset?: boolean;
    progressStep?: number;
    progressMessage?: string;
    progressTaskId?: string;
  },
): Promise<ScreenshotResult> {
  logger.debug(
    `Taking custom region screenshot at (${input.x}, ${input.y}) ${input.width}x${input.height}`,
  );

  try {
    const response = await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'screenshot_custom_region',
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
        gridSize: input.gridSize ?? undefined,
        zoomLevel: input.zoomLevel ?? undefined,
        includeOffset: input.includeOffset ?? undefined,
        progressStep: input.progressStep ?? undefined,
        progressMessage: input.progressMessage ?? undefined,
        progressTaskId: input.progressTaskId ?? undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`Screenshot custom region failed: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      image: data.image,
      offset: data.offset,
      region: { x: input.x, y: input.y, width: input.width, height: input.height },
      zoomLevel: data.zoomLevel,
    };
  } catch (error) {
    logger.error('Error in screenshot_custom_region action:', error);
    throw error;
  }
}
