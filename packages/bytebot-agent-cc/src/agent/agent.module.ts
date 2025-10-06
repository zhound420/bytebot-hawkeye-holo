import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { MessagesModule } from '../messages/messages.module';
import { ModelsModule } from '../models/models.module';
import { AgentProcessor } from './agent.processor';
import { ConfigModule } from '@nestjs/config';
import { AgentScheduler } from './agent.scheduler';
import { InputCaptureService } from './input-capture.service';
import { AgentAnalyticsService } from './agent.analytics';

@Module({
  imports: [ConfigModule, TasksModule, MessagesModule, ModelsModule],
  providers: [
    AgentProcessor,
    AgentScheduler,
    InputCaptureService,
    AgentAnalyticsService,
  ],
  exports: [AgentProcessor],
})
export class AgentModule {}
