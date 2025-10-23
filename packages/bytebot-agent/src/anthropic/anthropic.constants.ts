import { BytebotAgentModel } from '../agent/agent.types';

/**
 * Anthropic Claude Models - Current as of January 2025
 *
 * Anthropic does not provide a /models API endpoint.
 * This list must be manually updated when new models are released.
 */
export const ANTHROPIC_MODELS: BytebotAgentModel[] = [
  // Claude 3.5 series (latest generation - October 2024)
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
  // Claude 3 series (previous generation)
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

export const DEFAULT_MODEL = ANTHROPIC_MODELS[0]; // Claude 3.5 Sonnet
