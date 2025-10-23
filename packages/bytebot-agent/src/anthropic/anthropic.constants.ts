import { BytebotAgentModel } from '../agent/agent.types';

/**
 * Anthropic Claude Models - Current as of October 2025
 *
 * Anthropic does not provide a /models API endpoint.
 * This list must be manually updated when new models are released.
 */
export const ANTHROPIC_MODELS: BytebotAgentModel[] = [
  // Claude 4.5 series (latest generation - September-October 2025)
  {
    provider: 'anthropic',
    name: 'claude-sonnet-4-5-20250929',
    title: 'Claude Sonnet 4.5',
    contextWindow: 200000,
    supportsVision: true,
  },
  {
    provider: 'anthropic',
    name: 'claude-haiku-4-5-20251015',
    title: 'Claude Haiku 4.5',
    contextWindow: 200000,
    supportsVision: true,
  },
  // Claude 4.1 series (August 2025)
  {
    provider: 'anthropic',
    name: 'claude-opus-4-1-20250801',
    title: 'Claude Opus 4.1',
    contextWindow: 200000,
    supportsVision: true,
  },
  // Claude 4 series (June 2025)
  {
    provider: 'anthropic',
    name: 'claude-sonnet-4-20250629',
    title: 'Claude Sonnet 4',
    contextWindow: 200000,
    supportsVision: true,
  },
  // Claude 3.5 series (October 2024)
  {
    provider: 'anthropic',
    name: 'claude-3-5-sonnet-20241022',
    title: 'Claude 3.5 Sonnet',
    contextWindow: 200000,
    supportsVision: true,
  },
  {
    provider: 'anthropic',
    name: 'claude-3-5-haiku-20241022',
    title: 'Claude 3.5 Haiku',
    contextWindow: 200000,
    supportsVision: false,
  },
  // Claude 3 series (early 2024)
  {
    provider: 'anthropic',
    name: 'claude-3-opus-20240229',
    title: 'Claude 3 Opus',
    contextWindow: 200000,
    supportsVision: true,
  },
  {
    provider: 'anthropic',
    name: 'claude-3-sonnet-20240229',
    title: 'Claude 3 Sonnet',
    contextWindow: 200000,
    supportsVision: true,
  },
  {
    provider: 'anthropic',
    name: 'claude-3-haiku-20240307',
    title: 'Claude 3 Haiku',
    contextWindow: 200000,
    supportsVision: true,
  },
];

export const DEFAULT_MODEL = ANTHROPIC_MODELS[0]; // Claude Sonnet 4.5
