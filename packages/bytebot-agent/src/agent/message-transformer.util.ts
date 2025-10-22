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
import { MessageContentBlock, MessageContentType, ImageContentBlock, ToolResultContentBlock } from '@bytebot/shared';
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
  logger.log(`📝 NON-VISION MODEL: Transforming images to text descriptions for ${messages.length} messages`);

  let imageCount = 0;
  let transformedCount = 0;

  // Deep clone messages to avoid mutating original data
  const transformedMessages = messages.map((message) => {
    const contentBlocks = message.content as MessageContentBlock[];

    // Transform content blocks
    const transformedContent = contentBlocks.map((block) => {
      // Handle top-level images
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

      // Handle images nested in ToolResult blocks (from computer_screenshot, etc.)
      if (block.type === MessageContentType.ToolResult) {
        const toolResult = block as ToolResultContentBlock;
        const transformedToolContent = toolResult.content.map((content) => {
          if (content.type === MessageContentType.Image) {
            imageCount++;
            transformedCount++;

            // Extract metadata if available
            const metadata = extractImageMetadata(content as ImageContentBlock);

            // Generate text description
            const textBlock = generateTextDescription(content as ImageContentBlock, metadata);

            logger.debug(
              `Transformed nested image in ToolResult to text: "${textBlock.text.substring(0, 60)}..."`,
            );

            return textBlock;
          }

          // Preserve all non-image content in ToolResult
          return content;
        });

        // Return ToolResult with transformed content
        return {
          ...toolResult,
          content: transformedToolContent,
        };
      }

      // Preserve all other blocks unchanged
      return block;
    });

    // Return new message object with transformed content
    return {
      ...message,
      content: transformedContent as any,
    };
  });

  if (transformedCount > 0) {
    logger.log(
      `📝 NON-VISION MODEL: ✓ Transformed ${transformedCount} image block(s) to text descriptions. ` +
      `Model will receive text like "[Screenshot captured at HH:MM:SS...]" instead of actual images.`,
    );
  } else {
    logger.debug(`📝 NON-VISION MODEL: No images to transform in ${messages.length} messages`);
  }

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
