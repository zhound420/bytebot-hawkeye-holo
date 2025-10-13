import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TasksService } from '../tasks/tasks.service';
import { AgentProcessor } from './agent.processor';
import { TaskStatus } from '@prisma/client';
import { FileStorageService } from '../tasks/file-storage.service';
import { TaskArchivalService } from '../tasks/task-archival.service';

@Injectable()
export class AgentScheduler implements OnModuleInit {
  private readonly logger = new Logger(AgentScheduler.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly agentProcessor: AgentProcessor,
    private readonly fileStorageService: FileStorageService,
    private readonly taskArchivalService: TaskArchivalService,
  ) {}

  async onModuleInit() {
    this.logger.log('AgentScheduler initialized');

    // Session Recovery: Recover from any crash/restart
    await this.recoverFromCrash();

    await this.handleCron();
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async handleCron() {
    const now = new Date();
    const scheduledTasks = await this.tasksService.findScheduledTasks();
    for (const scheduledTask of scheduledTasks) {
      if (scheduledTask.scheduledFor && scheduledTask.scheduledFor < now) {
        this.logger.debug(
          `Task ID: ${scheduledTask.id} is scheduled for ${scheduledTask.scheduledFor}, queuing it`,
        );
        await this.tasksService.update(scheduledTask.id, {
          queuedAt: now,
        });
      }
    }

    if (this.agentProcessor.isRunning()) {
      return;
    }
    // Atomically acquire lock on the next highest priority task
    // This enables multiple workers to process tasks concurrently
    const task = await this.tasksService.acquireNextTask();
    if (task) {
      if (task.files.length > 0) {
        this.logger.debug(
          `Task ID: ${task.id} has files, staging them from shared storage`,
        );
        for (const file of task.files) {
          if (!file.storagePath) {
            this.logger.warn(
              `Skipping file ${file.name} for task ${task.id} because storagePath is missing`,
            );
            continue;
          }

          if (file.storageProvider !== this.fileStorageService.provider) {
            this.logger.warn(
              `Skipping file ${file.name} for task ${task.id} due to unsupported provider ${file.storageProvider}`,
            );
            continue;
          }

          try {
            const destination = await this.fileStorageService.copyToDesktop({
              name: file.name,
              storagePath: file.storagePath!,
            });
            this.logger.debug(
              `Copied file ${file.name} for task ${task.id} to ${destination}`,
            );
          } catch (error) {
            this.logger.error(
              `Failed to prepare file ${file.name} for task ${task.id}: ${error.message}`,
              error.stack,
            );
          }
        }
      }

      await this.tasksService.update(task.id, {
        status: TaskStatus.RUNNING,
        executedAt: new Date(),
      });
      this.logger.debug(`Processing task ID: ${task.id}`);
      this.agentProcessor.processTask(task.id);
    }
  }

  /**
   * Session Recovery: Recover tasks that were left in RUNNING state after crash/restart
   * Called once during service startup (onModuleInit)
   */
  private async recoverFromCrash(): Promise<void> {
    try {
      const runningTasks = await this.tasksService.findRunningTasks();

      if (runningTasks.length === 0) {
        this.logger.log('Session recovery: No stuck tasks found');
        return;
      }

      this.logger.warn(
        `Session recovery: Found ${runningTasks.length} task(s) stuck in RUNNING state after restart`,
      );

      for (const task of runningTasks) {
        const age = Date.now() - task.updatedAt.getTime();
        const ageMinutes = Math.round(age / 1000 / 60);

        this.logger.log(
          `Recovering task ${task.id} (age: ${ageMinutes} minutes, description: "${task.description.substring(0, 50)}...")`,
        );

        // Option 1: Reset to PENDING for automatic retry
        // Option 2: Mark as NEEDS_HELP if task was running for a long time (>10 min)

        if (ageMinutes > 10) {
          // Task was running for a long time before crash - likely needs help
          await this.tasksService.update(task.id, {
            status: TaskStatus.NEEDS_HELP,
          });
          this.logger.warn(
            `Task ${task.id} recovered as NEEDS_HELP (was running for ${ageMinutes} minutes before crash)`,
          );
        } else {
          // Recent task - safe to retry
          await this.tasksService.update(task.id, {
            status: TaskStatus.PENDING,
            executedAt: null, // Clear execution timestamp for clean restart
          });
          this.logger.log(
            `Task ${task.id} recovered as PENDING for automatic retry`,
          );
        }
      }

      this.logger.log(`Session recovery complete: Recovered ${runningTasks.length} task(s)`);
    } catch (error) {
      this.logger.error(
        `Session recovery failed: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Zombie Task Detection: Find tasks stuck in RUNNING state for too long
   * Runs every 5 minutes to detect tasks that are stuck but service is still running
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async detectZombieTasks(): Promise<void> {
    try {
      const ZOMBIE_THRESHOLD_MINUTES = 60; // 1 hour
      const zombieTasks = await this.tasksService.findZombieTasks(
        ZOMBIE_THRESHOLD_MINUTES,
      );

      if (zombieTasks.length === 0) {
        return; // No zombies found
      }

      this.logger.warn(
        `Zombie detection: Found ${zombieTasks.length} task(s) stuck in RUNNING state for >${ZOMBIE_THRESHOLD_MINUTES} minutes`,
      );

      for (const task of zombieTasks) {
        const age = Date.now() - task.updatedAt.getTime();
        const ageMinutes = Math.round(age / 1000 / 60);

        // Check if this task is actually being processed by AgentProcessor
        const isActivelyProcessing =
          this.agentProcessor.isRunning() &&
          this.agentProcessor.getCurrentTaskId() === task.id;

        if (isActivelyProcessing) {
          // Task is legitimately running, not a zombie
          this.logger.debug(
            `Task ${task.id} is actively processing (age: ${ageMinutes} min), skipping zombie cleanup`,
          );
          continue;
        }

        // Task is a zombie - stuck but not actually being processed
        this.logger.warn(
          `Zombie task detected: ${task.id} (age: ${ageMinutes} min, description: "${task.description.substring(0, 50)}...")`,
        );

        await this.tasksService.update(task.id, {
          status: TaskStatus.NEEDS_HELP,
        });

        this.logger.log(
          `Zombie task ${task.id} marked as NEEDS_HELP for manual review`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Zombie detection failed: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Session Cleanup: Archive old completed tasks
   * Runs daily at 2 AM to reduce database bloat
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async archiveOldTasks(): Promise<void> {
    try {
      const RETENTION_DAYS = parseInt(
        process.env.TASK_RETENTION_DAYS || '30',
        10,
      );

      this.logger.log(
        `Starting daily task archival (retention: ${RETENTION_DAYS} days)`,
      );

      const result = await this.taskArchivalService.archiveOldTasks(
        RETENTION_DAYS,
      );

      if (result.archived > 0 || result.errors > 0) {
        this.logger.log(
          `Daily archival complete: ${result.archived} tasks archived, ${result.errors} errors`,
        );
      }

      // Log archive statistics
      const stats = await this.taskArchivalService.getArchiveStats();
      this.logger.log(
        `Archive stats: ${stats.totalArchives} total archives, ${stats.totalSizeMB.toFixed(2)} MB`,
      );
    } catch (error) {
      this.logger.error(
        `Daily archival failed: ${error.message}`,
        error.stack,
      );
    }
  }
}
