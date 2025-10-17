import { Injectable, Logger } from '@nestjs/common';

/**
 * Tool call pattern for loop detection
 */
interface ToolCallPattern {
  toolName: string;
  params: string; // JSON stringified parameters
  timestamp: number;
}

/**
 * Loop detection result
 */
export interface LoopDetectionResult {
  isLoop: boolean;
  loopCount?: number;
  pattern?: string;
  suggestion?: string;
}

/**
 * Loop Detection Service
 *
 * Detects when AI models get stuck in repetitive tool call patterns
 * (e.g., repeatedly calling computer_detect_elements with same params)
 *
 * Based on real-world analysis:
 * - Qwen3-VL got stuck calling detect→click→detect→click for same element
 * - 6 repeated CV detection attempts before requesting help
 * - Pattern: same tool + same params repeatedly
 */
@Injectable()
export class LoopDetectionService {
  private readonly logger = new Logger('LoopDetectionService');

  // Track tool call history per task
  private readonly taskToolHistory = new Map<string, ToolCallPattern[]>();

  // Default thresholds (can be overridden by model tier)
  private readonly DEFAULT_LOOP_THRESHOLD = 3; // Detect after 3 identical calls
  private readonly HISTORY_WINDOW_MS = 5 * 60 * 1000; // Look back 5 minutes
  private readonly MAX_HISTORY_SIZE = 100; // Keep last 100 tool calls per task

  /**
   * Record a tool call for loop detection
   */
  recordToolCall(
    taskId: string,
    toolName: string,
    params: Record<string, any>,
  ): void {
    // Normalize params to JSON for comparison
    const paramsStr = JSON.stringify(this.normalizeParams(params));

    const pattern: ToolCallPattern = {
      toolName,
      params: paramsStr,
      timestamp: Date.now(),
    };

    // Get or create history for this task
    let history = this.taskToolHistory.get(taskId);
    if (!history) {
      history = [];
      this.taskToolHistory.set(taskId, history);
    }

    // Add new pattern
    history.push(pattern);

    // Trim old history (keep last MAX_HISTORY_SIZE calls)
    if (history.length > this.MAX_HISTORY_SIZE) {
      history.splice(0, history.length - this.MAX_HISTORY_SIZE);
    }

    // Clean up old entries outside time window
    const cutoffTime = Date.now() - this.HISTORY_WINDOW_MS;
    this.taskToolHistory.set(
      taskId,
      history.filter((p) => p.timestamp >= cutoffTime),
    );
  }

  /**
   * Normalize params for comparison (ignore timestamps, order, etc.)
   */
  private normalizeParams(params: Record<string, any>): Record<string, any> {
    const normalized: Record<string, any> = {};

    // Sort keys for consistent comparison
    const sortedKeys = Object.keys(params).sort();

    for (const key of sortedKeys) {
      const value = params[key];

      // Skip timestamp-like fields
      if (key === 'timestamp' || key === 'createdAt' || key === 'updatedAt') {
        continue;
      }

      // Normalize nested objects recursively
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        normalized[key] = this.normalizeParams(value);
      } else {
        normalized[key] = value;
      }
    }

