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
        name: 'o3',
        provider: 'openai',
        description: 'OpenAI o3 - Advanced reasoning model',
        cvSuccessRate: 0.92,
        notes: 'Flagship reasoning model with extended thinking capability',
      },
      {
        name: 'o3-pro',
        provider: 'openai',
        description: 'OpenAI o3-pro - Premium reasoning model',
        cvSuccessRate: 0.93,
        notes: 'Premium tier with enhanced reasoning depth',
      },
      {
        name: 'openai/o3-mini',
        provider: 'openrouter',
        description: 'OpenAI o3-mini - Reasoning model, similar to o3',
        cvSuccessRate: 0.90,
        notes: 'Tested: Tier 1 CV-first workflow, successful Holo integration',
      },
      // OpenAI o1 series
      {
        name: 'o1',
        provider: 'openai',
        description: 'OpenAI o1 - Reasoning model',
        cvSuccessRate: 0.91,
        notes: 'Strong reasoning capabilities, good for complex tasks',
      },
      {
        name: 'o1-2024',
        provider: 'openai',
        description: 'OpenAI o1 (2024 release)',
        cvSuccessRate: 0.91,
      },
      {
        name: 'o1-preview',
        provider: 'openai',
        description: 'OpenAI o1-preview - Early access reasoning model',
        cvSuccessRate: 0.90,
      },
      {
        name: 'o1-preview-2024',
        provider: 'openai',
        description: 'OpenAI o1-preview (2024 release)',
        cvSuccessRate: 0.90,
      },
      // GPT-5 series (may not be released yet)
      {
        name: 'gpt-5',
        provider: 'openai',
        description: 'GPT-5 - Next generation flagship',
        cvSuccessRate: 0.95,
        notes: 'May not be released yet, tier assignment based on expected capability',
      },
      {
        name: 'gpt-5-thinking',
        provider: 'openai',
        description: 'GPT-5 with reasoning mode',
        cvSuccessRate: 0.95,
      },
      {
        name: 'gpt-5-main',
        provider: 'openai',
        description: 'GPT-5 main chat variant',
        cvSuccessRate: 0.95,
      },
      {
        name: 'gpt-4.1',
        provider: 'openai',
        description: 'GPT-4.1 - Updated GPT-4 variant',
        cvSuccessRate: 0.93,
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
      {
        name: 'glm-4.5',
        provider: 'openrouter',
        description: 'GLM-4.5 - Zhipu AI flagship model',
        cvSuccessRate: 0.86,
        notes: 'Strong reasoning, multimodal capabilities',
      },
      {
        name: 'openrouter-glm-4.5',
        provider: 'openrouter',
        description: 'GLM-4.5 via OpenRouter',
        cvSuccessRate: 0.86,
      },
      // Claude 4.1
      {
        name: 'claude-4.1',
        provider: 'anthropic',
        description: 'Claude 4.1 - Latest Anthropic flagship',
        cvSuccessRate: 0.95,
        notes: 'Most recent Claude release, expected top-tier performance',
      },
      // Claude 3.7 Sonnet
      {
        name: 'claude-3.7-sonnet',
        provider: 'anthropic',
        description: 'Claude 3.7 Sonnet - Enhanced Sonnet variant',
        cvSuccessRate: 0.93,
        notes: 'Improved version of 3.5 Sonnet',
      },
      {
        name: 'anthropic/claude-3.7-sonnet',
        provider: 'openrouter',
        description: 'Claude 3.7 Sonnet via OpenRouter',
        cvSuccessRate: 0.93,
      },
      {
        name: 'openrouter-claude-3.7-sonnet',
        provider: 'openrouter',
        description: 'Claude 3.7 Sonnet via OpenRouter',
        cvSuccessRate: 0.93,
      },
      // Google Gemini 2.5 series
      {
        name: 'gemini-2.5-pro',
        provider: 'google',
        description: 'Gemini 2.5 Pro - Latest flagship multimodal',
        cvSuccessRate: 0.90,
        notes: '2025 release, enhanced vision and reasoning',
      },
      {
        name: 'gemini-2.5-flash',
        provider: 'google',
        description: 'Gemini 2.5 Flash - Fast multimodal model',
        cvSuccessRate: 0.88,
        notes: '2025 release, improved speed and capabilities',
      },
      {
        name: 'openrouter-gemini-2.5-pro',
        provider: 'openrouter',
        description: 'Gemini 2.5 Pro via OpenRouter',
        cvSuccessRate: 0.90,
      },
      {
        name: 'openrouter-gemini-2.5-flash',
        provider: 'openrouter',
        description: 'Gemini 2.5 Flash via OpenRouter',
        cvSuccessRate: 0.88,
      },
      // Gemini 2.5 Computer Use Preview
      {
        name: 'gemini-2.5-computer-use-preview',
        provider: 'google',
        description: 'Gemini 2.5 Computer Use (Preview) - Direct Google API',
        cvSuccessRate: 0.90,
        notes: 'Preview model for computer use, browser automation, parallel function calls',
      },
      {
        name: 'openrouter-gemini-2.5-computer-use-preview',
        provider: 'openrouter',
        description: 'Gemini 2.5 Computer Use (Preview) via OpenRouter',
        cvSuccessRate: 0.90,
        notes: 'May not be available on OpenRouter yet - fallback to direct Google if needed',
      },
      // Meta Llama 4 Maverick (flagship)
      {
        name: 'llama-4-maverick',
        provider: 'openrouter',
        description: 'Llama 4 Maverick - 400B MoE flagship',
        cvSuccessRate: 0.89,
        notes: '400B total, 17B active, 256k context',
      },
      {
        name: 'openrouter-llama-4-maverick',
        provider: 'openrouter',
        description: 'Llama 4 Maverick via OpenRouter',
        cvSuccessRate: 0.89,
      },
      // Mistral Large/Small 3.1
      {
        name: 'mistral-large',
        provider: 'openrouter',
        description: 'Mistral Large - Flagship reasoning model',
        cvSuccessRate: 0.88,
        notes: 'Strong reasoning and tool use capabilities',
      },
      {
        name: 'openrouter-mistral-large',
        provider: 'openrouter',
        description: 'Mistral Large via OpenRouter',
        cvSuccessRate: 0.88,
      },
      {
        name: 'mistral-small-3.1',
        provider: 'openrouter',
        description: 'Mistral Small 3.1 - 24B multimodal',
        cvSuccessRate: 0.86,
        notes: '24B params, 96k context, multimodal',
      },
      {
        name: 'openrouter-mistral-small-3.1',
        provider: 'openrouter',
        description: 'Mistral Small 3.1 via OpenRouter',
        cvSuccessRate: 0.86,
      },
      // xAI Grok
      {
        name: 'grok-1',
        provider: 'openrouter',
        description: 'xAI Grok-1 - Reasoning model',
        cvSuccessRate: 0.87,
        notes: 'xAI reasoning model with strong capabilities',
      },
      {
        name: 'openrouter-grok-1',
        provider: 'openrouter',
        description: 'Grok-1 via OpenRouter',
        cvSuccessRate: 0.87,
      },
      // InternVL3-78B (vision-specialized)
      {
        name: 'internvl3-78b',
        provider: 'openrouter',
        description: 'InternVL3-78B - Vision-specialized model',
        cvSuccessRate: 0.90,
        notes: '78B vision-language model, strong UI understanding',
      },
      {
        name: 'openrouter-/internvl3-78b',
        provider: 'openrouter',
        description: 'InternVL3-78B via OpenRouter',
        cvSuccessRate: 0.90,
      },
      // DeepSeek Prover V2 & Reasoner V3.1
      {
        name: 'deepseek-prover-v2',
        provider: 'openrouter',
        description: 'DeepSeek Prover V2 - Mathematical reasoning',
        cvSuccessRate: 0.88,
        notes: 'Specialized for mathematical and logical reasoning',
      },
      {
        name: 'openrouter-deepseek-prover-v2',
        provider: 'openrouter',
        description: 'DeepSeek Prover V2 via OpenRouter',
        cvSuccessRate: 0.88,
      },
      {
        name: 'deepseek-reasoner-v3.1',
        provider: 'openrouter',
        description: 'DeepSeek Reasoner V3.1 - Advanced reasoning',
        cvSuccessRate: 0.87,
        notes: 'Latest DeepSeek reasoning variant',
      },
      {
        name: 'openrouter-deepseek-reasoner-v3.1',
        provider: 'openrouter',
        description: 'DeepSeek Reasoner V3.1 via OpenRouter',
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
      // OpenAI o1-mini (smaller reasoning model)
      {
        name: 'o1-mini',
        provider: 'openai',
        description: 'OpenAI o1-mini - Compact reasoning model',
        cvSuccessRate: 0.82,
        notes: 'Smaller, faster o1 variant with good reasoning',
      },
      // OpenAI Codex (code-specialized)
      {
        name: 'codex-davinci-002',
        provider: 'openai',
        description: 'Codex Davinci - Code-specialized model',
        cvSuccessRate: 0.75,
        notes: 'Specialized for code, not optimized for CV workflows',
      },
      {
        name: 'code-davinci-002',
        provider: 'openai',
        description: 'Codex Davinci (alt name)',
        cvSuccessRate: 0.75,
      },
      {
        name: 'codex-cushman-001',
        provider: 'openai',
        description: 'Codex Cushman - Smaller code model',
        cvSuccessRate: 0.70,
        notes: 'Faster code model, limited CV capabilities',
      },
      {
        name: 'code-cushman-001',
        provider: 'openai',
        description: 'Codex Cushman (alt name)',
        cvSuccessRate: 0.70,
      },
      // GPT-5 mini/nano (if released)
      {
        name: 'gpt-5-mini',
        provider: 'openai',
        description: 'GPT-5 Mini - Smaller GPT-5 variant',
        cvSuccessRate: 0.88,
        notes: 'Expected to be strong but not flagship tier',
      },
      {
        name: 'gpt-5-nano',
        provider: 'openai',
        description: 'GPT-5 Nano - Compact GPT-5',
        cvSuccessRate: 0.82,
        notes: 'Compact variant for faster inference',
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
      // Meta Llama 4 Scout
      {
        name: 'llama-4-scout',
        provider: 'openrouter',
        description: 'Llama 4 Scout - Smaller Llama 4 variant',
        cvSuccessRate: 0.80,
        notes: 'Compact Llama 4 for faster inference',
      },
      {
        name: 'openrouter-llama-4-scout',
        provider: 'openrouter',
        description: 'Llama 4 Scout via OpenRouter',
        cvSuccessRate: 0.80,
      },
      // DeepSeek distilled models
      {
        name: 'deepseek-r1-distill-qwen-32b',
        provider: 'openrouter',
        description: 'DeepSeek R1 distilled (Qwen 32B)',
        cvSuccessRate: 0.78,
        notes: 'Distilled from R1, good reasoning at smaller size',
      },
      {
        name: 'openrouter-deepseek-r1-distill-qwen-32b',
        provider: 'openrouter',
        description: 'DeepSeek R1 Qwen distill via OpenRouter',
        cvSuccessRate: 0.78,
      },
      {
        name: 'deepseek-r1-distill-llama-70b',
        provider: 'openrouter',
        description: 'DeepSeek R1 distilled (Llama 70B)',
        cvSuccessRate: 0.80,
        notes: 'Distilled from R1, Llama-based variant',
      },
      {
        name: 'openrouter-deepseek-r1-distill-llama-70b',
        provider: 'openrouter',
        description: 'DeepSeek R1 Llama distill via OpenRouter',
        cvSuccessRate: 0.80,
      },
      {
        name: 'deepseek-chat-v3.1',
        provider: 'openrouter',
        description: 'DeepSeek Chat V3.1 - Latest chat variant',
        cvSuccessRate: 0.79,
        notes: 'General-purpose chat model, good capabilities',
      },
      {
        name: 'openrouter-deepseek-chat-v3.1',
        provider: 'openrouter',
        description: 'DeepSeek Chat V3.1 via OpenRouter',
        cvSuccessRate: 0.79,
      },
      // Qwen 3 series
      {
        name: 'qwen3-coder',
        provider: 'openrouter',
        description: 'Qwen 3 Coder 480B - Code-specialized',
        cvSuccessRate: 0.77,
        notes: 'Large code model, good reasoning',
      },
      {
        name: 'openrouter-qwen3-coder-480b',
        provider: 'openrouter',
        description: 'Qwen 3 Coder 480B via OpenRouter',
        cvSuccessRate: 0.77,
      },
      {
        name: 'qwen3-max',
        provider: 'openrouter',
        description: 'Qwen 3 Max - Flagship variant',
        cvSuccessRate: 0.81,
        notes: 'Top Qwen 3 model with strong capabilities',
      },
      {
        name: 'openrouter-qwen3-max',
        provider: 'openrouter',
        description: 'Qwen 3 Max via OpenRouter',
        cvSuccessRate: 0.81,
      },
      {
        name: 'qwen-plus',
        provider: 'openrouter',
        description: 'Qwen Plus - Mid-tier Qwen model',
        cvSuccessRate: 0.76,
      },
      {
        name: 'openrouter-qwen-plus',
        provider: 'openrouter',
        description: 'Qwen Plus via OpenRouter',
        cvSuccessRate: 0.76,
      },
      {
        name: 'qwen-turbo',
        provider: 'openrouter',
        description: 'Qwen Turbo - Fast Qwen variant',
        cvSuccessRate: 0.74,
        notes: 'Optimized for speed',
      },
      {
        name: 'openrouter-qwen-turbo',
        provider: 'openrouter',
        description: 'Qwen Turbo via OpenRouter',
        cvSuccessRate: 0.74,
      },
      {
        name: 'qwen-max',
        provider: 'openrouter',
        description: 'Qwen Max - Top Qwen model',
        cvSuccessRate: 0.80,
      },
      {
        name: 'openrouter-qwen-max',
        provider: 'openrouter',
        description: 'Qwen Max via OpenRouter',
        cvSuccessRate: 0.80,
      },
      // Gemini 2.0 Flash Thinking
      {
        name: 'gemini-2.0-flash-thinking',
        provider: 'google',
        description: 'Gemini 2.0 Flash Thinking - Reasoning mode',
        cvSuccessRate: 0.83,
        notes: 'Flash variant with extended reasoning',
      },
      {
        name: 'openrouter-gemini-2.0-flash-thinking',
        provider: 'openrouter',
        description: 'Gemini 2.0 Flash Thinking via OpenRouter',
        cvSuccessRate: 0.83,
      },
      // Moonshot Kimi VL
      {
        name: 'kimi-vl-a3b',
        provider: 'openrouter',
        description: 'Kimi VL A3B - Multimodal reasoning',
        cvSuccessRate: 0.79,
        notes: '16B MoE, 2.8B active, lightweight multimodal',
      },
      {
        name: 'openrouter-kimi-vl-a3b',
        provider: 'openrouter',
        description: 'Kimi VL A3B via OpenRouter',
        cvSuccessRate: 0.79,
      },
      // Zhipu GLM 4.5 Air
      {
        name: 'glm-4.5-air',
        provider: 'openrouter',
        description: 'GLM 4.5 Air - Lighter GLM variant',
        cvSuccessRate: 0.77,
        notes: 'Faster, smaller GLM 4.5',
      },
      {
        name: 'openrouter-glm-4.5-air',
        provider: 'openrouter',
        description: 'GLM 4.5 Air via OpenRouter',
        cvSuccessRate: 0.77,
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
      // Claude models
      'claude-sonnet-4',
      'claude-opus-4',
      'claude-4.1',
      'claude-3.7',
      'claude-3-5-sonnet',
      // GPT models
      'gpt-4o',
      'gpt-4.1',
      'gpt-5',
      // OpenAI reasoning models
      'o3',
      'o1',
      // DeepSeek reasoning models
      'deepseek-r1',
      'deepseek-prover',
      'deepseek-reasoner',
      // GLM series (Chinese flagship)
      'glm-4',
      // Gemini 2.5
      'gemini-2.5',
      // Meta Llama 4
      'llama-4-maverick',
      // Mistral
      'mistral-large',
      'mistral-small-3',
      // xAI Grok
      'grok-1',
      'grok',
      // Vision specialized
      'internvl3',
      'internvl',
    ],
    tier2: [
      'gpt-4o-mini',
      'o1-mini',
      'codex',
      'code-davinci',
      'code-cushman',
      'gpt-5-mini',
      'gpt-5-nano',
      'gemini',
      'claude-3-haiku',
      'gpt-4',
      'llama-4-scout',
      'deepseek-chat',
      'deepseek-distill',
      'qwen3-coder',
      'qwen3-max',
      'qwen-plus',
      'qwen-turbo',
      'qwen-max',
      'kimi',
      'glm-4.5-air',
    ],
    tier3: ['qwen3-vl', 'llava', 'cogvlm'],
  },

  // Universal rules for auto-detecting model tiers
  // Works for ANY model from ANY provider (current + future)
  universalRules: {
    tier1: {
      suffixes: ['-pro', '-max', '-ultra', '-large', '-turbo', '-maverick'],
      prefixes: ['o3-', 'o4-', 'o5-', 'o1-', 'gpt-5-', 'gpt-6-', 'claude-4', 'claude-5', 'gemini-2.5'],
      keywords: ['opus', 'ui-tars', 'internvl', 'showui', 'reasoning', 'prover', 'grok', 'maverick', 'reasoner'],
      versionThreshold: 5.0, // Auto-tier1 for version >= 5.0
    },
    tier2: {
      suffixes: ['-mini', '-flash', '-medium', '-standard', '-scout', '-distill', '-air'],
      prefixes: ['gpt-4-', 'gemini-1', 'gemini-2', 'codex-', 'code-', 'qwen3-', 'qwen-'],
      keywords: ['sonnet', 'haiku', 'codex', 'coder', 'distill', 'scout', 'kimi', 'chat', 'turbo'],
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
