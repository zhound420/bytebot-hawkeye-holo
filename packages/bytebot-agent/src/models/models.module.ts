import { Module } from '@nestjs/common';
import { ModelCapabilityService } from './model-capability.service';

@Module({
  providers: [ModelCapabilityService],
  exports: [ModelCapabilityService],
})
export class ModelsModule {}
