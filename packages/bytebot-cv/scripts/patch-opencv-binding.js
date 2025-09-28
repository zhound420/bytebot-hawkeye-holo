const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const bindingPath = path.join(rootDir, 'node_modules', 'opencv4nodejs', 'binding.gyp');
const siftHeaderPath = path.join(rootDir, 'node_modules', 'opencv4nodejs', 'cc', 'xfeatures2d', 'SIFTDetector.h');

function ensureDefines(content, defines) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const marker = '"<!@(node ./install/parseEnv.js OPENCV4NODEJS_DEFINES)",';

  if (!content.includes(marker)) {
    return content;
  }

  const existingDefineRegex = /"([A-Z0-9_]+)"/g;
  const existing = new Set();
  let match;
  while ((match = existingDefineRegex.exec(content))) {
    existing.add(match[1]);
  }

  const missing = defines.filter((define) => !existing.has(define));
  if (!missing.length) {
    return content;
  }

  const insert = [marker, ...missing.map((define) => `"${define}",`)]
    .join(`${newline}\t\t\t`);

  return content.replace(marker, insert);
}

function patchSiftHeader(content) {
  let updated = content;
  const hasCrLf = updated.includes('\r\n');
  const newline = hasCrLf ? '\r\n' : '\n';

  if (!updated.includes('#include <opencv2/features2d.hpp>')) {
    updated = updated.replace(
      '#include <opencv2/xfeatures2d.hpp>',
      '#include <opencv2/xfeatures2d.hpp>' + newline + '#include <opencv2/features2d.hpp>'
    );
  }

  if (!updated.includes('SiftDetectorCvType')) {
    const marker = '#include "features2d/FeatureDetector.h"';
    const aliasBlock = [
      marker,
      '',
      '#if CV_VERSION_GREATER_EQUAL(4, 4, 0)',
      'using SiftDetectorCvType = cv::SIFT;',
      '#else',
      'using SiftDetectorCvType = cv::xfeatures2d::SIFT;',
      '#endif'
    ].join(newline);

    updated = updated.replace(marker, aliasBlock);
  }

  updated = updated.replace(/cv::Ptr<cv::xfeatures2d::SIFT>/g, 'cv::Ptr<SiftDetectorCvType>');
  updated = updated.replace(/cv::xfeatures2d::SIFT::create/g, 'SiftDetectorCvType::create');

  return updated;
}

try {
  if (fs.existsSync(bindingPath)) {
    const original = fs.readFileSync(bindingPath, 'utf8');
    const updated = ensureDefines(original, ['OPENCV_ENABLE_NONFREE', 'HAVE_OPENCV_XFEATURES2D']);
    if (updated !== original) {
      fs.writeFileSync(bindingPath, updated, 'utf8');
      console.log('[opencv4nodejs] ensured nonfree feature defines');
    }
  } else {
    console.warn('[opencv4nodejs] binding.gyp not found; skipping define patch');
  }

  if (fs.existsSync(siftHeaderPath)) {
    const originalHeader = fs.readFileSync(siftHeaderPath, 'utf8');
    const patchedHeader = patchSiftHeader(originalHeader);
    if (patchedHeader !== originalHeader) {
      fs.writeFileSync(siftHeaderPath, patchedHeader, 'utf8');
      console.log('[opencv4nodejs] patched SIFT detector for OpenCV >= 4.4');
    }
  }
} catch (error) {
  console.warn('[opencv4nodejs] unable to patch OpenCV bindings', error);
}
