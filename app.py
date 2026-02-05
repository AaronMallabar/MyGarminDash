import os
import logging
from google import genai
import json
import traceback
from flask import Flask, render_template, jsonify, request, session, redirect, url_for
from functools import wraps
from garminconnect import Garmin
from datetime import date, timedelta, datetime
from zoneinfo import ZoneInfo
from datetime import date, timedelta, datetime
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import pickle

load_dotenv()

# Helper for null-to-zero conversions
n = lambda x: x if x is not None else 0

# Timezone Configuration
EST = ZoneInfo("America/New_York")

def get_today():
    """Get today's date in Eastern Standard Time."""
    return datetime.now(EST).date()

# Gemini configuration is now handled per-client instance

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "super-secret-dev-key")
APP_PASSWORD = os.getenv("APP_PASSWORD", "admin") # Default for dev, set in Render
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global client cache (simple version)
garmin_client = None

# Settings management
SETTINGS_FILE = 'settings.json'
DEFAULT_SETTINGS = {
    'ai_model': 'gemma-3-27b-it'
}

# Nutrition Storage
FOOD_LOGS_FILE = 'food_logs.json'
CUSTOM_FOODS_FILE = 'custom_foods.json'

# Caching
stats_cache = {}
weight_cache = {'value': None, 'timestamp': 0}
calorie_cache = {}

def load_json(path, default):
    if os.path.exists(path):
        try:
            with open(path, 'r') as f:
                return json.load(f)
        except: return default
    return default

def save_json(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)

def load_settings():
    """Load settings from JSON file, return defaults if not found."""
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r') as f:
                return json.load(f)
    except Exception as e:
        logger.warning(f"Failed to load settings: {e}")
    return DEFAULT_SETTINGS.copy()

def save_settings(settings):
    """Save settings to JSON file."""
    try:
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(settings, f, indent=2)
        return True
    except Exception as e:
        logger.error(f"Failed to save settings: {e}")
        return False

def get_garmin_client():
    global garmin_client
    if garmin_client:
        return garmin_client
    
    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    
    if not email or not password:
        raise ValueError("Garmin credentials not found in environment variables")
        
    try:
        # Initialize Garmin client
        client = Garmin(email, password)
        client.login()
        logger.info("Successfully logged in to Garmin Connect")
        garmin_client = client
        return client
    except Exception as e:
        logger.error(f"Failed to login to Garmin Connect: {e}")
        raise e

def garmin_request(func, *args, **kwargs):
    """Wrapper to handle Garmin API calls with retries for transient network errors."""
    max_retries = 3
    for attempt in range(max_retries):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            if attempt < max_retries - 1:
                wait = (attempt + 1) * 2
                logger.warning(f"Garmin API error: {e}. Retrying in {wait}s... (Attempt {attempt + 1}/{max_retries})")
                time.sleep(wait)
                # Force re-login on next attempt if it seems like a session issue
                if any(err in str(e).lower() for err in ["session", "login", "auth", "expired"]):
                    global garmin_client
                    garmin_client = None
            else:
                logger.error(f"Garmin API failed after {max_retries} attempts: {e}")
                raise e

def get_user_max_hr(client):
    try:
        profile = garmin_request(client.get_user_profile)
        birth_str = profile.get('userData', {}).get('birthDate')
        if birth_str:
            birth_date = date.fromisoformat(birth_str)
            today = get_today()
            age = today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))
            return 220 - age
    except:
        pass
    return 190 # Default fallback

def get_calorie_data(client, date_str):
    """Fetch calorie data with robust fallbacks for sync issues."""
    cache_key = f"calories_{date_str}"
    if cache_key in calorie_cache: return calorie_cache[cache_key]

    try:
        stats = client.get_stats(date_str)
        total_cal = n(stats.get('totalCalories'))
        active_cal = n(stats.get('activeCalories'))
        resting_cal = n(stats.get('bmrCalories') or stats.get('restingCalories'))
        
        if total_cal == 0:
            # Try to get most recent weight from cache first
            global weight_cache
            weight_grams = weight_cache['value']
            
            # If no cached weight or it's old (1 hour), try one search
            now = time.time()
            if not weight_grams or (now - weight_cache['timestamp'] > 3600):
                date_obj = date.fromisoformat(date_str)
                for i in range(5): # Reduce search range to 5 days for speed
                    check_date = (date_obj - timedelta(days=i)).isoformat()
                    try:
                        body_comp = client.get_body_composition(check_date)
                        if body_comp and 'totalAverage' in body_comp and body_comp['totalAverage'].get('weight'):
                            weight_grams = body_comp['totalAverage']['weight']
                            weight_cache = {'value': weight_grams, 'timestamp': now}
                            break
                    except: continue
            
            weight_kg = (weight_grams / 1000) if weight_grams else 80
            bmr_est = (10 * weight_kg + 900)
            step_cal = n(stats.get('totalSteps')) * 0.04
            
            resting_cal = int(bmr_est)
            active_cal = int(step_cal + (active_cal or 0))
            total_cal = resting_cal + active_cal
            logger.info(f"Calorie Fallback: {total_cal} kcal for {date_str}")
            
        result = {
            'total': total_cal,
            'active': active_cal,
            'resting': resting_cal,
            'steps': n(stats.get('totalSteps')),
            'steps_goal': n(stats.get('totalStepsGoal')),
            'resting_hr': n(stats.get('restingHeartRate')),
            'stress_avg': n(stats.get('averageStressLevel'))
        }
        calorie_cache[cache_key] = result
        return result
    except Exception as e:
        logger.error(f"Error calculating calories: {e}")
        return {'total': 0, 'active': 0, 'resting': 0, 'steps': 0}

# ==============================================================================
# CACHE SYSTEM
# ==============================================================================

CACHE_FILE = 'polyline_cache.pkl'
polyline_lock = threading.Lock()

class PolylineCache:
    def __init__(self):
        self.cache = {}
        self.load()

    def load(self):
        if os.path.exists(CACHE_FILE):
            try:
                with open(CACHE_FILE, 'rb') as f:
                    self.cache = pickle.load(f)
            except Exception as e:
                logger.error(f"Failed to load cache: {e}")
                self.cache = {}

    def save(self):
        try:
            with open(CACHE_FILE, 'wb') as f:
                pickle.dump(self.cache, f, protocol=pickle.HIGHEST_PROTOCOL)
        except Exception as e:
            logger.error(f"Failed to save cache: {e}")

    def get(self, activity_id):
        return self.cache.get(activity_id)

    def set(self, activity_id, polyline):
        with polyline_lock:
            self.cache[activity_id] = polyline
            # Auto-save every 50 updates or so could be added, but for now explicitly called
    
    def has(self, activity_id):
        return activity_id in self.cache

# AI Memory and State Cache
AI_MEMORY_FILE = 'ai_memory_cache.json'

def load_ai_memory():
    try:
        if os.path.exists(AI_MEMORY_FILE):
            with open(AI_MEMORY_FILE, 'r') as f:
                return json.load(f)
    except:
        pass
    return {'activity_summaries': {}, 'last_health_state': {}}

def save_ai_memory(memory):
    try:
        with open(AI_MEMORY_FILE, 'w') as f:
            json.dump(memory, f)
    except:
        pass

# Initialize Cache
poly_cache = PolylineCache()
ai_memory = load_ai_memory()

def group_activities_into_sessions(activities, hours_gap=2):
    """Group activities into sessions based on a time window."""
    if not activities:
        return []
        
    # Filter out None values and ensure we have a list of dicts
    activities = [a for a in activities if a is not None]
    if not activities:
        return []
        
    # Sort by time ascending for grouping
    sorted_acts = sorted(activities, key=lambda x: x.get('startTimeLocal', ''))
    
    sessions = []
    current_session = []
    last_end_time = None
    
    for a in sorted_acts:
        start_str = a.get('startTimeLocal', '')
        # Handle duration (some activities might not have it)
        dur = a.get('duration', 0)
        if dur is None: dur = 0
            
        try:
            # Garmin format is usually YYYY-MM-DD HH:MM:SS
            start_dt = datetime.strptime(start_str, '%Y-%m-%d %H:%M:%S')
        except:
            start_dt = None
            
        if last_end_time and start_dt and (start_dt - last_end_time).total_seconds() < (hours_gap * 3600):
            current_session.append(a)
        else:
            if current_session:
                sessions.append(current_session)
            current_session = [a]
        
        if start_dt:
            last_end_time = start_dt + timedelta(seconds=dur)
            
    if current_session:
        sessions.append(current_session)
        
    # Return most recent first
    sessions.reverse()
    return sessions

# Global state for background fetch management
fetch_generation = 0
active_fetch_range = None
is_fetching = False
fetch_lock = threading.Lock()

# AI Insights Cache
ai_insights_cache = {
    'data': None,
    'timestamp': None
}
AI_CACHE_EXPIRY = 60  # Reduced to 60s temporarily to force refresh for USER

# Heatmap Cache
heatmap_cache = {
    'data': None,
    'timestamp': None,
    'range': None
}
HEATMAP_CACHE_EXPIRY = 120  # 2 minute cache duration

# Activity Heatmap Cache (GitHub style contribution map)
activity_heatmap_cache = {
    'data': None,
    'timestamp': None
}
ACT_HEATMAP_CACHE_EXPIRY = 3600 # 1 hour

# Background Worker
def server_warmup():
    """Warms up the Garmin client and pre-fills caches on startup."""
    global ai_insights_cache, activity_heatmap_cache
    logger.info("Server Warmup: Starting deep background pre-fetch...")
    try:
        client = get_garmin_client()
        # Pre-fetch activity heatmap (lightweight)
        if not activity_heatmap_cache['data']:
            logger.info("Server Warmup: Pre-fetching activity heatmap...")
            # We call the logic with a proper year range for consistency
            today = get_today()
            start_date = today - timedelta(days=366)
            activities = client.get_activities_by_date(start_date.isoformat(), today.isoformat())
            
            heatmap = {}
            for activity in activities:
                if not activity: continue
                start_local = activity.get('startTimeLocal')
                if start_local and len(start_local) >= 10:
                    date_str = start_local[:10]
                    if date_str not in heatmap:
                        heatmap[date_str] = []
                    
                    dist_mi = round(n(activity.get('distance')) / 1609.34, 1)
                    dur_m = round(n(activity.get('duration')) / 60)
                    
                    heatmap[date_str].append({
                        'name': activity.get('activityName', 'Activity'),
                        'type': activity.get('activityType', {}).get('typeKey', 'other'),
                        'dist': dist_mi,
                        'dur': dur_m
                    })
            activity_heatmap_cache['data'] = heatmap
            activity_heatmap_cache['timestamp'] = time.time()

        # Trigger AI Insight Generation in background
        if not ai_insights_cache['data']:
            logger.info("Server Warmup: Generating AI Insights in advance...")
            # We call the internal function to avoid route handling overhead
            # This will populate ai_insights_cache and ai_memory
            generate_insights_logic()
            
        logger.info("Server Warmup: Completed.")
    except Exception as e:
        logger.error(f"Server Warmup Failed: {e}")

