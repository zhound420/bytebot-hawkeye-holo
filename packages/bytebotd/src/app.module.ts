import { Module } from '@nestjs/common';
import { ComputerUseModule } from './computer-use/computer-use.module';
import { InputTrackingModule } from './input-tracking/input-tracking.module';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BytebotMcpModule } from './mcp';
import { HeartbeatModule } from './heartbeat/heartbeat.module';
import { LoggerModule } from './logger/logger.module';
import * as fs from 'fs';

// Build ServeStaticModule imports conditionally
const staticModules: any[] = [];

// Only serve noVNC if directory exists (Linux containers)
if (fs.existsSync('/opt/noVNC')) {
  staticModules.push({
    rootPath: '/opt/noVNC',
    serveRoot: '/novnc',
  });
}

// Always serve progress page
staticModules.push({
  rootPath: '/app/progress',
  serveRoot: '/progress',
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Explicitly makes it globally available
    }),
    LoggerModule,
    ServeStaticModule.forRoot(...staticModules),
    ComputerUseModule,
    InputTrackingModule,
    BytebotMcpModule,
    HeartbeatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
