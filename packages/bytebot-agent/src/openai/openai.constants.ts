import { BytebotAgentModel } from 'src/agent/agent.types';

/**
 * OpenAI Models - Fallback list
 *
 * This list is used as a fallback when dynamic model fetching fails.
 * In normal operation, models are fetched from OpenAI's /v1/models API.
 */
export const OPENAI_MODELS: BytebotAgentModel[] = [
  // GPT-4o series (latest multimodal models)
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
  // GPT-4 Turbo (previous generation)
  {
    provider: 'openai',
    name: 'gpt-4-turbo',
    title: 'GPT-4 Turbo',
    contextWindow: 128000,
    supportsVision: true,
  },
  {
    provider: 'openai',
    name: 'gpt-4-turbo-preview',
    title: 'GPT-4 Turbo Preview',
    contextWindow: 128000,
    supportsVision: true,
  },
  // GPT-3.5 series (legacy, cost-effective)
  {
    provider: 'openai',
    name: 'gpt-3.5-turbo',
    title: 'GPT-3.5 Turbo',
    contextWindow: 16385,
    supportsVision: false,
  },
];

export const DEFAULT_MODEL = OPENAI_MODELS[0]; // gpt-4o
