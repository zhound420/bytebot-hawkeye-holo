/**
 * Message transformer for hybrid vision/non-vision model support
 *
 * Transforms message content to replace Image blocks with Text descriptions
 * for non-vision models, while preserving all other content unchanged.
 *
 * **Architecture:**
 * - Database: Always stores full messages with images (for UI display)
 * - API Transform: Replaces images with text for non-vision models
 * - UI Display: Always shows images (reads from database)
 *
 * This separation enables users to see visual artifacts while non-vision
 * models receive structured text descriptions.
 */

import { Message } from '@prisma/client';
import { MessageContentBlock, MessageContentType, ImageContentBlock } from '@bytebot/shared';
import { generateTextDescription, extractImageMetadata } from './image-text-description.util';
import { Logger } from '@nestjs/common';

const logger = new Logger('MessageTransformer');

/**
 * Transform messages for non-vision models
 *
 * Replaces all Image content blocks with Text descriptions while preserving
 * all other content (text, tool_use, tool_result, etc.)
 *
 * @param messages - Original messages from database
 * @returns Transformed messages with images replaced by text
 *
 * @example
 * const messages = await messagesService.findUnsummarized(taskId);
 * const transformed = transformImagesForNonVision(messages);
 * // Now transformed messages have no Image blocks, only Text descriptions
 */
export function transformImagesForNonVision(messages: Message[]): Message[] {
  logger.debug(`Transforming ${messages.length} messages for non-vision model`);

  let imageCount = 0;
  let transformedCount = 0;

  // Deep clone messages to avoid mutating original data
  const transformedMessages = messages.map((message) => {
    const contentBlocks = message.content as MessageContentBlock[];

    // Transform content blocks
    const transformedContent = contentBlocks.map((block) => {
      if (block.type === MessageContentType.Image) {
        imageCount++;
        transformedCount++;

        // Extract metadata if available
        const metadata = extractImageMetadata(block as ImageContentBlock);

        // Generate text description
        const textBlock = generateTextDescription(block as ImageContentBlock, metadata);

        logger.debug(
          `Transformed image to text: "${textBlock.text.substring(0, 60)}..."`,
        );

        return textBlock;
      }

      // Preserve all non-image blocks
      return block;
    });

    // Return new message object with transformed content
    return {
      ...message,
      content: transformedContent as any,
    };
  });

  logger.log(
    `Transformed ${transformedCount} image blocks in ${messages.length} messages for non-vision model`,
  );

  return transformedMessages;
}

/**
 * Check if messages contain any images
 *
 * @param messages - Messages to check
 * @returns true if any message contains an Image block
 */
export function containsImages(messages: Message[]): boolean {
  return messages.some((message) => {
    const contentBlocks = message.content as MessageContentBlock[];
    return contentBlocks.some((block) => block.type === MessageContentType.Image);
  });
}

/**
 * Count total images across all messages
 *
 * @param messages - Messages to count images in
 * @returns Total number of Image blocks
 */
export function countImages(messages: Message[]): number {
  return messages.reduce((count, message) => {
    const contentBlocks = message.content as MessageContentBlock[];
    const messageImages = contentBlocks.filter(
      (block) => block.type === MessageContentType.Image,
    ).length;
    return count + messageImages;
  }, 0);
}
