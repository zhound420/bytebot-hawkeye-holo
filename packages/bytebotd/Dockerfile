# -----------------------------------------------------------------------------
# Bytebot Dockerfile - Virtual Desktop Environment (No OpenCV)
# -----------------------------------------------------------------------------

# Base image - standard Node.js (OpenCV removed)
FROM node:20.19.5-slim AS base

# -----------------------------------------------------------------------------
# 1. Environment setup
# -----------------------------------------------------------------------------
# Set non-interactive installation
ARG DEBIAN_FRONTEND=noninteractive
# Configure display for X11 applications
ENV DISPLAY=:0
ENV NPM_CONFIG_IGNORE_ENGINES=true

# Create symlink for Node.js binary (supervisord expects /usr/bin/node)
RUN ln -sf /usr/local/bin/node /usr/bin/node && \
    ln -sf /usr/local/bin/npm /usr/bin/npm

# -----------------------------------------------------------------------------
# 2. System dependencies installation
# -----------------------------------------------------------------------------
RUN apt-get update && apt-get install -y \
    # Essential build tools
    dpkg-dev \
    # X11 / VNC
    xvfb x11vnc xauth x11-xserver-utils \
    x11-apps sudo software-properties-common \
    # Desktop environment
    xfce4 xfce4-goodies dbus dbus-x11 wmctrl \
    bluez bluetooth \
    # Display manager with autologin capability
    lightdm \
    # Development tools
    python3 python3-pip python3-dbus python3-gi gir1.2-glib-2.0 \
    curl wget git vim \
    # Utilities
    supervisor netcat-openbsd \
    # Applications
    xpdf gedit xpaint \
    # Libraries
    libxtst-dev \
    libgif-dev \
    libcairo2-dev \
    # Sharp dependencies for ARM64 native compilation
    libvips-dev \
    # Remove unneeded dependencies
    && apt-get remove -y light-locker xfce4-screensaver xfce4-power-manager || true \
    # Clean up to reduce image size
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /run/dbus && \
    # Generate a machine-id so dbus-daemon doesn't complain
    dbus-uuidgen --ensure=/etc/machine-id

