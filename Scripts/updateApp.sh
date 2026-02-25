#!/bin/bash
# Ensure standard paths are available
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
# Move to your app directory
cd /home/ubuntu/MyGarminDash

# Check for updates from GitHub
git fetch

# Compare local main branch with remote main branch
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse @{u})

if [ $LOCAL != $REMOTE ]; then
    echo "Update found! Pulling new code..."
    git pull
    sleep 5
    echo "Restarting App..."
    # Restart the service to apply changes
    sudo systemctl restart garmin.service
    echo "App updated and restarted."
else
    echo "App is already up to date."
fi
