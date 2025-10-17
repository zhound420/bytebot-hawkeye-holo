#!/bin/bash
# Wrapper entrypoint for bytebot-windows container
# Runs Holo IP resolution before starting dockur/windows

set -e

echo "========================================="
echo "  Bytebot Windows Container Starting"
echo "========================================="
echo ""

# Run Holo IP resolution script
if [ -f "/oem/resolve-holo-ip.sh" ]; then
    echo "Resolving Holo IP address..."
    bash /oem/resolve-holo-ip.sh
    echo ""
else
    echo "WARNING: /oem/resolve-holo-ip.sh not found"
    echo ""
fi

# Start dockur/windows main process
echo "Starting dockur/windows..."
echo ""
exec /run/entry.sh "$@"
