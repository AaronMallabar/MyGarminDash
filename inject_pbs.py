import re

with open('app.py', 'r', encoding='utf-8') as f:
    content = f.read()

injection = """
@app.route('/api/personal_bests')
@login_required
def api_personal_bests():
    try:
        import glob
        from collections import defaultdict
        
        pts = load_json('garmin_cache/personal_bests_details.json', {})
        files = glob.glob('garmin_cache/activities/*.json')
        activities = []
        for f in files:
            activities.extend(list(load_json(f, {}).values()))
            
        today_date = get_today()
        month_prefix = today_date.strftime('%Y-%m')
        year_prefix = today_date.strftime('%Y')
        
        def init_record():
            return {
                'run': {
                    'fastest_1mi': None, 'fastest_1mi_id': None, 'fastest_1mi_date': None,
                    'fastest_5k': None, 'fastest_5k_id': None, 'fastest_5k_date': None,
                    'fastest_5mi': None, 'fastest_5mi_id': None, 'fastest_5mi_date': None,
                    'longest_run': 0, 'longest_run_id': None, 'longest_run_date': None,
                },
                'bike': {
                    'power_curve': {str(w): {'val': 0, 'id': None, 'date': None} for w in [5, 30, 60, 120, 300, 600, 1200, 1800, 3600]},
                    'longest_ride': 0, 'longest_ride_id': None, 'longest_ride_date': None,
                    'max_speed': 0, 'max_speed_id': None, 'max_speed_date': None,
                    'highest_climb': 0, 'highest_climb_id': None, 'highest_climb_date': None,
                }
            }
            
        res = {'lifetime': init_record(), 'year': init_record(), 'month': init_record()}
        
        def update_run_pace(period, key, val, aid, d_str):
            curr = res[period]['run'][key]
            if val is not None and val > 0:
                if curr is None or val < curr:
                    res[period]['run'][key] = val
                    res[period]['run'][f"{key}_id"] = aid
                    res[period]['run'][f"{key}_date"] = d_str

        def update_run_max(period, key, val, aid, d_str):
            curr = res[period]['run'][key]
            if val and val > curr:
                res[period]['run'][key] = val
                res[period]['run'][f"{key}_id"] = aid
                res[period]['run'][f"{key}_date"] = d_str
                
        def update_bike_max(period, key, val, aid, d_str):
            curr = res[period]['bike'][key]
            if val and val > curr:
                res[period]['bike'][key] = val
                res[period]['bike'][f"{key}_id"] = aid
                res[period]['bike'][f"{key}_date"] = d_str
                
        for a in activities:
            aid = str(a.get('activityId'))
            d_str = a.get('startTimeLocal', '')
            if not d_str or not aid: continue
            
            is_run = is_running_activity(a)
            is_bike = is_cycling_activity(a)
            if not is_run and not is_bike: continue
            
            periods = ['lifetime']
            if d_str.startswith(year_prefix): periods.append('year')
            if d_str.startswith(month_prefix): periods.append('month')
            
            dist_mi = n(a.get('distance', 0)) * 0.000621371
            max_spd_mph = n(a.get('maxSpeed', 0)) * 2.23694
            elev_ft = n(a.get('elevationGain', 0)) * 3.28084
            
            for p in periods:
                if is_run:
                    update_run_max(p, 'longest_run', dist_mi, aid, d_str)
                elif is_bike:
                    update_bike_max(p, 'longest_ride', dist_mi, aid, d_str)
                    update_bike_max(p, 'max_speed', max_spd_mph, aid, d_str)
                    update_bike_max(p, 'highest_climb', elev_ft, aid, d_str)
                    
            # Details PBs
            det = pts.get(aid)
            if det:
                for p in periods:
                    if is_run and det.get('pace'):
                        for key in ['1mi', '5k', '5mi']:
                            val = det['pace'].get(key)
                            update_run_pace(p, f"fastest_{key}", val, aid, d_str)
                    if is_bike and det.get('power'):
                        for k, val in det['power'].items():
                            curr = res[p]['bike']['power_curve'][k]['val']
                            if val and val > curr:
                                res[p]['bike']['power_curve'][k] = {'val': val, 'id': aid, 'date': d_str}
                                
        return jsonify(res)
    except Exception as e:
        logger.error(f"Error fetching PBs: {e}")
        return jsonify({'error': str(e)}), 500

pb_sync_active = False

@app.route('/api/trigger_pb_sync', methods=['POST'])
@login_required
def trigger_pb_sync():
    global pb_sync_active
    if pb_sync_active: return jsonify({'status': 'running'})
    
    def sync_worker():
        global pb_sync_active
        pb_sync_active = True
        try:
            client = get_garmin_client()
            pts = load_json('garmin_cache/personal_bests_details.json', {})
            import glob
            files = glob.glob('garmin_cache/activities/*.json')
            acts = []
            for f in files: acts.extend(list(load_json(f, {}).values()))
            
            for a in acts:
                aid = str(a.get('activityId', ''))
                start_str = a.get('startTimeLocal', '')
                if not aid or start_str < '2025-01-01': continue
                if aid in pts: continue
                is_run = is_running_activity(a)
                is_bike = is_cycling_activity(a)
                if not is_run and not is_bike: continue
                try:
                    logger.info(f"PB Sync: fetching {aid}")
                    details = client.get_activity_details(aid)
                    pow_bests, pace_bests = pb_parse_activity_details(details)
                    pts[aid] = {
                        'power': pow_bests if is_bike else {},
                        'pace': pace_bests if is_run else {},
                        'timestamp': time.time(),
                        'date': start_str,
                        'is_run': is_run,
                        'is_bike': is_bike
                    }
                    save_json('garmin_cache/personal_bests_details.json', pts)
                    time.sleep(1.5)
                except Exception as e:
                    logger.error(f"Failed PB sync for {aid}: {e}")
        finally:
            pb_sync_active = False

    import threading
    threading.Thread(target=sync_worker, daemon=True).start()
    return jsonify({'status': 'started'})

@app.route('/api/pb_sync_status')
@login_required
def pb_sync_status():
    global pb_sync_active
    return jsonify({'active': pb_sync_active})

if __name__ == '__main__':
"""

content = content.replace("if __name__ == '__main__':", injection)
with open('app.py', 'w', encoding='utf-8') as f:
    f.write(content)
print("Injected!")
