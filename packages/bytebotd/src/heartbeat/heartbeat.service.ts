import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatService.name);
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly heartbeatPath: string;
  private readonly heartbeatIntervalMs = 2000; // 2 seconds

  constructor() {
    // Determine heartbeat file path based on platform
    if (os.platform() === 'win32') {
      // Windows: Use C:\ProgramData\Bytebot\heartbeat.txt
      const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
      const bytebotDir = path.join(programData, 'Bytebot');

      // Ensure directory exists
      if (!fs.existsSync(bytebotDir)) {
        try {
          fs.mkdirSync(bytebotDir, { recursive: true });
          this.logger.log(`Created heartbeat directory: ${bytebotDir}`);
        } catch (error) {
          this.logger.error(`Failed to create heartbeat directory: ${error.message}`);
        }
      }

      this.heartbeatPath = path.join(bytebotDir, 'heartbeat.txt');
    } else {
      // Linux/macOS: Use /tmp/bytebot-heartbeat.txt
      this.heartbeatPath = '/tmp/bytebot-heartbeat.txt';
    }
  }

  onModuleInit() {
    this.logger.log(`Starting heartbeat service (interval: ${this.heartbeatIntervalMs}ms)`);
    this.logger.log(`Heartbeat file: ${this.heartbeatPath}`);

    // Write initial heartbeat immediately
    this.writeHeartbeat();

    // Start periodic heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.writeHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  onModuleDestroy() {
    this.logger.log('Stopping heartbeat service');

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Optionally delete heartbeat file on shutdown
    try {
      if (fs.existsSync(this.heartbeatPath)) {
        fs.unlinkSync(this.heartbeatPath);
        this.logger.log('Heartbeat file deleted on shutdown');
      }
    } catch (error) {
      this.logger.error(`Failed to delete heartbeat file: ${error.message}`);
    }
  }

  private writeHeartbeat() {
    try {
      const timestamp = new Date().toISOString();
      const content = `${timestamp}\npid:${process.pid}\nuptime:${process.uptime().toFixed(2)}s\n`;

      fs.writeFileSync(this.heartbeatPath, content, { encoding: 'utf8' });

      // Log every 30 seconds to avoid spam
      if (Math.floor(process.uptime()) % 30 === 0) {
        this.logger.debug(`Heartbeat written: ${timestamp}`);
      }
    } catch (error) {
      this.logger.error(`Failed to write heartbeat: ${error.message}`);
    }
  }

  /**
   * Get heartbeat file path (useful for diagnostics)
   */
  getHeartbeatPath(): string {
    return this.heartbeatPath;
  }

  /**
   * Check if heartbeat is healthy (file exists and is recent)
   */
  isHealthy(): boolean {
    try {
      if (!fs.existsSync(this.heartbeatPath)) {
        return false;
      }

      const content = fs.readFileSync(this.heartbeatPath, 'utf8');
      const lines = content.split('\n');
      const timestamp = lines[0];

      const lastHeartbeat = new Date(timestamp);
      const now = new Date();
      const ageMs = now.getTime() - lastHeartbeat.getTime();

      // Healthy if last heartbeat was within 10 seconds
      return ageMs < 10000;
    } catch (error) {
      this.logger.error(`Heartbeat health check failed: ${error.message}`);
      return false;
    }
  }
}
