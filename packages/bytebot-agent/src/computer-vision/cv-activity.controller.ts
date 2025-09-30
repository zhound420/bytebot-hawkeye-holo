import { Controller, Get, Sse } from '@nestjs/common';
import { Observable, interval, map } from 'rxjs';
import { CVActivityIndicatorService } from '../../../bytebot-cv/src/services/cv-activity-indicator.service';

@Controller('cv-activity')
export class CVActivityController {
  constructor(
    private readonly cvActivityService: CVActivityIndicatorService
  ) {}

  /**
   * Get current CV activity snapshot
   */
  @Get('status')
  getActivityStatus() {
    return this.cvActivityService.getSnapshot();
  }

  /**
   * Get CV method performance statistics
   */
  @Get('performance')
  getPerformanceStats() {
    return this.cvActivityService.getMethodPerformance();
  }

  /**
   * Get CV method execution history
   */
  @Get('history')
  getMethodHistory() {
    return {
      history: this.cvActivityService.getMethodHistory().slice(-20), // Last 20 executions
      totalExecutions: this.cvActivityService.getMethodHistory().length
    };
  }

  /**
   * Server-Sent Events endpoint for real-time CV activity updates
   */
  @Sse('stream')
  streamActivity(): Observable<any> {
    return interval(1000).pipe(
      map(() => {
        const snapshot = this.cvActivityService.getSnapshot();
        return {
          data: {
            timestamp: Date.now(),
            ...snapshot
          }
        };
      })
    );
  }

  /**
   * Check if any CV methods are currently active
   */
  @Get('active')
  isActive() {
    return {
      active: this.cvActivityService.hasActiveMethods(),
      activeCount: this.cvActivityService.getSnapshot().totalActiveCount,
      activeMethods: this.cvActivityService.getSnapshot().activeMethods
    };
  }
}