# -----------------------------------------------------------------------------
# 3. Additional software installation
# -----------------------------------------------------------------------------
# Install Firefox and additional software
RUN apt-get update && apt-get install -y \
    # Install necessary packages
    software-properties-common apt-transport-https wget gnupg \
    # Install Additional Graphics Libraries (Debian compatible)
    mesa-utils \
    libgl1-mesa-dri \
    libglx-mesa0 \
    libgl1-mesa-dev \
    # Install Sandbox Capabilities
    libcap2-bin \
    # Install Fonts
    fontconfig \
    fonts-dejavu \
    fonts-liberation \
    fonts-freefont-ttf \
    # Install Firefox and Thunderbird from Debian repositories
    firefox-esr \
    thunderbird \
    && apt-get clean && rm -rf /var/lib/apt/lists/* \
    # Set Firefox as default browser system-wide
    && update-alternatives --install /usr/bin/x-www-browser x-www-browser /usr/bin/firefox-esr 200 \
    && update-alternatives --set x-www-browser /usr/bin/firefox-esr \
    && fc-cache -f -v

# Ensure fontconfig caches are writable at runtime
RUN mkdir -p /var/cache/fontconfig /root/.cache/fontconfig /root/.fontconfig \
    && chmod -R 777 /var/cache/fontconfig /root/.cache/fontconfig /root/.fontconfig

# Install 1Password based on architecture
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then \
        curl -sS https://downloads.1password.com/linux/keys/1password.asc | \
        gpg --dearmor --output /usr/share/keyrings/1password-archive-keyring.gpg && \
        echo "deb [arch=amd64 signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/amd64 stable main" | \
        tee /etc/apt/sources.list.d/1password.list && \
        mkdir -p /etc/debsig/policies/AC2D62742012EA22/ && \
        curl -sS https://downloads.1password.com/linux/debian/debsig/1password.pol | \
        tee /etc/debsig/policies/AC2D62742012EA22/1password.pol && \
        mkdir -p /usr/share/debsig/keyrings/AC2D62742012EA22 && \
        curl -sS https://downloads.1password.com/linux/keys/1password.asc | \
        gpg --dearmor --output /usr/share/debsig/keyrings/AC2D62742012EA22/debsig.gpg && \
        apt-get update && apt-get install -y 1password && \
        apt-get clean && rm -rf /var/lib/apt/lists/*; \
    elif [ "$ARCH" = "arm64" ]; then \
        apt-get update && apt-get install -y \
            libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils \
            libatspi2.0-0 libdrm2 libgbm1 libxcb-dri3-0 libxkbcommon0 \
            libsecret-1-0 && \
        apt-get clean && rm -rf /var/lib/apt/lists/* && \
        curl -sSL https://downloads.1password.com/linux/tar/beta/aarch64/1password-latest.tar.gz -o /tmp/1password.tar.gz && \
        mkdir -p /opt/1password && \
        tar -xzf /tmp/1password.tar.gz -C /opt/1password --strip-components=1 && \
        ln -sf /opt/1password/1password /usr/bin/1password && \
        chmod +x /opt/1password/1password && \
        mkdir -p /usr/share/pixmaps /usr/share/icons/hicolor/512x512/apps /usr/share/icons/hicolor/256x256/apps && \
        find /opt/1password -name "*1password*.png" -o -name "*1password*.svg" | while read icon; do \
            if [[ "$icon" == *"512"* ]]; then \
                cp "$icon" /usr/share/icons/hicolor/512x512/apps/1password.png 2>/dev/null || true; \
            elif [[ "$icon" == *"256"* ]]; then \
                cp "$icon" /usr/share/icons/hicolor/256x256/apps/1password.png 2>/dev/null || true; \
            fi; \
            cp "$icon" /usr/share/pixmaps/1password.png 2>/dev/null || true; \
        done && \
        rm -rf /tmp/1password.tar.gz && \
        gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true; \
    else \
        echo "1Password is not available for $ARCH architecture."; \
    fi

# Install Visual Studio Code
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then \
        apt-get update && apt-get install -y wget gpg apt-transport-https software-properties-common && \
        wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/ms_vscode.gpg && \
        echo "deb [arch=amd64 signed-by=/usr/share/keyrings/ms_vscode.gpg] https://packages.microsoft.com/repos/code stable main" > /etc/apt/sources.list.d/vscode.list && \
        apt-get update && apt-get install -y code && \
        apt-get clean && rm -rf /var/lib/apt/lists/* ; \
    elif [ "$ARCH" = "arm64" ]; then \
        apt-get update && apt-get install -y wget gpg && \
        wget -qO /tmp/code_arm64.deb https://update.code.visualstudio.com/latest/linux-deb-arm64/stable && \
        apt-get install -y /tmp/code_arm64.deb && \
        rm -f /tmp/code_arm64.deb && \
        apt-get clean && rm -rf /var/lib/apt/lists/* ; \
    else \
        echo "VSCode is not available for $ARCH architecture."; \
    fi

# -----------------------------------------------------------------------------
# 4. VNC and remote access setup
# -----------------------------------------------------------------------------
RUN git clone https://github.com/novnc/noVNC.git /opt/noVNC \
    && git clone https://github.com/novnc/websockify.git /opt/websockify \
    && cd /opt/websockify \
    && pip3 install --break-system-packages .

# -----------------------------------------------------------------------------
# 5. Application setup (bytebotd)
# -----------------------------------------------------------------------------
# Install dependencies required to build libnut-core and uiohook-napi
RUN apt-get update && \
    apt-get install -y \
        cmake \
        libx11-dev \
        libxtst-dev \
        libxinerama-dev \
        libxi-dev \
        libxt-dev \
        libxrandr-dev \
        libxkbcommon-dev \
        libxkbcommon-x11-dev \
        xclip \
        git build-essential && \
    rm -rf /var/lib/apt/lists/*

COPY packages/shared/ /bytebot/packages/shared/
COPY packages/bytebot-cv/ /bytebot/packages/bytebot-cv/
COPY packages/bytebotd/ /bytebot/packages/bytebotd/
COPY config/universal-coordinates.yaml /bytebot/config/universal-coordinates.yaml
WORKDIR /bytebot/packages/bytebotd

RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    curl \
    wget \
    python3 \
    python3-pip \
    pkg-config \
    libgtk-3-dev \
    tesseract-ocr \
    tesseract-ocr-eng \
    # Complete Canvas/Cairo dependencies
    libcairo2-dev \
    libpango1.0-dev \
    libpangocairo-1.0-0 \
    libglib2.0-dev \
    libfontconfig1-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    && rm -rf /var/lib/apt/lists/*

# Set workspace dependencies
RUN node -e "const fs=require('fs'); const path=require('path'); const file=path.join('package.json'); const pkg=JSON.parse(fs.readFileSync(file,'utf8')); pkg.dependencies['@bytebot/cv']='../bytebot-cv'; fs.writeFileSync(file, JSON.stringify(pkg, null, 2)+'\n');" \
    && npm install --prefix ../shared

# Clear npm cache to avoid stale builds
RUN npm cache clean --force

# Install bytebot-cv dependencies (no OpenCV)
RUN cd ../bytebot-cv \
    && echo "Installing bytebot-cv dependencies (OmniParser + Tesseract.js only)..." \
    && npm install --no-workspaces --include=dev --ignore-engines \
    && echo "✓ bytebot-cv dependencies installed successfully (no OpenCV)"

# Rebuild Canvas for Node.js 20.x compatibility in bytebot-cv
RUN cd ../bytebot-cv \
    && echo "Rebuilding Canvas for Node.js 20.x compatibility in bytebot-cv..." \
    && rm -rf node_modules/canvas/build 2>/dev/null || true \
    && npm rebuild canvas --build-from-source \
    && echo "✓ Canvas rebuilt successfully in bytebot-cv" \
    && node -e "const canvas = require('canvas'); console.log('Canvas version in bytebot-cv:', canvas.version || 'available');"

# Install bytebotd dependencies
RUN npm install --build-from-source --ignore-optional

# Remove Sharp from dependencies temporarily and install manually
RUN npm uninstall sharp 2>/dev/null || true && \
    rm -rf node_modules/sharp && \
    npm cache clean --force

# Install Sharp with modern auto-detection
RUN npm install --no-save sharp@^0.33.5 && \
    node -e "const sharp = require('sharp'); console.log('Sharp version:', sharp.versions || 'available');"

# Build packages with TypeScript
WORKDIR /bytebot/packages/bytebot-cv
RUN rm -rf dist && npm run build

WORKDIR /bytebot/packages/bytebotd
RUN npm rebuild uiohook-napi --build-from-source

RUN node -e "const fs=require('fs'); const path=require('path'); const file=path.join('package.json'); const pkg=JSON.parse(fs.readFileSync(file,'utf8')); pkg.dependencies['@bytebot/cv']='workspace:*'; fs.writeFileSync(file, JSON.stringify(pkg, null, 2)+'\n');"

RUN npm run build

# Final verification - ensure bytebot-cv can load canvas successfully
RUN echo "=== Final Canvas Module Verification ===" \
    && cd /bytebot/packages/bytebot-cv \
    && echo "Testing canvas in bytebot-cv..." \
    && node -e "try { const canvas = require('canvas'); console.log('✓ Canvas loaded successfully in bytebot-cv:', canvas.version || 'version unknown'); } catch(e) { console.error('✗ Canvas failed to load in bytebot-cv:', e.message); process.exit(1); }" \
    && echo "✓ Canvas module verification passed!"

WORKDIR /compile

# Upgrade CMake to version 3.20+ required by libnut-core
RUN ARCH=$(dpkg --print-architecture) && \
    CMAKE_VERSION="3.29.8" && \
    if [ "$ARCH" = "amd64" ]; then \
        CMAKE_ARCH="x86_64"; \
    elif [ "$ARCH" = "arm64" ]; then \
        CMAKE_ARCH="aarch64"; \
    else \
        echo "Unsupported architecture: $ARCH" && exit 1; \
    fi && \
    wget https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/cmake-${CMAKE_VERSION}-linux-${CMAKE_ARCH}.tar.gz -O /tmp/cmake.tar.gz && \
    mkdir -p /opt/cmake && \
    tar -xzf /tmp/cmake.tar.gz -C /opt/cmake --strip-components=1 && \
    ln -sf /opt/cmake/bin/cmake /usr/local/bin/cmake && \
    ln -sf /opt/cmake/bin/cpack /usr/local/bin/cpack && \
    ln -sf /opt/cmake/bin/ctest /usr/local/bin/ctest && \
    cmake --version && \
    rm -f /tmp/cmake.tar.gz

RUN git clone https://github.com/ZachJW34/libnut-core.git && \
    cd libnut-core && \
    npm install && \
    npm run build:release

# Replace libnut.node with compiled version
RUN rm -f /bytebot/packages/bytebotd/node_modules/@nut-tree-fork/libnut-linux/build/Release/libnut.node && \
    cp /compile/libnut-core/build/Release/libnut.node /bytebot/packages/bytebotd/node_modules/@nut-tree-fork/libnut-linux/build/Release/libnut.node

RUN rm -rf /compile

WORKDIR /bytebot/packages/bytebotd

# -----------------------------------------------------------------------------
# 6. User setup and autologin configuration
# -----------------------------------------------------------------------------
RUN useradd -ms /bin/bash user && echo "user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

RUN mkdir -p /var/run/dbus && \
    chmod 755 /var/run/dbus && \
    chown user:user /var/run/dbus

RUN mkdir -p /tmp/bytebot-screenshots && \
    chown -R user:user /tmp/bytebot-screenshots

# Copy staged system files
RUN chown -R root:root /bytebot/packages/bytebotd/root && \
    find /bytebot/packages/bytebotd/root -type f -exec chmod 644 {} + && \
    find /bytebot/packages/bytebotd/root -type d -exec chmod 755 {} + && \
    find /bytebot/packages/bytebotd/root -type f -executable -exec chmod +x {} + && \
    cp -a /bytebot/packages/bytebotd/root/. /

RUN chmod +x /usr/local/bin/bytebot-bluez-stub

RUN chown -R user:user /home/user
RUN chmod -R 755 /home/user

RUN mkdir -p /home/user/Desktop && \
    ln -sf /usr/share/applications/firefox.desktop /home/user/Desktop/firefox.desktop && \
    ln -sf /usr/share/applications/thunderbird.desktop /home/user/Desktop/thunderbird.desktop && \
    ln -sf /usr/share/applications/1password.desktop /home/user/Desktop/1password.desktop && \
    ln -sf /usr/share/applications/code.desktop /home/user/Desktop/code.desktop && \
    ln -sf /usr/share/applications/xfce4-terminal.desktop /home/user/Desktop/terminal.desktop && \
    chown -R user:user /home/user/Desktop

ENV BYTEBOT_GRID_OVERLAY=true \
    BYTEBOT_GRID_DEBUG=false \
    BYTEBOT_PROGRESSIVE_ZOOM_USE_AI=true \
    BYTEBOT_UNIVERSAL_TEACHING=true \
    BYTEBOT_ADAPTIVE_CALIBRATION=true \
    BYTEBOT_ZOOM_REFINEMENT=true \
    BYTEBOT_COORDINATE_METRICS=true \
    BYTEBOT_POST_CLICK_CALIBRATION=true \
    BYTEBOT_DRIFT_COMPENSATION=true \
    BYTEBOT_DRIFT_SMOOTHING=0.2 \
    BYTEBOT_TELEMETRY_DIR=/tmp/bytebot-telemetry \
    BYTEBOT_PROGRESS_PORT=8081

RUN mkdir -p /home/user/.config /home/user/.local/share /home/user/.cache \
    && chown -R user:user /home/user/.config /home/user/.local /home/user/.cache

WORKDIR /home/user

# -----------------------------------------------------------------------------
# 7. Port configuration and runtime
# -----------------------------------------------------------------------------
EXPOSE 9990

# Start supervisor to manage all services
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf", "-n"]
