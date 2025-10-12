import * as winston from 'winston';
import * as DailyRotateFile from 'winston-daily-rotate-file';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Create Winston logger configuration with platform-aware paths
 */
export function createWinstonLogger() {
  // Determine log directory based on platform
  let logDir: string;
  if (os.platform() === 'win32') {
    // Windows: C:\Bytebot-Logs
    logDir = 'C:\\Bytebot-Logs';
  } else {
    // Linux/macOS: /var/log/bytebot
    logDir = '/var/log/bytebot';
  }

  // Ensure log directory exists
  if (!fs.existsSync(logDir)) {
    try {
      fs.mkdirSync(logDir, { recursive: true });
    } catch (error) {
      console.error(`Failed to create log directory ${logDir}: ${error.message}`);
      // Fallback to temp directory
      logDir = os.tmpdir();
    }
  }

  // Log format
  const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, context, stack }) => {
      const contextStr = context ? `[${context}] ` : '';
      const stackStr = stack ? `\n${stack}` : '';
      return `[${timestamp}] [${level.toUpperCase()}] ${contextStr}${message}${stackStr}`;
    }),
  );

  // Console format (colorized for readability)
  const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, context }) => {
      const contextStr = context ? `[${context}] ` : '';
      return `[${timestamp}] ${level} ${contextStr}${message}`;
    }),
  );

  // Daily rotate file transport (main log)
  const fileRotateTransport = new DailyRotateFile({
    filename: path.join(logDir, 'bytebotd-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '10m',
    maxFiles: '14d',
    format: logFormat,
    level: 'debug',
  });

  // Error log transport (errors only)
  const errorRotateTransport = new DailyRotateFile({
    filename: path.join(logDir, 'bytebotd-error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '10m',
    maxFiles: '14d',
    format: logFormat,
    level: 'error',
  });

  // Console transport
  const consoleTransport = new winston.transports.Console({
    format: consoleFormat,
    level: 'debug',
  });

  return winston.createLogger({
    level: 'debug',
    transports: [consoleTransport, fileRotateTransport, errorRotateTransport],
    exceptionHandlers: [
      new winston.transports.File({
        filename: path.join(logDir, 'bytebotd-exceptions.log'),
        format: logFormat,
      }),
    ],
    rejectionHandlers: [
      new winston.transports.File({
        filename: path.join(logDir, 'bytebotd-rejections.log'),
        format: logFormat,
      }),
    ],
  });
}
