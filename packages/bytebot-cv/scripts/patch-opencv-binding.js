const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const moduleRoot = path.join(rootDir, 'node_modules', 'opencv4nodejs');
const bindingPath = path.join(moduleRoot, 'binding.gyp');
const siftHeaderPath = path.join(moduleRoot, 'cc', 'xfeatures2d', 'SIFTDetector.h');
const claheSourceDir = path.join(rootDir, 'opencv4nodejs');
const claheHeaderTarget = path.join(moduleRoot, 'cc', 'imgproc', 'CLAHE.h');
const claheSourceTarget = path.join(moduleRoot, 'cc', 'imgproc', 'CLAHE.cc');
const opencvModulePath = path.join(moduleRoot, 'cc', 'opencv4nodejs.cc');

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

function copyFileIfChanged(source, target) {
  if (!fs.existsSync(source)) {
    return false;
  }

  if (fs.existsSync(target)) {
    const existing = fs.readFileSync(target);
    const proposed = fs.readFileSync(source);
    if (existing.equals(proposed)) {
      return false;
    }
  }

  fs.copyFileSync(source, target);
  return true;
}

function ensureClaheSources() {
  const sourceHeader = path.join(claheSourceDir, 'CLAHE.h');
  const sourceImpl = path.join(claheSourceDir, 'CLAHE.cc');

  let changed = false;
  try {
    if (copyFileIfChanged(sourceHeader, claheHeaderTarget)) {
      changed = true;
      console.log('[opencv4nodejs] installed CLAHE.h binding');
    }
    if (copyFileIfChanged(sourceImpl, claheSourceTarget)) {
      changed = true;
      console.log('[opencv4nodejs] installed CLAHE.cc binding');
    }
  } catch (error) {
    console.warn('[opencv4nodejs] unable to copy CLAHE bindings', error);
  }
  return changed;
}

function ensureClaheInBindingGyp(content) {
  if (content.includes('cc/imgproc/CLAHE.cc')) {
    return content;
  }

  const pattern = /"cc\/imgproc\/imgproc\.cc"\s*,/;
  if (!pattern.test(content)) {
    return content;
  }

  return content.replace(pattern, (match) => `${match}\n        "cc/imgproc/CLAHE.cc",`);
}

function ensureClaheRegistration(content) {
  const includeMarker = '#include "imgproc/imgproc.h"';
  if (!content.includes('#include "imgproc/CLAHE.h"') && content.includes(includeMarker)) {
    content = content.replace(
      includeMarker,
      `${includeMarker}\n#include "imgproc/CLAHE.h"`,
    );
  }

  const initMarker = '\tImgproc::Init(target);';
  if (content.includes(initMarker) && !content.includes('CLAHE::Init(target);')) {
    content = content.replace(
      initMarker,
      `${initMarker}\n\tCLAHE::Init(target);`,
    );
  }

  return content;
}

try {
  if (fs.existsSync(bindingPath)) {
    const original = fs.readFileSync(bindingPath, 'utf8');
    let updated = ensureDefines(original, ['OPENCV_ENABLE_NONFREE', 'HAVE_OPENCV_XFEATURES2D']);
    updated = ensureClaheInBindingGyp(updated);
    if (updated !== original) {
      fs.writeFileSync(bindingPath, updated, 'utf8');
      console.log('[opencv4nodejs] updated binding.gyp for CLAHE support');
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

  const claheInstalled = ensureClaheSources();

  if (fs.existsSync(opencvModulePath)) {
    const originalModule = fs.readFileSync(opencvModulePath, 'utf8');
    const patchedModule = ensureClaheRegistration(originalModule);
    if (patchedModule !== originalModule) {
      fs.writeFileSync(opencvModulePath, patchedModule, 'utf8');
      console.log('[opencv4nodejs] registered CLAHE module');
    } else if (claheInstalled) {
      console.log('[opencv4nodejs] CLAHE module already registered');
    }
  }
} catch (error) {
  console.warn('[opencv4nodejs] unable to patch OpenCV bindings', error);
}
