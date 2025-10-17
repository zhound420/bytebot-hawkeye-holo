# Windows ISO Cache Directory

This directory stores downloaded Windows ISO files to avoid redownloading them on fresh installs.

**Tiny11 2311:** ~3.5GB (https://archive.org/download/tiny11-2311/tiny11%202311%20x64.iso)

The fresh-build.sh script will:
1. Check if ISO exists here before allowing Windows install
2. Prompt user to keep or remove ISO cache separately from Windows volume
3. Mount ISO to /custom.iso in dockur/windows container if present

