# Raspberry Pi 3 Setup: Garmin Token Sync

This guide explains how to set up the `sync_tokens.py` script on your "always-on" Raspberry Pi 3 at work.

## 1. Files to Transfer from PC to Pi

Copy these files/folders from `c:\Users\Aaron\Documents\GitHub\MyGarminDash` to a folder on your Pi (e.g., `/home/pi/MyGarminDash/`):

- **`sync_tokens.py`** (The main script)
- **`.env`** (Your configuration and credentials)
- **The SSH `.key` file** (e.g., `ssh-key-2026-02-16.key`)
- **`garmin_cache/session/`** (Transfer the entire `session` folder with tokens inside)

## 2. One-Time Setup on the Raspberry Pi

Run these commands in the Pi terminal:

```bash
# 1. Update Pip and install dependencies
pip3 install garminconnect python-dotenv

# 2. Fix SSH key permissions (Linux is strict!)
# Replace /home/pi/MyGarminDash with the actual path on your Pi
chmod 600 /home/pi/MyGarminDash/ssh-key-2026-02-16.key
```

## 3. Configuration Update

Open the `.env` file **on the Pi** and update the `ORACLE_SSH_KEY` path:

```bash
# Example change for the Pi:
ORACLE_SSH_KEY=/home/pi/MyGarminDash/ssh-key-2026-02-16.key
```

## 4. Run the Script

You can test the script manually at any time on the Pi:

```bash
python3 sync_tokens.py
```

## ⚠️ Important Reminder

Before starting the Pi script, ensure your **Oracle Server** has been updated with the `app.py` and `gunicorn.conf.py` fixes to prevent the OOM memory crash during restarts.

---
**Tip:** You can set this up as a "Cron Job" on the Pi to run automatically every 4 hours:
1. Type `crontab -e`
2. Add this line: `0 */4 * * * /usr/bin/python3 /home/pi/MyGarminDash/sync_tokens.py >> /home/pi/MyGarminDash/sync.log 2>&1`
