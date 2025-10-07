# Windows 11 Container Setup Guide

This guide covers setting up and troubleshooting Bytebot Hawkeye with a Windows 11 desktop container.

## Quick Start

```bash
# IMPORTANT: Build packages on HOST first (required for auto-install)
cd packages/shared && npm run build
cd ../bytebot-cv && npm install && npm run build
cd ../bytebotd && npm install && npm run build

# Start Windows 11 stack (auto-install runs automatically)
./scripts/start-stack.sh --os windows

# Access Windows (wait 10-20 minutes for auto-install to complete)
# Web viewer: http://localhost:8006
# RDP: rdp://localhost:3389

# ONLY if auto-install fails, run manual troubleshooting script:
# Inside Windows PowerShell (as Administrator):
PowerShell -ExecutionPolicy Bypass -File C:\shared\scripts\setup-windows-bytebotd.ps1
```

## Requirements

### Host System
- **KVM Support**: `/dev/kvm` must be available
  - Linux: Install `qemu-kvm` and add user to `kvm` group
  - Check: `ls -l /dev/kvm` should show the device
- **Resources**:
  - 8GB+ RAM (configurable via `WINDOWS_RAM_SIZE`)
  - 4+ CPU cores (configurable via `WINDOWS_CPU_CORES`)
  - 128GB+ disk space (configurable via `WINDOWS_DISK_SIZE`)
- **Docker**: Docker Engine 20.10+ with docker-compose

### Software
- Node.js 20+ (installed automatically by setup script)
- Git (installed automatically by setup script)

## Automated Setup (Recommended)

**Windows 11 container now includes FULLY AUTOMATED setup!** No manual intervention required.

### Prerequisites (REQUIRED)

**Build packages on HOST before starting Windows container:**

```bash
cd packages/shared && npm run build
cd ../bytebot-cv && npm install && npm run build
cd ../bytebotd && npm install && npm run build
```

The Windows container uses **pre-built artifacts** from the host (mounted as read-only volumes). Building inside Windows would take 10-20 minutes; using pre-built artifacts takes 2-3 minutes.

### What Happens Automatically

On first boot, the container runs `install.bat` (`/oem` mount) which:
1. ✅ Installs Chocolatey package manager
2. ✅ Installs Node.js 20
3. ✅ Installs Git
4. ✅ Installs Visual Studio Code (with desktop shortcut)
5. ✅ Installs 1Password (password manager)
6. ✅ Uses pre-built bytebotd artifacts from host (mounted at `C:\app\bytebotd`)
7. ✅ Creates scheduled task for auto-start on login
8. ✅ Starts bytebotd service immediately

**Timeline:**
- Windows installation: 5-10 minutes
- Automated setup: 2-3 minutes (using pre-built artifacts!)
- **Total first boot: 7-13 minutes**

### Quick Start

```bash
# 1. Build packages on host (REQUIRED - only once)
cd packages/shared && npm run build
cd ../bytebot-cv && npm install && npm run build
cd ../bytebotd && npm install && npm run build

# 2. Start Windows stack (auto-install runs automatically)
./scripts/start-stack.sh --os windows

# 3. Access via web viewer (wait 7-13 minutes for auto-install)
open http://localhost:8006

# Or via RDP (faster)
# Windows: mstsc /v:localhost:3389
# Mac: Microsoft Remote Desktop → localhost:3389
# Linux: remmina -c rdp://localhost:3389
```

Once installation completes, bytebotd will be running at `http://localhost:9990`.

## Manual Setup (Optional)

If auto-install fails or you need to re-run setup:

### 1. Start Windows Container

```bash
./scripts/start-stack.sh --os windows
```

**First Boot:**
- Takes 5-10 minutes for Windows installation
- Container downloads Windows 11 ISO (~5GB)
- Automatic installation completes without user intervention

**Subsequent Boots:**
- Takes 1-2 minutes
- Windows boots from stored image in `windows_storage` volume

### 2. Access Windows

**Option A: Web Viewer (Recommended)**
```
http://localhost:8006
```
- No additional software needed
- Works in any browser
- Slightly lower performance than RDP

**Option B: RDP Client**
```
rdp://localhost:3389
```
- Better performance
- Requires RDP client (Microsoft Remote Desktop, Remmina, etc.)
- Default credentials (if required): Administrator / (no password by default)

### 3. Run Manual Setup Script (Troubleshooting Only)

**IMPORTANT:** This script is ONLY for troubleshooting if auto-install fails. The automatic `install.bat` should handle everything.

1. Open PowerShell as Administrator in Windows
2. Run the manual setup script:
   ```powershell
   PowerShell -ExecutionPolicy Bypass -File C:\shared\scripts\setup-windows-bytebotd.ps1
   ```

   **Note:** The `docker/shared` and `docker/oem` folders from the host are mounted at `C:\shared\scripts` in Windows.

