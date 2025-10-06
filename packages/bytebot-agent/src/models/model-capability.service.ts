import { Injectable, Logger } from '@nestjs/common';
import {
  MODEL_CAPABILITIES,
  ModelTier,
  ModelProfile,
  EnforcementRules,
} from './model-capabilities.config';

/**
 * Service for managing model capabilities and tier assignments
 *
 * Provides:
 * - Model tier lookup (Tier 1/2/3 based on reasoning & tool use)
 * - Enforcement rule retrieval
 * - Dynamic tier assignment for unknown models
 * - Pattern-based fuzzy matching
 * - Universal detection (works for any model from any provider)
 *
 * Detection Layers (in order):
 * 1. Explicit match (manually tested models)
 * 2. Pattern matching (provider/version prefixes)
 * 3. Universal rules (suffix/keyword detection)
 * 4. Metadata scoring (pricing/context window)
 * 5. Safe default (tier2)
 */
@Injectable()
export class ModelCapabilityService {
  private readonly logger = new Logger('ModelCapabilityService');

  /**
   * Strip provider prefix from model name
   * @param modelName - Model name with optional provider prefix
   * @returns Model name without provider prefix
   */
  private stripProviderPrefix(modelName: string): string {
    const providers = [
      'openai/',
      'anthropic/',
      'openrouter/',
      'vertex_ai/',
      'gemini/',
      'google/',
    ];

    for (const prefix of providers) {
      if (modelName.toLowerCase().startsWith(prefix)) {
        return modelName.slice(prefix.length);
      }
    }

    return modelName;
  }

  /**
   * Parse version number from model name
   * @param modelName - Model name (e.g., "gpt-5", "claude-4.5")
   * @returns Version number or null if not found
   */
  private parseModelVersion(modelName: string): number | null {
    // Match patterns like: gpt-5, gpt-5.1, claude-4.5, o3, o3-pro
    const versionPatterns = [
      /gpt-(\d+\.?\d*)/i,
      /claude-(\d+\.?\d*)/i,
      /gemini-(\d+\.?\d*)/i,
      /o(\d+)-?/i, // o3, o3-pro
    ];

    for (const pattern of versionPatterns) {
      const match = modelName.match(pattern);
      if (match && match[1]) {
        return parseFloat(match[1]);
      }
    }

    return null;
  }

  /**
   * Check if model matches universal tier rules
   * @param modelName - Normalized model name (without provider prefix)
   * @param tier - Tier to check rules for
   * @returns true if model matches tier's universal rules
   */
  private matchUniversalRules(
    modelName: string,
    tier: ModelTier,
  ): { matched: boolean; reason?: string } {
    const rules = MODEL_CAPABILITIES.universalRules[tier];
    const normalized = modelName.toLowerCase();

    // Check suffixes
    if (rules.suffixes) {
      for (const suffix of rules.suffixes) {
        if (normalized.endsWith(suffix.toLowerCase())) {
          return {
            matched: true,
            reason: `suffix: ${suffix}`,
          };
        }
      }
    }

    // Check prefixes
    if (rules.prefixes) {
      for (const prefix of rules.prefixes) {
        if (normalized.startsWith(prefix.toLowerCase())) {
          return {
            matched: true,
            reason: `prefix: ${prefix}`,
          };
        }
      }
    }

    // Check keywords
    if (rules.keywords) {
      for (const keyword of rules.keywords) {
        if (normalized.includes(keyword.toLowerCase())) {
          return {
            matched: true,
            reason: `keyword: ${keyword}`,
          };
        }
      }
    }

    // Check patterns (regex)
    if (rules.patterns) {
      for (const pattern of rules.patterns) {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(normalized)) {
          return {
            matched: true,
            reason: `pattern: ${pattern}`,
          };
        }
      }
    }

