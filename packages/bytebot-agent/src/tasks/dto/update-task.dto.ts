import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { TaskPriority, TaskStatus } from '@prisma/client';

export class UpdateTaskDto {
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  queuedAt?: Date;

  @IsOptional()
  executedAt?: Date;

  @IsOptional()
  completedAt?: Date;

  @IsOptional()
  @IsBoolean()
  directVisionMode?: boolean;

  // Phase 1.2: NEEDS_HELP context
  @IsOptional()
  helpContext?: {
    reason: string;
    blockerType: string;
    message: string;
    elapsedMs?: number;
    timestamp: string;
    suggestedActions: string[];
  };

  @IsOptional()
  lastScreenshotId?: string;

  // Phase 3.2: Re-failure tracking
  @IsOptional()
  lastNeedsHelpAt?: Date;

  @IsOptional()
  lastResumedAt?: Date;

  @IsOptional()
  needsHelpCount?: number;
}
