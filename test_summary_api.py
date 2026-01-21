import os
import logging
from garminconnect import Garmin
from datetime import date, timedelta
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_api():
    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    
    client = Garmin(email, password)
    client.login()
    
    today = date.today()
    start = today - timedelta(days=7)
    
    print(f"Testing get_progress_summary_between_dates from {start} to {today}")
    summary = client.get_progress_summary_between_dates(start.isoformat(), today.isoformat())
    print(f"Type: {type(summary)}")
    if isinstance(summary, list):
        print(f"List length: {len(summary)}")
        if len(summary) > 0:
            print(f"First item keys: {summary[0].keys()}")
            print(f"First item: {summary[0]}")
    else:
        print(f"Summary keys: {summary.keys()}")

if __name__ == "__main__":
    test_api()
