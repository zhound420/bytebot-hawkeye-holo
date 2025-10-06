/**
 * Vision capability detection for hybrid vision/non-vision model support
 *
 * Determines whether a model can process images or requires text descriptions.
 * This enables the system to support both vision models (GPT-4o, Claude, Gemini)
 * and non-vision models (o3, DeepSeek-R1, Qwen-Plus) with the same workflow.
 */

import { BytebotAgentModel } from './agent.types';

/**
 * Check if a model supports vision/image input
 *
 * @param model - Model metadata with capability information
 * @returns true if model can process images, false if it requires text-only input
 *
 * @example
 * const model = { name: 'gpt-4o', supportsVision: true, ... };
 * supportsVision(model); // true
 *
 * const textModel = { name: 'o3', supportsVision: false, ... };
 * supportsVision(textModel); // false
 */
export function supportsVision(model: BytebotAgentModel): boolean {
  // Default to true for backward compatibility with models that don't specify
  // This ensures existing vision models continue to work without changes
  return model.supportsVision ?? true;
}

/**
 * Get a human-readable description of the model's vision capability
 *
 * @param model - Model metadata
 * @returns Description string for UI display
 *
 * @example
 * getVisionCapabilityDescription(gpt4o); // "Vision-capable (can process images)"
 * getVisionCapabilityDescription(o3); // "Text-only (receives text descriptions)"
 */
export function getVisionCapabilityDescription(model: BytebotAgentModel): string {
  return supportsVision(model)
    ? 'Vision-capable (can process images)'
    : 'Text-only (receives text descriptions)';
}

/**
 * Get an emoji indicator for vision capability
 *
 * @param model - Model metadata
 * @returns Emoji string for compact UI display
 */
export function getVisionCapabilityEmoji(model: BytebotAgentModel): string {
  return supportsVision(model) ? '👁️' : '📝';
}
