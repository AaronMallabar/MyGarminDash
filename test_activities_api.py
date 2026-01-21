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
    start = today - timedelta(days=30)
    
    print(f"Testing get_activities_by_date from {start} to {today}")
    activities = client.get_activities_by_date(start.isoformat(), today.isoformat())
    print(f"Type: {type(activities)}")
    print(f"List length: {len(activities)}")
    if len(activities) > 0:
        print(f"First activity keys: {activities[0].keys()}")
        print(f"First activity example: {activities[0]['activityName']} on {activities[0]['startTimeLocal']} type: {activities[0]['activityType']['typeKey']}")

if __name__ == "__main__":
    test_api()
