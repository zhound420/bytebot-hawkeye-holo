/**
 * Token Estimation Utility
 * Provides rough token count estimates for messages to prevent context window overflow
 */

import { Message } from '@prisma/client';
import { MessageContentBlock, MessageContentType } from '@bytebot/shared';

/**
 * Estimate tokens for a text string
 * Rule of thumb: ~4 characters per token for English text
 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for an image
 * Claude Vision models use ~1600 tokens for a 1920x1080 image
 * Scales approximately with pixel count
 */
export function estimateImageTokens(
  width: number = 1920,
  height: number = 1080,
): number {
  // Base estimate: 1600 tokens for 1920x1080 (2,073,600 pixels)
  const basePixels = 1920 * 1080;
  const actualPixels = width * height;
  const baseTokens = 1600;

  // Scale linearly with pixel count
  return Math.ceil((actualPixels / basePixels) * baseTokens);
}

/**
 * Estimate tokens for a single content block
 */
export function estimateContentBlockTokens(block: MessageContentBlock): number {
  switch (block.type) {
    case MessageContentType.Text:
      return estimateTextTokens(block.text || '');

    case MessageContentType.Image:
      // Assume standard screenshot dimensions if not specified
      // Most screenshots are 1920x1080 or smaller
      return estimateImageTokens(1920, 1080);

    case MessageContentType.ToolUse:
      // Tool use blocks include name + input parameters (JSON)
      const toolName = (block as any).name || '';
      const toolInput = JSON.stringify((block as any).input || {});
      return estimateTextTokens(toolName + toolInput);

    case MessageContentType.ToolResult:
      // Tool result blocks can contain text, images, or documents
      const content = (block as any).content || [];
      return content.reduce(
        (sum: number, c: any) => sum + estimateContentBlockTokens(c),
        0,
      );

    case MessageContentType.Document:
      // Documents are usually text files
      const docContent = (block as any).content || '';
      return estimateTextTokens(docContent);

    default:
      // Unknown block type, assume minimal tokens
      return 10;
  }
}

/**
 * Estimate tokens for a complete message
 */
export function estimateMessageTokens(message: Message): number {
  const content = message.content as MessageContentBlock[];
  if (!Array.isArray(content)) {
    return 0;
  }

  return content.reduce(
    (sum, block) => sum + estimateContentBlockTokens(block),
    0,
  );
}

/**
 * Estimate total tokens for an array of messages
 */
export function estimateTotalTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

/**
 * Check if adding a new message would exceed the context window threshold
 * Returns true if safe to add, false if would exceed
 */
export function canAddMessage(
  currentMessages: Message[],
  newMessageTokens: number,
  contextWindow: number,
  thresholdPercent: number = 0.75,
): boolean {
  const currentTokens = estimateTotalTokens(currentMessages);
  const threshold = contextWindow * thresholdPercent;
  return currentTokens + newMessageTokens <= threshold;
}

/**
 * Compress screenshot by downsampling resolution
 * Returns suggested dimensions to reduce token usage
 */
export function compressScreenshotDimensions(
  originalWidth: number,
  originalHeight: number,
  targetTokens: number,
): { width: number; height: number; tokenSavings: number } {
  const originalTokens = estimateImageTokens(originalWidth, originalHeight);

  if (originalTokens <= targetTokens) {
    // No compression needed
    return {
      width: originalWidth,
      height: originalHeight,
      tokenSavings: 0,
    };
  }

  // Calculate scale factor to achieve target tokens
  const scaleFactor = Math.sqrt(targetTokens / originalTokens);

  const newWidth = Math.floor(originalWidth * scaleFactor);
  const newHeight = Math.floor(originalHeight * scaleFactor);
  const newTokens = estimateImageTokens(newWidth, newHeight);

  return {
    width: newWidth,
    height: newHeight,
    tokenSavings: originalTokens - newTokens,
  };
}

/**
 * Calculate optimal image compression settings for Smart Focus stages
 */
export function getSmartFocusCompressionSettings(
  stage: 'overview' | 'region' | 'focused',
): { maxWidth: number; maxHeight: number; quality: number } {
  switch (stage) {
    case 'overview':
      // Overview stage: Heavy compression for broad view
      // ~400 tokens (75% reduction from 1600)
      return { maxWidth: 960, maxHeight: 540, quality: 0.7 };

    case 'region':
      // Region stage: Moderate compression for zoomed region
      // ~800 tokens (50% reduction)
      return { maxWidth: 1280, maxHeight: 720, quality: 0.8 };

    case 'focused':
      // Focused stage: Minimal compression for precision
      // ~1200 tokens (25% reduction)
      return { maxWidth: 1600, maxHeight: 900, quality: 0.9 };

    default:
      // Default: No compression
      return { maxWidth: 1920, maxHeight: 1080, quality: 1.0 };
  }
}
