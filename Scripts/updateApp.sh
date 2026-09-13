#!/bin/bash
# Ensure standard paths are available
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

# Dynamically locate app directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
APP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$APP_DIR" || exit 1

LOG_FILE="$APP_DIR/garmin_cache/update.log"
mkdir -p "$APP_DIR/garmin_cache"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=========================================="
echo "Update check started at $(date)"
echo "App directory: $APP_DIR"

# Fetch latest commits from remote
git fetch origin main 2>/dev/null || git fetch

LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse origin/main 2>/dev/null || git rev-parse @{u} 2>/dev/null)

echo "Local commit:  $LOCAL"
echo "Remote commit: $REMOTE"

if [ "$LOCAL" != "$REMOTE" ] || [ "$1" == "--force" ]; then
    echo "Update found! Pulling latest code..."
    # Discard any local file changes that might block pull
    git reset --hard HEAD
    git pull origin main || git pull

    # Update dependencies if venv exists
    if [ -f "$APP_DIR/venv/bin/pip" ]; then
        echo "Updating dependencies in virtualenv..."
        "$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt" --quiet
    fi

    echo "Restarting service..."
    sleep 2

    # Try passwordless sudo restart first
    if sudo -n systemctl restart garmin.service 2>/dev/null; then
        echo "✅ garmin.service restarted via sudo."
    elif systemctl restart garmin.service 2>/dev/null; then
        echo "✅ garmin.service restarted directly."
    else
        echo "⚠️ Sudo password required for systemctl restart. Triggering worker reload via process signal..."
        # If systemd has Restart=always, killing gunicorn will trigger systemd to auto-restart the fresh code
        pkill -f "gunicorn.*app:app" 2>/dev/null || true
        echo "✅ Restart signal sent."
    fi
else
    echo "✅ App is already up to date ($LOCAL)."
fi
echo "=========================================="