@app.route('/api/warmup', methods=['GET'])
def trigger_warmup():
    """Endpoint for the login page to trigger a refresh/warmup of data."""
    # We start it in a new thread so it doesn't block the login page load
    threading.Thread(target=server_warmup, daemon=True).start()
    return jsonify({'status': 'warmup_started'})

# Shared logic for AI insights is defined further down the file.

# Start warmup thread if not in debug reload
if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not app.debug:
    threading.Thread(target=server_warmup, daemon=True).start()

# Background Worker for polylines
def background_polyline_fetcher(client, activity_ids, generation_id):
    """Fetch polylines for given IDs in background using parallel threads."""
    global is_fetching
    
    logger.info(f"Background fetch gen:{generation_id} started for {len(activity_ids)} items using parallel threads.")
    count = 0
    
    # Helper to fetch a single item
    def fetch_item(aid):
        # Quick check inside thread (though outer loop handles most)
        if generation_id != fetch_generation: return None
        
        try:
            details = client.get_activity_details(aid)
            poly = (details.get('geoPolylineDTO') or {}).get('polyline', [])
            if not poly:
                return (aid, [])
            
            # Optimize: Convert to compact [[lat, lon]] format and downsample
            compact = [[p['lat'], p['lon']] for p in poly if 'lat' in p and 'lon' in p]
            
            # Downsample for heatmap (500 pts is plenty of resolution for a map line)
            if len(compact) > 500:
                step = len(compact) // 500
                compact = compact[::step]
                
            return (aid, compact)
        except Exception as e:
            # Rate limit or net error?
            logger.warning(f"Error fetching polyline for {aid}: {e}")
            return None

    try:
        # Use 1 worker for background polylines on Render to prevent OOM/CPU starvation
        with ThreadPoolExecutor(max_workers=1) as executor:
            # Filter IDs that need fetching
            to_fetch = [aid for aid in activity_ids if not poly_cache.has(aid)]
            
            # Submit all
            future_to_aid = {executor.submit(fetch_item, aid): aid for aid in to_fetch}
            
            for future in as_completed(future_to_aid):
                # Check cancellation
                if generation_id != fetch_generation:
                    logger.info("Fetch aborted by newer generation.")
                    executor.shutdown(wait=False, cancel_futures=True)
                    return

                res = future.result()
                if res:
                    aid, poly = res
                    poly_cache.set(aid, poly)
                    count += 1
                    
                    if count % 20 == 0:
                        poly_cache.save()
                        logger.info(f"Background fetch gen:{generation_id} progress: {count}")

    finally:
        if generation_id == fetch_generation:
            is_fetching = False
            poly_cache.save()
            logger.info(f"Background fetch gen:{generation_id} completed. Updated {count} activities.")


# Authentication Decorator
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        if username == "AaronM" and password == APP_PASSWORD:
            session['logged_in'] = True
            return redirect(url_for('index'))
        else:
            error = 'Invalid Username or Password'
    return render_template('login.html', error=error)

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    return render_template('index.html')

