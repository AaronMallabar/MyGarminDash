"""
Garmin Token Sync — Runs on your Windows PC.
Refreshes Garmin session tokens using your home IP, then pushes them to
your Oracle server so it never has to touch Garmin's login servers directly.

Usage:
    python sync_tokens.py

You can also set this up as a Windows Scheduled Task to run automatically
every time you log in or on a timer (e.g., every 6 hours).
"""

import os
import sys
import subprocess
import logging
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# ─── CONFIGURATION ───────────────────────────────────────────────────────────
# Oracle server SSH details (edit these to match your setup)
ORACLE_USER = os.getenv("ORACLE_USER", "ubuntu")
ORACLE_HOST = os.getenv("ORACLE_HOST", "")  # e.g., "129.213.xx.xx"
ORACLE_KEY  = os.getenv("ORACLE_SSH_KEY", "")  # e.g., "C:/Users/Aaron/.ssh/oracle_key"
REMOTE_TOKEN_DIR = "/home/ubuntu/MyGarminDash/garmin_cache/session"
REMOTE_SERVICE   = "garmin.service"

# Local paths
LOCAL_TOKEN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "garmin_cache", "session")

# ─── LOGGING ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("sync_tokens")

def refresh_tokens():
    """Login to Garmin using this PC's home internet and save fresh tokens."""
    from garminconnect import Garmin

    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")

    if not email or not password:
        logger.error("GARMIN_EMAIL and GARMIN_PASSWORD must be set in .env")
        return False

    os.makedirs(LOCAL_TOKEN_DIR, exist_ok=True)

    client = Garmin(email, password)

    # Try token-based login first (fast, no fresh credentials needed)
    try:
        client.login(LOCAL_TOKEN_DIR)
        logger.info("Logged in via existing token (refreshed automatically).")
    except Exception:
        logger.info("Token expired or missing — performing fresh login...")
        client.login()
        logger.info("Fresh login successful.")

    # Save the (possibly refreshed) tokens to disk
    client.garth.dump(LOCAL_TOKEN_DIR)
    logger.info(f"Tokens saved to {LOCAL_TOKEN_DIR}")
    return True


def push_tokens_to_oracle():
    """SCP the local token files to the Oracle server."""
    if not ORACLE_HOST:
        logger.error("ORACLE_HOST is not set! Add it to your .env file.")
        logger.error("Example: ORACLE_HOST=129.213.xx.xx")
        return False

    if not os.path.isdir(LOCAL_TOKEN_DIR):
        logger.error(f"Local token directory not found: {LOCAL_TOKEN_DIR}")
        return False

    # Build SCP command
    scp_target = f"{ORACLE_USER}@{ORACLE_HOST}:{REMOTE_TOKEN_DIR}/"
    scp_cmd = ["scp", "-o", "StrictHostKeyChecking=no"]

    if ORACLE_KEY:
        scp_cmd += ["-i", ORACLE_KEY]

    # Copy all files in the session directory
    token_files = [
        os.path.join(LOCAL_TOKEN_DIR, f)
        for f in os.listdir(LOCAL_TOKEN_DIR)
        if os.path.isfile(os.path.join(LOCAL_TOKEN_DIR, f))
    ]

    if not token_files:
        logger.error("No token files found to push!")
        return False

    scp_cmd += token_files + [scp_target]

    logger.info(f"Pushing {len(token_files)} token file(s) to {ORACLE_HOST}...")
    try:
        result = subprocess.run(scp_cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            logger.info("Tokens pushed successfully!")
            return True
        else:
            logger.error(f"SCP failed: {result.stderr.strip()}")
            return False
    except subprocess.TimeoutExpired:
        logger.error("SCP timed out after 30 seconds.")
        return False
    except FileNotFoundError:
        logger.error("SCP command not found. Make sure OpenSSH is installed.")
        logger.error("On Windows: Settings > Apps > Optional Features > OpenSSH Client")
        return False


def restart_remote_service():
    """SSH into the Oracle server and restart the Garmin dashboard service."""
    ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no"]
    if ORACLE_KEY:
        ssh_cmd += ["-i", ORACLE_KEY]
    ssh_cmd += [
        f"{ORACLE_USER}@{ORACLE_HOST}",
        f"sudo systemctl restart {REMOTE_SERVICE}"
    ]

    logger.info(f"Restarting {REMOTE_SERVICE} on {ORACLE_HOST}...")
    try:
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            logger.info("Service restarted successfully!")
            return True
        else:
            logger.error(f"SSH restart failed: {result.stderr.strip()}")
            return False
    except Exception as e:
        logger.error(f"Failed to restart remote service: {e}")
        return False


def main():
    logger.info("=" * 60)
    logger.info(f"Garmin Token Sync — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info("=" * 60)

    # Step 1: Refresh tokens locally
    logger.info("Step 1/3: Refreshing Garmin tokens on this PC...")
    if not refresh_tokens():
        logger.error("Token refresh failed. Aborting.")
        sys.exit(1)

    # Step 2: Push tokens to Oracle
    logger.info("Step 2/3: Pushing tokens to Oracle server...")
    if not push_tokens_to_oracle():
        logger.error("Token push failed. Your Oracle server will use cached data.")
        sys.exit(1)

    # Step 3: Restart the remote service so it picks up the new tokens
    logger.info("Step 3/3: Restarting dashboard service...")
    restart_remote_service()

    logger.info("=" * 60)
    logger.info("DONE! Your Oracle dashboard now has fresh tokens.")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
