import { BytebotAgentModel } from 'src/agent/agent.types';

/**
 * OpenAI Models - Fallback list
 *
 * This list is used as a fallback when dynamic model fetching fails.
 * In normal operation, models are fetched from OpenAI's /v1/models API.
 */
export const OPENAI_MODELS: BytebotAgentModel[] = [
  // GPT-4o series (current generation multimodal models)
  {
    provider: 'openai',
    name: 'gpt-4o',
    title: 'GPT-4o',
    contextWindow: 128000,
    supportsVision: true,
  },
  {
    provider: 'openai',
    name: 'gpt-4o-mini',
    title: 'GPT-4o Mini',
    contextWindow: 128000,
    supportsVision: true,
  },
  // GPT-5 series (August 2025) - Best for coding and agentic tasks
  {
    provider: 'openai',
    name: 'gpt-5',
    title: 'GPT-5',
    contextWindow: 400000,
    supportsVision: true,
  },
  {
    provider: 'openai',
    name: 'gpt-5-mini',
    title: 'GPT-5 Mini',
    contextWindow: 400000,
    supportsVision: true,
  },
  {
    provider: 'openai',
    name: 'gpt-5-nano',
    title: 'GPT-5 Nano',
    contextWindow: 400000,
    supportsVision: true,
  },
  // GPT-4.1 series (April 2025) - Superior coding and vision
  {
    provider: 'openai',
    name: 'gpt-4.1',
    title: 'GPT-4.1',
    contextWindow: 1000000,
    supportsVision: true,
  },
  {
    provider: 'openai',
    name: 'gpt-4.1-mini',
    title: 'GPT-4.1 Mini',
    contextWindow: 1000000,
    supportsVision: true,
  },
  {
    provider: 'openai',
    name: 'gpt-4.1-nano',
    title: 'GPT-4.1 Nano',
    contextWindow: 1000000,
    supportsVision: true,
  },
  // o1 series (reasoning models)
  {
    provider: 'openai',
    name: 'o1',
    title: 'o1',
    contextWindow: 200000,
    supportsVision: false,
  },
  {
    provider: 'openai',
    name: 'o1-preview',
    title: 'o1 Preview',
    contextWindow: 128000,
    supportsVision: false,
  },
  {
    provider: 'openai',
    name: 'o1-mini',
    title: 'o1 Mini',
    contextWindow: 128000,
    supportsVision: false,
  },
  // o3-mini series (reasoning models with effort control - January 2025)
  {
    provider: 'openai',
    name: 'o3-mini',
    title: 'o3 Mini',
    contextWindow: 200000,
    supportsVision: false,
  },
  {
    provider: 'openai',
    name: 'o3-mini-low',
    title: 'o3 Mini (Low)',
    contextWindow: 200000,
    supportsVision: false,
  },
  {
    provider: 'openai',
    name: 'o3-mini-medium',
    title: 'o3 Mini (Medium)',
    contextWindow: 200000,
    supportsVision: false,
  },
  {
    provider: 'openai',
    name: 'o3-mini-high',
    title: 'o3 Mini (High)',
    contextWindow: 200000,
    supportsVision: false,
  },
];

export const DEFAULT_MODEL = OPENAI_MODELS[0]; // gpt-4o
