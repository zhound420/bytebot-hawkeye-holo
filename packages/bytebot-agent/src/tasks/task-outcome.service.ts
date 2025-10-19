import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TaskStatus } from '@prisma/client';

/**
 * Phase 3.3: Task Outcome Tracking and Empirical Model Learning
 *
 * Tracks task outcomes to build empirical understanding of which models
 * perform best in different scenarios. Replaces static tier system with
 * data-driven model recommendations.
 */
@Injectable()
export class TaskOutcomeService {
  private readonly logger = new Logger(TaskOutcomeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record task outcome when task completes, fails, or is cancelled
   *
   * @param taskId - Task to record outcome for
   */
  async recordTaskOutcome(taskId: string): Promise<void> {
    try {
      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
        include: {
          messages: true,
          blockers: true,
          dialogInteractions: true,
        },
      });

      if (!task) {
        this.logger.warn(`Task ${taskId} not found for outcome recording`);
        return;
      }

      // Only record outcomes for terminal states
      if (
        task.status !== TaskStatus.COMPLETED &&
        task.status !== TaskStatus.FAILED &&
        task.status !== TaskStatus.CANCELLED
      ) {
        return;
      }

      // Extract model information
      const model = task.model as any;
      const modelName = model?.name || 'unknown';
      const modelProvider = model?.provider || 'unknown';

      // Calculate metrics
      const totalDurationMs = task.completedAt
        ? task.completedAt.getTime() - task.createdAt.getTime()
        : Date.now() - task.createdAt.getTime();

      // Count tool calls from messages
      const toolCallCount = task.messages.filter((msg) => {
        const content = msg.content as any;
        return Array.isArray(content) && content.some((block: any) => block.type === 'tool_use');
      }).length;

      // Count CV detections (messages with detect_elements tool)
      const cvDetectionCount = task.messages.filter((msg) => {
        const content = msg.content as any;
        return (
          Array.isArray(content) &&
          content.some(
            (block: any) =>
              block.type === 'tool_use' &&
              (block.name === 'computer_detect_elements' || block.name === 'computer_click_element'),
          )
        );
      }).length;

      // Count clicks (messages with click/click_element tools)
      const clickCount = task.messages.filter((msg) => {
        const content = msg.content as any;
        return (
          Array.isArray(content) &&
          content.some(
            (block: any) =>
              block.type === 'tool_use' &&
              (block.name === 'computer_click' || block.name === 'computer_click_element'),
          )
        );
      }).length;

      // Count errors (tool_result blocks with is_error: true)
      const errorCount = task.messages.filter((msg) => {
        const content = msg.content as any;
        return (
          Array.isArray(content) &&
          content.some((block: any) => block.type === 'tool_result' && block.is_error)
        );
      }).length;

      // Determine outcome
      let outcome: string;
      if (task.status === TaskStatus.COMPLETED) {
        outcome = 'success';
      } else if (task.status === TaskStatus.FAILED) {
        outcome = 'failure';
      } else if (task.status === TaskStatus.CANCELLED) {
        outcome = 'abandoned';
      } else {
        outcome = 'needs_help';
      }

      // Infer complexity based on metrics
      let taskComplexity: string;
      if (toolCallCount < 5 && totalDurationMs < 30000) {
        taskComplexity = 'simple';
      } else if (toolCallCount < 15 && totalDurationMs < 120000) {
        taskComplexity = 'medium';
      } else {
        taskComplexity = 'complex';
      }

      // Collect blocker types
      const blockerTypes = task.blockers
        .filter((b) => !b.resolved)
        .map((b) => b.blockerType);

      // Check if help was required
      const requiredHelp = task.needsHelpCount > 0;

      // Check if this was first attempt (no previous outcomes for same description)
      const previousOutcomes = await this.prisma.taskOutcome.count({
        where: {
          taskDescription: task.description,
          createdAt: {
            lt: task.createdAt,
          },
        },
      });
      const firstAttempt = previousOutcomes === 0;

      // Record outcome
      await this.prisma.taskOutcome.create({
        data: {
          taskId,
          modelName,
          modelProvider,
          finalStatus: task.status,
          outcome,
          totalDurationMs,
          toolCallCount,
          cvDetectionCount,
          clickCount,
          errorCount,
          taskDescription: task.description,
          taskComplexity,
          blockerTypes,
          requiredHelp,
          firstAttempt,
          completedAt: task.completedAt || new Date(),
        },
      });

      this.logger.log(
        `Recorded outcome for task ${taskId}: ` +
        `model=${modelName}, outcome=${outcome}, complexity=${taskComplexity}, ` +
        `duration=${Math.round(totalDurationMs / 1000)}s, tools=${toolCallCount}, ` +
        `clicks=${clickCount}, errors=${errorCount}`,
      );
    } catch (error) {
      this.logger.error(`Failed to record outcome for task ${taskId}: ${error.message}`);
    }
  }

  /**
   * Get success rate for a specific model
   *
   * @param modelName - Model to analyze
   * @param minSamples - Minimum number of samples required (default: 5)
   * @returns Success rate (0.0-1.0) or null if insufficient data
   */
  async getModelSuccessRate(modelName: string, minSamples = 5): Promise<number | null> {
    const outcomes = await this.prisma.taskOutcome.findMany({
      where: { modelName },
      select: { outcome: true },
    });

    if (outcomes.length < minSamples) {
      return null; // Insufficient data
    }

    const successCount = outcomes.filter((o) => o.outcome === 'success').length;
    return successCount / outcomes.length;
  }

  /**
   * Get model performance statistics
   *
   * @param modelName - Model to analyze
   * @returns Performance stats or null if no data
   */
  async getModelPerformanceStats(modelName: string): Promise<{
    totalTasks: number;
    successRate: number;
    avgDurationMs: number;
    avgToolCalls: number;
    avgClicks: number;
    errorRate: number;
    helpRate: number;
  } | null> {
    const outcomes = await this.prisma.taskOutcome.findMany({
      where: { modelName },
    });

    if (outcomes.length === 0) {
      return null;
    }

    const successCount = outcomes.filter((o) => o.outcome === 'success').length;
    const helpCount = outcomes.filter((o) => o.requiredHelp).length;
    const totalErrors = outcomes.reduce((sum, o) => sum + o.errorCount, 0);

    return {
      totalTasks: outcomes.length,
      successRate: successCount / outcomes.length,
      avgDurationMs: outcomes.reduce((sum, o) => sum + o.totalDurationMs, 0) / outcomes.length,
      avgToolCalls: outcomes.reduce((sum, o) => sum + o.toolCallCount, 0) / outcomes.length,
      avgClicks: outcomes.reduce((sum, o) => sum + o.clickCount, 0) / outcomes.length,
      errorRate: totalErrors / (outcomes.length * 10), // Normalize to 0-1 assuming max 10 errors/task
      helpRate: helpCount / outcomes.length,
    };
  }

  /**
   * Recommend best models for a given task based on empirical data
   *
   * @param taskDescription - Task description or keywords
   * @param complexity - Task complexity hint ('simple', 'medium', 'complex')
   * @returns Ranked list of recommended model names
   */
  async recommendModels(
    taskDescription: string,
    complexity?: string,
  ): Promise<Array<{ modelName: string; score: number; reasoning: string }>> {
    // Get all models with outcomes
    const allOutcomes = await this.prisma.taskOutcome.findMany({
      where: complexity ? { taskComplexity: complexity } : {},
    });

    if (allOutcomes.length === 0) {
      return []; // No data yet
    }

    // Group by model
    const modelGroups = new Map<string, any[]>();
    for (const outcome of allOutcomes) {
      if (!modelGroups.has(outcome.modelName)) {
        modelGroups.set(outcome.modelName, []);
      }
      modelGroups.get(outcome.modelName)!.push(outcome);
    }

    // Score each model
    const scores: Array<{ modelName: string; score: number; reasoning: string }> = [];

    for (const [modelName, outcomes] of modelGroups.entries()) {
      const successCount = outcomes.filter((o) => o.outcome === 'success').length;
      const successRate = successCount / outcomes.length;
      const avgDuration = outcomes.reduce((sum, o) => sum + o.totalDurationMs, 0) / outcomes.length;
      const helpRate = outcomes.filter((o) => o.requiredHelp).length / outcomes.length;

      // Score: 60% success rate, 20% speed, 20% autonomy (inverse of help rate)
      const score =
        successRate * 0.6 +
        (1 - Math.min(avgDuration / 300000, 1)) * 0.2 + // Normalize duration (max 5 min)
        (1 - helpRate) * 0.2;

      const reasoning =
        `${Math.round(successRate * 100)}% success, ` +
        `${Math.round(avgDuration / 1000)}s avg, ` +
        `${Math.round((1 - helpRate) * 100)}% autonomous`;

      scores.push({ modelName, score, reasoning });
    }

    // Sort by score descending
    return scores.sort((a, b) => b.score - a.score);
  }

  /**
   * Get leaderboard of best performing models
   *
   * @param limit - Number of top models to return
   * @returns Top models with stats
   */
  async getModelLeaderboard(limit = 10): Promise<
    Array<{
      modelName: string;
      successRate: number;
      totalTasks: number;
      avgDurationMs: number;
    }>
  > {
    const allOutcomes = await this.prisma.taskOutcome.findMany();

    // Group by model
    const modelGroups = new Map<string, any[]>();
    for (const outcome of allOutcomes) {
      if (!modelGroups.has(outcome.modelName)) {
        modelGroups.set(outcome.modelName, []);
      }
      modelGroups.get(outcome.modelName)!.push(outcome);
    }

    // Calculate stats for each model
    const leaderboard: Array<{
      modelName: string;
      successRate: number;
      totalTasks: number;
      avgDurationMs: number;
    }> = [];

    for (const [modelName, outcomes] of modelGroups.entries()) {
      // Require at least 5 tasks for leaderboard
      if (outcomes.length < 5) continue;

      const successCount = outcomes.filter((o) => o.outcome === 'success').length;
      const successRate = successCount / outcomes.length;
      const avgDurationMs =
        outcomes.reduce((sum, o) => sum + o.totalDurationMs, 0) / outcomes.length;

      leaderboard.push({
        modelName,
        successRate,
        totalTasks: outcomes.length,
        avgDurationMs,
      });
    }

    // Sort by success rate, then by total tasks
    return leaderboard
      .sort((a, b) => {
        if (Math.abs(a.successRate - b.successRate) < 0.05) {
          return b.totalTasks - a.totalTasks;
        }
        return b.successRate - a.successRate;
      })
      .slice(0, limit);
  }
}
