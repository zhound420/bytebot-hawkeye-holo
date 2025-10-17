#!/bin/bash
# Resolve bytebot-holo IP and create Windows config file
# This script runs in the bytebot-windows container during startup
# to resolve the Holo service IP for Windows VM to use

set -e

echo "Resolving bytebot-holo IP address..."

# Wait for Holo to be available (max 60 seconds)
if ! timeout 60 bash -c 'until getent hosts bytebot-holo >/dev/null 2>&1; do sleep 1; done'; then
    echo "ERROR: Timeout waiting for bytebot-holo to be resolvable"
    exit 1
fi

# Get Holo IP from Docker DNS
HOLO_IP=$(getent hosts bytebot-holo | awk '{ print $1 }')

if [ -z "$HOLO_IP" ]; then
    echo "ERROR: Could not resolve bytebot-holo IP address"
    exit 1
fi

echo "✓ Resolved bytebot-holo: $HOLO_IP"

# Create Windows batch config file
cat > /oem/holo-config.bat <<EOF
@echo off
REM Auto-generated Holo configuration
REM Created by resolve-holo-ip.sh during container startup
set HOLO_IP=$HOLO_IP
set HOLO_URL=http://$HOLO_IP:9989
EOF

echo "✓ Created /oem/holo-config.bat with Holo URL: http://$HOLO_IP:9989"
echo ""
echo "Windows installers will use this configuration to connect to Holo"
