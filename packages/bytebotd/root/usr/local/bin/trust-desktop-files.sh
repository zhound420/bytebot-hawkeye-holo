#!/bin/bash
# Trust .desktop files on Desktop to prevent "Mark as executable" dialog

# Wait for desktop to be ready
sleep 2

# Trust all .desktop files
for file in /home/user/Desktop/*.desktop; do
    if [ -f "$file" ]; then
        gio set "$file" metadata::trusted true 2>/dev/null || true
    fi
done
