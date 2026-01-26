
import os
import json
from garminconnect import Garmin
from dotenv import load_dotenv

load_dotenv()

def list_types():
    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    
    try:
        client = Garmin(email, password)
        client.login()
        
        # Get last 50 activities
        activities = client.get_activities(0, 50)
        
        types = set()
        for act in activities:
            t = act.get('activityType', {}).get('typeKey')
            types.add(t)
            print(f"Name: {act['activityName']}, Type: {t}")
            
        print("\nUnique Types Found:", types)
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    list_types()
