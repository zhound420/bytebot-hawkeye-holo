# macOS Container Setup Guide

This guide covers setting up and troubleshooting Bytebot Hawkeye with a macOS Sonoma/Sequoia desktop container.

## ⚠️ Important: Licensing Requirements

**This container should only be run on Apple hardware** (iMac, Mac mini, MacBook, Mac Studio, Mac Pro) according to Apple's macOS license terms. Running macOS in a virtual environment on non-Apple hardware violates Apple's EULA.

## Quick Start

```bash
# Start macOS stack
./scripts/start-stack.sh --os macos

# Access macOS
# Web viewer: http://localhost:8006
# VNC: vnc://localhost:5900

# Inside macOS, run (Terminal as root):
sudo bash /shared/setup-macos-bytebotd.sh
```

## Requirements

### Host System
- **Apple Hardware**: iMac, Mac mini, MacBook, Mac Studio, or Mac Pro (licensing requirement)
- **KVM Support**: `/dev/kvm` must be available
  - Linux: Install `qemu-kvm` and add user to `kvm` group
  - Check: `ls -l /dev/kvm` should show the device
- **Resources**:
  - 8GB+ RAM (configurable via `MACOS_RAM_SIZE`)
  - 4+ CPU cores (configurable via `MACOS_CPU_CORES`)
  - 64GB+ disk space (configurable via `MACOS_DISK_SIZE`)
- **Docker**: Docker Engine 20.10+ with docker-compose

### Software
- Node.js 20+ (installed automatically by setup script via Homebrew)
- Git (usually pre-installed on macOS)
- Homebrew (installed automatically by setup script)

## Setup Process

### 1. Start macOS Container

```bash
./scripts/start-stack.sh --os macos
```

**First Boot:**
- Takes 5-10 minutes for macOS installation
- Container downloads macOS Sonoma ISO
- Automatic installation completes without user intervention

**Subsequent Boots:**
- Takes 1-2 minutes
- macOS boots from stored image in `macos_storage` volume

### 2. Access macOS

**Option A: Web Viewer (Recommended)**
```
http://localhost:8006
```
- No additional software needed
- Works in any browser
- Slightly lower performance than VNC

**Option B: VNC Client**
```
vnc://localhost:5900
```
- Better performance than web viewer
- Requires VNC client (Screen Sharing on Mac, TigerVNC, RealVNC, etc.)
- Connect to: `localhost:5900`

### 3. Run Setup Script

1. Open Terminal in macOS
2. Switch to root:
   ```bash
   sudo su
   ```
3. Run setup script:
   ```bash
   bash /shared/setup-macos-bytebotd.sh
   ```

**What the script does:**
- Installs Homebrew package manager
- Installs Node.js 20 via Homebrew
- Installs Git (if not present)
- Copies source code from shared folder
- Builds bytebot packages (shared, bytebot-cv, bytebotd)
- Creates LaunchAgent for auto-start
- Configures bytebotd to run on login

### 4. Verify Installation

Check if LaunchAgent is loaded:
```bash
launchctl list | grep bytebot
```

Check if bytebotd is running:
```bash
ps aux | grep node
```

Test API access from browser:
```
http://localhost:9990/health
```

## Configuration

### Environment Variables

Edit `docker/.env` to customize macOS container:

```bash
# macOS version (only on Apple hardware!)
MACOS_VERSION=14         # Options: 11-15 (14=Sonoma, 15=Sequoia)

# Resources
MACOS_RAM_SIZE=8G        # Minimum 8GB recommended
MACOS_CPU_CORES=4        # Minimum 4 cores recommended
MACOS_DISK_SIZE=64G      # Minimum 64GB for macOS + software

# Display resolution (matches Linux/Windows)
MACOS_RESOLUTION=1280x960

# Shared folder for file transfer
MACOS_SHARED_DIR=./shared
```

### Bytebotd Configuration

Bytebotd uses the same environment variables as Linux/Windows. Key settings:

```bash
# Holo 1.5-7B (works identically on macOS)
BYTEBOT_CV_USE_HOLO=true
HOLO_URL=http://bytebot-holo:9989

# Grid overlay and precision features
BYTEBOT_GRID_OVERLAY=true
BYTEBOT_PROGRESSIVE_ZOOM_USE_AI=true
BYTEBOT_SMART_FOCUS=true
```

## Troubleshooting

