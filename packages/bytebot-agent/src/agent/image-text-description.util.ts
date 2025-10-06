/**
 * Image-to-text description generator for non-vision models
 *
 * Converts Image content blocks to Text descriptions, enabling non-vision models
 * to understand visual context through structured text descriptions.
 */

import { ImageContentBlock, TextContentBlock, MessageContentType } from '@bytebot/shared';

export interface ImageMetadata {
  description?: string;
  elementCount?: number;
  timestamp?: string;
  resolution?: { width: number; height: number };
  isSOM?: boolean; // Set-of-Mark annotated screenshot
  context?: string; // Additional context about the image
}

/**
 * Generate a text description for an image block
 *
 * @param imageBlock - Image content block to describe
 * @param metadata - Optional metadata about the image
 * @returns Text content block describing the image
 *
 * @example
 * // SOM-annotated screenshot
 * const text = generateTextDescription(imageBlock, {
 *   isSOM: true,
 *   elementCount: 3,
 *   description: "Screenshot with detected elements"
 * });
 * // Result: "[SOM-annotated screenshot with 3 numbered elements - see element list below]"
 *
 * // Regular screenshot
 * const text = generateTextDescription(imageBlock, {
 *   resolution: { width: 1920, height: 1080 },
 *   timestamp: "2025-10-06T18:00:00Z"
 * });
 * // Result: "[Screenshot captured at 18:00:00 - Resolution: 1920x1080]"
 */
export function generateTextDescription(
  imageBlock: ImageContentBlock,
  metadata?: ImageMetadata,
): TextContentBlock {
  let description: string;

  if (metadata?.isSOM && metadata?.elementCount !== undefined) {
    // SOM-annotated screenshot - reference the element list
    description = `[SOM-annotated screenshot with ${metadata.elementCount} numbered elements - see element list below]`;
  } else if (metadata?.resolution) {
    // Regular screenshot with resolution info
    const timeStr = metadata.timestamp
      ? new Date(metadata.timestamp).toLocaleTimeString()
      : 'now';
    description = `[Screenshot captured at ${timeStr} - Resolution: ${metadata.resolution.width}x${metadata.resolution.height}]`;
  } else if (metadata?.description) {
    // Custom description provided
    description = `[Image: ${metadata.description}]`;
  } else if (metadata?.context) {
    // Generic with context
    description = `[Image content: ${metadata.context}]`;
  } else {
    // Fallback generic description
    description = '[Image content - visual representation not available in text mode]';
  }

  return {
    type: MessageContentType.Text,
    text: description,
  };
}

/**
 * Extract metadata from an Image block
 *
 * Images may have metadata stored in custom properties for context-aware descriptions
 *
 * @param imageBlock - Image block to extract metadata from
 * @returns Metadata object if available
 */
export function extractImageMetadata(imageBlock: ImageContentBlock): ImageMetadata | undefined {
  // Check if the image block has custom metadata properties
  const blockWithMetadata = imageBlock as any;

  if (blockWithMetadata.metadata) {
    return blockWithMetadata.metadata as ImageMetadata;
  }

  return undefined;
}

/**
 * Check if an image block is a SOM-annotated screenshot
 *
 * @param imageBlock - Image block to check
 * @returns true if this is a SOM screenshot
 */
export function isSOMImage(imageBlock: ImageContentBlock): boolean {
  const metadata = extractImageMetadata(imageBlock);
  return metadata?.isSOM ?? false;
}