    // Check version threshold
    const version = this.parseModelVersion(modelName);
    if (version !== null) {
      if (rules.versionThreshold && version >= rules.versionThreshold) {
        return {
          matched: true,
          reason: `version >= ${rules.versionThreshold} (${version})`,
        };
      }

      if (rules.versionRange) {
        const [min, max] = rules.versionRange;
        if (version >= min && version < max) {
          return {
            matched: true,
            reason: `version in range [${min}, ${max}) (${version})`,
          };
        }
      }
    }

    return { matched: false };
  }

  /**
   * Score model tier based on metadata thresholds
   * @param metadata - Model metadata (inputCost, contextWindow, etc.)
   * @returns Tier or null if metadata doesn't match any threshold
   */
  private scoreFromMetadata(metadata: {
    inputCost?: number;
    contextWindow?: number;
  }): ModelTier | null {
    // Tier 1: Premium pricing OR large context
    const tier1Thresholds = MODEL_CAPABILITIES.metadataThresholds.tier1;
    if (
      (metadata.inputCost !== undefined &&
        tier1Thresholds.inputCostMin !== undefined &&
        metadata.inputCost >= tier1Thresholds.inputCostMin) ||
      (metadata.contextWindow !== undefined &&
        tier1Thresholds.contextWindowMin !== undefined &&
        metadata.contextWindow >= tier1Thresholds.contextWindowMin)
    ) {
      return 'tier1';
    }

    // Tier 3: Budget pricing
    const tier3Thresholds = MODEL_CAPABILITIES.metadataThresholds.tier3;
    if (
      metadata.inputCost !== undefined &&
      tier3Thresholds.inputCostMax !== undefined &&
      metadata.inputCost <= tier3Thresholds.inputCostMax
    ) {
      return 'tier3';
    }

    // Tier 2: Mid-range (fallback if not tier1 or tier3)
    const tier2Thresholds = MODEL_CAPABILITIES.metadataThresholds.tier2;
    if (
      (metadata.inputCost !== undefined &&
        tier2Thresholds.inputCostMin !== undefined &&
        tier2Thresholds.inputCostMax !== undefined &&
        metadata.inputCost >= tier2Thresholds.inputCostMin &&
        metadata.inputCost < tier2Thresholds.inputCostMax) ||
      (metadata.contextWindow !== undefined &&
        tier2Thresholds.contextWindowMin !== undefined &&
        metadata.contextWindow >= tier2Thresholds.contextWindowMin)
    ) {
      return 'tier2';
    }

    return null;
  }

  /**
   * Get the tier for a given model
   * @param modelName - Model identifier (e.g., "gpt-4o", "openai/gpt-4o")
   * @param metadata - Optional model metadata for Layer 4 detection
   * @returns Model tier (tier1, tier2, or tier3)
   */
  getModelTier(
    modelName: string,
    metadata?: { inputCost?: number; contextWindow?: number },
  ): ModelTier {
    if (!modelName) {
      this.logger.warn('No model name provided, using default tier');
      return MODEL_CAPABILITIES.defaultTier;
    }

    // Normalize model name (lowercase, trim)
    const normalized = modelName.toLowerCase().trim();
    const withoutProvider = this.stripProviderPrefix(normalized);

    // Layer 1: Exact match (highest priority - manually tested models)
    for (const tier of ['tier1', 'tier2', 'tier3'] as ModelTier[]) {
      const models = MODEL_CAPABILITIES[tier].models;
      const exactMatch = models.find(
        (m) => m.name.toLowerCase() === normalized,
      );
      if (exactMatch) {
        this.logger.debug(
          `Model "${modelName}" matched tier ${tier} (exact match)`,
        );
        return tier;
      }
    }

    // Layer 2: Pattern matching (medium priority - known model families)
    for (const tier of ['tier1', 'tier2', 'tier3'] as ModelTier[]) {
      const patterns = MODEL_CAPABILITIES.patterns[tier];
      const patternMatch = patterns.find((pattern) =>
        withoutProvider.includes(pattern.toLowerCase()),
      );
      if (patternMatch) {
        this.logger.debug(
          `Model "${modelName}" matched tier ${tier} (pattern: ${patternMatch})`,
        );
        return tier;
      }
    }

    // Layer 3: Universal rules (provider-agnostic - works for any model)
    for (const tier of ['tier1', 'tier3', 'tier2'] as ModelTier[]) {
      // Check tier1 and tier3 first (more specific), then tier2
      const ruleMatch = this.matchUniversalRules(withoutProvider, tier);
      if (ruleMatch.matched) {
        this.logger.log(
          `Model "${modelName}" matched tier ${tier} via universal rule (${ruleMatch.reason})`,
        );
        return tier;
      }
    }

    // Layer 4: Metadata scoring (use LiteLLM proxy metadata)
    if (metadata) {
      const metadataTier = this.scoreFromMetadata(metadata);
      if (metadataTier) {
        this.logger.log(
          `Model "${modelName}" matched tier ${metadataTier} via metadata scoring (cost: ${metadata.inputCost}, context: ${metadata.contextWindow})`,
        );
        return metadataTier;
      }
    }

    // Layer 5: Safe default tier
    this.logger.log(
      `Model "${modelName}" not recognized by any detection layer, using default tier: ${MODEL_CAPABILITIES.defaultTier}`,
    );
    return MODEL_CAPABILITIES.defaultTier;
  }

  /**
   * Get model profile information
   * @param modelName - Model identifier
   * @returns Model profile or null if not found
   */
  getModelProfile(modelName: string): ModelProfile | null {
    if (!modelName) {
      return null;
    }

    const normalized = modelName.toLowerCase().trim();

    for (const tier of ['tier1', 'tier2', 'tier3'] as ModelTier[]) {
      const models = MODEL_CAPABILITIES[tier].models;
      const profile = models.find((m) => m.name.toLowerCase() === normalized);
      if (profile) {
        return profile;
      }
    }

    return null;
  }

  /**
   * Get enforcement rules for a model
   * @param modelName - Model identifier
   * @returns Enforcement rules for the model's tier
   */
  getEnforcementRules(modelName: string): EnforcementRules {
    const tier = this.getModelTier(modelName);
    return MODEL_CAPABILITIES.enforcementRules[tier];
  }

  /**
   * Check if a model should enforce CV-first workflow strictly
   * @param modelName - Model identifier
   * @returns true if strict enforcement is enabled
   */
  shouldEnforceCvFirst(modelName: string): boolean {
    const rules = this.getEnforcementRules(modelName);
    return rules.enforceCvFirst;
  }

  /**
   * Check if a model allows click violations
   * @param modelName - Model identifier
   * @returns true if click violations are allowed
   */
  allowsClickViolations(modelName: string): boolean {
    const rules = this.getEnforcementRules(modelName);
    return rules.allowClickViolations;
  }

  /**
   * Get maximum CV attempts before fallback for a model
   * @param modelName - Model identifier
   * @returns Maximum number of CV detection attempts
   */
  getMaxCvAttempts(modelName: string): number {
    const rules = this.getEnforcementRules(modelName);
    return rules.maxCvAttempts;
  }

  /**
   * Get loop detection threshold for a model
   * @param modelName - Model identifier
   * @returns Number of identical failures before triggering loop detection
   */
  getLoopDetectionThreshold(modelName: string): number {
    const rules = this.getEnforcementRules(modelName);
    return rules.loopDetectionThreshold;
  }

  /**
   * Get all models in a specific tier
   * @param tier - Tier to query
   * @returns Array of model profiles
   */
  getModelsInTier(tier: ModelTier): ModelProfile[] {
    return MODEL_CAPABILITIES[tier].models;
  }

  /**
   * Get tier summary information
   * @returns Summary of all tiers and model counts
   */
  getTierSummary(): {
    tier1Count: number;
    tier2Count: number;
    tier3Count: number;
    defaultTier: ModelTier;
  } {
    return {
      tier1Count: MODEL_CAPABILITIES.tier1.models.length,
      tier2Count: MODEL_CAPABILITIES.tier2.models.length,
      tier3Count: MODEL_CAPABILITIES.tier3.models.length,
      defaultTier: MODEL_CAPABILITIES.defaultTier,
    };
  }
}