### Container won't start

**Error: `/dev/kvm` not found**
```bash
# Check if KVM is available
ls -l /dev/kvm

# On Ubuntu/Debian
sudo apt install qemu-kvm
sudo usermod -aG kvm $USER
# Log out and back in

# Verify
groups | grep kvm
```

**Error: Port already in use**
```bash
# Check what's using the ports
sudo lsof -i :8006
sudo lsof -i :5900
sudo lsof -i :9990

# Stop conflicting services or change ports in docker-compose.macos.yml
```

**Error: Not running on Apple hardware**
- This is a licensing limitation
- macOS EULA requires Apple hardware
- Running on non-Apple hardware violates terms

### macOS installation stuck

**Installation hanging at Apple logo**
- Wait 10-15 minutes (macOS installation is slow)
- Check container logs: `docker logs bytebot-macos`
- Restart container if truly stuck: `docker restart bytebot-macos`

**Kernel panic or boot loop**
- KVM may not be properly configured
- Check host kernel modules: `lsmod | grep kvm`
- Ensure running on Apple hardware

### Setup script fails

**"Homebrew installation failed"**
```bash
# Manual Homebrew install
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Add to PATH (Apple Silicon)
eval "$(/opt/homebrew/bin/brew shellenv)"

# Add to PATH (Intel Mac)
eval "$(/usr/local/bin/brew shellenv)"
```

**"npm install failed"**
- Check internet connectivity in macOS
- Try manual build:
  ```bash
  cd /Users/Shared/bytebot/packages/shared
  npm install
  npm run build
  ```
- Check Node.js version: `node --version` (should be 20.x)

**"Source code not found"**
- Verify shared folder is mounted:
  ```bash
  ls /shared
  ```
- Copy files manually:
  ```bash
  # On host, copy to docker/shared folder
  cp -r ./* docker/shared/bytebot-hawkeye-holo/

  # In macOS, copy from shared
  cp -r /shared/bytebot-hawkeye-holo/* /Users/Shared/bytebot/
  ```

### Bytebotd not starting

**LaunchAgent fails to load**
```bash
# Check LaunchAgent status
launchctl list | grep bytebot

# View logs
tail -f /Users/Shared/bytebot/bytebotd.log
tail -f /Users/Shared/bytebot/bytebotd.error.log

# Manually load LaunchAgent
launchctl load ~/Library/LaunchAgents/com.bytebot.bytebotd.plist

# Start manually to see errors
cd /Users/Shared/bytebot/packages/bytebotd
node dist/main.js
```

**Port 9990 already in use**
```bash
# Find process using port
lsof -i :9990

# Kill process (replace PID)
kill -9 <pid>
```

**Module not found errors**
```bash
# Rebuild packages
cd /Users/Shared/bytebot/packages/shared
npm install && npm run build

cd /Users/Shared/bytebot/packages/bytebot-cv
npm install && npm run build

cd /Users/Shared/bytebot/packages/bytebotd
npm install && npm run build
```

### Performance Issues

**Slow UI response**
- Increase RAM: `MACOS_RAM_SIZE=12G`
- Increase CPU: `MACOS_CPU_CORES=6`
- Use VNC client instead of web viewer
- Disable visual effects in System Settings

**High CPU usage**
- Check for Software Update running
- Disable Spotlight indexing temporarily
- Reduce resolution: `MACOS_RESOLUTION=1024x768`

### Holo 1.5-7B Integration

**Holo service unreachable**
```bash
# Test connectivity from macOS
curl http://bytebot-holo:9989/health

# If fails, check network
docker exec bytebot-macos ping bytebot-holo
```

**Slow element detection**
- Normal on macOS container: ~2-4s per frame
- Container runs in CPU mode (no GPU passthrough in Docker)
- Use BALANCED or SPEED performance profile

## Comparison: macOS vs Windows vs Linux

