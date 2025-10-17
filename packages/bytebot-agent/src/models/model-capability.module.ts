import { Module } from '@nestjs/common';
import { ModelCapabilityService } from './model-capability.service';

/**
 * Module for model capability management
 *
 * Provides ModelCapabilityService for tier-based enforcement
 * and adaptive CV-first workflow based on model capabilities.
 */
@Module({
  providers: [ModelCapabilityService],
  exports: [ModelCapabilityService],
})
export class ModelCapabilityModule {}
