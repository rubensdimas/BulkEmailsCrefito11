#!/bin/sh
set -e

echo "[entrypoint] Starting entrypoint script..."

# Fix permissions on uploads directory for non-root user (nodejs)
# This runs AFTER the volume is mounted, so we need to ensure the nodejs user can write
if [ -d "/app/uploads" ]; then
    echo "[entrypoint] Fixing permissions on /app/uploads..."
    chown -R nodejs:nodejs /app/uploads 2>/dev/null || true
    chmod -R 755 /app/uploads 2>/dev/null || true
    echo "[entrypoint] Permissions fixed"
fi

# If running npm commands, execute them directly using npm
if [ "$1" = "npm" ]; then
    echo "[entrypoint] Running: npm ${*:2}"
    exec npm "$@"
fi

# For other commands, use exec to replace the process
echo "[entrypoint] Executing: $@"
exec "$@"