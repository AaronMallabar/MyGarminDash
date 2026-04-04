import requests, json

session = requests.Session()

# Login
r = session.post('http://localhost:5000/login', data={'password': 'Aaron!123'})
print(f"Login: {r.status_code}, URL: {r.url}")

# Try stats API to verify we're logged in
r = session.get('http://localhost:5000/api/stats')
print(f"Stats API: {r.status_code}")
if r.status_code != 200:
    print("Auth failed - not logged in")
    exit(1)

# Activity ID from cache
cache = json.load(open('garmin_cache/personal_bests_details.json'))
# Get a cached bike activity
bike_id = None
for aid, data in list(cache.items())[:20]:
    if data.get('is_bike'):
        bike_id = aid
        break

if bike_id:
    print(f"\nFetching /api/activity/{bike_id} ...")
    r2 = session.get(f'http://localhost:5000/api/activity/{bike_id}')
    print(f"Status: {r2.status_code}")
    if r2.status_code == 200:
        detail = r2.json()
        bests = detail.get('bests', {})
        print(f"'bests' field present: {bool(bests)}")
        print(f"'bests' keys: {list(bests.keys()) if bests else 'EMPTY'}")
        if bests:
            print(json.dumps(bests, indent=2)[:500])
        else:
            print("TOP-LEVEL KEYS:", list(detail.keys()))
    else:
        print(f"Error: {r2.text[:300]}")
else:
    print("No bike activity found in cache")
