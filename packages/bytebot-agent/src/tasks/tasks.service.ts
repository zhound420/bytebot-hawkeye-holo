import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import {
  Task,
  Role,
  Prisma,
  TaskStatus,
  TaskType,
  TaskPriority,
  File,
} from '@prisma/client';
import { AddTaskMessageDto } from './dto/add-task-message.dto';
import { TasksGateway } from './tasks.gateway';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FileStorageService } from './file-storage.service';
import * as os from 'os';

const buildRunnableTaskFilter = (
  now: Date = new Date(),
): Prisma.TaskWhereInput => ({
  OR: [
    {
      queuedAt: {
        not: null,
      },
    },
    {
      scheduledFor: null,
    },
    {
      scheduledFor: {
        lte: now,
      },
    },
  ],
});

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  private readonly workerId: string;

  constructor(
    readonly prisma: PrismaService,
    @Inject(forwardRef(() => TasksGateway))
    private readonly tasksGateway: TasksGateway,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly fileStorageService: FileStorageService,
  ) {
    // Generate unique worker ID for task locking
    this.workerId = `${os.hostname()}-${process.pid}-${Date.now()}`;
    this.logger.log(`TasksService initialized with worker ID: ${this.workerId}`);
  }

  async create(createTaskDto: CreateTaskDto): Promise<Task> {
    this.logger.log(
      `Creating new task with description: ${createTaskDto.description}`,
    );

    const task = await this.prisma.$transaction(async (prisma) => {
      // Create the task first
      this.logger.debug('Creating task record in database');
      const task = await prisma.task.create({
        data: {
          description: createTaskDto.description,
          type: createTaskDto.type || TaskType.IMMEDIATE,
          priority: createTaskDto.priority || TaskPriority.MEDIUM,
          status: TaskStatus.PENDING,
          createdBy: createTaskDto.createdBy || Role.USER,
          model: createTaskDto.model,
          directVisionMode: createTaskDto.directVisionMode || false,
          ...(createTaskDto.scheduledFor
            ? { scheduledFor: createTaskDto.scheduledFor }
            : {}),
        },
      });
      this.logger.log(`Task created successfully with ID: ${task.id}`);

      let filesDescription = '';

      // Save files if provided
      if (createTaskDto.files && createTaskDto.files.length > 0) {
        this.logger.debug(
          `Saving ${createTaskDto.files.length} file(s) for task ID: ${task.id}`,
        );
        filesDescription += `\n`;

        for (const file of createTaskDto.files) {
          const persisted = await this.fileStorageService.persistBase64File(
            task.id,
            file,
          );
          filesDescription += `\nFile ${file.name} uploaded to shared storage.`;

          await prisma.file.create({
            data: {
              name: file.name,
              type: file.type || 'application/octet-stream',
              size: file.size,
              storagePath: persisted.relativePath,
              storageProvider: this.fileStorageService.provider,
              taskId: task.id,
            },
          });

          this.logger.debug(
            `Stored file ${file.name} for task ${task.id} at ${persisted.relativePath}`,
          );
        }
        this.logger.debug(`Files saved successfully for task ID: ${task.id}`);
      }

      // Create the initial system message
      this.logger.debug(`Creating initial message for task ID: ${task.id}`);
      await prisma.message.create({
        data: {
          content: [
            {
              type: 'text',
              text: `${createTaskDto.description} ${filesDescription}`,
            },
          ] as Prisma.InputJsonValue,
          role: Role.USER,
          taskId: task.id,
        },
      });
      this.logger.debug(`Initial message created for task ID: ${task.id}`);

      return task;
    });

    this.tasksGateway.emitTaskCreated(task);

    return task;
  }

  async findScheduledTasks(): Promise<Task[]> {
    return this.prisma.task.findMany({
      where: {
        scheduledFor: {
          not: null,
        },
        queuedAt: null,
      },
      orderBy: [{ scheduledFor: 'asc' }],
    });
  }

  async findNextTask(): Promise<(Task & { files: File[] }) | null> {
    const task = await this.prisma.task.findFirst({
      where: {
        ...buildRunnableTaskFilter(),
        status: {
          in: [TaskStatus.RUNNING, TaskStatus.PENDING],
        },
      },
      orderBy: [
        { executedAt: 'asc' },
        { priority: 'desc' },
        { queuedAt: 'asc' },
        { createdAt: 'asc' },
      ],
      include: {
        files: true,
      },
    });

    if (task) {
      this.logger.log(
        `Found existing task with ID: ${task.id}, and status ${task.status}. Resuming.`,
      );
    }

    return task;
  }

  /**
   * Session Recovery: Find all tasks in RUNNING state
   * Used during startup to detect tasks left in RUNNING state after crash/restart
   */
  async findRunningTasks(): Promise<Task[]> {
    return this.prisma.task.findMany({
      where: {
        status: TaskStatus.RUNNING,
      },
      orderBy: {
        updatedAt: 'asc', // Oldest first
      },
    });
  }

  /**
   * Zombie Detection: Find tasks stuck in RUNNING state for too long
   * @param thresholdMinutes - Tasks running longer than this are considered zombies
   */
  async findZombieTasks(thresholdMinutes: number): Promise<Task[]> {
    const thresholdDate = new Date(
      Date.now() - thresholdMinutes * 60 * 1000,
    );

    return this.prisma.task.findMany({
      where: {
        status: TaskStatus.RUNNING,
        updatedAt: {
          lt: thresholdDate, // Updated before threshold (stuck)
        },
      },
      orderBy: {
        updatedAt: 'asc', // Oldest first
      },
    });
  }

  async findAll(
    page = 1,
    limit = 10,
    statuses?: string[],
  ): Promise<{ tasks: Task[]; total: number; totalPages: number }> {
    this.logger.log(
      `Retrieving tasks - page: ${page}, limit: ${limit}, statuses: ${statuses?.join(',')}`,
    );

    const skip = (page - 1) * limit;

    const whereClause: Prisma.TaskWhereInput =
      statuses && statuses.length > 0
        ? { status: { in: statuses as TaskStatus[] } }
        : {};

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({
        where: whereClause,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.task.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(total / limit);
    this.logger.debug(`Retrieved ${tasks.length} tasks out of ${total} total`);

    return { tasks, total, totalPages };
  }

  async findById(id: string): Promise<Task> {
    this.logger.log(`Retrieving task by ID: ${id}`);

    try {
      const task = await this.prisma.task.findUnique({
        where: { id },
        include: {
          files: true,
        },
      });

      if (!task) {
        this.logger.warn(`Task with ID: ${id} not found`);
        throw new NotFoundException(`Task with ID ${id} not found`);
      }

      this.logger.debug(`Retrieved task with ID: ${id}`);
      return task;
    } catch (error: any) {
      this.logger.error(`Error retrieving task ID: ${id} - ${error.message}`);
      this.logger.error(error.stack);
      throw error;
    }
  }

  async update(id: string, updateTaskDto: UpdateTaskDto): Promise<Task> {
    this.logger.log(`Updating task with ID: ${id}`);
    this.logger.debug(`Update data: ${JSON.stringify(updateTaskDto)}`);

    const existingTask = await this.findById(id);

    if (!existingTask) {
      this.logger.warn(`Task with ID: ${id} not found for update`);
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    let updatedTask = await this.prisma.task.update({
      where: { id },
      data: updateTaskDto,
    });

    if (updateTaskDto.status === TaskStatus.COMPLETED) {
      this.eventEmitter.emit('task.completed', { taskId: id });
    } else if (updateTaskDto.status === TaskStatus.NEEDS_HELP) {
      updatedTask = await this.takeOver(id);
    } else if (updateTaskDto.status === TaskStatus.FAILED) {
      this.eventEmitter.emit('task.failed', { taskId: id });
    }

    this.logger.log(`Successfully updated task ID: ${id}`);
    this.logger.debug(`Updated task: ${JSON.stringify(updatedTask)}`);

    this.tasksGateway.emitTaskUpdate(id, updatedTask);

    return updatedTask;
  }

  async delete(id: string): Promise<Task> {
    this.logger.log(`Deleting task with ID: ${id}`);

    const deletedTask = await this.prisma.task.delete({
      where: { id },
    });

    this.logger.log(`Successfully deleted task ID: ${id}`);

    this.tasksGateway.emitTaskDeleted(id);

    return deletedTask;
  }

  async addTaskMessage(taskId: string, addTaskMessageDto: AddTaskMessageDto) {
    const task = await this.findById(taskId);
    if (!task) {
      this.logger.warn(`Task with ID: ${taskId} not found for guiding`);
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    const message = await this.prisma.message.create({
      data: {
        content: [{ type: 'text', text: addTaskMessageDto.message }],
        role: Role.USER,
        taskId,
      },
    });

    this.tasksGateway.emitNewMessage(taskId, message);
    return task;
  }

  async resume(taskId: string): Promise<Task> {
    this.logger.log(`Resuming task ID: ${taskId}`);

    const task = await this.findById(taskId);
    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    if (task.control !== Role.USER) {
      throw new BadRequestException(`Task ${taskId} is not under user control`);
    }

    const updatedTask = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        control: Role.ASSISTANT,
        status: TaskStatus.RUNNING,
      },
    });

    try {
      await fetch(
        `${this.configService.get<string>('BYTEBOT_DESKTOP_BASE_URL')}/input-tracking/stop`,
        { method: 'POST' },
      );
    } catch (error) {
      this.logger.error('Failed to stop input tracking', error);
    }

    // Broadcast resume event so AgentProcessor can react
    this.eventEmitter.emit('task.resume', { taskId });

    this.logger.log(`Task ${taskId} resumed`);
    this.tasksGateway.emitTaskUpdate(taskId, updatedTask);

    return updatedTask;
  }

  async takeOver(taskId: string): Promise<Task> {
    this.logger.log(`Taking over control for task ID: ${taskId}`);

    const task = await this.findById(taskId);
    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    if (task.control !== Role.ASSISTANT) {
      throw new BadRequestException(
        `Task ${taskId} is not under agent control`,
      );
    }

    const updatedTask = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        control: Role.USER,
      },
    });

    try {
      await fetch(
        `${this.configService.get<string>('BYTEBOT_DESKTOP_BASE_URL')}/input-tracking/start`,
        { method: 'POST' },
      );
    } catch (error) {
      this.logger.error('Failed to start input tracking', error);
    }

    // Broadcast takeover event so AgentProcessor can react
    this.eventEmitter.emit('task.takeover', { taskId });

    this.logger.log(`Task ${taskId} takeover initiated`);
    this.tasksGateway.emitTaskUpdate(taskId, updatedTask);

    return updatedTask;
  }

  async cancel(taskId: string): Promise<Task> {
    this.logger.log(`Cancelling task ID: ${taskId}`);

    const task = await this.findById(taskId);
    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    if (
      task.status === TaskStatus.COMPLETED ||
      task.status === TaskStatus.FAILED ||
      task.status === TaskStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Task ${taskId} is already completed, failed, or cancelled`,
      );
    }

    const updatedTask = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.CANCELLED,
      },
    });

    // Broadcast cancel event so AgentProcessor can cancel processing
    this.eventEmitter.emit('task.cancel', { taskId });

    this.logger.log(`Task ${taskId} cancelled`);
    this.tasksGateway.emitTaskUpdate(taskId, updatedTask);

    return updatedTask;
  }

  /**
   * Concurrency Support: Atomically acquire a lock on the next available task
   * Uses database-level locking to prevent multiple workers from processing the same task
   * @returns Task with lock acquired, or null if no tasks available
   */
  async acquireNextTask(): Promise<(Task & { files: File[] }) | null> {
    const LOCK_TIMEOUT_MINUTES = 60; // Release stale locks after 60 minutes

    try {
      // Use a transaction with FOR UPDATE SKIP LOCKED for atomic lock acquisition
      const task = await this.prisma.$transaction(async (tx) => {
        // Find next runnable task that is either:
        // 1. Not locked (lockedBy is null)
        // 2. Has stale lock (lockedAt > 60 minutes ago)
        const staleLockThreshold = new Date();
        staleLockThreshold.setMinutes(
          staleLockThreshold.getMinutes() - LOCK_TIMEOUT_MINUTES,
        );

        const availableTask = await tx.task.findFirst({
          where: {
            ...buildRunnableTaskFilter(),
            status: {
              in: [TaskStatus.RUNNING, TaskStatus.PENDING],
            },
            OR: [
              { lockedBy: null }, // Not locked
              { lockedAt: { lt: staleLockThreshold } }, // Stale lock
            ],
          },
          orderBy: [
            { executedAt: 'asc' },
            { priority: 'desc' },
            { queuedAt: 'asc' },
            { createdAt: 'asc' },
          ],
          include: {
            files: true,
          },
        });

        if (!availableTask) {
          return null;
        }

        // Atomically acquire lock
        const lockedTask = await tx.task.update({
          where: { id: availableTask.id },
          data: {
            lockedBy: this.workerId,
            lockedAt: new Date(),
          },
          include: {
            files: true,
          },
        });

        this.logger.log(
          `Worker ${this.workerId} acquired lock on task ${lockedTask.id}`,
        );

        return lockedTask;
      });

      return task;
    } catch (error) {
      this.logger.error(
        `Failed to acquire task lock: ${error.message}`,
        error.stack,
      );
      return null;
    }
  }

  /**
   * Release lock on a task
   * Called when task completes or worker crashes
   */
  async releaseLock(taskId: string): Promise<void> {
    try {
      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          lockedBy: null,
          lockedAt: null,
        },
      });

      this.logger.debug(`Released lock on task ${taskId}`);
    } catch (error) {
      this.logger.warn(
        `Failed to release lock on task ${taskId}: ${error.message}`,
      );
    }
  }

  /**
   * Get worker ID for this service instance
   */
  getWorkerId(): string {
    return this.workerId;
  }

  /**
   * Find tasks locked by this worker (for cleanup on shutdown)
   */
  async findTasksLockedByThisWorker(): Promise<Task[]> {
    return this.prisma.task.findMany({
      where: {
        lockedBy: this.workerId,
      },
    });
  }

  /**
   * Release all locks held by this worker (for graceful shutdown)
   */
  async releaseAllLocksForThisWorker(): Promise<number> {
    try {
      const result = await this.prisma.task.updateMany({
        where: {
          lockedBy: this.workerId,
        },
        data: {
          lockedBy: null,
          lockedAt: null,
        },
      });

      this.logger.log(
        `Released ${result.count} locks for worker ${this.workerId}`,
      );
      return result.count;
    } catch (error) {
      this.logger.error(
        `Failed to release locks for worker ${this.workerId}: ${error.message}`,
      );
      return 0;
    }
  }
}
