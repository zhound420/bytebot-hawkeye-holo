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
 * - Model tier lookup (Tier 1/2/3 based on CV capability)
 * - Enforcement rule retrieval
 * - Dynamic tier assignment for unknown models
 * - Pattern-based fuzzy matching
 */
@Injectable()
export class ModelCapabilityService {
  private readonly logger = new Logger('ModelCapabilityService');

  /**
   * Get the tier for a given model
   * @param modelName - Model identifier (e.g., "gpt-4o", "openai/gpt-4o")
   * @returns Model tier (tier1, tier2, or tier3)
   */
  getModelTier(modelName: string): ModelTier {
    if (!modelName) {
      this.logger.warn('No model name provided, using default tier');
      return MODEL_CAPABILITIES.defaultTier;
    }

    // Normalize model name (lowercase, trim)
    const normalized = modelName.toLowerCase().trim();

    // 1. Try exact match first
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

    // 2. Try pattern matching
    for (const tier of ['tier1', 'tier2', 'tier3'] as ModelTier[]) {
      const patterns = MODEL_CAPABILITIES.patterns[tier];
      const patternMatch = patterns.find((pattern) =>
        normalized.includes(pattern.toLowerCase()),
      );
      if (patternMatch) {
        this.logger.debug(
          `Model "${modelName}" matched tier ${tier} (pattern: ${patternMatch})`,
        );
        return tier;
      }
    }

    // 3. Default tier for unknown models
    this.logger.log(
      `Model "${modelName}" not recognized, using default tier: ${MODEL_CAPABILITIES.defaultTier}`,
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
