import { Module } from '@nestjs/common';
import { TextSemanticAnalyzerService } from './services/text-semantic-analyzer.service';

@Module({
  providers: [
    TextSemanticAnalyzerService,
  ],
  exports: [],
})
export class BytebotCvModule {}