@app.route('/api/settings', methods=['GET'])
@login_required
def get_settings():
    """Get current settings."""
    try:
        settings = load_settings()
        # Add available models list
        settings['available_models'] = [
            {'id': 'gemini-3-flash-preview', 'name': 'Gemini 3.0 Flash (Experimental)', 'description': 'Latest experimental model'},
            {'id': 'gemini-2.5-flash', 'name': 'Gemini 2.5 Flash', 'description': 'Most capable model'},
            {'id': 'gemini-2.5-flash-lite', 'name': 'Gemini 2.5 Flash Lite', 'description': 'Optimized for massive scale and lowest cost'},
            {'id': 'gemma-3-27b-it', 'name': 'Gemma 3 27B', 'description': 'High quota, great performance'}
        ]
        return jsonify(settings)
    except Exception as e:
        logger.error(f"Error getting settings: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/settings', methods=['POST'])
@login_required
def update_settings():
    """Update settings."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        current_settings = load_settings()
        
        # Update only allowed fields
        if 'ai_model' in data:
            current_settings['ai_model'] = data['ai_model']
            logger.info(f"AI model updated to: {data['ai_model']}")
            
            # Clear AI insights cache when model changes
            global ai_insights_cache
            ai_insights_cache = {'timestamp': 0, 'data': None}
        
        if save_settings(current_settings):
            return jsonify({'success': True, 'settings': current_settings})
        else:
            return jsonify({'error': 'Failed to save settings'}), 500
            
    except Exception as e:
        logger.error(f"Error updating settings: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/ai_insights')
@login_required
def get_ai_insights():
    global ai_insights_cache
    
    # Check cache first
    now = time.time()
    if ai_insights_cache['data'] and ai_insights_cache['timestamp']:
        if now - ai_insights_cache['timestamp'] < AI_CACHE_EXPIRY:
            logger.info("AI Insights: Returning cached response")
            return jsonify(ai_insights_cache['data'])

    try:
        result = generate_insights_logic()
        if result and 'error' in result:
            return jsonify(result), 503 # Service Unavailable or specific error
        if result:
            return jsonify(result)
        return jsonify({'error': 'Failed to generate insights'}), 500
    except Exception as e:
        logger.error(f"Error serving AI insights: {e}")
        return jsonify({'error': str(e)}), 500

def generate_insights_logic():
    global ai_insights_cache, ai_memory
    
    try:
        client = get_garmin_client()
        today = get_today()
        
        # 1. Fetch Today's Deep Health Data
        def safe_fetch(func, *args, **kwargs):
            try: return func(*args, **kwargs) or {}
            except: return {}

        stats = safe_fetch(client.get_stats, today.isoformat())
        sleep = safe_fetch(client.get_sleep_data, today.isoformat())
        hrv_res = safe_fetch(client.get_hrv_data, today.isoformat())
        hrv = hrv_res.get('hrvSummary', {}) if isinstance(hrv_res, dict) else {}
        
        steps_today = n(stats.get('totalSteps', 0))
        stress_today = n(stats.get('averageStressLevel', 0))
        dto_today = sleep.get('dailySleepDTO', {}) if isinstance(sleep, dict) else {}
        sleep_score_today = n(
            dto_today.get('sleepScore') or 
            dto_today.get('score') or 
            dto_today.get('sleepScores', {}).get('overall', {}).get('value')
        )
        sleep_seconds_today = n(dto_today.get('sleepTimeSeconds', 0))
        
        # If today's sleep is zero, try yesterday (sometimes Garmin's sync for 'today' is pending)
        if sleep_seconds_today == 0:
            yesterday = (today - timedelta(days=1)).isoformat()
            y_sleep = safe_fetch(client.get_sleep_data, yesterday)
            y_dto = y_sleep.get('dailySleepDTO', {}) if isinstance(y_sleep, dict) else {}
            if n(y_dto.get('sleepTimeSeconds', 0)) > 0:
                dto_today = y_dto
                sleep_score_today = n(
                    dto_today.get('sleepScore') or 
                    dto_today.get('score') or 
                    dto_today.get('sleepScores', {}).get('overall', {}).get('value')
                )
                sleep_seconds_today = n(dto_today.get('sleepTimeSeconds', 0))
                logger.info("AI Insights: Using yesterday's sleep data as today's is zero.")

        sleep_hours_today = round(sleep_seconds_today / 3600, 1)

        # Fetch 7-Day History for Trend Analysis
        from concurrent.futures import ThreadPoolExecutor
        def fetch_historical(d):
            try:
                s = client.get_stats(d.isoformat())
                sl = client.get_sleep_data(d.isoformat())
                dto = sl.get('dailySleepDTO', {}) if isinstance(sl, dict) else {}
                score = n(
                    dto.get('sleepScore') or 
                    dto.get('score') or 
                    dto.get('sleepScores', {}).get('overall', {}).get('value')
                )
                sleep_seconds = n(dto.get('sleepTimeSeconds', 0))
                return {
                    'date': d.isoformat(),
                    'steps': n(s.get('totalSteps', 0)),
                    'stress': n(s.get('averageStressLevel', 0)),
                    'sleep_score': score,
                    'sleep_hours': round(sleep_seconds / 3600, 1)
                }
            except: return None

        past_dates = [today - timedelta(days=i) for i in range(1, 8)]
        with ThreadPoolExecutor(max_workers=4) as executor:
            history_list = list(executor.map(fetch_historical, past_dates))
        history_list = [h for h in history_list if h]

        # Fetch activities from Jan 1st of current year OR the last 30 days (whichever is earlier)
        ytd_start = datetime(today.year, 1, 1).date()
        baseline_start = today - timedelta(days=30)
        fetch_start = min(ytd_start, baseline_start)
        
        logger.info(f"AI Insights: Fetching activities since {fetch_start} for YTD and baselines")
        acts_hist = client.get_activities_by_date(fetch_start.isoformat(), today.isoformat())
        
        # Calculate Baselines (30d) and YTD Records
        baselines = {
            'run_avg_pace': 0, 'run_max_dist': 0, 'run_count': 0,
            'cycle_avg_pace': 0, 'cycle_max_dist': 0, 'cycle_count': 0, 'cycle_avg_power': 0,
            'avg_duration': 0,
            'ytd_run_max_dist': 0,
            'ytd_cycle_max_dist': 0,
            'ytd_cycle_max_power': 0
        }
        
        run_paces = []
        cycle_paces = []
        cycle_powers = []
        durations = []
        
        # Baseline Helper for Cycling
        def is_cycling_baseline(act):
            tk = act.get('activityType', {}).get('typeKey', '').lower()
            an = act.get('activityName', '').lower()
            return any(k in tk for k in ['cycling', 'ride', 'biking', 'virtual', 'indoor']) or \
                   any(k in an for k in ['zwift', 'ride', 'cycling', 'peloton', 'trainerroad'])

        for a in acts_hist:
            start_time_str = a.get('startTimeLocal', '')
            if not start_time_str: continue
            
            try:
                act_date = datetime.strptime(start_time_str.split(' ')[0], '%Y-%m-%d').date()
            except:
                continue
            
            d_mi = n(a.get('distance', 0)) * 0.000621371
            dur_m = n(a.get('duration', 0)) / 60
            type_key = a.get('activityType', {}).get('typeKey', '')
            
            # YTD Records Tracking
            if act_date >= ytd_start:
                if 'running' in type_key:
                    baselines['ytd_run_max_dist'] = max(baselines['ytd_run_max_dist'], d_mi)
                elif is_cycling_baseline(a):
                    baselines['ytd_cycle_max_dist'] = max(baselines['ytd_cycle_max_dist'], d_mi)
                    summary = a.get('summaryDTO', {})
                    p = a.get('averagePower') or a.get('avgPower') or summary.get('averagePower') or summary.get('avgPower')
                    baselines['ytd_cycle_max_power'] = max(baselines['ytd_cycle_max_power'], n(p))

            # 30-Day Rolling Baseline
            if d_mi > 0 and dur_m > 0 and act_date >= baseline_start:
                durations.append(dur_m)
                if 'running' in type_key:
                    baselines['run_count'] += 1
                    run_paces.append(dur_m / d_mi)
                    baselines['run_max_dist'] = max(baselines['run_max_dist'], d_mi)
                elif is_cycling_baseline(a):
                    baselines['cycle_count'] += 1
                    baselines['cycle_max_dist'] = max(baselines['cycle_max_dist'], d_mi)
                    cycle_paces.append(d_mi / (dur_m / 60))
                    # Check historical power for 30d avg
                    summary = a.get('summaryDTO', {})
                    p = a.get('averagePower') or a.get('avgPower') or summary.get('averagePower') or summary.get('avgPower')
                    if n(p) > 0: cycle_powers.append(p)
        
        if run_paces: baselines['run_avg_pace'] = sum(run_paces) / len(run_paces)
        if cycle_paces: baselines['cycle_avg_pace'] = sum(cycle_paces) / len(cycle_paces)
        if 'cycle_powers' in locals() and cycle_powers: baselines['cycle_avg_power'] = sum(cycle_powers) / len(cycle_powers)
        if durations: baselines['avg_duration'] = sum(durations) / len(durations)

        # Fetch Recent Activities for detailed analysis
        acts_raw = acts_hist[:15]
        
        # Enrichment: Fetch full activity objects for the most recent 10 activities to get power/etc.
        def fetch_full_act(a):
            try:
                aid = a.get('activityId')
                if not aid: return a
                
                # Fetch both the full summary AND the second-by-second details
                full = client.get_activity(aid)
                details = client.get_activity_details(aid)
                
                if full: 
                    a.update(full)
                    # Also check nested summaryDTO
                    s_dto = full.get('summaryDTO', {})
                    if s_dto: a.update(s_dto)
                
                if details:
                    descriptors = details.get('metricDescriptors', [])
                    metrics_list = details.get('activityDetailMetrics', [])
                    # Use EXACT mapping as used in the graph code
                    key_map = {d['key']: d['metricsIndex'] for d in descriptors}
                    
                    p_key = 'directPower'
                    if p_key in key_map:
                        idx = key_map[p_key]
                        powers = [n(m.get('metrics')[idx]) for m in metrics_list if m.get('metrics') and idx < len(m.get('metrics')) and m.get('metrics')[idx] is not None]
                        if powers:
                            a['extracted_avg_p'] = round(sum(powers) / len(powers))
                            a['extracted_max_p'] = max(powers)
                            logger.info(f"VERIFIED: Found {len(powers)} power dots for act {aid}. Avg: {a['extracted_avg_p']}W")
                            
            except Exception as e:
                logger.warning(f"Failed to enrich activity {a.get('activityId')}: {e}")
            return a

        if acts_raw:
            with ThreadPoolExecutor(max_workers=5) as executor:
                acts_raw = list(executor.map(fetch_full_act, acts_raw))

        sessions = group_activities_into_sessions(acts_raw)
        
        # 2. Memory-Based Context Reduction
        training_history_for_ai = []
        # Robust Cycling Check helper
        def is_cycling(act):
            tk = act.get('activityType', {}).get('typeKey', '').lower()
            an = act.get('activityName', '').lower()
            return any(k in tk for k in ['cycling', 'ride', 'biking', 'virtual', 'indoor']) or \
                   any(k in an for k in ['zwift', 'ride', 'cycling', 'peloton', 'trainerroad'])

        for s in sessions:
            session_id = "|".join([str(a.get('activityId')) for a in s])
            
            # Check if we already have a detailed summary for this session in memory
            if session_id in ai_memory['activity_summaries']:
                # Only send the summary we already generated, not the raw metrics
                training_history_for_ai.append({
                    "session_id": session_id,
                    "cached_insight": ai_memory['activity_summaries'][session_id]
                })
            else:
                # New session
                is_cycling_session = any(is_cycling(a) for a in s)
                stages = []
                for a in s:
                    d_mi = n(a.get('distance', 0)) * 0.000621371
                    dur_m = n(a.get('duration', 0)) / 60
                    
                    # Robust local check for this stage
                    this_is_run = 'running' in a.get('activityType', {}).get('typeKey', '').lower()
                    this_is_cycle = is_cycling(a)
                    
                    stage_data = {
                        "activity_id": a.get('activityId'),
                        "name": a.get('activityName'),
                        "distance_mi": round(d_mi, 2),
                        "duration_min": round(dur_m),
                        "date": a.get('startTimeLocal', '').split(' ')[0],
                        "avg_hr": a.get('averageHR'),
                        "avg_cadence": a.get('averageBikeCadence') or a.get('averageRunCadence') or a.get('averageCadence'),
                        "elevation_gain_ft": round(n(a.get('elevationGain')) * 3.28084) if a.get('elevationGain') else 0
                    }
                    
                    # Provide explicit pace strings to guide the AI
                    if d_mi > 0 and dur_m > 0:
                        if this_is_run:
                            pace_dec = dur_m / d_mi
                            m = int(pace_dec)
                            s_rem = int((pace_dec - m) * 60)
                            stage_data["pace_m_per_mi"] = f"{m}:{s_rem:02d}"
                        elif this_is_cycle:
                            stage_data["pace_mph"] = round(d_mi / (dur_m / 60), 1)
                            # Priority Check: Extracted / Calculated > Summary > Stats
                            avg_p = a.get('extracted_avg_p') or a.get('averagePower') or a.get('avgPower')
                            max_p = a.get('extracted_max_p') or a.get('maxPower') or a.get('max_power')
                            norm_p = a.get('normalizedPower') or a.get('normPower')
                            
                            if n(avg_p) > 0: 
                                stage_data["avg_power_w"] = n(avg_p)
                            if n(max_p) > 0: stage_data["max_power_w"] = n(max_p)
                            if n(norm_p) > 0: stage_data["normalized_power_w"] = n(norm_p)
                            
                            stage_data["is_virtual"] = "virtual" in a.get('activityType', {}).get('typeKey', '').lower() or "zwift" in a.get('activityName', '').lower()
                            
                    stages.append(stage_data)

                # Prepare refined training history for AI
                session_summary = {
                    "session_id": session_id,
                    "name": s[0].get('activityName', 'Cycling Session'),
                    "is_multi_stage": len(s) > 1,
                    "stages": stages,
                    "period": "CURRENT_YEAR" if s[0].get('startTimeLocal', '').startswith(str(today.year)) else "PREVIOUS_YEAR"
                }

                # CRITICAL: Pull power metrics to the top-level of the session so the AI can't miss them
                if is_cycling_session:
                    all_stage_powers = [stg.get('avg_power_w') for stg in stages if stg.get('avg_power_w')]
                    if all_stage_powers:
                        session_summary["session_avg_power_w"] = round(sum(all_stage_powers) / len(all_stage_powers))
                    
                    # LOGGING AUDIT: This verifies what is actually being sent to the AI
                    logger.info(f"AI PAYLOAD AUDIT: Session {session_id} - Power: {session_summary.get('session_avg_power_w')}W")

                training_history_for_ai.append(session_summary)

        # Context Preparation
        context = {
            "today_date": today.isoformat(),
            "today_stats": {
                "steps": steps_today,
                "stress": stress_today,
                "sleep_score": sleep_score_today,
                "sleep_hours": sleep_hours_today,
                "hrv_status": hrv.get('status', 'Unknown')
            },
            "seven_day_history": history_list,
            "baselines_30d": baselines,
            "training_history": training_history_for_ai
        }

        # Gemini Call
        ai_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        settings = load_settings()
        model_name = settings.get('ai_model', 'gemma-3-27b-it')
        
        prompt = f"""
        You are 'Athlete Intelligence', my elite-level Performance Analyst.
        
        CRITICAL PERSONALITY:
        - Address me directly as 'you'. 
        - I am a data-driven athlete who values technical depth over generic "good job" feedback.
        - **NEVER** recommend "low-intensity walks" for rest. Focus on "Active Recovery," "Metabolic Flush," or "Structural Durability."
        - Be a "pattern seeker." Look for the **"Why"** behind the data:
            - Is your HR high for a familiar pace? (Indicates fatigue or heat)
            - Are you producing more power at a lower cadence? (Strength focus vs cardiovascular focus)
            - Are your recent runs showing a "tightening" of pace consistency?
        
        CRITICAL STYLE:
        - **Avoid being formulaic**. Do not just go down a checklist of Power, Speed, and HR for every session. 
        - **Find the Outlier**: Every session has one thing that stands out—Focus the analysis on THAT. 
        - Use Markdown bold (**) for stats only when they support a technical point.
        - The goal is to provide insight I **can't** see just by looking at a table of numbers.
        
        UNITS: 
        - RUNNING: **minutes per mile** (e.g., 7:45/mi).
        - CYCLING: **Watts** (Avg/NP) and **mph**.
        - ELEVATION: **Feet**.
        - CADENCE: **spm** (Run) / **rpm** (Cycle).
        - **TONE**: Direct, expert, coaching. Use 'you' and 'your'.
        
        COMPARISON DATA:
        - Use "baselines_30d" to see if an activity is above/below my recent average.
        - **MILESTONES**: Compare activities to `ytd_run_max_dist` or `ytd_cycle_max_power`. 
        - **RANKING**: Only consider sessions with `"period": "CURRENT_YEAR"` when calculating YTD rankings (e.g., 'longest run of the year'). DO NOT compare against 'PREVIOUS_YEAR' data for YTD claims.
        - If today's activity is a season best (longest run of the year, highest power of the year), you MUST lead with that accomplishment.
        
        DATA: {json.dumps(context)}
        
        For sessions with "cached_insight", reuse it. 
        For new sessions:
        - For the **4 most recent** sessions, provide a long-form, multi-paragraph insight (Strava-style).
        - For everything else, provide a concise 2-sentence highlight.
        
        CRITICAL: Every session in the 'training_history' MUST be accounted for in the 'activity_insights' response. 
        Address me using 'you' throughout.
        
        Return JSON structure:
        {{
          "daily_summary": "A bold summary followed by 2 sentences looking at health trends.", 
          "yesterday_summary": "1-2 sentences recap.", 
          "suggestions": ["...", "..."],
          "activity_insights": [{{ 
              "session_id": "...", 
              "name": "...", 
              "highlight": "**BOLD SUMMARY** (e.g. **Negative Split Master!**)", 
              "was": "Longer narrative analyzing pace vs 30d avg and consistency. Use **bold** for metrics.", 
              "worked_on": "e.g. Aerobic Power", 
              "better_next": "..." 
          }}]
        }}
        """

        response = ai_client.models.generate_content(model=model_name, contents=prompt)
        raw_text = response.text
        
        # Robust JSON extraction
        try:
            import re
            json_match = re.search(r'\{.*\}', raw_text, re.DOTALL)
            if json_match:
                clean_text = json_match.group(0)
            else:
                clean_text = raw_text.replace('```json', '').replace('```', '').strip()
            
            ai_data = json.loads(clean_text)
        except Exception as e:
            logger.error(f"Failed to parse AI response: {e}")
            logger.error(f"RAW TEXT: {raw_text}")
            raise e

        # Update Memory with new insights
        for insight in ai_data.get('activity_insights', []):
            sid = insight.get('session_id')
            if sid:
                # We always store it, even if it already existed, to get the freshest tone
                ai_memory['activity_summaries'][sid] = insight
        
        # Fallback Check: If the AI skipped ANY sessions, we create a basic placeholder 
        # so they aren't blank on the UI.
        for s in sessions:
            sid = "|".join([str(a.get('activityId')) for a in s])
            if sid not in ai_memory['activity_summaries']:
                logger.warning(f"AI skipped session {sid}, creating placeholder.")
                ai_memory['activity_summaries'][sid] = {
                    "session_id": sid,
                    "name": s[0].get('activityName', 'Activity'),
                    "highlight": "**Solid Consistency!**",
                    "was": "This activity is part of your regular training rhythm. Good effort maintaining momentum.",
                    "worked_on": "Consistency",
                    "better_next": "Keep stacking these sessions to build your aerobic base."
                }

        save_ai_memory(ai_memory)

        # Build final response with unrolled activity IDs
        final_activity_insights = []
        # We iterate over the sessions we originally identified to ensure nothing is missed
        for s in sessions:
            sid = "|".join([str(a.get('activityId')) for a in s])
            # Get insight from memory (which now includes the ones just generated)
            insight = ai_memory['activity_summaries'].get(sid)
            
            if insight:
                # Map this session insight to every activity in the group
                for a in s:
                    unrolled = insight.copy()
                    unrolled['activity_id'] = str(a.get('activityId'))
                    final_activity_insights.append(unrolled)

        result = {
            'daily_summary': ai_data.get('daily_summary'),
            'yesterday_summary': ai_data.get('yesterday_summary'),
            'suggestions': " ".join(ai_data.get('suggestions', [])),
            'activity_insights': final_activity_insights,
            'is_ai': True,
            'model_name': model_name
        }
        
        ai_insights_cache['data'] = result
        ai_insights_cache['timestamp'] = time.time()
        return result

    except Exception as e:
        logger.error(f"Logic generation failed: {e}")
        error_msg = str(e)
        # Try to extract a clean message if it's a Google API error
        if "Quota exceeded" in error_msg or "429" in error_msg:
            error_msg = "Gemini API Quota Exceeded. Please wait a minute before retrying."
        elif "503" in error_msg:
            error_msg = "Gemini API is temporarily overloaded. Please retry in a few seconds."
            
        return {
            'error': error_msg,
            'details': str(e),
            'daily_summary': "Analysis Interrupted.",
            'is_ai': False
        }

@app.route('/api/stats')
@login_required
def get_stats():
    try:
        client = get_garmin_client()
        today = get_today()
        today_str = today.isoformat()
        logger.info(f"Fetching stats for today: {today_str}")
        
        # specific date for stats (today)
        stats = client.get_stats(today_str)
        # Verify stats date - Garmin sometimes returns the last available day if today is empty
        if stats and stats.get('calendarDate') != today_str:
            logger.warning(f"Stats returned for {stats.get('calendarDate')} instead of {today_str}. Using empty stats for today.")
            stats = {}
        
        # Sleep data (often for "last night" which might be today's date or yesterday's depending on API)
        # We try today first
        sleep = client.get_sleep_data(today.isoformat())
        
        # Recent activities (Grouped)
        acts_raw = client.get_activities(0, 10)
        sessions = group_activities_into_sessions(acts_raw)
        
        # Flatten sessions for basic compatibility but keep group data
        ui_activities = []
        for s in sessions:
            if len(s) == 1:
                # Single activity
                ui_activities.append(s[0])
            else:
                # Grouped activity session
                total_dist = sum(n(a.get('distance', 0)) for a in s)
                total_dur = sum(n(a.get('duration', 0)) for a in s)
                # Use the primary activity (usually the longest or last) for the title
                # Filtering s to ensure we have a valid key for max
                primary = max(s, key=lambda x: n(x.get('distance', 0))) if s else s[0]
                
                grouped = primary.copy()
                grouped['distance'] = total_dist
                grouped['duration'] = total_dur
                grouped['activityName'] = f"Grouped Session: {len(s)} Stages"
                grouped['is_grouped'] = True
                grouped['grouped_ids'] = [str(a.get('activityId')) for a in s]
                grouped['grouped_activities'] = s
                ui_activities.append(grouped)

        # Verify sleep date
        sleep_dto = sleep.get('dailySleepDTO', {}) if isinstance(sleep, dict) else {}
        if sleep_dto and sleep_dto.get('calendarDate') != today_str:
            logger.warning(f"Sleep data returned for {sleep_dto.get('calendarDate')} instead of {today_str}. Ignoring.")
            sleep_dto = {}

        # Weight - Use cached or fetch once
        global weight_cache
        now = time.time()
        weight_grams = weight_cache['value']
        
        if not weight_grams or (now - weight_cache['timestamp'] > 3600):
            for i in range(5):
                check_date = (today - timedelta(days=i)).isoformat()
                try:
                    body_comp = client.get_body_composition(check_date)
                    if body_comp and 'totalAverage' in body_comp and body_comp['totalAverage'].get('weight'):
                        weight_grams = body_comp['totalAverage']['weight']
                        weight_cache = {'value': weight_grams, 'timestamp': now}
                        break
                except: continue

        # Use helper for calories and stats
        cal_data = get_calorie_data(client, today_str)

        response_data = {
            'steps': cal_data['steps'],
            'steps_goal': cal_data['steps_goal'],
            'resting_hr': cal_data['resting_hr'],
            'stress_avg': cal_data['stress_avg'],
            'sleep_seconds': n(sleep_dto.get('sleepTimeSeconds')),
            'sleep_score': n(
                sleep_dto.get('sleepScore') or 
                sleep_dto.get('score') or 
                sleep_dto.get('sleepScores', {}).get('overall', {}).get('value')
            ),
            'hrv': client.get_hrv_data(today.isoformat()).get('hrvSummary'),
            'activities': ui_activities,
            'weight_grams': weight_grams,
            'calories': {
                'total': cal_data['total'],
                'active': cal_data['active'],
                'resting': cal_data['resting']
            }
        }
        return jsonify(response_data)
        
    except ValueError as ve:
        return jsonify({'error': str(ve)}), 500
    except Exception as e:
        logger.error(f"Error fetching data: {e}")
        return jsonify({'error': 'Failed to fetch data from Garmin. Check server logs.'}), 500

@app.route('/api/goals')
@login_required
def get_user_goals():
    try:
        client = get_garmin_client()
        active_goals = client.get_goals("active")
        future_goals = client.get_goals("future")
        # Combine lists
        all_goals = active_goals + future_goals
        return jsonify(all_goals)
    except Exception as e:
        logger.error(f"Error fetching goals: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/goals_config')
@login_required
def get_goals_config():
    try:
        return jsonify({
            'monthly': {
                'running': float(os.getenv('MONTHLY_RUNNING_GOAL', 20)),
                'cycling': float(os.getenv('MONTHLY_CYCLING_GOAL', 200))
            },
            'yearly': {
                'running': float(os.getenv('YEARLY_RUNNING_GOAL', 365)),
                'cycling': float(os.getenv('YEARLY_CYCLING_GOAL', 5000))
            }
        })
    except Exception as e:
        logger.error(f"Error fetching goals config: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/longterm_stats')
@login_required
def get_longterm_stats():
    try:
        client = get_garmin_client()
        today = get_today()
        
        # Calculate start dates
        start_of_month = today.replace(day=1)
        start_of_year = today.replace(month=1, day=1)
        
        # Fetch data
        logger.info(f"Fetching stats from {start_of_month} to {today}")
        month_summary = client.get_progress_summary_between_dates(start_of_month.isoformat(), today.isoformat())
        year_summary = client.get_progress_summary_between_dates(start_of_year.isoformat(), today.isoformat())
        
        # logger.info(f"Month Summary Raw: {month_summary}") 
        
        def extract_distance(summary_list, activity_type_key):
            """Helper to sum distance for a specific activity type from the summary list.
            API returns distance in centimeters, nested in stats dictionary.
            Returns distance in MILES.
            """
            total_distance_cm = 0
            for item in summary_list:
                stats = item.get('stats', {})
                if activity_type_key in stats:
                    distance_data = stats[activity_type_key].get('distance', {})
                    val = distance_data.get('sum', 0)
                    total_distance_cm += val
            
            # Convert cm to miles (1 cm = 6.21371e-6 miles)
            miles = total_distance_cm * 0.00000621371
            logger.info(f"Extracted {activity_type_key}: {total_distance_cm} cm = {miles} miles")
            return miles

        data = {
            'month': {
                'running': extract_distance(month_summary, 'running'),
                'cycling': extract_distance(month_summary, 'cycling')
            },
            'year': {
                'running': extract_distance(year_summary, 'running'),
                'cycling': extract_distance(year_summary, 'cycling')
            }
        }
        
        return jsonify(data)
    except Exception as e:
        logger.error(f"Error fetching longterm stats: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/ytd_mileage_comparison')
@login_required
def get_ytd_mileage_comparison():
    try:
        client = get_garmin_client()
        today = get_today()
        current_day_of_year = today.timetuple().tm_yday
        
        # Build daily cumulative data for each year
        cycling_daily_data = {}
        running_daily_data = {}
        
        for year in [2024, 2025, 2026]:
            # Target date range: Jan 1 to same day-of-year as today
            start_date = date(year, 1, 1)
            end_date = start_date + timedelta(days=current_day_of_year - 1)
            
            # Don't query future for current year
            if year == today.year and end_date > today:
                end_date = today

            try:
                logger.info(f"Fetching activities for YTD {year} ({start_date} to {end_date})")
                activities = client.get_activities_by_date(start_date.isoformat(), end_date.isoformat())
                
                day_map_cycle = {}
                day_map_run = {}
                
                for act in activities:
                    start_local = act.get('startTimeLocal')
                    if not start_local: continue
                    
                    # Extract day of year
                    d_str = start_local.split(' ')[0]
                    d = date.fromisoformat(d_str)
                    d_num = d.timetuple().tm_yday
                    
                    dist_meters = act.get('distance', 0)
                    type_key = act.get('activityType', {}).get('typeKey', '')
                    
                    # Cycling
                    if 'cycling' in type_key or 'ride' in type_key:
                        day_map_cycle[d_num] = day_map_cycle.get(d_num, 0) + dist_meters
                    # Running
                    elif 'running' in type_key or 'run' in type_key:
                        day_map_run[d_num] = day_map_run.get(d_num, 0) + dist_meters

                # Now build cumulative arrays
                cycle_cumulative = []
                run_cumulative = []
                cumulative_cycle_miles = 0
                cumulative_run_miles = 0
                
                # Conversion factor: meters to miles
                M_TO_MI = 0.000621371
                
                for d in range(1, current_day_of_year + 1):
                    # Get daily distance (meters) or 0
                    c_m = day_map_cycle.get(d, 0)
                    r_m = day_map_run.get(d, 0)
                    
                    cumulative_cycle_miles += c_m * M_TO_MI
                    cumulative_run_miles += r_m * M_TO_MI
                    
                    cycle_cumulative.append(round(cumulative_cycle_miles, 1))
                    run_cumulative.append(round(cumulative_run_miles, 1))
                
                cycling_daily_data[str(year)] = cycle_cumulative
                running_daily_data[str(year)] = run_cumulative

            except Exception as e:
                logger.error(f"Error processing YTD for {year}: {e}")
                cycling_daily_data[str(year)] = [0] * current_day_of_year
                running_daily_data[str(year)] = [0] * current_day_of_year

        # Get goals from config
        cycle_goal = float(os.getenv('YEARLY_CYCLING_GOAL', 5000))
        run_goal = float(os.getenv('YEARLY_RUNNING_GOAL', 365))
        
        cycle_goal_increment = cycle_goal / 365
        run_goal_increment = run_goal / 365
        
        cycle_goal_line = [round(cycle_goal_increment * (i + 1), 1) for i in range(current_day_of_year)]
        run_goal_line = [round(run_goal_increment * (i + 1), 1) for i in range(current_day_of_year)]
        
        day_labels = [f"Day {i+1}" for i in range(current_day_of_year)]
        
        return jsonify({
            'labels': day_labels,
            'cycling': {
                'years': cycling_daily_data,
                'goal_line': cycle_goal_line,
                'yearly_goal': cycle_goal
            },
            'running': {
                'years': running_daily_data,
                'goal_line': run_goal_line,
                'yearly_goal': run_goal
            }
        })
    except Exception as e:
        logger.error(f"Error fetching YTD mileage comparison: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/steps_history')
@login_required
def get_steps_history():
    try:
        client = get_garmin_client()
        range_val = request.args.get('range', '1w')
        end_date_str = request.args.get('end_date')
        
        actual_today = get_today()
        # ... rest of the code is already updated in previous turn but I need to make sure 'client' is there
        # Since I'm replacing the whole function again to be safe:

        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = actual_today
        
        history_days = 90
        if range_val == '1y': history_days = 366
        elif range_val == '1m': history_days = max(history_days, 31)
        
        start_date = end_date - timedelta(days=history_days)
        all_data = client.get_daily_steps(start_date.isoformat(), end_date.isoformat())
        all_data.sort(key=lambda x: x['calendarDate'], reverse=True)
        
        streak = 0
        streak_start = actual_today - timedelta(days=90)
        streak_data = client.get_daily_steps(streak_start.isoformat(), actual_today.isoformat())
        streak_data.sort(key=lambda x: x['calendarDate'], reverse=True)
        
        today_str = actual_today.isoformat()
        temp_expected = actual_today
        for day in streak_data:
            d_str = day['calendarDate']
            curr_d = date.fromisoformat(d_str)
            if streak > 0 and (temp_expected - curr_d).days > 1: break
            steps = day.get('totalSteps', 0); goal = day.get('stepGoal', 10000)
            if d_str == today_str:
                if steps >= goal: streak += 1
                temp_expected = curr_d; continue
            if steps >= goal: streak += 1; temp_expected = curr_d
            else: break

        requested_days = 7
        if range_val == '1d': requested_days = 1
        elif range_val == '1m': requested_days = 30
        elif range_val == '1y': requested_days = 365
        
        # Filter history to ensure we don't return data past the end_date if Garmin returns it
        # and specifically for 1d view, ensure we are actually returning the requested day
        history = [d for d in all_data if d['calendarDate'] <= end_date.isoformat()]
        history = list(reversed(history[:requested_days]))
        
        # If we asked for 1d but history[0] isn't the right date, return an empty/zero placeholder
        if range_val == '1d' and history and history[0].get('calendarDate') != end_date.isoformat():
            logger.info(f"Steps: Requested {end_date.isoformat()}, but most recent is {history[0].get('calendarDate')}. Returning zero for today.")
            history = [{
                'calendarDate': end_date.isoformat(),
                'totalSteps': 0,
                'stepGoal': 10000
            }]

        return jsonify({
            'history': history,
            'streak': streak,
            'range': range_val
        })
    except Exception as e:
        logger.error(f"Error fetching steps history: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/hr_history')
@login_required
def get_hr_history():
    try:
        client = get_garmin_client()
        range_val = request.args.get('range', '1w')
        end_date_str = request.args.get('end_date')
        
        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = get_today()

        max_hr = get_user_max_hr(client)
        zones = [round(max_hr * (0.5 + i*0.1)) for i in range(5)]

        if range_val == '1d':
            hr_data = client.get_heart_rates(end_date.isoformat())
            return jsonify({
                'range': '1d',
                'summary': {
                    'rhr': hr_data.get('restingHeartRate'),
                    'max': hr_data.get('maxHeartRate'),
                    'min': hr_data.get('minHeartRate')
                },
                'samples': hr_data.get('heartRateValues', []),
                'zones': zones,
                'max_hr': max_hr
            })
        else:
            days = 7
            if range_val == '1w': days = 7
            elif range_val == '1m': days = 31
            elif range_val == '1y': days = 365
            
            history = []
            dates_to_fetch = [end_date - timedelta(days=i) for i in range(days)]
            
            from concurrent.futures import ThreadPoolExecutor
            def fetch_day(d):
                try:
                    day_data = client.get_heart_rates(d.isoformat())
                    if day_data.get('restingHeartRate'):
                        return {
                            'date': d.isoformat(),
                            'rhr': day_data.get('restingHeartRate'),
                            'max': day_data.get('maxHeartRate')
                        }
                except:
                    pass
                return None

            workers = 2 # Capped for Render memory
            with ThreadPoolExecutor(max_workers=workers) as executor:
                results = list(executor.map(fetch_day, dates_to_fetch))
            
            history = [r for r in results if r]
            history.sort(key=lambda x: x['date']) # Ensure sorted by date
            
            return jsonify({
                'range': range_val,
                'history': history,
                'zones': zones,
                'max_hr': max_hr
            })

    except Exception as e:
        logger.error(f"Error fetching HR history: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/stress_history')
@login_required
def get_stress_history():
    try:
        client = get_garmin_client()
        range_val = request.args.get('range', '1w')
        end_date_str = request.args.get('end_date')
        
        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = get_today()

        if range_val == '1d':
            stress_data = client.get_stress_data(end_date.isoformat())
            return jsonify({
                'range': '1d',
                'summary': {
                    'avg': stress_data.get('avgStressLevel'),
                    'max': stress_data.get('maxStressLevel')
                },
                'samples': stress_data.get('stressValuesArray', [])
            })
        else:
            days = 7
            if range_val == '1w': days = 7
            elif range_val == '1m': days = 31
            elif range_val == '1y': days = 365
            
            dates_to_fetch = [end_date - timedelta(days=i) for i in range(days)]
            
            from concurrent.futures import ThreadPoolExecutor
            def fetch_day(d):
                try:
                    day_data = client.get_stress_data(d.isoformat())
                    if day_data.get('avgStressLevel'):
                        return {
                            'date': d.isoformat(),
                            'avg': day_data.get('avgStressLevel'),
                            'max': day_data.get('maxStressLevel')
                        }
                except:
                    pass
                return None

            workers = 2 # Capped for Render memory
            with ThreadPoolExecutor(max_workers=workers) as executor:
                results = list(executor.map(fetch_day, dates_to_fetch))
            
            history = [r for r in results if r]
            history.sort(key=lambda x: x['date'])
            
            return jsonify({
                'range': range_val,
                'history': history
            })

    except Exception as e:
        logger.error(f"Error fetching stress history: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/sleep_history')
@login_required
def get_sleep_history():
    try:
        client = get_garmin_client()
        range_val = request.args.get('range', '1w')
        end_date_str = request.args.get('end_date')
        
        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = get_today()

        if range_val == '1d':
            sleep_data = client.get_sleep_data(end_date.isoformat())
            dto = sleep_data.get('dailySleepDTO', {})
            scores = dto.get('sleepScores', {})
            overall_score = scores.get('overall', {}).get('value')
            
            return jsonify({
                'range': '1d',
                'summary': {
                    'score': overall_score,
                    'total': dto.get('sleepTimeSeconds'),
                    'deep': dto.get('deepSleepSeconds'),
                    'light': dto.get('lightSleepSeconds'),
                    'rem': dto.get('remSleepSeconds'),
                    'awake': dto.get('awakeSleepSeconds')
                }
            })
        else:
            days = 7
            if range_val == '1w': days = 7
            elif range_val == '1m': days = 31
            elif range_val == '1y': days = 365
            
            dates_to_fetch = [end_date - timedelta(days=i) for i in range(days)]
            
            from concurrent.futures import ThreadPoolExecutor
            def fetch_day(d):
                try:
                    day_data = client.get_sleep_data(d.isoformat())
                    dto = day_data.get('dailySleepDTO', {})
                    scores = dto.get('sleepScores', {})
                    score = scores.get('overall', {}).get('value')
                    
                    if dto.get('sleepTimeSeconds'):
                        return {
                            'date': d.isoformat(),
                            'score': score,
                            'total': dto.get('sleepTimeSeconds')
                        }
                except:
                    pass
                return None

            workers = 2 # Capped for Render memory
            with ThreadPoolExecutor(max_workers=workers) as executor:
                results = list(executor.map(fetch_day, dates_to_fetch))
            
            history = [r for r in results if r]
            history.sort(key=lambda x: x['date'])
            
            return jsonify({
                'range': range_val,
                'history': history
            })

    except Exception as e:
        logger.error(f"Error fetching sleep history: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/weight_history')
@login_required
def get_weight_history():
    try:
        range_val = request.args.get('range', '1m')
        end_date_str = request.args.get('end_date')
        client = get_garmin_client()
        
        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = get_today()
        
        if range_val == '1m':
            start_date = end_date - timedelta(days=30)
        elif range_val == '6m':
            start_date = end_date - timedelta(days=180)
        elif range_val == '1y':
            start_date = end_date - timedelta(days=365)
        elif range_val == '2y':
            start_date = end_date - timedelta(days=730)
        elif range_val == '5y':
            start_date = end_date - timedelta(days=1825)
        else:
            start_date = end_date - timedelta(days=30)
            
        res = client.get_weigh_ins(start_date.isoformat(), end_date.isoformat())
        
        # Garmin API can return a list or a dict with 'dailyWeightSummaries'
        summaries = []
        if isinstance(res, list):
            summaries = res
        elif isinstance(res, dict) and 'dailyWeightSummaries' in res:
            summaries = res['dailyWeightSummaries']
            
        # Format for chart (earliest to latest)
        history = []
        for day in reversed(summaries):
            if 'latestWeight' in day and day['latestWeight'].get('weight'):
                kg = day['latestWeight']['weight'] / 1000
                lbs = kg * 2.20462
                history.append({
                    'date': day['summaryDate'],
                    'weight_kg': round(kg, 1),
                    'weight_lbs': round(lbs, 1)
                })
        
        return jsonify(history)
    except Exception as e:
        logger.error(f"Error fetching weight history: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/hydration')
@login_required
def get_hydration():
    try:
        client = get_garmin_client()
        today = get_today().isoformat()
        data = client.get_hydration_data(today)
        return jsonify({
            'date': today,
            'intake': data.get('valueInML', 0),
            'goal': data.get('goalInML', 2000)
        })
    except Exception as e:
        logger.error(f"Error fetching hydration: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/hrv')
@login_required
def get_hrv():
    try:
        client = get_garmin_client()
        range_val = request.args.get('range', '1d')
        end_date_str = request.args.get('end_date')
        
        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = get_today()

        if range_val == '1d':
            hrv_data = client.get_hrv_data(end_date.isoformat())
            return jsonify(hrv_data)
        else:
            days = 7
            if range_val == '1w': days = 7
            elif range_val == '1m': days = 31
            elif range_val == '1y': days = 365
            
            dates_to_fetch = [end_date - timedelta(days=i) for i in range(days)]
            
            from concurrent.futures import ThreadPoolExecutor
            def fetch_day(d):
                try:
                    day_data = client.get_hrv_data(d.isoformat())
                    summary = day_data.get('hrvSummary')
                    if summary:
                        return summary
                except:
                    pass
                return None

            workers = 2 # Capped for Render memory
            with ThreadPoolExecutor(max_workers=workers) as executor:
                results = list(executor.map(fetch_day, dates_to_fetch))
            
            history = [r for r in results if r]
            history.sort(key=lambda x: x['calendarDate'])
            
            # For status cards, we often want the "current" day's full data too
            current_full = client.get_hrv_data(end_date.isoformat())
            
            return jsonify({
                'range': range_val,
                'history': history,
                'hrvSummary': current_full.get('hrvSummary'),
                'hrvReadings': current_full.get('hrvReadings')
            })
    except Exception as e:
        logger.error(f"Error fetching HRV: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/hydration_history')
@login_required
def get_hydration_history():
    try:
        client = get_garmin_client()
        range_val = request.args.get('range', '1w')
        end_date_str = request.args.get('end_date')
        
        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = get_today()

        if range_val == '1d':
            data = client.get_hydration_data(end_date.isoformat())
            return jsonify({
                'range': '1d',
                'summary': {
                    'intake': data.get('valueInML', 0),
                    'goal': data.get('goalInML', 2000)
                }
            })
        else:
            days = 7
            if range_val == '1w': days = 7
            elif range_val == '1m': days = 31
            elif range_val == '1y': days = 365
            
            dates_to_fetch = [end_date - timedelta(days=i) for i in range(days)]
            
            from concurrent.futures import ThreadPoolExecutor
            def fetch_day(d):
                try:
                    day_data = client.get_hydration_data(d.isoformat())
                    if day_data.get('goalInML') or day_data.get('valueInML'):
                        return {
                            'date': d.isoformat(),
                            'intake': day_data.get('valueInML', 0),
                            'goal': day_data.get('goalInML', 2000)
                        }
                except:
                    pass
                return None

            workers = 2 # Capped for Render memory
            with ThreadPoolExecutor(max_workers=workers) as executor:
                results = list(executor.map(fetch_day, dates_to_fetch))
            
            history = [r for r in results if r]
            history.sort(key=lambda x: x['date'])
            
            return jsonify({
                'range': range_val,
                'history': history
            })

    except Exception as e:
        logger.error(f"Error fetching hydration history: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/intensity_minutes_history')
@login_required
def get_intensity_minutes_history():
    try:
        client = get_garmin_client()
        range_val = request.args.get('range', '1w')
        end_date_str = request.args.get('end_date')
        
        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = get_today()

        if range_val == '1d':
            # Detail for a single day
            im_data = client.get_intensity_minutes_data(end_date.isoformat())
            return jsonify({
                'range': '1d',
                'summary': {
                    'total': im_data.get('moderateMinutes', 0) + 2 * im_data.get('vigorousMinutes', 0),
                    'moderate': im_data.get('moderateMinutes', 0),
                    'vigorous': im_data.get('vigorousMinutes', 0),
                    'goal': im_data.get('weekGoal', 150),
                    'startDayMinutes': im_data.get('startDayMinutes', 0)
                },
                'samples': im_data.get('imValuesArray', [])
            })
        
        elif range_val in ['1w', '1m']:
            # Align to Monday-Sunday weeks
            # Garmin weekday() is 0 (Mon) to 6 (Sun)
            days_to_monday = end_date.weekday()
            current_monday = end_date - timedelta(days=days_to_monday)
            
            if range_val == '1w':
                start_date = current_monday
                days = 7
            else: # 1m
                # Show 4 full weeks (the current week + 3 previous)
                start_date = current_monday - timedelta(weeks=3)
                days = 28
            
            dates_to_fetch = [start_date + timedelta(days=i) for i in range(days)]
            
            from concurrent.futures import ThreadPoolExecutor
            def fetch_day(d):
                try:
                    # Don't fetch future dates
                    if d > get_today():
                        return { 'date': d.isoformat(), 'moderate': 0, 'vigorous': 0, 'total': 0 }
                    data = client.get_intensity_minutes_data(d.isoformat())
                    return {
                        'date': d.isoformat(),
                        'moderate': data.get('moderateMinutes', 0),
                        'vigorous': data.get('vigorousMinutes', 0),
                        'total': data.get('moderateMinutes', 0) + 2 * data.get('vigorousMinutes', 0)
                    }
                except:
                    return { 'date': d.isoformat(), 'moderate': 0, 'vigorous': 0, 'total': 0 }

            with ThreadPoolExecutor(max_workers=20) as executor:
                results = list(executor.map(fetch_day, dates_to_fetch))
            
            history = results
            history.sort(key=lambda x: x['date'])
            
            # Fetch current weekly goal
            goal = 150
            try:
                today_stats = client.get_intensity_minutes_data(get_today().isoformat())
                goal = today_stats.get('weekGoal', 150)
            except:
                pass

            return jsonify({
                'range': range_val,
                'history': history,
                'goal': goal
            })

        else: # 6m or 1y
            # Weekly summaries
            weeks = 26 if range_val == '6m' else 52
            start_date = end_date - timedelta(weeks=weeks)
            
            wim_data = client.get_weekly_intensity_minutes(start_date.isoformat(), end_date.isoformat())
            # Format: {'calendarDate': '...', 'weeklyGoal': ..., 'moderateValue': ..., 'vigorousValue': ...}
            
            history = []
            for w in wim_data:
                history.append({
                    'date': w.get('calendarDate'),
                    'goal': w.get('weeklyGoal', 150),
                    'moderate': w.get('moderateValue', 0),
                    'vigorous': w.get('vigorousValue', 0),
                    'total': w.get('moderateValue', 0) + 2 * w.get('vigorousValue', 0)
                })
            
            return jsonify({
                'range': range_val,
                'history': history
            })

    except Exception as e:
        logger.error(f"Error fetching intensity minutes history: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/activity/<int:activity_id>')
@login_required
def get_activity_details(activity_id):
    try:
        logger.info(f"Fetching details for activity_id: {activity_id}")
        client = get_garmin_client()
        details = client.get_activity_details(activity_id)
        if not details:
            logger.warning(f"No details found for activity {activity_id}")
            return jsonify({'error': "Activity details not available from Garmin"}), 404
            
        returned_id = details.get('activityId')
        logger.info(f"Garmin returned details for ID: {returned_id} (Requested: {activity_id})")
        
        # Extract metrics and descriptors
        descriptors = details.get('metricDescriptors', [])
        metrics_list = details.get('activityDetailMetrics', [])
        
        # Create a mapping of key to index
        key_map = {d['key']: d['metricsIndex'] for d in descriptors}
        logger.info(f"Available metrics keys: {list(key_map.keys())}")
        
        def get_val(row, key):
            idx = key_map.get(key)
            if idx is not None and idx < len(row):
                return row[idx]
            return None

        charts = {
            'heart_rate': [], 'speed': [], 'elevation': [],
            'cadence': [], 'power': [], 'timestamps': [], 'distance': []
        }
        
        # Build strict chart lists
        for m in metrics_list:
            row = m.get('metrics')
            if not row: continue
            
            ts = get_val(row, 'directTimestamp')
            if ts:
                charts['timestamps'].append(ts)
                charts['heart_rate'].append(get_val(row, 'directHeartRate'))
                charts['speed'].append(get_val(row, 'directSpeed'))
                charts['elevation'].append(get_val(row, 'directElevation'))
                charts['power'].append(get_val(row, 'directPower'))
                charts['distance'].append(get_val(row, 'sumDistance'))
                
                # Cadence logic
                cad = get_val(row, 'directRunCadence')
                if cad is None: cad = get_val(row, 'directDoubleCadence')
                if cad is None: cad = get_val(row, 'directBikeCadence')
                if cad is None: cad = get_val(row, 'directFractionalCadence')
                charts['cadence'].append(cad)

        # Summary Refinement
        activity_info = client.get_activity(activity_id)
        summary = details.get('summaryDTO')
        if (not summary or not isinstance(summary, dict) or len(summary) < 5) and activity_info:
            summary = activity_info.get('summaryDTO')
        
        if not summary or not isinstance(summary, dict):
            summary = {}

        # Calculate missing summary fields from charts
        total_dist_m = summary.get('distance')
        if not total_dist_m and charts['distance']:
            # Find last non-null distance
            for d in reversed(charts['distance']):
                if d is not None:
                    total_dist_m = d
                    break
        
        total_dur_s = summary.get('duration')
        if not total_dur_s and len(charts['timestamps']) > 1:
            total_dur_s = (charts['timestamps'][-1] - charts['timestamps'][0]) / 1000

        avg_speed = summary.get('averageSpeed')
        if not avg_speed and total_dur_s and total_dur_s > 0:
            if total_dist_m is not None:
                avg_speed = total_dist_m / total_dur_s
            else:
                avg_speed = 0

        avg_pace_str = "--"
        if avg_speed and avg_speed > 0.1:
            pace_seconds = 1609.34 / avg_speed
            avg_pace_str = f"{int(pace_seconds//60)}:{int(pace_seconds%60):02d}"

        # Determine activity type for splits
        type_info = activity_info.get('activityType', {}) if activity_info else {}
        type_key = type_info.get('typeKey', '').lower()
        act_name = activity_info.get('activityName', '').lower() if activity_info else ""
        
        # Comprehensive cycling check (Type or Name)
        is_cycling = any(k in type_key for k in ['cycling', 'ride', 'biking', 'virtual', 'indoor']) or \
                     any(k in act_name for k in ['zwift', 'ride', 'cycling', 'peloton', 'trainerroad'])
        
        split_len = 5 if is_cycling else 1
        
        logger.info(f"Activity {activity_id} detected as {'CYCLING' if is_cycling else 'RUNNING/OTHER'} (type_key: {type_key})")
        
        # Splits logic
        splits = []
        try:
            if 'sumDistance' in key_map:
                mile_in_m = 1609.34
                next_split_dist = split_len * mile_in_m
                last_dur = 0
                last_dist = 0
                start_ts = charts['timestamps'][0] if charts['timestamps'] else 0
                
                for m in metrics_list:
                    row = m.get('metrics')
                    if not row: continue
                    
                    curr_dist = get_val(row, 'sumDistance')
                    if curr_dist and curr_dist >= next_split_dist:
                        # Find duration
                        curr_dur = get_val(row, 'sumDuration')
                        if curr_dur is None: # Fallback to timestamp
                            ts = get_val(row, 'directTimestamp')
                            curr_dur = (ts - start_ts) / 1000 if ts else 0
                        
                        split_dur = curr_dur - last_dur
                        actual_dist_m = curr_dist - last_dist
                        actual_dist_mi = actual_dist_m / mile_in_m
                        
                        if split_dur > 0 and actual_dist_mi > 0:
                            if is_cycling:
                                speed = actual_dist_mi / (split_dur / 3600)
                                pace_str = f"{speed:.1f} mph"
                            else:
                                pace_val = split_dur / actual_dist_mi
                                pace_str = f"{int(pace_val//60)}:{int(pace_val%60):02d}"

                            splits.append({
                                'mile': round(next_split_dist / mile_in_m, 0) if not is_cycling or (next_split_dist / mile_in_m) % 1 == 0 else round(next_split_dist / mile_in_m, 1),
                                'duration': split_dur,
                                'pace_str': pace_str
                            })
                        last_dur = curr_dur
                        last_dist = curr_dist
                        # Ensure we move to the next boundary even if we jumped multiple
                        while next_split_dist <= curr_dist:
                            next_split_dist += split_len * mile_in_m
                
                # Final partial split
                if total_dist_m and total_dist_m > last_dist:
                    remain_m = total_dist_m - last_dist
                    remain_mi = remain_m / mile_in_m
                    if remain_mi > 0.05: # Only show if significant (>0.05mi)
                        remain_dur = total_dur_s - last_dur
                        if remain_dur > 0:
                            if is_cycling:
                                speed = remain_mi / (remain_dur / 3600)
                                pace_str = f"{speed:.1f} mph"
                            else:
                                pace_pm = remain_dur / remain_mi
                                pace_str = f"{int(pace_pm//60)}:{int(pace_pm%60):02d}"
                            
                            splits.append({
                                'mile': round(total_dist_m / mile_in_m, 2),
                                'duration': remain_dur,
                                'pace_str': pace_str
                            })
        except Exception as split_err:
            logger.error(f"Error calculating splits: {split_err}")

        logger.info(f"Activity {activity_id}: found {len(splits)} splits, dist {total_dist_m}m, dur {total_dur_s}s")

        # Prepare polyline (compact it for front-end performance)
        raw_poly = (details.get('geoPolylineDTO') or {}).get('polyline', [])
        compact_poly = [[p['lat'], p['lon']] for p in raw_poly if 'lat' in p and 'lon' in p]
        
        return jsonify({
            'activityId': activity_id,
            'charts': charts,
            'summary': summary,
            'splits': splits,
            'avg_pace_str': avg_pace_str,
            'avg_speed': avg_speed,
            'polyline': compact_poly
        })
    except Exception as e:
        logger.error(f"Error fetching activity details: {e}")
        logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

@app.route('/api/add_weight', methods=['POST'])
@login_required
def add_weight():
    try:
        data = request.json
        weight = data.get('weight') # in kg
        
        if not weight:
            return jsonify({'error': 'Weight is required'}), 400
            
        client = get_garmin_client()
        
        # GarminConnect library requires timestamp as the first argument
        timestamp = datetime.now(EST).isoformat()
        
        client.add_body_composition(timestamp, float(weight))
        
        return jsonify({'status': 'success', 'message': 'Weight added successfully'})

    except Exception as e:
        logger.error(f"Error adding weight: {e}")
        return jsonify({'error': str(e)}), 500

# --- Nutrition & Calorie Tracking ---

@app.route('/api/nutrition/logs', methods=['GET'])
@login_required
def get_food_logs():
    date_str = request.args.get('date', get_today().isoformat())
    logs = load_json(FOOD_LOGS_FILE, [])
    day_logs = [log for log in logs if log['date'] == date_str]
    return jsonify(day_logs)

@app.route('/api/nutrition/log', methods=['POST'])
@login_required
def log_food():
    data = request.json
    raw_name = data.get('name', '')
    if not raw_name:
        return jsonify({'error': 'Food name required'}), 400
    
    # Support multiple food items separated by commas
    items_to_log = [i.strip() for i in raw_name.split(',')]
    logged_entries = []
    
    date_str = data.get('date', get_today().isoformat())
    time_str = data.get('time', datetime.now(EST).strftime('%H:%M'))
    custom_foods = load_json(CUSTOM_FOODS_FILE, {})
    
    ai_items = []
    for name in items_to_log:
        if name in custom_foods:
            nutrition = custom_foods[name]
            log_entry = {
                'id': int(time.time() * 1000) + len(logged_entries),
                'date': date_str,
                'time': time_str,
                'name': name,
                **nutrition
            }
            logged_entries.append(log_entry)
        else:
            ai_items.append(name)
            
    if ai_items:
        try:
            ai_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
            settings = load_settings()
            model_name = settings.get('ai_model', 'gemini-2.0-flash-exp')
            
            prompt = f"""
            Analyze these food items: {", ".join(ai_items)}
            My Goals: Weight loss, low cholesterol.
            Return ONLY a JSON array of objects, one for each item, with:
            name (string), calories (int), cholesterol_mg (int), protein_g (int), carbs_g (int), fat_g (int), ai_note (str).
            """
            
            response = ai_client.models.generate_content(model=model_name, contents=prompt)
            clean_text = response.text.replace('```json', '').replace('```', '').strip()
            estimates = json.loads(clean_text)
            
            for est in estimates:
                log_entry = {
                    'id': int(time.time() * 1000) + len(logged_entries),
                    'date': date_str,
                    'time': time_str,
                    **est
                }
                logged_entries.append(log_entry)
        except Exception as e:
            logger.error(f"Bulk AI estimation failed: {e}")
            for name in ai_items:
                logged_entries.append({
                    'id': int(time.time() * 1000) + len(logged_entries),
                    'date': date_str, 'time': time_str, 'name': name,
                    'calories': 0, 'cholesterol_mg': 0, 'protein_g': 0, 'carbs_g': 0, 'fat_g': 0, 'ai_note': 'Failed'
                })

    dry_run = request.args.get('dry_run') == 'true'
    if not dry_run:
        logs = load_json(FOOD_LOGS_FILE, [])
        logs.extend(logged_entries)
        save_json(FOOD_LOGS_FILE, logs)
    
    return jsonify(logged_entries)
    
    nutrition = None
    if name in custom_foods:
        nutrition = custom_foods[name]
        logger.info(f"Nutrition: Found custom food '{name}'")
    else:
        # Use AI to estimate
        try:
            ai_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
            settings = load_settings()
            model_name = settings.get('ai_model', 'gemini-2.0-flash-exp')
            
            prompt = f"""
            Estimate nutritional values for: "{name}"
            Aaron's Goals: Weight loss, low cholesterol.
            Return ONLY a JSON object with: 
            calories (int), cholesterol_mg (int), protein_g (int), carbs_g (int), fat_g (int), ai_note (str).
            """
            
            response = ai_client.models.generate_content(model=model_name, contents=prompt)
            clean_text = response.text.replace('```json', '').replace('```', '').strip()
            nutrition = json.loads(clean_text)
            logger.info(f"Nutrition: AI estimated '{name}' at {nutrition.get('calories')} kcal")
        except Exception as e:
            logger.error(f"AI Nutrition estimation failed: {e}")
            nutrition = {'calories': 0, 'cholesterol_mg': 0, 'protein_g': 0, 'carbs_g': 0, 'fat_g': 0, 'ai_note': 'Estimation failed.'}

    log_entry = {
        'id': int(time.time() * 1000),
        'date': date_str,
        'time': time_str,
        'name': name,
        **nutrition
    }
    
    logs = load_json(FOOD_LOGS_FILE, [])
    logs.append(log_entry)
    save_json(FOOD_LOGS_FILE, logs)
    
    return jsonify(log_entry)

@app.route('/api/nutrition/delete', methods=['POST'])
@login_required
def delete_food_log():
    log_id = request.json.get('id')
    logs = load_json(FOOD_LOGS_FILE, [])
    new_logs = [l for l in logs if l.get('id') != log_id]
    save_json(FOOD_LOGS_FILE, new_logs)
    return jsonify({'status': 'success'})

@app.route('/api/nutrition/custom_foods', methods=['GET', 'POST'])
@login_required
def handle_custom_foods():
    if request.method == 'GET':
        return jsonify(load_json(CUSTOM_FOODS_FILE, {}))
    
    data = request.json
    name = data.get('name')
    if not name:
        return jsonify({'error': 'Food name required'}), 400
    
    custom_foods = load_json(CUSTOM_FOODS_FILE, {})
    custom_foods[name] = {
        'calories': data.get('calories', 0),
        'cholesterol_mg': data.get('cholesterol_mg', 0),
        'protein_g': data.get('protein_g', 0),
        'carbs_g': data.get('carbs_g', 0),
        'fat_g': data.get('fat_g', 0),
        'category': data.get('category', 'Meal'),
        'ingredients': data.get('ingredients', []) # List of {name, qty, unit, cals}
    }
    save_json(CUSTOM_FOODS_FILE, custom_foods)
    return jsonify({'status': 'success'})

@app.route('/api/nutrition/delete_library_item', methods=['POST'])
@login_required
def delete_library_item():
    name = request.json.get('name')
    custom_foods = load_json(CUSTOM_FOODS_FILE, {})
    if name in custom_foods:
        del custom_foods[name]
        save_json(CUSTOM_FOODS_FILE, custom_foods)
    return jsonify({'status': 'success'})

@app.route('/api/nutrition/estimate_ingredients', methods=['POST'])
@login_required
def estimate_ingredients():
    data = request.json
    ingredients = data.get('ingredients', [])
    
    if not ingredients:
        return jsonify({'error': 'Ingredients required'}), 400
        
    try:
        ai_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        settings = load_settings()
        model_name = settings.get('ai_model', 'gemini-2.0-flash-exp')
        
        ing_list_str = "\n".join([f"- {i['qty']} {i['unit']} of {i['name']}" for i in ingredients])
        
        prompt = f"""
        Estimate nutritional values for these ingredients collectively and individually:
        {ing_list_str}
        
        Return ONLY a JSON array where each object corresponds to an ingredient and has:
        calories (int), cholesterol_mg (int), protein_g (int), carbs_g (int), fat_g (int).
        """
        
        response = ai_client.models.generate_content(model=model_name, contents=prompt)
        clean_text = response.text.replace('```json', '').replace('```', '').strip()
        result = json.loads(clean_text)
        return jsonify(result)
    except Exception as e:
        logger.error(f"Bulk ingredient estimation failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/nutrition/export_library')
@login_required
def export_library_csv():
    import csv
    import io
    from flask import make_response
    
    library = load_json(CUSTOM_FOODS_FILE, {})
    si = io.StringIO()
    cw = csv.writer(si)
    cw.writerow(['Name', 'Category', 'Calories', 'Cholesterol (mg)', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Ingredients'])
    
    for name, data in library.items():
        ings = data.get('ingredients') or []
        ing_list = "; ".join([f"{i.get('qty','0')} {i.get('unit','pcs')} {i.get('name','Item')}" for i in ings])
        cw.writerow([
            name,
            data.get('category'),
            data.get('calories'),
            data.get('cholesterol_mg'),
            data.get('protein_g'),
            data.get('carbs_g'),
            data.get('fat_g'),
            ing_list
        ])
    
    output = make_response(si.getvalue())
    output.headers["Content-Disposition"] = "attachment; filename=food_library.csv"
    output.headers["Content-Type"] = "text/csv"
    return output

@app.route('/api/nutrition/analysis')
@login_required
def get_nutrition_analysis():
    date_str = request.args.get('date', get_today().isoformat())
    
    # Get intakes
    logs = load_json(FOOD_LOGS_FILE, [])
    day_logs = [log for log in logs if log['date'] == date_str]
    total_in = sum(l.get('calories', 0) for l in day_logs)
    total_chol = sum(l.get('cholesterol_mg', 0) for l in day_logs)
    
    # Get outtakes from Garmin with detailed breakdown and fallbacks
    client = get_garmin_client()
    cal_data = get_calorie_data(client, date_str)
    
    total_out = cal_data['total']
    active_out = cal_data['active']
    resting_out = cal_data['resting']
    
    # Check for no_ai flag
    if request.args.get('no_ai') == 'true':
        return jsonify({
            'analysis': "Detailed analysis available on request.",
            'metabolic': {
                'total': total_out,
                'resting': resting_out,
                'active': active_out
            }
        })
    
    try:
        ai_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        settings = load_settings()
        model_name = settings.get('ai_model', 'gemini-2.0-flash-exp')
        
        food_list = ", ".join([l['name'] for l in day_logs]) or "No food logged yet."
        
        prompt = f"""
        You are 'Athlete Intelligence', a personal health coach. Analyze my nutrition for {date_str}.
        My Goals: Weight loss, low cholesterol.
        
        Metabolic Data:
        - Total Energy Out: {total_out} kcal (Resting: {resting_out}, Active: {active_out})
        - Total Energy In: {total_in} kcal
        - Total Cholesterol: {total_chol} mg
        - Logged Foods: {food_list}
        
        Address me directly as 'you'. Provide a concise, expert analysis (2 sentences). 
        Focus on how my energy balance (intake vs total out) and cholesterol align with my weight loss and heart health goals. 
        If 'Active' calories are high, mention my workout efficiency.
        """
        
        response = ai_client.models.generate_content(model=model_name, contents=prompt)
        return jsonify({
            'analysis': response.text,
            'metabolic': {
                'total': total_out,
                'resting': resting_out,
                'active': active_out
            }
        })
    except Exception as e:
        logger.error(f"Nutrition analysis failed: {e}")
        return jsonify({
            'analysis': "Athlete Intelligence is currently refining your metabolic insights.",
            'metabolic': {
                'total': total_out,
                'resting': resting_out,
                'active': active_out
            }
        })

@app.route('/api/nutrition/export')
@login_required
def export_food_csv():
    import csv
    import io
    from flask import make_response
    
    logs = load_json(FOOD_LOGS_FILE, [])
    # Sort by date and time
    logs.sort(key=lambda x: (x['date'], x['time']))
    
    si = io.StringIO()
    cw = csv.writer(si)
    cw.writerow(['Date', 'Time', 'Food', 'Calories', 'Cholesterol (mg)', 'Protein (g)', 'Carbs (g)', 'Fat (g)'])
    
    for l in logs:
        cw.writerow([
            l.get('date'),
            l.get('time'),
            l.get('name'),
            l.get('calories'),
            l.get('cholesterol_mg'),
            l.get('protein_g'),
            l.get('carbs_g'),
            l.get('fat_g')
        ])
    
    output = make_response(si.getvalue())
    output.headers["Content-Disposition"] = "attachment; filename=food_logs.csv"
    output.headers["Content-Type"] = "text/csv"
    return output

@app.route('/api/activity_heatmap')
@login_required
def get_activity_heatmap():
    global activity_heatmap_cache
    now = time.time()
    
    if activity_heatmap_cache['data'] and activity_heatmap_cache['timestamp']:
        if now - activity_heatmap_cache['timestamp'] < ACT_HEATMAP_CACHE_EXPIRY:
            logger.info("Heatmap: Returning cached data.")
            return jsonify(activity_heatmap_cache['data'])

    try:
        client = get_garmin_client()
        today = get_today()
        start_date = today - timedelta(days=366)
        
        # 1. Attempt date-range fetch (more precise for exactly 1 year)
        start_str = start_date.isoformat()
        end_str = today.isoformat()
        logger.info(f"Heatmap: Attempting date-range fetch from {start_str} to {end_str}")
        
        activities = []
        try:
            activities = garmin_request(client.get_activities_by_date, start_str, end_str)
        except Exception as e:
            logger.warning(f"Heatmap: get_activities_by_date failed: {e}. Falling back...")

        # 2. Fallback to count-based fetch if empty or failed
        if not activities:
            logger.info("Heatmap: No activities from date-range. Fetching last 1000...")
            activities = garmin_request(client.get_activities, 0, 1000)
        
        logger.info(f"Heatmap: Found {len(activities) if activities else 0} total activities to process.")
        
        heatmap = {}
        for activity in activities:
            if not activity: continue
            start_local = activity.get('startTimeLocal')
            if start_local and len(start_local) >= 10:
                # Robust date extraction: first 10 characters are YYYY-MM-DD
                date_str = start_local[:10]
                
                if date_str not in heatmap:
                    heatmap[date_str] = []
                
                # Extract distance and duration safely
                raw_dist = activity.get('distance')
                raw_dur = activity.get('duration')
                
                dist_mi = round(n(raw_dist) / 1609.34, 1)
                dur_m = round(n(raw_dur) / 60)
                
                # Add a succinct summary for the UI tooltip
                heatmap[date_str].append({
                    'name': activity.get('activityName', 'Activity'),
                    'type': activity.get('activityType', {}).get('typeKey', 'other'),
                    'dist': dist_mi,
                    'dur': dur_m
                })

        # Debug: Log a few keys to verify format
        if heatmap:
            sample_keys = list(heatmap.keys())[:3]
            logger.info(f"Heatmap: Generated {len(heatmap)} date keys. Samples: {sample_keys}")

        # Final Cache Commit
        activity_heatmap_cache['data'] = heatmap
        activity_heatmap_cache['timestamp'] = now
        return jsonify(heatmap)

    except Exception as e:
        logger.error(f"Error fetching activity heatmap: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/calendar_activities')
@login_required
def get_calendar_activities():
    try:
        client = get_garmin_client()
        start = request.args.get('start_date')
        end = request.args.get('end_date')
        
        if not start or not end:
            return jsonify({'error': 'Start and End dates required'}), 400
            
        activities = client.get_activities_by_date(start, end)
        return jsonify(activities)

    except Exception as e:
        logger.error(f"Error fetching calendar activities: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/heatmap_data')
@login_required
def get_heatmap_data():
    global heatmap_cache
    range_val = request.args.get('range', 'this_year')
    now = time.time()
    
    if heatmap_cache['data'] and heatmap_cache['range'] == range_val:
        if now - heatmap_cache['timestamp'] < HEATMAP_CACHE_EXPIRY:
            return jsonify(heatmap_cache['data'])

    try:
        client = get_garmin_client()
        
        today = get_today()
        if range_val == 'this_year':
            start_date = date(today.year, 1, 1)
        elif range_val == 'this_month':
            start_date = date(today.year, today.month, 1)
        elif range_val == 'last_month':
            first_this_month = date(today.year, today.month, 1)
            end_date = first_this_month - timedelta(days=1)
            start_date = date(end_date.year, end_date.month, 1)
        elif range_val == 'last_year':
            start_date = date(today.year - 1, 1, 1)
            end_date = date(today.year - 1, 12, 31) # Correctly set end date
        elif range_val == 'all':
            start_date = date(2020, 1, 1) # Arbitrary reasonable start
        else:
            start_date = today - timedelta(days=90)
            
        # Standard flow covers until today unless overridden
        if range_val not in ['last_year', 'last_month']:
            end_date = today

        # 1. Fetch Activity List (Summary)
        # Note: get_activities matches by count, get_activities_by_date matches by date
        # We use by_date which is more robust for "This Year"
        logger.info(f"Fetching activities for heatmap: {start_date} to {end_date}")
        activities = client.get_activities_by_date(start_date.isoformat(), end_date.isoformat())
        
        # 2. Identify missing Cached Polylines
        missing_ids = []
        result_points = []
        
        for act in activities:
            aid = act.get('activityId')
            # Check basic filters here if we want server side filtering
            # For now send all data, let frontend filter types
            
            if poly_cache.has(aid):
                # Retrieve from cache
                poly = poly_cache.get(aid)
                # Optimize: We interpret the polyline here to flatten it? 
                # Or send struct. Sending raw struct {lat, lon} array is fine.
                if poly:
                    result_points.append({
                        'id': aid,
                        'type': act.get('activityType', {}).get('typeKey'),
                        'poly': poly # List of {lat, lon, ...}
                    })
            else:
                # Identification logic:
                # 1. Activities with real GPS usually have startLatitude != 0 and not None
                # 2. Virtual rides (Zwift) often have startLatitude = 0.0 but CONTAIN valid Polyline data
                # 3. We want to fetch if we haven't checked yet
                
                lat = act.get('startLatitude')
                type_key = act.get('activityType', {}).get('typeKey', 'unknown')
                is_virtual = 'virtual' in type_key.lower() or 'indoor_cycling' in type_key.lower()
                
                # Check for cached emptiness?
                # If we visited it before and saved [], it will start in poly_cache.has(aid) -> True
                # So here we only care about candidates we have NEVER checked.
                
                # Condition: Has latitude (even 0.0 for virtual) OR is explicitly virtual
                if lat is not None or is_virtual:
                    missing_ids.append(aid)

        # 3. Trigger Background Fill if needed
        if missing_ids:
            global fetch_generation, active_fetch_range, is_fetching
            
            with fetch_lock:
                if range_val != active_fetch_range:
                    fetch_generation += 1
                    active_fetch_range = range_val
                    is_fetching = True
                    current_gen = fetch_generation
                    
                    logger.info(f"New range '{range_val}': cancelling old, starting gen:{current_gen} for {len(missing_ids)} items.")
                    # Use a lock to ensure only one fetcher runs at a time globally
                    thread = threading.Thread(target=background_polyline_fetcher, args=(client, missing_ids, current_gen))
                    thread.daemon = True
                    thread.start()
                elif not is_fetching:
                    is_fetching = True
                    current_gen = fetch_generation
                    logger.info(f"Range '{range_val}' active but no worker. Spawning gen:{current_gen} for {len(missing_ids)} items.")
                    thread = threading.Thread(target=background_polyline_fetcher, args=(client, missing_ids, current_gen))
                    thread.daemon = True
                    thread.start()
            
        result = {
            'count': len(result_points),
            'total_activities': len(activities),
            'missing_count': len(missing_ids),
            'data': result_points
        }
        
        # Update Cache
        heatmap_cache['data'] = result
        heatmap_cache['timestamp'] = time.time()
        heatmap_cache['range'] = range_val
        
        return jsonify(result)

    except Exception as e:
        logger.error(f"Error serving heatmap data: {e}")
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
