import { Controller, Get } from '@nestjs/common';
import { AgentProcessor } from './agent.processor';

@Controller('learning-metrics')
export class LearningMetricsController {
  constructor(private readonly agentProcessor: AgentProcessor) {}

  /**
   * Get all learning cache entries with confidence scores
   */
  @Get('cache')
  getCacheEntries() {
    return this.agentProcessor.getVisualDescriptionCache();
  }

  /**
   * Get learning statistics summary
   */
  @Get('stats')
  getStats() {
    const cache = this.agentProcessor.getVisualDescriptionCache();
    const entries = Object.values(cache.cache).flatMap(app =>
      Object.values(app)
    );

    const totalEntries = entries.length;
    const avgConfidence = entries.length > 0
      ? entries.reduce((sum, e) => sum + (e.confidence || 0.5), 0) / entries.length
      : 0;
    const totalSuccesses = entries.reduce((sum, e) => sum + (e.successCount || 0), 0);
    const totalFailures = entries.reduce((sum, e) => sum + (e.failureCount || 0), 0);
    const totalHits = entries.reduce((sum, e) => sum + (e.hits || 0), 0);

    // Group by application
    const byApplication: Record<string, any> = {};
    for (const [app, appEntries] of Object.entries(cache.cache)) {
      const appEntriesArray = Object.values(appEntries);
      byApplication[app] = {
        count: appEntriesArray.length,
        avgConfidence: appEntriesArray.length > 0
          ? appEntriesArray.reduce((sum, e) => sum + (e.confidence || 0.5), 0) / appEntriesArray.length
          : 0,
        totalHits: appEntriesArray.reduce((sum, e) => sum + (e.hits || 0), 0),
      };
    }

    return {
      totalEntries,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      totalSuccesses,
      totalFailures,
      totalHits,
      successRate: totalSuccesses + totalFailures > 0
        ? Math.round((totalSuccesses / (totalSuccesses + totalFailures)) * 100) / 100
        : 0,
      byApplication,
    };
  }

  /**
   * Get top performing cache entries
   */
  @Get('top')
  getTopEntries() {
    const cache = this.agentProcessor.getVisualDescriptionCache();
    const entries: Array<{
      app: string;
      element: string;
      confidence: number;
      hits: number;
      successCount: number;
      failureCount: number;
      lastUsed: number;
    }> = [];

    for (const [app, appEntries] of Object.entries(cache.cache)) {
      for (const [element, data] of Object.entries(appEntries)) {
        entries.push({
          app,
          element,
          confidence: data.confidence || 0.5,
          hits: data.hits || 0,
          successCount: data.successCount || 0,
          failureCount: data.failureCount || 0,
          lastUsed: data.lastUsed || data.timestamp,
        });
      }
    }

    // Sort by confidence * hits (high confidence + frequently used)
    entries.sort((a, b) => {
      const scoreA = a.confidence * (a.hits + 1);
      const scoreB = b.confidence * (b.hits + 1);
      return scoreB - scoreA;
    });

    return entries.slice(0, 10);
  }
}