**What the script does:**
- Installs Chocolatey package manager
- Installs Node.js 20
- Installs Git
- Copies source code from `/oem` mount
- Builds bytebot packages (shared, bytebot-cv, bytebotd) - SLOW (~10-20 min)
- Creates auto-start scheduled task
- Configures bytebotd to run on boot

**Why prefer auto-install:**
- `install.bat` uses pre-built host artifacts (2-3 min)
- Manual script builds inside Windows (10-20 min)
- Auto-install runs on first boot without intervention

### 4. Verify Installation

Check if bytebotd is running:
```powershell
# In Windows PowerShell
Get-ScheduledTask -TaskName "Bytebot Desktop Daemon"

# Check if Node.js process is running
Get-Process -Name node
```

Test API access from browser:
```
http://localhost:9990/health
```

## Configuration

### Environment Variables

Edit `docker/.env` to customize Windows container:

```bash
# Windows version
WINDOWS_VERSION=11          # Options: 11, 11l (LTSC), 11e (Enterprise), 10

# Resources
WINDOWS_RAM_SIZE=8G         # Minimum 8GB recommended
WINDOWS_CPU_CORES=4         # Minimum 4 cores recommended
WINDOWS_DISK_SIZE=64G       # Minimum 64GB for Windows + software

# Display resolution (matches Linux container)
WINDOWS_RESOLUTION=1280x960

# Shared folder for file transfer
WINDOWS_SHARED_DIR=./shared
```

### Bytebotd Configuration

Bytebotd uses the same environment variables as the Linux container. Key settings:

```bash
# Holo 1.5-7B (works identically on Windows)
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
sudo lsof -i :3389
sudo lsof -i :9990

# Stop conflicting services or change ports in docker-compose.windows.yml
```

**Error: Insufficient resources**
```
# Reduce resource allocation in docker/.env
WINDOWS_RAM_SIZE=6G
WINDOWS_CPU_CORES=2
```

### Windows installation stuck

**Installation hanging at "Getting ready..."**
- Wait 10-15 minutes (Windows installation is slow)
- Check container logs: `docker logs bytebot-windows`
- Restart container if truly stuck: `docker restart bytebot-windows`

**Blue screen or boot loop**
- KVM may not be properly configured
- Check host kernel modules: `lsmod | grep kvm`
- Try CPU-only mode (much slower): Comment out `runtime: nvidia` in compose file

### Setup script fails

**"Chocolatey installation failed"**
```powershell
# Manual Chocolatey install
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Refresh PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine")
```

**"npm install failed"**
- Check internet connectivity in Windows
- Try manual build:
  ```powershell
  cd C:\bytebot\packages\shared
  npm install
  npm run build
  ```
- Check Node.js version: `node --version` (should be 20.x)

**"Source code not found"**
- Verify shared folder is mounted:
  ```powershell
  Test-Path C:\shared
  ```
- Copy files manually:
  ```powershell
  # On host, copy to docker/shared folder
  cp -r ./* docker/shared/bytebot-hawkeye-holo/

  # In Windows, copy from shared
  Copy-Item C:\shared\bytebot-hawkeye-holo\* C:\bytebot\ -Recurse
  ```

### Bytebotd not starting

**Service fails to start**
```powershell
# Check scheduled task status
Get-ScheduledTask -TaskName "Bytebot Desktop Daemon" | Get-ScheduledTaskInfo

# View task history
Get-WinEvent -LogName "Microsoft-Windows-TaskScheduler/Operational" |
  Where-Object {$_.Message -like "*Bytebot*"} |
  Select-Object -First 10

# Start manually to see errors
cd C:\bytebot\packages\bytebotd
node dist\main.js
```

**Port 9990 already in use**
```powershell
# Find process using port
netstat -ano | findstr :9990

# Kill process (replace PID)
taskkill /PID <pid> /F
```

**Module not found errors**
```powershell
# Rebuild packages
cd C:\bytebot\packages\shared
npm install && npm run build

cd C:\bytebot\packages\bytebot-cv
npm install && npm run build

cd C:\bytebot\packages\bytebotd
npm install && npm run build
```

### Performance Issues

**Slow UI response**
- Increase RAM: `WINDOWS_RAM_SIZE=12G`
- Increase CPU: `WINDOWS_CPU_CORES=6`
- Use RDP instead of web viewer
- Disable Windows visual effects:
  ```powershell
  # Adjust for best performance
  SystemPropertiesPerformance.exe
  ```

