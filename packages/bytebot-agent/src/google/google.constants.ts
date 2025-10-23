import { BytebotAgentModel } from '../agent/agent.types';

export const GOOGLE_MODELS: BytebotAgentModel[] = [
  // Gemini 2.0 series (Latest - December 2024)
  {
    provider: 'google',
    name: 'gemini-2.0-flash-exp',
    title: 'Gemini 2.0 Flash (Experimental)',
    contextWindow: 1000000,
    supportsVision: true,
  },
  // Gemini 1.5 series (Stable production models)
  {
    provider: 'google',
    name: 'gemini-1.5-pro',
    title: 'Gemini 1.5 Pro',
    contextWindow: 2000000,
    supportsVision: true,
  },
  {
    provider: 'google',
    name: 'gemini-1.5-flash',
    title: 'Gemini 1.5 Flash',
    contextWindow: 1000000,
    supportsVision: true,
  },
];

export const DEFAULT_MODEL = GOOGLE_MODELS[0];