    return normalized;
  }

  /**
   * Detect if the model is stuck in a loop
   *
   * @param taskId - Current task ID
   * @param threshold - Number of identical calls to trigger loop detection (default: tier-specific)
   * @returns Loop detection result with suggestions
   */
  detectLoop(taskId: string, threshold?: number): LoopDetectionResult {
    const history = this.taskToolHistory.get(taskId);
    if (!history || history.length === 0) {
      return { isLoop: false };
    }

    const loopThreshold = threshold ?? this.DEFAULT_LOOP_THRESHOLD;

    // Look at recent history (within time window)
    const cutoffTime = Date.now() - this.HISTORY_WINDOW_MS;
    const recentHistory = history.filter((p) => p.timestamp >= cutoffTime);

    if (recentHistory.length < loopThreshold) {
      return { isLoop: false };
    }

    // Check for repeated patterns in recent history
    const patternCounts = new Map<string, number>();
    const patternDetails = new Map<string, ToolCallPattern>();

    for (const pattern of recentHistory) {
      const key = `${pattern.toolName}:${pattern.params}`;
      const count = (patternCounts.get(key) || 0) + 1;
      patternCounts.set(key, count);
      patternDetails.set(key, pattern);
    }

    // Find patterns that repeat above threshold
    for (const [key, count] of patternCounts.entries()) {
      if (count >= loopThreshold) {
        const pattern = patternDetails.get(key)!;
        const suggestion = this.getSuggestion(pattern.toolName, count);

        this.logger.warn(
          `Loop detected in task ${taskId}: ${pattern.toolName} called ${count} times with same params`,
        );

        return {
          isLoop: true,
          loopCount: count,
          pattern: key,
          suggestion,
        };
      }
    }

    return { isLoop: false };
  }

  /**
   * Get suggestion for breaking out of loop
   */
  private getSuggestion(toolName: string, loopCount: number): string {
    if (toolName === 'computer_detect_elements') {
      return `CV detection has failed ${loopCount} times with the same query. Try:
1. Use keyboard shortcuts instead (Tab, Ctrl+P, etc.)
2. Try discovery mode: computer_detect_elements({ description: "", includeAll: true })
3. Fallback to computer_click_mouse with grid coordinates
4. Request help if the element is truly not detectable`;
    }

    if (toolName === 'computer_click_mouse') {
      return `Mouse click has been attempted ${loopCount} times at the same location. Try:
1. Take a fresh screenshot to verify UI state
2. Try keyboard shortcuts instead
3. Check if the element moved or changed
4. Request help if stuck`;
    }

    if (toolName === 'computer_screenshot') {
      return `Screenshot has been called ${loopCount} times without progress. Try:
1. Execute an action instead of just observing
2. Use keyboard shortcuts to change UI state
3. Request help if you're stuck planning`;
    }

    return `Tool ${toolName} has been called ${loopCount} times. Try a different approach or request help.`;
  }

  /**
   * Clear loop detection history for a task
   */
  clearTaskHistory(taskId: string): void {
    this.taskToolHistory.delete(taskId);
    this.logger.debug(`Cleared loop detection history for task ${taskId}`);
  }

  /**
   * Get recent tool call history for debugging
   */
  getTaskHistory(taskId: string, limit: number = 20): ToolCallPattern[] {
    const history = this.taskToolHistory.get(taskId) || [];
    return history.slice(-limit);
  }

  /**
   * Check if specific tool+params combination has been attempted recently
   */
  hasRecentAttempt(
    taskId: string,
    toolName: string,
    params: Record<string, any>,
    withinMs: number = 60000, // Default: 1 minute
  ): boolean {
    const history = this.taskToolHistory.get(taskId);
    if (!history) {
      return false;
    }

    const cutoffTime = Date.now() - withinMs;
    const paramsStr = JSON.stringify(this.normalizeParams(params));

    return history.some(
      (p) =>
        p.timestamp >= cutoffTime &&
        p.toolName === toolName &&
        p.params === paramsStr,
    );
  }

  /**
   * Get statistics about tool usage patterns
   */
  getToolStats(taskId: string): {
    totalCalls: number;
    uniquePatterns: number;
    mostCommonTool: string | null;
    mostCommonPattern: string | null;
  } {
    const history = this.taskToolHistory.get(taskId) || [];

    const toolCounts = new Map<string, number>();
    const patternCounts = new Map<string, number>();

    for (const pattern of history) {
      // Count tool names
      const toolCount = (toolCounts.get(pattern.toolName) || 0) + 1;
      toolCounts.set(pattern.toolName, toolCount);

      // Count full patterns
      const key = `${pattern.toolName}:${pattern.params}`;
      const patternCount = (patternCounts.get(key) || 0) + 1;
      patternCounts.set(key, patternCount);
    }

    // Find most common
    let mostCommonTool: string | null = null;
    let maxToolCount = 0;
    for (const [tool, count] of toolCounts.entries()) {
      if (count > maxToolCount) {
        maxToolCount = count;
        mostCommonTool = tool;
      }
    }

    let mostCommonPattern: string | null = null;
    let maxPatternCount = 0;
    for (const [pattern, count] of patternCounts.entries()) {
      if (count > maxPatternCount) {
        maxPatternCount = count;
        mostCommonPattern = pattern;
      }
    }

    return {
      totalCalls: history.length,
      uniquePatterns: patternCounts.size,
      mostCommonTool,
      mostCommonPattern,
    };
  }
}
