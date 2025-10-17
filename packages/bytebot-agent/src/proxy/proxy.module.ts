import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProxyService } from './proxy.service';
import { ModelsModule } from '../models/models.module';

@Module({
  imports: [ConfigModule, ModelsModule],
  providers: [ProxyService],
  exports: [ProxyService],
})
export class ProxyModule {}