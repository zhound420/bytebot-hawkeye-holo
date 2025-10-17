import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TaskStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

export interface ArchivedTask {
  id: string;
  description: string;
  status: TaskStatus;
  createdAt: Date;
  completedAt: Date | null;
  messageCount: number;
  summaryCount: number;
}

@Injectable()
export class TaskArchivalService {
  private readonly logger = new Logger(TaskArchivalService.name);
  private readonly archiveDir = path.join(
    process.cwd(),
    'data',
    'task-archives',
  );

  constructor(private readonly prisma: PrismaService) {
    // Ensure archive directory exists
    if (!fs.existsSync(this.archiveDir)) {
      fs.mkdirSync(this.archiveDir, { recursive: true });
      this.logger.log(`Created archive directory: ${this.archiveDir}`);
    }
  }

  /**
   * Archive completed tasks older than the specified number of days
   * Exports task data to JSON and removes from database
   */
  async archiveOldTasks(
    retentionDays: number = 30,
  ): Promise<{ archived: number; errors: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    this.logger.log(
      `Archiving tasks completed before ${cutoffDate.toISOString()} (${retentionDays} days ago)`,
    );

    try {
      // Find completed/cancelled/failed tasks older than retention period
      const tasksToArchive = await this.prisma.task.findMany({
        where: {
          status: {
            in: [TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.FAILED],
          },
          completedAt: {
            lt: cutoffDate,
          },
        },
        include: {
          messages: true,
          summaries: true,
          files: {
            select: {
              id: true,
              name: true,
              type: true,
              size: true,
              storagePath: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          completedAt: 'asc',
        },
      });

      if (tasksToArchive.length === 0) {
        this.logger.log('No tasks found for archival');
        return { archived: 0, errors: 0 };
      }

      this.logger.log(
        `Found ${tasksToArchive.length} task(s) eligible for archival`,
      );

      let archivedCount = 0;
      let errorCount = 0;

      for (const task of tasksToArchive) {
        try {
          // Export task to JSON file
          const archiveFilename = `${task.id}_${task.completedAt?.toISOString().replace(/:/g, '-')}.json`;
          const archivePath = path.join(this.archiveDir, archiveFilename);

          const archiveData = {
            task: {
              id: task.id,
              description: task.description,
              type: task.type,
              status: task.status,
              priority: task.priority,
              createdAt: task.createdAt,
              completedAt: task.completedAt,
              executedAt: task.executedAt,
              error: task.error,
              result: task.result,
              model: task.model,
            },
            messages: task.messages.map((msg) => ({
              id: msg.id,
              role: msg.role,
              createdAt: msg.createdAt,
              // Omit large content blocks to save space
              contentSummary: `${(msg.content as any[]).length} blocks`,
            })),
            summaries: task.summaries.map((summary) => ({
              id: summary.id,
              content: summary.content,
              createdAt: summary.createdAt,
            })),
            files: task.files,
            metadata: {
              archivedAt: new Date().toISOString(),
              originalRetentionDays: retentionDays,
            },
          };

          fs.writeFileSync(archivePath, JSON.stringify(archiveData, null, 2));
          this.logger.debug(`Exported task ${task.id} to ${archivePath}`);

          // Delete task from database (cascades to messages, summaries, files)
          await this.prisma.task.delete({
            where: { id: task.id },
          });

          archivedCount++;
          this.logger.debug(
            `Archived task ${task.id}: "${task.description.substring(0, 50)}..."`,
          );
        } catch (error) {
          errorCount++;
          this.logger.error(
            `Failed to archive task ${task.id}: ${error.message}`,
          );
        }
      }

      this.logger.log(
        `Archival complete: ${archivedCount} tasks archived, ${errorCount} errors`,
      );

      return { archived: archivedCount, errors: errorCount };
    } catch (error) {
      this.logger.error(`Archival process failed: ${error.message}`);
      return { archived: 0, errors: 1 };
    }
  }

  /**
   * Get statistics about archived tasks
   */
  async getArchiveStats(): Promise<{
    totalArchives: number;
    oldestArchive: Date | null;
    newestArchive: Date | null;
    totalSizeMB: number;
  }> {
    try {
      const files = fs.readdirSync(this.archiveDir).filter((f) => f.endsWith('.json'));

      if (files.length === 0) {
        return {
          totalArchives: 0,
          oldestArchive: null,
          newestArchive: null,
          totalSizeMB: 0,
        };
      }

      let totalSize = 0;
      const dates: Date[] = [];

      for (const file of files) {
        const filePath = path.join(this.archiveDir, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;

        // Extract date from filename (format: taskId_YYYY-MM-DDTHH-mm-ss.json)
        const match = file.match(/_(\d{4}-\d{2}-\d{2}T[\d-]+)\.json$/);
        if (match) {
          const dateStr = match[1].replace(/-/g, ':');
          dates.push(new Date(dateStr));
        }
      }

      dates.sort((a, b) => a.getTime() - b.getTime());

      return {
        totalArchives: files.length,
        oldestArchive: dates.length > 0 ? dates[0] : null,
        newestArchive: dates.length > 0 ? dates[dates.length - 1] : null,
        totalSizeMB: totalSize / (1024 * 1024),
      };
    } catch (error) {
      this.logger.error(`Failed to get archive stats: ${error.message}`);
      return {
        totalArchives: 0,
        oldestArchive: null,
        newestArchive: null,
        totalSizeMB: 0,
      };
    }
  }

  /**
   * Restore a task from archive (for recovery scenarios)
   */
  async restoreTask(taskId: string): Promise<boolean> {
    try {
      const archiveFiles = fs.readdirSync(this.archiveDir);
      const archiveFile = archiveFiles.find((f) => f.startsWith(`${taskId}_`));

      if (!archiveFile) {
        this.logger.warn(`No archive found for task ${taskId}`);
        return false;
      }

      const archivePath = path.join(this.archiveDir, archiveFile);
      const archiveData = JSON.parse(fs.readFileSync(archivePath, 'utf-8'));

      // Restore task to database
      // Note: This is a simplified restoration - full restoration would need to
      // recreate messages and summaries with proper relationships
      await this.prisma.task.create({
        data: {
          id: archiveData.task.id,
          description: archiveData.task.description,
          type: archiveData.task.type,
          status: archiveData.task.status,
          priority: archiveData.task.priority,
          model: archiveData.task.model,
          createdAt: new Date(archiveData.task.createdAt),
          completedAt: archiveData.task.completedAt
            ? new Date(archiveData.task.completedAt)
            : null,
          executedAt: archiveData.task.executedAt
            ? new Date(archiveData.task.executedAt)
            : null,
          error: archiveData.task.error,
          result: archiveData.task.result,
        },
      });

      this.logger.log(`Restored task ${taskId} from archive`);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to restore task ${taskId}: ${error.message}`,
      );
      return false;
    }
  }
}
