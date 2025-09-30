import { Controller, Get } from '@nestjs/common';

@Controller('cv-activity')
export class CVActivityController {
  // Mock CV activity data for now - can be enhanced later with proper service injection
  private mockActivity = {
    activeMethods: [],
    totalActiveCount: 0,
    methodDetails: {},
    performance: {
      averageProcessingTime: 0,
      totalMethodsExecuted: 0,
      successRate: 1.0
    }
  };

  /**
   * Get current CV activity snapshot
   */
  @Get('status')
  getActivityStatus() {
    return this.mockActivity;
  }

  /**
   * Get CV method performance statistics
   */
  @Get('performance')
  getPerformanceStats() {
    return [
      {
        method: 'template-matching',
        executionCount: 0,
        averageTime: 0,
        successRate: 1.0
      },
      {
        method: 'contour-detection',
        executionCount: 0,
        averageTime: 0,
        successRate: 1.0
      }
    ];
  }

  /**
   * Get CV method execution history
   */
  @Get('history')
  getMethodHistory() {
    return {
      history: [], // Empty for now
      totalExecutions: 0
    };
  }

  /**
   * Simple polling endpoint for CV activity updates (replaces SSE for compatibility)
   */
  @Get('stream')
  streamActivity() {
    return {
      timestamp: Date.now(),
      ...this.mockActivity
    };
  }

  /**
   * Check if any CV methods are currently active
   */
  @Get('active')
  isActive() {
    return {
      active: false,
      activeCount: 0,
      activeMethods: []
    };
  }
}