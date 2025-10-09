import { Controller, Get, Redirect, Headers, Logger } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);
  private healthCheckCount = 0;

  constructor(private readonly appService: AppService) {}

  // Health check endpoint for monitoring tools (tray icon, health checks, etc.)
  @Get('health')
  getHealth() {
    this.healthCheckCount++;

    // Log every 10th health check to avoid spam (but still track activity)
    if (this.healthCheckCount % 10 === 0) {
      this.logger.debug(`Health check #${this.healthCheckCount} (logging every 10th)`);
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'bytebotd',
      uptime: process.uptime(),
    };
  }

  // When a client makes a GET request to /vnc,
  // this method will automatically redirect them to the noVNC URL.
  @Get('vnc')
  // Leave the decorator empty but keep the status code.
  @Redirect(undefined, 302)
  redirectToVnc(@Headers('host') host: string) {
    return {
      url: `/novnc/vnc.html?host=${host}&path=websockify&resize=scale`,
    };
  }
}
