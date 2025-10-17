import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TelemetryService } from './telemetry/telemetry.service';
import { createProxyMiddleware } from 'http-proxy-middleware';
import * as express from 'express';
import { json, urlencoded } from 'express';
import { Logger } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  try {
    logger.log('Starting Bytebot Desktop Daemon...');

    const app = await NestFactory.create(AppModule);

    // Use Winston logger for the entire application
    app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

    // Configure body parser with increased payload size limit (50MB)
    app.use(json({ limit: '50mb' }));
    app.use(urlencoded({ limit: '50mb', extended: true }));

    // Enable CORS
    app.enableCors({
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true,
    });

    // Reset telemetry on startup
    try {
      const telemetry = app.get(TelemetryService);
      await telemetry.resetAll();
      logger.log('[Telemetry] Drift offsets reset on startup');
    } catch (error) {
      logger.warn(
        `[Telemetry] Failed to reset drift offsets on startup: ${(error as Error).message}`,
      );
    }

    const wsProxy = createProxyMiddleware({
      target: 'http://localhost:6080',
      ws: true,
      changeOrigin: true,
      pathRewrite: { '^/websockify': '/' },
    });
    app.use('/websockify', express.raw({ type: '*/*' }), wsProxy);

    // Explicitly bind to all interfaces (0.0.0.0) for container/Windows compatibility
    const port = 9990;
    const host = '0.0.0.0';

    const server = await app.listen(port, host);

    // Selective upgrade routing
    server.on('upgrade', (req, socket, head) => {
      if (req.url?.startsWith('/websockify')) {
        wsProxy.upgrade(req, socket, head);
      }
      // else let Socket.IO/Nest handle it by not hijacking the socket
    });

    logger.log('========================================');
    logger.log('  Bytebot Desktop Daemon is ready!');
    logger.log('========================================');
    logger.log(`  HTTP Server: http://${host}:${port}`);
    logger.log(`  Health Check: http://localhost:${port}/health`);
    logger.log(`  VNC Redirect: http://localhost:${port}/vnc`);
    logger.log(`  Process ID: ${process.pid}`);
    logger.log('========================================');
  } catch (error) {
    logger.error('Failed to start Bytebot Desktop Daemon', error.stack);
    process.exit(1);
  }
}
bootstrap();
