import os
from garminconnect import Garmin
from dotenv import load_dotenv

load_dotenv()

email = os.getenv("GARMIN_EMAIL")
password = os.getenv("GARMIN_PASSWORD")

print("Initializing garmin with newer flow")
try:
    garmin = Garmin(email=email, password=password)
    # Give a single tokenstore file or dir? The example uses a directory or explicit path?
    # Actually the new library seems to use the given arg as the directory and it will append garmin_tokens.json, OR if it's not present, it creates garmin_tokens.json in that folder. 
    # Let's see. The example says:
    # tokenstore = os.getenv("GARMINTOKENS", "~/.garminconnect")
    garmin.login("garmin_tokens_test")
    print("SUCCESS: Logged in and tokens saved to garmin_tokens_test")

    today = "2026-04-15"
    summary = garmin.get_user_summary(today)
    print("Steps:", summary.get("totalSteps", "Unknown"))
except Exception as e:
    print(f"FAILED: {e}")
