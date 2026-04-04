import json

d = json.load(open('garmin_cache/personal_bests_details.json'))
print(f"Activities cached: {len(d)}")
keys = list(d.keys())[:5]
for k in keys:
    entry = d[k]
    power = entry.get('power', {})
    pace = entry.get('pace', {})
    has_power = any(v > 0 for v in power.values()) if power else False
    has_pace = any(v is not None and v > 0 for v in pace.values()) if pace else False
    print(f"  {k}: is_bike={entry.get('is_bike')}, is_run={entry.get('is_run')}, has_power={has_power}, has_pace={has_pace}")
