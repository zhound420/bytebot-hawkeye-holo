#!/usr/bin/env node
const { existsSync } = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function ensureOpenCvBindings() {
  if (hasOpenCvBinding()) {
    return;
  }

  const cvDir = path.resolve(__dirname, '..', '..', 'bytebot-cv');
  console.warn('[start-prod] opencv4nodejs not found; attempting recovery.');
  const opencvEnv = {
    ...process.env,
    OPENCV_LIB_DIR:
      process.env.OPENCV_LIB_DIR ||
      path.join(cvDir, 'node_modules', 'opencv-build', 'opencv', 'build', 'lib'),
    OPENCV_INCLUDE_DIR:
      process.env.OPENCV_INCLUDE_DIR ||
      path.join(cvDir, 'node_modules', 'opencv-build', 'opencv', 'build', 'include'),
    OPENCV_BIN_DIR:
      process.env.OPENCV_BIN_DIR ||
      path.join(cvDir, 'node_modules', 'opencv-build', 'opencv', 'build', 'bin'),
  };

  const cvPackageJson = require(path.join(cvDir, 'package.json'));
  const opencvDecl = cvPackageJson.dependencies?.opencv4nodejs;
  const installTarget =
    typeof opencvDecl === 'string' &&
    !opencvDecl.startsWith('workspace:') &&
    !opencvDecl.startsWith('file:')
      ? `opencv4nodejs@${opencvDecl}`
      : 'opencv4nodejs';

  const installSteps = [
    {
      label: 'opencv4nodejs install script',
      run: () => runNodeScript(path.join(cvDir, 'node_modules', 'opencv4nodejs'), 'install/install.js', opencvEnv, { exitOnFail: false }),
    },
    {
      label: `npm install (${installTarget})`,
      run: () => {
        const result = spawnSync('npm', ['install', '--no-save', '--loglevel', 'verbose', '--build-from-source', installTarget], {
          cwd: cvDir,
          stdio: 'inherit',
          env: opencvEnv,
        });

        if (result.status !== 0) {
          console.error(`[start-prod] npm install for opencv4nodejs failed (exit code ${result.status}).`);
          return false;
        }

        return true;
      },
    },
  ];

  runNodeScript(cvDir, 'scripts/patch-opencv-binding.js', opencvEnv, { exitOnFail: false });

  let recovered = hasOpenCvBinding();

  for (const step of installSteps) {
    if (recovered) {
      break;
    }

    console.warn(`[start-prod] Running ${step.label}...`);
    const ok = step.run();
    if (!ok) {
      continue;
    }

    recovered = hasOpenCvBinding();
    if (recovered) {
      console.info(`[start-prod] opencv4nodejs available after ${step.label}.`);
    }
  }

  if (!recovered) {
    console.error('[start-prod] opencv4nodejs still unavailable after recovery attempts.');
    process.exit(1);
  }

  runNodeScript(cvDir, 'scripts/patch-opencv-binding.js', opencvEnv);
  runNodeScript(cvDir, 'scripts/verify-opencv-capabilities.js', opencvEnv);
  refreshLoaderCache(cvDir);

  try {
    delete require.cache[require.resolve('opencv4nodejs')];
    require('opencv4nodejs');
  } catch (error) {
    console.error('[start-prod] opencv4nodejs verification failed after recovery.');
    console.error(error);
    process.exit(1);
  }
}

function refreshLoaderCache(cvDir) {
  const loaderPath = path.join(cvDir, 'dist', 'utils', 'opencv-loader.js');
  try {
    const resolved = require.resolve(loaderPath);
    delete require.cache[resolved];
    const loader = require(resolved);
    if (loader && typeof loader.refreshOpenCvModule === 'function') {
      loader.refreshOpenCvModule();
    }
  } catch (error) {
    if (!isModuleNotFound(error, loaderPath)) {
      console.warn('[start-prod] Unable to refresh OpenCV loader cache:', error.message || error);
    }
  }
}

function hasOpenCvBinding() {
  try {
    const resolved = require.resolve('opencv4nodejs');
    delete require.cache[resolved];
    require('opencv4nodejs');
    return true;
  } catch (error) {
    if (!isModuleNotFound(error, 'opencv4nodejs')) {
      console.warn('[start-prod] opencv4nodejs load failed:', error.message || error);
    }
    return false;
  }
}

function runNodeScript(cwd, scriptRelativePath, env, options = {}) {
  const { exitOnFail = true } = options;
  const result = spawnSync(process.execPath, [scriptRelativePath], {
    cwd,
    stdio: 'inherit',
    env,
  });

  if (result.status !== 0) {
    console.error(`[start-prod] Script ${scriptRelativePath} failed with exit code ${result.status}.`);
    if (exitOnFail) {
      process.exit(typeof result.status === 'number' ? result.status : 1);
    }
    return false;
  }

  return true;
}

function isModuleNotFound(error, moduleName) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  if (error.code === 'MODULE_NOT_FOUND' && typeof error.message === 'string') {
    return error.message.includes(moduleName);
  }
  return false;
}

ensureOpenCvBindings();

const baseDist = path.resolve(__dirname, '..', 'dist');
const candidates = [
  'src/main.js',
  'bytebot-agent/src/main.js',
  'main.js',
];

for (const rel of candidates) {
  const candidatePath = path.join(baseDist, rel);
  if (existsSync(candidatePath)) {
    require(candidatePath);
    return;
  }
}

console.error('Unable to locate a compiled Nest entrypoint under dist/. Searched:', candidates);
process.exit(1);
