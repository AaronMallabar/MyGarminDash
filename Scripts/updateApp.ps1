# MyGarminDash Windows Update Script

Write-Host "Checking for updates..." -ForegroundColor Cyan

# Fetch the latest state
git fetch

$LOCAL = git rev-parse HEAD
$REMOTE = git rev-parse @{u}

# Fallback if @{u} is not set
if ($LASTEXITCODE -ne 0) {
    $REMOTE = git rev-parse origin/main
}

if ($LOCAL -ne $REMOTE) {
    Write-Host "Update found! Pulling new code..." -ForegroundColor Green
    git pull
    
    Write-Host "Update complete. Please restart your python app.py to see changes." -ForegroundColor Yellow
    
    # Optional: we could try to kill and restart, but that's risky remotely.
    # For now, just pull the code.
} else {
    Write-Host "App is already up to date." -ForegroundColor Green
}
