import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Phase 3.1: Task Blocker Memory Service
 *
 * Enables cross-model learning by recording blockers that cause task failures.
 * When a model encounters a blocker (modal dialog, timeout, crash, etc.),
 * subsequent models are informed so they can avoid the same failure.
 */
@Injectable()
export class TaskBlockerService {
  private readonly logger = new Logger(TaskBlockerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a blocker that caused a task to fail or require help
   *
   * @param taskId - Task that encountered the blocker
   * @param blockerType - Type of blocker encountered
   * @param description - Human-readable description
   * @param modelName - Model that failed on this blocker
   * @param metadata - Additional context (dialog text, error messages, etc.)
   * @param screenshotId - Reference to screenshot showing the blocker
   */
  async recordBlocker(params: {
    taskId: string;
    blockerType: 'modal_dialog' | 'timeout' | 'permission_denied' | 'element_not_found' | 'crash';
    description: string;
    modelName: string;
    metadata?: any;
    screenshotId?: string;
  }): Promise<void> {
    const { taskId, blockerType, description, modelName, metadata, screenshotId } = params;

    try {
      // Check if this blocker already exists for this task
      const existingBlocker = await this.prisma.taskBlocker.findFirst({
        where: {
          taskId,
          blockerType,
          resolved: false,
        },
      });

      if (existingBlocker) {
        // Add model to failedModels list if not already present
        const failedModels = existingBlocker.failedModels || [];
        if (!failedModels.includes(modelName)) {
          await this.prisma.taskBlocker.update({
            where: { id: existingBlocker.id },
            data: {
              failedModels: [...failedModels, modelName],
              metadata: metadata || existingBlocker.metadata,
            },
          });

          this.logger.log(
            `Updated blocker for task ${taskId}: ${blockerType} - Model ${modelName} added to failed list (${failedModels.length + 1} models failed)`,
          );
        }
      } else {
        // Create new blocker record
        await this.prisma.taskBlocker.create({
          data: {
            taskId,
            blockerType,
            description,
            screenshotId,
            failedModels: [modelName],
            metadata,
          },
        });

        this.logger.log(
          `Recorded new blocker for task ${taskId}: ${blockerType} - "${description}" (Model: ${modelName})`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to record blocker for task ${taskId}: ${error.message}`,
      );
    }
  }

  /**
   * Get all unresolved blockers for a task
   * Used to inform subsequent models about known failure points
   *
   * @param taskId - Task to get blockers for
   * @returns Array of unresolved blockers
   */
  async getUnresolvedBlockers(taskId: string) {
    return this.prisma.taskBlocker.findMany({
      where: {
        taskId,
        resolved: false,
      },
      orderBy: {
        detectedAt: 'asc', // Oldest first
      },
    });
  }

  /**
   * Mark a blocker as resolved
   *
   * @param blockerId - Blocker to mark as resolved
   * @param resolutionNotes - How the blocker was resolved
   */
  async resolveBlocker(blockerId: string, resolutionNotes: string): Promise<void> {
    try {
      await this.prisma.taskBlocker.update({
        where: { id: blockerId },
        data: {
          resolved: true,
          resolutionNotes,
        },
      });

      this.logger.log(`Resolved blocker ${blockerId}: ${resolutionNotes}`);
    } catch (error) {
      this.logger.error(`Failed to resolve blocker ${blockerId}: ${error.message}`);
    }
  }

  /**
   * Generate system prompt context from blockers
   * Formats blocker information for injection into model system prompts
   *
   * @param taskId - Task to get blocker context for
   * @returns Formatted context string or null if no blockers
   */
  async getBlockerContext(taskId: string): Promise<string | null> {
    const blockers = await this.getUnresolvedBlockers(taskId);

    if (blockers.length === 0) {
      return null;
    }

    const lines = [
      '════════════════════════════════',
      '⚠️ PREVIOUS ATTEMPTS FAILED',
      '════════════════════════════════',
      '',
      'The following blockers were encountered by previous models:',
      '',
    ];

    for (const blocker of blockers) {
      lines.push(`**Blocker Type:** ${blocker.blockerType}`);
      lines.push(`**Description:** ${blocker.description}`);
      lines.push(`**Failed Models:** ${blocker.failedModels.join(', ')}`);

      if (blocker.metadata) {
        const metadata = blocker.metadata as any;
        if (metadata.dialog_text) {
          lines.push(`**Dialog Text:** "${metadata.dialog_text}"`);
        }
        if (metadata.button_options) {
          lines.push(`**Button Options:** ${metadata.button_options.join(', ')}`);
        }
        if (metadata.suggested_approach) {
          lines.push(`**Suggested Approach:** ${metadata.suggested_approach}`);
        }
      }

      lines.push('');
    }

    lines.push('**CRITICAL:** Learn from these failures. Do NOT repeat the same approach that failed.');
    lines.push('If you encounter the same blocker, escalate with set_task_status(NEEDS_HELP).');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Auto-detect and record blocker from helpContext
   * Called when a task transitions to NEEDS_HELP
   *
   * @param taskId - Task that needs help
   * @param helpContext - Help context from task
   * @param modelName - Model that requested help
   */
  async detectAndRecordFromHelpContext(
    taskId: string,
    helpContext: any,
    modelName: string,
  ): Promise<void> {
    if (!helpContext) return;

    const blockerType = this.mapHelpContextToBlockerType(helpContext);
    if (!blockerType) return;

    const description = helpContext.message || 'Task requires help';
    const metadata = {
      reason: helpContext.reason,
      blocker_type: helpContext.blockerType,
      elapsed_ms: helpContext.elapsedMs,
      suggested_actions: helpContext.suggestedActions,
      timestamp: helpContext.timestamp,
    };

    await this.recordBlocker({
      taskId,
      blockerType,
      description,
      modelName,
      metadata,
    });
  }

  /**
   * Map helpContext.blockerType to TaskBlocker.blockerType
   */
  private mapHelpContextToBlockerType(
    helpContext: any,
  ): 'modal_dialog' | 'timeout' | 'permission_denied' | 'element_not_found' | 'crash' | null {
    const blockerType = helpContext.blockerType || '';

    if (blockerType.includes('dialog') || blockerType.includes('modal')) {
      return 'modal_dialog';
    }
    if (blockerType.includes('timeout')) {
      return 'timeout';
    }
    if (blockerType.includes('permission')) {
      return 'permission_denied';
    }
    if (blockerType.includes('not_found') || blockerType.includes('element')) {
      return 'element_not_found';
    }
    if (blockerType.includes('crash') || blockerType.includes('error')) {
      return 'crash';
    }

    return null;
  }
}
