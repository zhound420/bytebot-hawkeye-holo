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

export interface UniversalRuleIndicators {
  suffixes?: string[]; // Model name suffixes (e.g., '-pro', '-nano')
  prefixes?: string[]; // Model name prefixes (e.g., 'o3-', 'gpt-5-')
  keywords?: string[]; // Keywords in model name (e.g., 'opus', 'ui-tars')
  versionThreshold?: number; // Minimum version number (e.g., 5.0 for gpt-5+)
  versionRange?: [number, number]; // Version range [min, max]
  patterns?: string[]; // Regex patterns to match
}

export interface MetadataThresholds {
  inputCostMin?: number; // Minimum cost per input token
  inputCostMax?: number; // Maximum cost per input token
  contextWindowMin?: number; // Minimum context window size
  requiredCapabilities?: string[]; // Required capability flags
}

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
  universalRules: Record<ModelTier, UniversalRuleIndicators>;
  metadataThresholds: Record<ModelTier, MetadataThresholds>;
}

/**
 * Model capability database
 * Based on real-world testing and performance analysis
 *
 * NOTE: Vision capabilities are provided by Holo 1.5-7B (OmniParser) service.
 * Models don't need built-in vision - they use computer_detect_elements tool.
 * Tiers focus on reasoning, tool use, and instruction following.
 */
export const MODEL_CAPABILITIES: ModelCapabilityConfig = {
  // Tier 1: Strong Reasoning & Tool Use
  // - Excellent reasoning and CV-first workflow adherence
  // - Strong tool use (calls computer_detect_elements correctly)
  // - Strict CV-first enforcement
  // - Flagship/premium models
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
      // OpenAI o3 series (reasoning models)
      {
        name: 'openai/o3-mini',
        provider: 'openrouter',
        description: 'OpenAI o3-mini - Reasoning model, similar to o3',
        cvSuccessRate: 0.90,
        notes: 'Tested: Tier 1 CV-first workflow, successful Holo integration',
      },
      // DeepSeek reasoning models
      {
        name: 'deepseek-r1',
        provider: 'openrouter',
        description: 'DeepSeek R1 - Advanced reasoning model',
        cvSuccessRate: 0.88,
        notes: 'Reasoning-focused model, expected strong tool use',
      },
      {
        name: 'openrouter/deepseek/deepseek-r1',
        provider: 'openrouter',
        description: 'DeepSeek R1 via OpenRouter (full path)',
        cvSuccessRate: 0.88,
      },
      // GLM series (Chinese flagship models)
      {
        name: 'glm-4.6',
        provider: 'openrouter',
        description: 'GLM-4.6 - Chinese flagship multimodal model',
        cvSuccessRate: 0.87,
        notes: 'Zhipu AI flagship model, strong reasoning capabilities',
      },
      {
        name: 'openrouter/z-ai/glm-4.6',
        provider: 'openrouter',
        description: 'GLM-4.6 via OpenRouter (full path)',
        cvSuccessRate: 0.87,
      },
    ],
  },

  // Tier 2: Medium Reasoning & Tool Use
  // - Good reasoning, may need guidance on CV workflow
  // - Relaxed CV-first enforcement (allow 1 violation)
  // - Keyboard shortcut suggestions emphasized
  // - Mid-tier models (mini, flash variants)
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

  // Tier 3: Limited Reasoning or Tool Use
  // - Struggles with CV-first workflow or tool calling
  // - Minimal CV-first enforcement (suggest but don't block)
  // - Keyboard-first prompts, CV as enhancement
  // - High fallback tolerance
  // - Budget/small models, open-source VL models
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
      {
        name: 'qwen3-vl-30b-a3b-instruct',
        provider: 'openrouter',
        description: 'Qwen3 VL 30B - Mid-size vision model',
        cvSuccessRate: 0.45,
        notes: '30B parameter vision model, smaller than 235B variant',
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
      'gpt-5',
      'o3',
      'deepseek-r1',  // DeepSeek reasoning models
      'glm-4',        // GLM-4 series (Chinese flagship)
    ],
    tier2: ['gpt-4o-mini', 'gemini', 'claude-3-haiku', 'gpt-4'],
    tier3: ['qwen3-vl', 'llava', 'cogvlm'],
  },

  // Universal rules for auto-detecting model tiers
  // Works for ANY model from ANY provider (current + future)
  universalRules: {
    tier1: {
      suffixes: ['-pro', '-max', '-ultra', '-large', '-turbo'],
      prefixes: ['o3-', 'o4-', 'o5-', 'gpt-5-', 'gpt-6-', 'claude-4', 'claude-5'],
      keywords: ['opus', 'ui-tars', 'internvl', 'showui', 'reasoning'],
      versionThreshold: 5.0, // Auto-tier1 for version >= 5.0
    },
    tier2: {
      suffixes: ['-mini', '-flash', '-medium', '-standard'],
      prefixes: ['gpt-4-', 'gemini-1', 'gemini-2'],
      keywords: ['sonnet', 'haiku'],
      versionRange: [4.0, 5.0], // Version 4.x models
    },
    tier3: {
      suffixes: ['-nano', '-tiny', '-small', '-lite'],
      patterns: [':free$', '-free$'], // Free tier models
      keywords: ['qwen.*vl'], // Open source VL models
      versionThreshold: 3.5, // Below version 3.5
    },
  },

  // Metadata-based scoring thresholds (from LiteLLM proxy)
  // Used as fallback when name patterns don't match
  metadataThresholds: {
    tier1: {
      inputCostMin: 0.000002, // Premium pricing
      contextWindowMin: 200000, // Large context
    },
    tier2: {
      inputCostMin: 0.0000002,
      inputCostMax: 0.000002,
      contextWindowMin: 128000,
    },
    tier3: {
      inputCostMax: 0.0000002, // Budget pricing
    },
  },
};
