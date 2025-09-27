const path = require('path');

function log(prefix, message) {
  console.error(`[opencv4nodejs:${prefix}] ${message}`);
}

function verifyClaheBindings() {
  let cv;
  try {
    cv = require('opencv4nodejs');
  } catch (error) {
    log('warn', `opencv4nodejs not resolved from ${path.resolve(__dirname, '..')}; skipping CLAHE check.`);
    return;
  }

  const hasClahe = Boolean(
    (cv && typeof cv.createCLAHE === 'function') ||
      (cv?.imgproc && typeof cv.imgproc.createCLAHE === 'function') ||
      (cv?.xphoto && typeof cv.xphoto.createCLAHE === 'function') ||
      (cv?.ximgproc && typeof cv.ximgproc.createCLAHE === 'function') ||
      (typeof cv?.CLAHE === 'function')
  );

  if (!hasClahe) {
    log('error', 'CLAHE factory not found. Ensure OpenCV is built with imgproc, photo, xphoto, and ximgproc modules enabled.');
    log('error', `Current OPENCV4NODEJS_AUTOBUILD_FLAGS: ${process.env.OPENCV4NODEJS_AUTOBUILD_FLAGS || '<unset>'}`);
    log('error', 'Re-run the install with OPENCV4NODEJS_AUTOBUILD_FLAGS="-DWITH_FFMPEG=OFF -DBUILD_opencv_imgproc=ON -DBUILD_opencv_photo=ON -DBUILD_opencv_xphoto=ON -DBUILD_opencv_ximgproc=ON -DOPENCV_ENABLE_NONFREE=ON"');
    process.exit(1);
  }
}

verifyClaheBindings();
