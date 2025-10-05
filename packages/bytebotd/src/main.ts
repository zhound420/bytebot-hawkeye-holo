import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TelemetryService } from './telemetry/telemetry.service';
import { createProxyMiddleware } from 'http-proxy-middleware';
import * as express from 'express';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Configure body parser with increased payload size limit (50MB)
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  // Enable CORS
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  });

  const wsProxy = createProxyMiddleware({
    target: 'http://localhost:6080',
    ws: true,
    changeOrigin: true,
    pathRewrite: { '^/websockify': '/' },
  });
  app.use('/websockify', express.raw({ type: '*/*' }), wsProxy);
  const server = await app.listen(9990);

  try {
    const telemetry = app.get(TelemetryService);
    await telemetry.resetAll();
    console.log('[Telemetry] Drift offsets reset on startup');
  } catch (error) {
    console.warn(
      `[Telemetry] Failed to reset drift offsets on startup: ${(error as Error).message}`,
    );
  }

  // Selective upgrade routing
  server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/websockify')) {
      wsProxy.upgrade(req, socket, head);
    }
    // else let Socket.IO/Nest handle it by not hijacking the socket
  });
}
bootstrap();
