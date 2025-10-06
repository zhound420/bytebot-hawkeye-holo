/**
 * Model Capability Configuration
 *
 * Defines CV-first workflow capabilities for different AI models.
 * Tiers determine enforcement strictness and prompt templates.
 */

export interface ModelProfile {
  name: string;
  provider: string;
  description: string;
  cvSuccessRate: number;
  notes?: string;
}

export interface EnforcementRules {
  maxCvAttempts: number;
  allowClickViolations: boolean;
  maxViolationsBeforeBlock?: number;
  enforceCvFirst: boolean;
  loopDetectionThreshold: number;
}

export type ModelTier = 'tier1' | 'tier2' | 'tier3';

export interface ModelCapabilityConfig {
  tier1: {
    models: ModelProfile[];
  };
  tier2: {
    models: ModelProfile[];
  };
  tier3: {
    models: ModelProfile[];
  };
  defaultTier: ModelTier;
  enforcementRules: Record<ModelTier, EnforcementRules>;
  patterns: Record<ModelTier, string[]>;
}

/**
 * Model capability database
 * Based on real-world testing and performance analysis
 */
export const MODEL_CAPABILITIES: ModelCapabilityConfig = {
  // Tier 1: Strong CV Capability
  // - Excellent vision understanding and CV-first workflow adherence
  // - Strict CV-first enforcement
  // - Minimal fallback needed
  tier1: {
    models: [
      // Anthropic Claude models
      {
        name: 'claude-sonnet-4.5',
        provider: 'anthropic',
        description: 'Claude Sonnet 4.5 - Excellent vision and reasoning',
        cvSuccessRate: 0.95,
      },
      {
        name: 'claude-opus-4',
        provider: 'anthropic',
        description: 'Claude Opus 4 - Superior multimodal understanding',
        cvSuccessRate: 0.95,
      },
      {
        name: 'claude-3-5-sonnet',
        provider: 'anthropic',
        description: 'Claude 3.5 Sonnet - Strong vision capabilities',
        cvSuccessRate: 0.92,
      },
      // OpenAI GPT-4o series
      {
        name: 'gpt-4o',
        provider: 'openai',
        description: 'GPT-4o - Excellent multimodal model',
        cvSuccessRate: 0.93,
        notes: 'Tested: 100% CV-first compliance, adaptive keyboard fallback',
      },
      {
        name: 'openai/gpt-4o',
        provider: 'openrouter',
        description: 'GPT-4o via OpenRouter',
        cvSuccessRate: 0.93,
      },
    ],
  },

  // Tier 2: Medium CV Capability
  // - Good vision understanding, some CV workflow challenges
  // - Relaxed CV-first enforcement (allow 1 violation)
  // - Keyboard shortcut suggestions emphasized
  tier2: {
    models: [
      // OpenAI smaller models
      {
        name: 'gpt-4o-mini',
        provider: 'openai',
        description: 'GPT-4o Mini - Good vision, faster inference',
        cvSuccessRate: 0.8,
      },
      {
        name: 'openai/gpt-4o-mini',
        provider: 'openrouter',
        description: 'GPT-4o Mini via OpenRouter',
        cvSuccessRate: 0.8,
      },
      // Google Gemini models
      {
        name: 'gemini-2.0-flash-exp',
        provider: 'google',
        description: 'Gemini 2.0 Flash - Fast multimodal model',
        cvSuccessRate: 0.82,
      },
      {
        name: 'gemini-1.5-pro',
        provider: 'google',
        description: 'Gemini 1.5 Pro - Solid vision capabilities',
        cvSuccessRate: 0.85,
      },
      // Anthropic smaller models
      {
        name: 'claude-3-haiku',
        provider: 'anthropic',
        description: 'Claude 3 Haiku - Fast, good vision',
        cvSuccessRate: 0.78,
      },
    ],
  },

  // Tier 3: Weak CV Capability
  // - Limited vision understanding or CV workflow struggles
  // - Minimal CV-first enforcement (suggest but don't block)
  // - Keyboard-first prompts, CV as enhancement
  // - High fallback tolerance
  tier3: {
    models: [
      // Qwen VL series
      {
        name: 'qwen3-vl-235b-a22b-instruct',
        provider: 'openrouter',
        description: 'Qwen3 VL - Struggles with CV-first workflow',
        cvSuccessRate: 0.4,
        notes:
          'Tested: 4 click violations, stuck in detect→click loops, requested help',
      },
      {
        name: 'openrouter/qwen/qwen3-vl-235b-a22b-instruct',
        provider: 'openrouter',
        description: 'Qwen3 VL via OpenRouter (full path)',
        cvSuccessRate: 0.4,
      },
      // Other VL models with known limitations
      {
        name: 'llava',
        provider: 'openrouter',
        description: 'LLaVA - Open source VL model',
        cvSuccessRate: 0.5,
      },
      {
        name: 'cogvlm',
        provider: 'openrouter',
        description: 'CogVLM - Open source VL model',
        cvSuccessRate: 0.45,
      },
    ],
  },

  // Default tier for unknown models
  // Tier 2 (balanced) is the safe default for new models
  defaultTier: 'tier2',

  // Enforcement rules per tier
  enforcementRules: {
    tier1: {
      maxCvAttempts: 2,
      allowClickViolations: false,
      enforceCvFirst: true,
      loopDetectionThreshold: 3,
    },
    tier2: {
      maxCvAttempts: 3,
      allowClickViolations: true, // Allow 1 violation
      maxViolationsBeforeBlock: 1,
      enforceCvFirst: true,
      loopDetectionThreshold: 3,
    },
    tier3: {
      maxCvAttempts: 2,
      allowClickViolations: true,
      maxViolationsBeforeBlock: 999, // Effectively unlimited
      enforceCvFirst: false, // Suggest but don't block
      loopDetectionThreshold: 2, // More sensitive to loops
    },
  },

  // Model patterns for fuzzy matching
  // Matches model names that contain these patterns
  patterns: {
    tier1: [
      'claude-sonnet-4',
      'claude-opus-4',
      'gpt-4o',
      'claude-3-5-sonnet',
    ],
    tier2: ['gpt-4o-mini', 'gemini', 'claude-3-haiku'],
    tier3: ['qwen', 'llava', 'cogvlm'],
  },
};
