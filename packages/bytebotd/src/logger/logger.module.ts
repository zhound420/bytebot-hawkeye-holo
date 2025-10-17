import { Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { createWinstonLogger } from './winston-logger.service';

@Module({
  imports: [
    WinstonModule.forRoot({
      instance: createWinstonLogger(),
    }),
  ],
  exports: [WinstonModule],
})
export class LoggerModule {}