**High CPU usage**
- Check for Windows Update running
- Disable Windows Defender real-time scanning (not recommended for production)
- Reduce resolution: `WINDOWS_RESOLUTION=1024x768`

### Holo 1.5-7B Integration

**Holo service unreachable**
```powershell
# Test connectivity from Windows
curl http://bytebot-holo:9989/health

# If fails, check network
docker exec bytebot-windows ping bytebot-holo
```

**Slow element detection**
- Normal on Windows: ~2-4s per frame (vs ~0.6s on Linux with NVIDIA GPU)
- Windows container runs in CPU mode (no GPU passthrough to Windows in Docker)
- Use BALANCED or SPEED performance profile in Holo settings

## Comparison: Windows vs Linux

| Feature | Windows Container | Linux Container |
|---------|------------------|-----------------|
| **Startup Time** | 1-2 minutes (after first install) | 10-15 seconds |
| **First Install** | 5-10 minutes | 30-60 seconds |
| **Performance** | Good (KVM virtualization) | Excellent (native containers) |
| **Holo 1.5-7B** | CPU mode (~2-4s/frame) | GPU mode (~0.6s/frame) |
| **Resolution** | 1280x960 (same) | 1280x960 |
| **UI Automation** | Native Windows apps | Linux apps (Firefox, 1Password, etc.) |
| **Use Case** | Testing Windows applications | Primary development/production |

## Advanced Topics

### Accessing Windows Files from Host

```bash
# Windows storage is in Docker volume
docker volume inspect bytebot_windows_storage

# Copy files out
docker cp bytebot-windows:C:\bytebot\logs ./windows-logs

# Copy files in
docker cp ./config.json bytebot-windows:C:\bytebot\
```

### Custom Windows Image

Modify `docker-compose.windows.yml`:
```yaml
environment:
  - VERSION=11e              # Windows 11 Enterprise
  - LANGUAGE=en-US          # Set language
  - KEYBOARD=us             # Set keyboard layout
```

### Performance Tuning

```yaml
# In docker-compose.windows.yml
environment:
  - DISK_SIZE=128G          # More disk space
  - RAM_SIZE=16G            # More RAM
  - CPU_CORES=8             # More CPU cores
```

### Debugging

**Enable verbose logging:**
```yaml
# In docker-compose.windows.yml (bytebot-windows service)
environment:
  - DEBUG=1
```

**View all logs:**
```bash
docker compose -f docker/docker-compose.windows.yml logs -f bytebot-windows
```

## Known Limitations

1. **No GPU Passthrough**: Windows container runs in CPU mode
   - Holo 1.5-7B slower than Linux (~2-4s vs ~0.6s per frame)
   - Acceptable for development/testing

2. **Longer Boot Time**: Windows requires full OS boot
   - First install: 5-10 minutes
   - Subsequent boots: 1-2 minutes

3. **Larger Storage**: Windows requires more disk space
   - Minimum 64GB recommended
   - vs ~10GB for Linux container

4. **No X11 Tools**: Linux-specific tools (wmctrl, xdotool) don't work
   - nut.js provides cross-platform alternatives
   - Some features gracefully degrade

5. **Separate Containers**: Windows and Linux run independently
   - Cannot switch between them without stopping/starting
   - Use different docker-compose files

## Support

### Check Logs
```bash
# Container logs
docker logs bytebot-windows -f

# Bytebotd logs (inside Windows)
cd C:\bytebot\packages\bytebotd
Get-Content -Path logs\bytebot.log -Wait

# Windows Event Viewer
eventvwr.msc
```

### Get Help
- GitHub Issues: Report problems or ask questions
- Documentation: Check CLAUDE.md for general Bytebot setup
- Docker Logs: Always include logs when reporting issues

## FAQ

**Q: Can I run both Linux and Windows containers at the same time?**
A: No, they use the same port (9990 for bytebotd). Stop one before starting the other.

**Q: Does Holo 1.5-7B work the same on Windows?**
A: Yes! The model is trained on Windows/Linux/macOS screenshots. Performance is slower (CPU vs GPU) but accuracy is identical.

**Q: Can I use Windows Server instead of Windows 11?**
A: Yes, set `WINDOWS_VERSION=2022` or `WINDOWS_VERSION=2019` in docker/.env

**Q: How do I reset the Windows installation?**
A: Delete the volume and restart:
```bash
docker compose -f docker/docker-compose.windows.yml down
docker volume rm bytebot_windows_storage
./scripts/start-stack.sh --os windows
```

**Q: Can I access Windows from multiple clients?**
A: Yes, both web viewer (8006) and RDP (3389) can be used simultaneously.

**Q: Is the Windows container licensed?**
A: The container downloads Windows from Microsoft. Review Microsoft licensing terms for your use case.
