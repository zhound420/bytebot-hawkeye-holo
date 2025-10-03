#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

/**
 * Simple production startup script for bytebot-agent
 * OpenCV removed - now uses OmniParser (primary) + Tesseract.js (fallback)
 */

console.log('[start-prod] ByteBot Agent Production Startup');
console.log('[start-prod] =====================================');

/**
 * Verify computer vision dependencies (OmniParser + Tesseract.js)
 */
function verifyComputerVision() {
  console.log('[start-prod] Verifying computer vision services...');

  try {
    // Verify Tesseract.js is available
    require('tesseract.js');
    console.log('[start-prod] ✓ Tesseract.js OCR available');

    // Note: OmniParser is a separate Python service checked at runtime
    console.log('[start-prod] ✓ Computer vision ready (OpenCV removed)');
    console.log('[start-prod] Using OmniParser (primary) + Tesseract.js (fallback)');
    return true;

  } catch (error) {
    console.log(`[start-prod] ⚠ Computer vision verification warning: ${error.message}`);
    console.log('[start-prod] Application will start but CV features may have limited functionality');
    return false;
  }
}

/**
 * Start the application
 */
function startApplication() {
  console.log('[start-prod] Starting NestJS application...');

  // Locate the compiled entry point
  const baseDist = path.resolve(__dirname, '..', 'dist');
  const candidates = [
    'src/main.js',
    'bytebot-agent/src/main.js',
    'main.js',
  ];

  for (const rel of candidates) {
    const candidatePath = path.join(baseDist, rel);
    if (fs.existsSync(candidatePath)) {
      console.log(`[start-prod] ✓ Found application entry point: ${candidatePath}`);
      console.log('[start-prod] =====================================');
      console.log('[start-prod] Starting ByteBot Agent...');
      console.log('[start-prod]');

      // Start the application
      require(candidatePath);
      return;
    }
  }

  console.error('[start-prod] ✗ Unable to locate compiled NestJS entry point');
  console.error(`[start-prod] Searched in: ${baseDist}`);
  console.error(`[start-prod] Candidates: ${candidates.join(', ')}`);
  console.error('[start-prod] Make sure the application was built with: npm run build:dist');
  process.exit(1);
}

/**
 * Main startup sequence
 */
function main() {
  try {
    // Step 1: Verify computer vision (optional, non-blocking)
    verifyComputerVision();

    // Step 2: Start application
    startApplication();

  } catch (error) {
    console.error('[start-prod] ✗ Startup failed:');
    console.error(`[start-prod] ${error.message}`);
    console.error(`[start-prod] ${error.stack}`);
    process.exit(1);
  }
}

// Run startup
main();
