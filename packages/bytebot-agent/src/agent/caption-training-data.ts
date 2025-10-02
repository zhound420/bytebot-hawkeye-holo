/**
 * Data collection system for fine-tuning OmniParser captions
 *
 * Collects training data from:
 * 1. LLM-provided descriptions when CV fails
 * 2. Successful/failed click feedback
 * 3. User corrections
 *
 * This data can be used to:
 * - Fine-tune Florence-2 model
 * - Train a secondary classifier
 * - Build better semantic mappings
 */

import * as fs from 'fs';
import * as path from 'path';

export interface CaptionTrainingEntry {
  // OmniParser's visual caption
  visualCaption: string;

  // Functional names (what users call it)
  functionalNames: string[];

  // Context
  applicationContext: string;
  elementCoordinates: { x: number; y: number; width: number; height: number };

  // LLM description (if available)
  llmDescription?: string;
  llmKeywords?: string[];

  // Verification
  clickSuccessful?: boolean;
  clickCount: number;
  successCount: number;
  failureCount: number;

  // Metadata
  timestamp: number;
  confidence: number; // 0.0 - 1.0 based on feedback
}

export class CaptionTrainingDataCollector {
  private readonly dataPath: string;
  private cache: Map<string, CaptionTrainingEntry> = new Map();

  constructor(dataPath?: string) {
    this.dataPath = dataPath || path.join(__dirname, '../data/caption-training-data.json');
    this.load();
  }

  /**
   * Record a caption mismatch where LLM provided better description
   */
  recordLLMCorrection(
    visualCaption: string,
    functionalQuery: string,
    llmDescription: string,
    llmKeywords: string[],
    context: {
      application: string;
      coordinates: { x: number; y: number; width: number; height: number };
    }
  ): void {
    const key = this.makeKey(visualCaption, context.application);
    const existing = this.cache.get(key);

    // Extract functional names from query
    const functionalNames = this.extractFunctionalNames(functionalQuery, llmKeywords);

    if (existing) {
      // Update existing entry
      existing.llmDescription = llmDescription;
      existing.llmKeywords = llmKeywords;
      existing.functionalNames = [
        ...new Set([...existing.functionalNames, ...functionalNames])
      ];
      existing.timestamp = Date.now();
    } else {
      // Create new entry
      this.cache.set(key, {
        visualCaption,
        functionalNames,
        applicationContext: context.application,
        elementCoordinates: context.coordinates,
        llmDescription,
        llmKeywords,
        clickCount: 0,
        successCount: 0,
        failureCount: 0,
        timestamp: Date.now(),
        confidence: 0.5, // Initial confidence
      });
    }

    this.save();
  }

  /**
   * Record click feedback for reinforcement
   */
  recordClickFeedback(
    visualCaption: string,
    functionalQuery: string,
    success: boolean,
    context: { application: string }
  ): void {
    const key = this.makeKey(visualCaption, context.application);
    const entry = this.cache.get(key);

    if (!entry) {
      // If no entry exists, we can't learn from this yet
      return;
    }

    entry.clickCount++;
    if (success) {
      entry.successCount++;
      // Increase confidence
      entry.confidence = Math.min(1.0, entry.confidence + 0.1);
    } else {
      entry.failureCount++;
      // Decrease confidence
      entry.confidence = Math.max(0.0, entry.confidence - 0.15);
    }

    entry.clickSuccessful = success;
    entry.timestamp = Date.now();

    // If confidence drops too low, remove entry (bad mapping)
    if (entry.confidence < 0.2) {
      this.cache.delete(key);
    }

    this.save();
  }

  /**
   * Get all high-confidence training entries for fine-tuning
   */
  getTrainingDataset(minConfidence: number = 0.6): CaptionTrainingEntry[] {
    return Array.from(this.cache.values())
      .filter(entry => entry.confidence >= minConfidence && entry.clickCount >= 3)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Export dataset in format suitable for Florence-2 fine-tuning
   */
  exportForFineTuning(minConfidence: number = 0.7): Array<{
    visual_caption: string;
    functional_caption: string;
    context: string;
    confidence: number;
  }> {
    const dataset = this.getTrainingDataset(minConfidence);

    return dataset.map(entry => ({
      visual_caption: entry.visualCaption,
      functional_caption: entry.functionalNames.join(', '),
      context: entry.applicationContext,
      confidence: entry.confidence,
    }));
  }

  /**
   * Get statistics about training data quality
   */
  getStats() {
    const entries = Array.from(this.cache.values());
    const verified = entries.filter(e => e.clickCount >= 3);
    const highConfidence = entries.filter(e => e.confidence >= 0.7);

    return {
      totalEntries: entries.length,
      verifiedEntries: verified.length,
      highConfidenceEntries: highConfidence.length,
      avgConfidence: entries.length > 0
        ? entries.reduce((sum, e) => sum + e.confidence, 0) / entries.length
        : 0,
      totalClicks: entries.reduce((sum, e) => sum + e.clickCount, 0),
      successRate: entries.reduce((sum, e) => sum + e.successCount, 0) /
                    Math.max(1, entries.reduce((sum, e) => sum + e.clickCount, 0)),
    };
  }

  private makeKey(visualCaption: string, application: string): string {
    return `${application}:${visualCaption.toLowerCase().substring(0, 50)}`;
  }

  private extractFunctionalNames(query: string, llmKeywords: string[]): string[] {
    const names = new Set<string>();

    // Add query words (filter out stop words)
    const stopWords = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'for', 'to', 'icon', 'button']);
    query.toLowerCase().split(/\s+/).forEach(word => {
      if (word.length > 2 && !stopWords.has(word)) {
        names.add(word);
      }
    });

    // Add LLM keywords (already filtered)
    llmKeywords.forEach(kw => names.add(kw));

    return Array.from(names);
  }

  private load(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
        this.cache = new Map(Object.entries(data));
      }
    } catch (error) {
      console.warn('Failed to load caption training data:', error);
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = Object.fromEntries(this.cache);
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.warn('Failed to save caption training data:', error);
    }
  }
}