| Feature | Linux Container | Windows Container | macOS Container |
|---------|----------------|-------------------|-----------------|
| **Startup Time** | 10-15 seconds | 1-2 minutes | 1-2 minutes |
| **First Install** | 30-60 seconds | 5-10 minutes | 5-10 minutes |
| **Performance** | Excellent (native) | Good (KVM) | Good (KVM) |
| **Holo 1.5-7B** | GPU (~0.6s/frame) | CPU (~2-4s/frame) | CPU (~2-4s/frame) |
| **Resolution** | 1280x960 | 1280x960 | 1280x960 |
| **Package Manager** | apt | Chocolatey | Homebrew |
| **Setup Script** | N/A (built-in) | PowerShell | Bash |
| **Remote Access** | noVNC (9990) | RDP (3389) + Web (8006) | VNC (5900) + Web (8006) |
| **Auto-Start** | systemd | Task Scheduler | LaunchAgent |
| **Use Case** | Primary development | Windows apps | macOS apps |
| **Licensing** | Open | Microsoft EULA | Apple hardware only |

## Advanced Topics

### Accessing macOS Files from Host

```bash
# macOS storage is in Docker volume
docker volume inspect bytebot_macos_storage

# Copy files out
docker cp bytebot-macos:/Users/Shared/bytebot/logs ./macos-logs

# Copy files in
docker cp ./config.json bytebot-macos:/Users/Shared/bytebot/
```

### Custom macOS Version

Modify `docker-compose.macos.yml`:
```yaml
environment:
  - VERSION=15           # Sequoia
  - VERSION=14           # Sonoma (default)
  - VERSION=13           # Ventura
  - VERSION=12           # Monterey
  - VERSION=11           # Big Sur
```

### Performance Tuning

```yaml
# In docker-compose.macos.yml
environment:
  - DISK_SIZE=128G      # More disk space
  - RAM_SIZE=16G        # More RAM
  - CPU_CORES=8         # More CPU cores
```

### Debugging

**Enable verbose logging:**
```yaml
# In docker-compose.macos.yml (bytebot-macos service)
environment:
  - DEBUG=1
```

**View all logs:**
```bash
docker compose -f docker/docker-compose.macos.yml logs -f bytebot-macos
```

## Known Limitations

1. **Apple Hardware Only**: Must run on Apple hardware (licensing)
   - Cannot run on generic x86_64 servers
   - Violates EULA to run on non-Apple hardware

2. **No GPU Passthrough**: macOS container runs in CPU mode
   - Holo 1.5-7B slower than Linux (~2-4s vs ~0.6s per frame)
   - Acceptable for development/testing

3. **Longer Boot Time**: macOS requires full OS boot
   - First install: 5-10 minutes
   - Subsequent boots: 1-2 minutes

4. **VNC vs RDP**: VNC performance lower than Windows RDP
   - Use native VNC client for better performance
   - Web viewer is slowest option

5. **Separate Containers**: macOS/Windows/Linux run independently
   - Cannot switch between them without stopping/starting
   - Use different docker-compose files

## Support

### Check Logs
```bash
# Container logs
docker logs bytebot-macos -f

# Bytebotd logs (inside macOS)
tail -f /Users/Shared/bytebot/bytebotd.log
tail -f /Users/Shared/bytebot/bytebotd.error.log

# System logs
log show --predicate 'process == "bytebotd"' --last 1h
```

### Get Help
- GitHub Issues: Report problems or ask questions
- Documentation: Check CLAUDE.md for general Bytebot setup
- Docker Logs: Always include logs when reporting issues

## FAQ

**Q: Can I run both Linux and macOS containers at the same time?**
A: No, they use the same port (9990 for bytebotd). Stop one before starting the other.

**Q: Does Holo 1.5-7B work the same on macOS?**
A: Yes! The model is trained on Windows/Linux/macOS screenshots. Performance is slower (CPU vs GPU) but accuracy is identical.

**Q: Can I run this on a PC or generic server?**
A: No. Apple's macOS license requires Apple hardware. Running on non-Apple hardware violates the EULA.

**Q: Which macOS version should I use?**
A: Use Sonoma (14) for best compatibility. Sequoia (15) is newer but may have issues.

**Q: How do I reset the macOS installation?**
A: Delete the volume and restart:
```bash
docker compose -f docker/docker-compose.macos.yml down
docker volume rm bytebot_macos_storage
./scripts/start-stack.sh --os macos
```

**Q: Can I access macOS from multiple clients?**
A: Yes, both web viewer (8006) and VNC (5900) can be used simultaneously.

**Q: What's the difference between VNC and the web viewer?**
A: VNC uses a native client (better performance), web viewer runs in browser (more convenient but slower).

**Q: Why is macOS slower than Linux?**
A: Linux containers are native, macOS runs in KVM virtualization. Also, macOS container uses CPU mode (no GPU passthrough).
