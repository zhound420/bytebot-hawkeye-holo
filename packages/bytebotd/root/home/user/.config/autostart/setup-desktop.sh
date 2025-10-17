#!/bin/bash
# Enhanced desktop icon setup script with robust error handling
# Ensures desktop files are executable and trusted by Xfce

LOG_FILE="/tmp/setup-desktop.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

log "=== Desktop Icon Setup Starting ==="

# Wait for dbus session to be available
log "Waiting for dbus session..."
for i in {1..30}; do
    if [ -n "$DBUS_SESSION_BUS_ADDRESS" ]; then
        log "✓ Dbus session available: $DBUS_SESSION_BUS_ADDRESS"
        break
    fi
    sleep 0.5
done

# Wait for Xfce to fully initialize (xfconf-query becomes available)
log "Waiting for Xfce initialization..."
for i in {1..30}; do
    if command -v xfconf-query >/dev/null 2>&1 && xfconf-query -c xfce4-desktop -l >/dev/null 2>&1; then
        log "✓ Xfce initialized"
        break
    fi
    sleep 0.5
done

# Additional delay to ensure desktop is fully loaded
sleep 2

# Process each desktop file
log "Processing desktop files..."
count=0
for desktop_file in /home/user/Desktop/*.desktop; do
    if [ -f "$desktop_file" ]; then
        filename=$(basename "$desktop_file")
        log "Processing: $filename"

        # Make executable
        if chmod +x "$desktop_file"; then
            log "  ✓ Made executable"
        else
            log "  ✗ chmod failed"
        fi

        # Set GIO metadata trusted flag (try multiple times)
        for attempt in {1..3}; do
            if gio set "$desktop_file" metadata::trusted true 2>&1 | tee -a "$LOG_FILE"; then
                log "  ✓ Set trusted metadata (attempt $attempt)"
                break
            else
                log "  ⚠ Attempt $attempt failed, retrying..."
                sleep 1
            fi
        done

        # Verify X-XFCE-Trusted flag exists in file
        if grep -q "X-XFCE-Trusted=true" "$desktop_file"; then
            log "  ✓ X-XFCE-Trusted flag present"
        else
            log "  ⚠ X-XFCE-Trusted flag missing (should be set at build time)"
        fi

        count=$((count + 1))
    fi
done

log "✓ Processed $count desktop files"
log "=== Desktop Icon Setup Complete ==="
