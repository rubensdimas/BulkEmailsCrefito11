#!/bin/sh
set -e

echo "[entrypoint] Starting entrypoint script as $(whoami)..."

# Fix permissions on uploads directory for non-root user (nodejs)
# This runs AFTER the volume is mounted, so we need to ensure the nodejs user can write
if [ -d "/app/uploads" ]; then
    echo "[entrypoint] Fixing permissions on /app/uploads..."
    chown -R nodejs:nodejs /app/uploads
    chmod -R 755 /app/uploads
    echo "[entrypoint] Permissions fixed"
fi

# Determine the final user to run the application
# If we are root, we should drop privileges via su-exec
if [ "$(id -u)" = "0" ]; then
    echo "[entrypoint] Dropping privileges to nodejs via su-exec"
    
    # If running npm commands, execute them via su-exec nodejs
    if [ "$1" = "npm" ]; then
        echo "[entrypoint] Running as nodejs: npm ${*:2}"
        exec su-exec nodejs "$@"
    fi

    echo "[entrypoint] Executing as nodejs: $@"
    exec su-exec nodejs "$@"
else
    # We are already non-root (unlikely if the Dockerfile doesn't have USER)
    echo "[entrypoint] Already running as $(whoami), executing directly: $@"
    exec "$@"
fi
