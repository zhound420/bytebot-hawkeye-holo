/**
 * Platform detection and OS-specific utilities for bytebotd
 */

import * as os from 'os';

export enum Platform {
  WINDOWS = 'windows',
  LINUX = 'linux',
  MACOS = 'darwin',
  UNKNOWN = 'unknown',
}

/**
 * Detect the current operating system platform
 */
export function getPlatform(): Platform {
  const platform = os.platform();
  switch (platform) {
    case 'win32':
      return Platform.WINDOWS;
    case 'linux':
      return Platform.LINUX;
    case 'darwin':
      return Platform.MACOS;
    default:
      return Platform.UNKNOWN;
  }
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return getPlatform() === Platform.WINDOWS;
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return getPlatform() === Platform.LINUX;
}

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
  return getPlatform() === Platform.MACOS;
}

/**
 * Get platform-specific modifier key name
 * @returns 'Ctrl' on Windows/Linux, 'Cmd' on macOS
 */
export function getPlatformModifierKey(): string {
  return isMacOS() ? 'Cmd' : 'Ctrl';
}

/**
 * Get platform-specific keyboard shortcut mapping
 * Converts generic shortcuts to platform-specific ones
 *
 * @param genericShortcut - Generic shortcut like "Mod+C" (Mod = Ctrl/Cmd based on platform)
 * @returns Platform-specific shortcut
 */
export function getPlatformShortcut(genericShortcut: string): string {
  const modifierKey = getPlatformModifierKey();
  return genericShortcut.replace(/Mod/g, modifierKey);
}

/**
 * Get platform information for logging/debugging
 */
export function getPlatformInfo(): {
  platform: Platform;
  arch: string;
  release: string;
  hostname: string;
} {
  return {
    platform: getPlatform(),
    arch: os.arch(),
    release: os.release(),
    hostname: os.hostname(),
  };
}

/**
 * Log platform information on startup
 */
export function logPlatformInfo(logger: { log: (message: string) => void }): void {
  const info = getPlatformInfo();
  logger.log(`Platform: ${info.platform} (${info.arch})`);
  logger.log(`OS Release: ${info.release}`);
  logger.log(`Hostname: ${info.hostname}`);

  if (isWindows()) {
    logger.log('Windows-specific features enabled');
  } else if (isLinux()) {
    logger.log('Linux-specific features enabled');
  } else if (isMacOS()) {
    logger.log('macOS-specific features enabled');
  }
}
