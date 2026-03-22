import os
import subprocess
import logging
from google import genai
import json
import traceback
from flask import Flask, render_template, jsonify, request, session, redirect, url_for
from functools import wraps
from garminconnect import Garmin
import garth
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

def get_git_command():
    """Find the git command, checking common paths as fallback when PATH is minimal."""
    try:
        subprocess.run(['git', '--version'], check=True, capture_output=True)
        return 'git'
    except (subprocess.CalledProcessError, FileNotFoundError):
        fallback_paths = []
        if os.name == 'nt':
            fallback_paths = [
                r"C:\Program Files\Git\cmd\git.exe",
                r"C:\Program Files\Git\bin\git.exe",
                r"C:\Users\User\AppData\Local\Programs\Git\cmd\git.exe"
            ]
        else:
            # Linux/macOS: services often run with minimal PATH that excludes /usr/bin
            fallback_paths = [
                "/usr/bin/git",
                "/usr/local/bin/git",
                "/bin/git"
            ]
        for path in fallback_paths:
            if os.path.exists(path):
                try:
                    subprocess.run([path, '--version'], check=True, capture_output=True)
                    return path
                except (subprocess.CalledProcessError, FileNotFoundError):
                    continue
    return None

def get_bash_command():
    """Find the bash command, checking common paths as fallback when PATH is minimal."""
    try:
        subprocess.run(['bash', '--version'], check=True, capture_output=True)
        return 'bash'
    except (subprocess.CalledProcessError, FileNotFoundError):
        fallback_paths = [
            "/bin/bash",
            "/usr/bin/bash",
            "/usr/local/bin/bash"
        ]
        for path in fallback_paths:
            if os.path.exists(path):
                return path
    return None

def get_app_version():
    """Calculate app version based on git commit count."""
    try:
        git_cmd = get_git_command()
        if not git_cmd:
            return "0.000"
        # Use subprocess to get the commit count from git
        count = subprocess.check_output([git_cmd, 'rev-list', '--count', 'HEAD'], 
                                       stderr=subprocess.DEVNULL,
                                       text=True).strip()
        return f"0.{count.zfill(3)}"
    except Exception:
        return "0.000"

# Application global version
APP_VERSION = get_app_version()

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
user_profile_cache = {'data': None, 'timestamp': None}

# Strength Muscle Mapping
# Each entry: { 'primary': [muscles], 'secondary': [muscles] }
STRENGTH_MUSCLE_MAPPING = {
    'ABS': {'primary': ['Abs'], 'secondary': []},
    'CRUNCH': {'primary': ['Abs'], 'secondary': []},
    'PLANK': {'primary': ['Abs'], 'secondary': []},
    'DEADBUG': {'primary': ['Abs', 'Hip Flexors', 'Shoulders'], 'secondary': []},
    'V_UP': {'primary': ['Abs'], 'secondary': []},
    'BENT_V_UP': {'primary': ['Abs'], 'secondary': []},
    'SUPERMAN': {'primary': ['Lower Back'], 'secondary': []},
    'LEG_RAISE': {'primary': ['Abs', 'Hip Flexors'], 'secondary': []},
    'SQUAT': {'primary': ['Quads', 'Glutes'], 'secondary': []},
    'LUNGE': {'primary': ['Quads', 'Glutes'], 'secondary': []},
    'LEG_PRESS': {'primary': ['Quads'], 'secondary': []},
    'LEG_EXTENSION': {'primary': ['Quads'], 'secondary': []},
    'LEG_CURL': {'primary': ['Hamstrings'], 'secondary': []},
    'DEADLIFT': {'primary': ['Hamstrings', 'Lower Back', 'Glutes'], 'secondary': []},
    'BENCH_PRESS': {'primary': ['Chest'], 'secondary': []},
    'CHEST_FLY': {'primary': ['Chest'], 'secondary': []},
    'PUSH_UP': {'primary': ['Chest', 'Triceps'], 'secondary': []},
    'SHOULDER_PRESS': {'primary': ['Shoulders'], 'secondary': []},
    'LATERAL_RAISE': {'primary': ['Shoulders'], 'secondary': []},
    'FRONT_RAISE': {'primary': ['Shoulders'], 'secondary': []},
    'LAT_PULLDOWN': {'primary': ['Lats', 'Back'], 'secondary': []},
    'ROW': {'primary': ['Back', 'Lats'], 'secondary': []},
    'PULL_UP': {'primary': ['Lats', 'Back'], 'secondary': []},
    'BICEP_CURL': {'primary': ['Biceps'], 'secondary': []},
    'TRICEP_EXTENSION': {'primary': ['Triceps'], 'secondary': []},
    'DIP': {'primary': ['Triceps', 'Chest'], 'secondary': []},
    'CALF_RAISE': {'primary': ['Calves'], 'secondary': []},
    'SHRUG': {'primary': ['Traps'], 'secondary': []},
    'HYPEREXTENSION': {'primary': ['Lower Back'], 'secondary': []},
    'CORE': {'primary': ['Core', 'Abs'], 'secondary': []},
    'BACK': {'primary': ['Back', 'Lats'], 'secondary': []},
    'BICEP': {'primary': ['Biceps'], 'secondary': []},
    'TRICEP': {'primary': ['Triceps'], 'secondary': []},
    'NECK': {'primary': ['Neck'], 'secondary': []},
}

MUSCLE_MAPPING_FILE = 'muscle_mapping.json'

def load_muscle_mapping():
    if os.path.exists(MUSCLE_MAPPING_FILE):
        return load_json(MUSCLE_MAPPING_FILE, STRENGTH_MUSCLE_MAPPING)
    return STRENGTH_MUSCLE_MAPPING.copy()

def save_muscle_mapping(mapping):
    save_json(MUSCLE_MAPPING_FILE, mapping)

# --- ROUTES ---
stats_cache = {}
weight_cache = {'value': None, 'timestamp': 0}
user_profile_cache = {'data': None, 'timestamp': 0}
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
        # Define token directory in garmin_cache
        token_dir = os.path.join(GarminPersistence.BASE_DIR, "session")
        os.makedirs(token_dir, exist_ok=True)
        
        # Initialize Garmin client
        client = Garmin(email, password)
        
        # Try to login using tokens first
        try:
            logger.info(f"Attempting to login to Garmin Connect using tokens in {token_dir}")
            client.login(token_dir)
            logger.info("Successfully logged in to Garmin Connect via token")
        except Exception as e:
            logger.warning(f"Session token invalid or missing, attempting fresh login: {e}")
            # Fresh login will use credentials and populate garth session
            client.login()
            # Save the new session tokens
            client.garth.dump(token_dir)
            logger.info("Successfully logged in to Garmin Connect and saved fresh tokens")
            
        garmin_client = client
        return client
    except Exception as e:
        if "403" in str(e):
            logger.error(f"CRITICAL: Garmin is blocking this IP address. Please re-bootstrap session from local machine.")
        logger.error(f"Failed to login to Garmin Connect: {e}")
        raise e

def garmin_request(func, *args, **kwargs):
    """Wrapper to handle Garmin API calls with retries and session auto-saving."""
    max_retries = 3
    for attempt in range(max_retries):
        try:
            res = func(*args, **kwargs)
            
            # PROACTIVE: Save session tokens if refreshed in-memory
            # This ensures that if the token was refreshed during the session, it gets saved to disk.
            global garmin_client
            if garmin_client:
                try:
                    token_dir = os.path.join(GarminPersistence.BASE_DIR, "session")
                    garmin_client.garth.dump(token_dir)
                except Exception as save_err:
                    logger.warning(f"Failed to auto-save Garmin session: {save_err}")
                    
            return res
        except Exception as e:
            if attempt < max_retries - 1:
                wait = (attempt + 1) * 2
                logger.warning(f"Garmin API error: {e}. Retrying in {wait}s... (Attempt {attempt + 1}/{max_retries})")
                time.sleep(wait)
                # Force re-login on next attempt if it seems like a session issue
                if any(err in str(e).lower() for err in ["403", "session", "login", "auth", "expired"]):
                    global garmin_client
                    garmin_client = None
            else:
                logger.error(f"Garmin API failed after {max_retries} attempts: {e}")
                raise e

def get_user_profile_data(client):
    """Get user profile data (age, height, gender, weight) with caching for BMR calculation."""
    global user_profile_cache
    
    # Check cache (24 hour expiry since profile data doesn't change often)
    now = time.time()
    if user_profile_cache['data'] and (now - user_profile_cache['timestamp'] < 86400):
        return user_profile_cache['data']
    
    try:
        profile = garmin_request(client.get_user_profile)
        
        # Debug: Log the full profile structure to find where height is stored
        logger.info(f"Full profile keys: {profile.keys()}")
        
        user_data = profile.get('userData', {})
        bio_data = profile.get('biometricProfile', {})
        
        logger.info(f"userData keys: {user_data.keys()}")
        logger.info(f"biometricProfile keys: {bio_data.keys()}")
        
        # Get age from birth date
        age = None
        birth_str = user_data.get('birthDate')
        if birth_str:
            birth_date = date.fromisoformat(birth_str)
            today = get_today()
            age = today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))
        
        # Get height in cm - check multiple possible locations
        height_cm = bio_data.get('height') or user_data.get('height') or bio_data.get('heightInCentimeters')
        
        # Fallback: Check settings.json for manually specified height
        if not height_cm:
            settings = load_settings()
            height_cm = settings.get('height_cm')
            if height_cm:
                logger.info(f"Using height from settings.json: {height_cm}cm")
        
        # Get weight in grams from user profile
        weight_grams = user_data.get('weight')
        
        # Get gender ('MALE' or 'FEMALE')
        gender = user_data.get('gender')
        
        profile_data = {
            'age': age,
            'height_cm': height_cm,
            'gender': gender,
            'weight_grams': weight_grams
        }
        
        user_profile_cache = {'data': profile_data, 'timestamp': now}
        logger.info(f"User profile cached: age={age}, height={height_cm}cm, weight={weight_grams}g, gender={gender}")
        return profile_data
    except Exception as e:
        logger.warning(f"Failed to get user profile: {e}")
        return {'age': None, 'height_cm': None, 'gender': None, 'weight_grams': None}

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
    """Fetch calorie data prioritizing Garmin's direct stats using the Centralized Sync Manager."""
    mgr = get_sync_manager()
    # stats_data will be {total, active, resting, steps, ...}
    stats_data = mgr.get_metric_for_date('stats', date_str)
    
    if stats_data:
        return stats_data
    
    # Fallback to empty context if sync completely fails and no cache exists
    return {'total': 0, 'active': 0, 'resting': 0, 'steps': 0, 'steps_goal': 10000, 'resting_hr': 0, 'stress_avg': 0}

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

# ==============================================================================
# PERSISTENT SYNC SYSTEM
# ==============================================================================

class GarminPersistence:
    """Handles structured JSON storage for Garmin metrics by month."""
    BASE_DIR = "garmin_cache"

    @staticmethod
    def _get_path(metric, date_str):
        # date_str is YYYY-MM-DD
        year_month = date_str[:7] # YYYY-MM
        return os.path.join(GarminPersistence.BASE_DIR, metric, f"{year_month}.json")

    @staticmethod
    def load_month(metric, date_str):
        path = GarminPersistence._get_path(metric, date_str)
        return load_json(path, {})

    @staticmethod
    def save_month(metric, date_str, data):
        path = GarminPersistence._get_path(metric, date_str)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        save_json(path, data)

    @staticmethod
    def get_singleton(metric):
        """Loads a non-date-specific persistent object from the cache directory."""
        path = os.path.join(GarminPersistence.BASE_DIR, f"{metric}.json")
        return load_json(path, None)

    @staticmethod
    def save_singleton(metric, data):
        """Saves a non-date-specific persistent object to the cache directory."""
        os.makedirs(GarminPersistence.BASE_DIR, exist_ok=True)
        path = os.path.join(GarminPersistence.BASE_DIR, f"{metric}.json")
        save_json(path, data)

class GarminSyncManager:
    """Central manager for syncing and retrieving Garmin data with local priority."""
    
    def __init__(self, client):
        self.client = client
        self.sync_times = {}

    def get_metric_for_date(self, metric, date_str, force_refresh=False):
        """Get metric for a specific day, syncing if missing."""
        month_data = GarminPersistence.load_month(metric, date_str)
        
        # Don't use cache for today or recently if it's older than threshold (heart rate/steps change)
        today = get_today()
        dt = datetime.strptime(date_str, '%Y-%m-%d').date()
        is_today = (date_str == today.isoformat())
        # Refresh last 3 days if they're stale (not having everything yet if watch didn't sync)
        is_near_past = (today - dt).days <= 3 and (today - dt).days >= 0

        if not force_refresh and date_str in month_data:
            cached = month_data[date_str]
            
            # Backfill check: if metric is stats or hr and missing max fields, force re-sync
            is_backfill_needed = False
            if isinstance(cached, dict):
                if metric == 'stats' and (not cached.get('max_hr') or not cached.get('resting_hr')):
                    is_backfill_needed = True
                elif metric == 'hr' and not cached.get('maxHeartRate'):
                    is_backfill_needed = True

            if not is_backfill_needed:
                if not is_today and not is_near_past:
                    return cached
                
                # If today or near past, check staleness
                # For today: 10 mins (600s)
                # For near past: 1 hour (3600s)
                expiry = 600 if is_today else 3600
                
                if isinstance(cached, dict):
                    if time.time() - cached.get('timestamp', 0) < expiry:
                        return cached
                else:
                    last_sync = self.sync_times.get(f"{metric}_{date_str}", 0)
                    if time.time() - last_sync < expiry:
                        return cached
        
        # Sync required
        logger.info(f"Syncing {metric} for {date_str}...")
        try:
            if metric == 'stats':
                res = self.client.get_stats(date_str)
                
                # Robust Max HR fetching
                max_v = n(res.get('maxHeartRate')) if res else 0
                rhr_v = n(res.get('restingHeartRate')) if res else 0
                
                if not max_v or not rhr_v:
                    # Fallback to detailed heart rate for missing extremes
                    hr_det = self.client.get_heart_rates(date_str) or {}
                    if not max_v: max_v = hr_det.get('maxHeartRate') or 0
                    if not rhr_v: rhr_v = hr_det.get('sleepingRestingHeartRate') or hr_det.get('restingHeartRate') or 0

                data = {
                    'total': n(res.get('totalKilocalories') or res.get('totalCalories')) if res else 0,
                    'active': n(res.get('activeKilocalories') or res.get('activeCalories')) if res else 0,
                    'resting': n(res.get('bmrKilocalories') or res.get('bmrCalories') or res.get('restingCalories')) if res else 0,
                    'steps': n(res.get('totalSteps')) if res else 0,
                    'steps_goal': n(res.get('totalStepsGoal')) if res else 10000,
                    'resting_hr': rhr_v,
                    'max_hr': max_v,
                    'min_hr': n(res.get('minHeartRate')) if res else 0,
                    'stress_avg': n(res.get('averageStressLevel')) if res else 0,
                    'timestamp': time.time()
                }
            elif metric == 'activities':
                dt = datetime.strptime(date_str, '%Y-%m-%d').date()
                s_api = (dt - timedelta(days=1)).isoformat()
                e_api = (dt + timedelta(days=1)).isoformat()
                raw_acts = self.client.get_activities_by_date(s_api, e_api)
                data = []
                for a in raw_acts:
                    sl = a.get('startTimeLocal')
                    if sl and sl.startswith(date_str):
                        data.append(a)
            elif metric == 'steps':
                # get_daily_steps returns a list of days, we pick the one matching date_str
                res = self.client.get_daily_steps(date_str, date_str)
                data = res[0] if res else {'totalSteps': 0, 'stepGoal': 10000}
                data['timestamp'] = time.time()
            elif metric == 'weight':
                res = self.client.get_body_composition(date_str)
                data = res.get('totalAverage', {}) if res else {}
                data['timestamp'] = time.time()
            elif metric == 'sleep':
                res = self.client.get_sleep_data(date_str)
                data = res.get('dailySleepDTO', {}) if res else {}
                data['timestamp'] = time.time()
            elif metric == 'hrv':
                res = self.client.get_hrv_data(date_str)
                data = res.get('hrvSummary', {}) if res else {}
                data['timestamp'] = time.time()
            elif metric == 'stress':
                res = self.client.get_stress_data(date_str)
                data = {
                    'avg': n(res.get('avgStressLevel')) if res else 0,
                    'max': n(res.get('maxStressLevel')) if res else 0,
                    'timestamp': time.time()
                }
            elif metric == 'intensity_minutes':
                res = self.client.get_intensity_minutes_data(date_str)
                data = {
                    'moderate': n(res.get('moderateMinutes')) if res else 0,
                    'vigorous': n(res.get('vigorousMinutes')) if res else 0,
                    'total': (n(res.get('moderateMinutes')) + 2 * n(res.get('vigorousMinutes'))) if res else 0,
                    'goal': n(res.get('weekGoal')) if res else 150,
                    'timestamp': time.time()
                }
            elif metric == 'hr':
                res = self.client.get_heart_rates(date_str)
                data = res if res else {}
                data['timestamp'] = time.time()
            elif metric == 'hydration':
                res = self.client.get_hydration_data(date_str)
                data = {
                    'intake': n(res.get('valueInML')) if res else 0,
                    'goal': n(res.get('goalInML')) if res else 2000,
                    'timestamp': time.time()
                }
            else:
                return None

            month_data[date_str] = data
            GarminPersistence.save_month(metric, date_str, month_data)
            self.sync_times[f"{metric}_{date_str}"] = time.time()
            return data
        except Exception as e:
            logger.error(f"Sync failed for {metric} on {date_str}: {e}")
            return month_data.get(date_str)

    def _sync_activities_range(self, start_date, end_date):
        logger.info(f"Batch syncing activities from {start_date} to {end_date}...")
        try:
            api_start = (start_date - timedelta(days=1)).isoformat()
            api_end = (end_date + timedelta(days=1)).isoformat()
            activities = self.client.get_activities_by_date(api_start, api_end)
            by_date = {}
            for act in activities:
                start_local = act.get('startTimeLocal')
                if start_local:
                    d_str = start_local.split(' ')[0]
                    if d_str not in by_date: by_date[d_str] = []
                    by_date[d_str].append(act)
            
            # Mark all dates in range as processed
            current = start_date
            while current <= end_date:
                d_str = current.isoformat()
                data = by_date.get(d_str, [])
                month_data = GarminPersistence.load_month('activities', d_str)
                month_data[d_str] = data
                GarminPersistence.save_month('activities', d_str, month_data)
                self.sync_times[f"activities_{d_str}"] = time.time()
                current += timedelta(days=1)
        except Exception as e:
            logger.error(f"Batch sync activities failed: {e}")

    def _sync_steps_range(self, start_date, end_date):
        logger.info(f"Batch syncing steps from {start_date} to {end_date}...")
        try:
            steps_list = self.client.get_daily_steps(start_date.isoformat(), end_date.isoformat())
            for entry in steps_list:
                d_str = entry.get('calendarDate')
                if d_str:
                    entry['timestamp'] = time.time()
                    month_data = GarminPersistence.load_month('steps', d_str)
                    month_data[d_str] = entry
                    GarminPersistence.save_month('steps', d_str, month_data)
        except Exception as e:
            logger.error(f"Batch sync steps failed: {e}")

    def _sync_weight_range(self, start_date, end_date):
        logger.info(f"Batch syncing weight from {start_date} to {end_date}...")
        try:
            weigh_ins = self.client.get_weigh_ins(start_date.isoformat(), end_date.isoformat())
            summaries = weigh_ins.get('dailyWeightSummaries', [])
            for s in summaries:
                d_str = s.get('calendarDate')
                if d_str:
                    data = s.get('totalAverage', {})
                    data['timestamp'] = time.time()
                    month_data = GarminPersistence.load_month('weight', d_str)
                    month_data[d_str] = data
                    GarminPersistence.save_month('weight', d_str, month_data)
        except Exception as e:
            logger.error(f"Batch sync weight failed: {e}")

    def get_range(self, metric, start_date, end_date, force_refresh=False):
        """Fetch a range of data, using cache where possible and batch fetching for gaps."""
        missing_ranges = []
        current = start_date
        range_start = None
        
        while current <= end_date:
            d_str = current.isoformat()
            month_data = GarminPersistence.load_month(metric, d_str)
            
            is_today = (d_str == get_today().isoformat())
            is_missing = force_refresh or d_str not in month_data
            if not force_refresh and d_str in month_data:
                cached = month_data[d_str]
                today = get_today()
                age = (today - current).days
                is_near_past = age <= 3 and age >= 0
                expiry = 600 if is_today else 3600 if is_near_past else None

                # Safe check for dict vs list
                if isinstance(cached, dict):
                    if expiry and time.time() - cached.get('timestamp', 0) > expiry:
                        is_missing = True
                else:
                    last_sync = self.sync_times.get(f"{metric}_{d_str}", 0)
                    # Auto-repair cached [] lists that might be corrupt or incomplete,
                    # specifically for activities in the last 7 days window.
                    if metric == 'activities':
                        if age <= 7 and not cached:
                            is_missing = True
                        elif expiry and time.time() - last_sync > expiry:
                            is_missing = True
                    elif expiry and time.time() - last_sync > expiry:
                        is_missing = True
            
            if is_missing:
                if range_start is None:
                    range_start = current
            else:
                if range_start is not None:
                    missing_ranges.append((range_start, current - timedelta(days=1)))
                    range_start = None
            current += timedelta(days=1)
            
        if range_start is not None:
            missing_ranges.append((range_start, end_date))

        # Batch fetch missing ranges
        if missing_ranges:
            if metric == 'activities':
                for rs, re in missing_ranges:
                    self._sync_activities_range(rs, re)
            elif metric == 'steps':
                for rs, re in missing_ranges:
                    self._sync_steps_range(rs, re)
            elif metric == 'weight':
                for rs, re in missing_ranges:
                    self._sync_weight_range(rs, re)

        # Collect results
        results = []
        current = start_date
        while current <= end_date:
            d_str = current.isoformat()
            val = self.get_metric_for_date(metric, d_str, force_refresh=force_refresh)
            if val is not None:
                if isinstance(val, dict):
                    results.append({**val, 'date': d_str, 'calendarDate': d_str})
                else:
                    results.extend(val)
            current += timedelta(days=1)
        logger.info(f"get_range: {metric} from {start_date} to {end_date} returned {len(results)} items")
        return results

    def sync_range(self, metric, start_date, end_date):
        """Forces a sync for a range, useful for warmup."""
        return self.get_range(metric, start_date, end_date)

# Initialize Globals
sync_manager = None

def get_sync_manager():
    global sync_manager
    if not sync_manager:
        client = get_garmin_client()
        sync_manager = GarminSyncManager(client)
    return sync_manager

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

# AI Insights Cache (Persistent & In-Memory)
AI_CACHE_EXPIRY = 21600 # 6 Hours
_cached_ai = GarminPersistence.get_singleton("ai_insights")
ai_insights_cache = _cached_ai if _cached_ai else {
    'data': None,
    'timestamp': None
}

def save_ai_insights_cache(data, timestamp):
    """Persist AI insights cache to storage."""
    global ai_insights_cache
    ai_insights_cache = {'data': data, 'timestamp': timestamp}
    GarminPersistence.save_singleton("ai_insights", ai_insights_cache)

# Heatmap Cache
heatmap_cache = {
    'data': None,
    'timestamp': None,
    'range': None
}
HEATMAP_CACHE_EXPIRY = 120  # 2 minute cache duration (used when all routes loaded)
HEATMAP_CACHE_EXPIRY_SYNCING = 10  # 10 second cache during active syncing

# Activity Heatmap Cache
ACT_HEATMAP_CACHE_EXPIRY = 86400 # 24 Hours
activity_heatmap_cache = {
    'data': None,
    'timestamp': None
}

# Background Worker
def server_warmup():
    """Warms up the Garmin client and pre-fills caches on startup."""
    global ai_insights_cache, activity_heatmap_cache
    logger.info("Server Warmup: Starting deep background pre-fetch...")
    try:
        mgr = get_sync_manager()
        
        # Proactively refresh last 3 days of core metrics
        logger.info("Server Warmup: Refreshing last 3 days of core metrics...")
        for i in range(4): # 0 (today) to 3 days ago
            d_str = (get_today() - timedelta(days=i)).isoformat()
            # These will check staleness internally based on the updated get_metric_for_date logic
            mgr.get_metric_for_date('stats', d_str)
            mgr.get_metric_for_date('sleep', d_str)
            mgr.get_metric_for_date('weight', d_str)
        
        # Pre-fetch activity heatmap (lightweight)
        if not activity_heatmap_cache['data']:
            logger.info("Server Warmup: Pre-fetching activity heatmap...")
            today = get_today()
            start_date = today - timedelta(days=366)
            activities = mgr.client.get_activities_by_date(start_date.isoformat(), today.isoformat())
            
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

        # Trigger AI Insight Generation in background only if no fresh cache exists
        now = time.time()
        if ai_insights_cache['data'] and ai_insights_cache['timestamp'] and (now - ai_insights_cache['timestamp'] < AI_CACHE_EXPIRY):
            logger.info(f"Server Warmup: AI Insights cache is still fresh ({round((now - ai_insights_cache['timestamp']) / 60)}min old). Skipping regeneration.")
        elif not ai_insights_cache['data']:
            logger.info("Server Warmup: No cached AI Insights found. Generating in advance...")
            generate_insights_logic()
        else:
            logger.info("Server Warmup: AI Insights cache expired. Regenerating...")
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
        # Use 3 workers for faster polyline fetching
        with ThreadPoolExecutor(max_workers=3) as executor:
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
        # Add app version
        settings['app_version'] = APP_VERSION
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
            
            # Clear AI insights cache when model changes (memory + disk)
            global ai_insights_cache
            ai_insights_cache = {'timestamp': 0, 'data': None}
            save_ai_insights_cache(None, 0)
        
        if save_settings(current_settings):
            return jsonify({'success': True, 'settings': current_settings})
        else:
            return jsonify({'error': 'Failed to save settings'}), 500
            
    except Exception as e:
        logger.error(f"Error updating settings: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cache/refresh', methods=['POST'])
@login_required
def refresh_cache():
    """Manually refresh cache for a date range."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
            
        start_str = data.get('start_date')
        end_str = data.get('end_date')
        # Default metrics to refresh
        metrics = data.get('metrics', ['stats', 'activities', 'steps', 'sleep', 'weight', 'hr', 'hrv', 'stress', 'intensity_minutes', 'hydration'])
        
        if not start_str or not end_str:
            return jsonify({'error': 'Missing start_date or end_date'}), 400
            
        start_date = datetime.strptime(start_str, '%Y-%m-%d').date()
        end_date = datetime.strptime(end_str, '%Y-%m-%d').date()
        
        if start_date > end_date:
            return jsonify({'error': 'start_date must be before end_date'}), 400
            
        # Limit range to avoid timing out or hitting rate limits too hard
        if (end_date - start_date).days > 31:
             return jsonify({'error': 'Range too large. Max 31 days at once.'}), 400

        mgr = get_sync_manager()
        for metric in metrics:
            logger.info(f"Manual refresh: {metric} from {start_date} to {end_date}")
            mgr.get_range(metric, start_date, end_date, force_refresh=True)
            
        # Invalidate memory-based summaries that might be affected
        global activity_heatmap_cache, heatmap_cache, ai_insights_cache
        activity_heatmap_cache = {'data': None, 'timestamp': 0}
        heatmap_cache = {'data': None, 'timestamp': 0, 'range': None}
        ai_insights_cache = {'data': None, 'timestamp': 0}

        return jsonify({'success': True, 'message': f'Successfully refreshed {len(metrics)} metrics from {start_str} to {end_str}.'})
    except Exception as e:
        logger.error(f"Error refreshing cache: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/check_update', methods=['GET'])
@login_required
def check_update():
    """Check for updates from GitHub."""
    try:
        git_cmd = get_git_command()
        if not git_cmd:
            return jsonify({'error': 'Git is not detected. Please install Git and restart the application.'}), 400

        # Fetch current state from remote
        subprocess.run([git_cmd, 'fetch'], check=True, capture_output=True, text=True)
        
        # Get head of local and remote
        local_res = subprocess.run([git_cmd, 'rev-parse', 'HEAD'], check=True, capture_output=True, text=True)
        # Handle cases where upstream might not be set
        try:
            remote_res = subprocess.run([git_cmd, 'rev-parse', '@{u}'], check=True, capture_output=True, text=True)
            remote_sha = remote_res.stdout.strip()
        except subprocess.CalledProcessError:
            # Fallback: check origin/main if @{u} fails
            remote_res = subprocess.run([git_cmd, 'rev-parse', 'origin/main'], check=True, capture_output=True, text=True)
            remote_sha = remote_res.stdout.strip()
        
        local_sha = local_res.stdout.strip()
        
        return jsonify({
            'update_available': local_sha != remote_sha,
            'local_sha': local_sha[:7],
            'remote_sha': remote_sha[:7]
        })
    except Exception as e:
        logger.error(f"Error checking for updates: {e}")
        return jsonify({'error': f"Git error: {str(e)}"}), 500

@app.route('/api/perform_update', methods=['POST'])
@login_required
def perform_update():
    """Trigger the update script."""
    try:
        if os.name == 'nt':
            # Windows: Look for a .ps1 or .bat script (to be created)
            script_path = os.path.join(os.path.dirname(__file__), 'Scripts', 'updateApp.ps1')
            if not os.path.exists(script_path):
                return jsonify({'error': 'Windows update script (updateApp.ps1) not found'}), 404
            subprocess.Popen(['powershell', '-ExecutionPolicy', 'Bypass', '-File', script_path], start_new_session=True)
        else:
            # Linux/Mac
            bash_cmd = get_bash_command()
            if not bash_cmd:
                return jsonify({'error': 'bash not found. Please install bash and restart the application.'}), 400
            
            script_path = os.path.join(os.path.dirname(__file__), 'Scripts', 'updateApp.sh')
            if not os.path.exists(script_path):
                return jsonify({'error': 'Update script not found'}), 404
            
            # Ensure the script is executable
            try:
                os.chmod(script_path, 0o755)
            except:
                pass

            subprocess.Popen([bash_cmd, script_path], start_new_session=True)
        
        return jsonify({'success': True, 'message': 'Update started'})
    except Exception as e:
        logger.error(f"Error performing update: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/ai_insights')
@login_required
def get_ai_insights():
    global ai_insights_cache
    
    force_refresh = request.args.get('force_refresh', 'false').lower() == 'true'
    
    # Check cache first (unless force refresh requested)
    now = time.time()
    if not force_refresh and ai_insights_cache['data'] and ai_insights_cache['timestamp']:
        if now - ai_insights_cache['timestamp'] < AI_CACHE_EXPIRY:
            cache_age_min = round((now - ai_insights_cache['timestamp']) / 60)
            logger.info(f"AI Insights: Returning cached response ({cache_age_min}min old)")
            result = ai_insights_cache['data'].copy()
            result['cached_at'] = ai_insights_cache['timestamp']
            result['cache_age_seconds'] = now - ai_insights_cache['timestamp']
            return jsonify(result)
    
    if force_refresh:
        logger.info("AI Insights: Force refresh requested by user")

    try:
        result = generate_insights_logic()
        if result and 'error' in result:
            return jsonify(result), 503
        if result:
            # Update cache and PERSIST
            now = time.time()
            ai_insights_cache = {
                'data': result,
                'timestamp': now
            }
            GarminPersistence.save_singleton("ai_insights", ai_insights_cache)
            
            result['cached_at'] = now
            result['cache_age_seconds'] = 0
            return jsonify(result)
        return jsonify({'error': 'Failed to generate insights'}), 500
    except Exception as e:
        logger.error(f"Error serving AI insights: {e}")
        return jsonify({'error': str(e)}), 500

def generate_insights_logic():
    global ai_insights_cache, ai_memory
    
    try:
        mgr = get_sync_manager()
        today = get_today()
        
        # --- DATA PAYLOAD HELPER FUNCTIONS ---
        def get_sleep_score(s_data):
            if not isinstance(s_data, dict): return 0
            return n(s_data.get('sleepScore') or s_data.get('score') or s_data.get('sleepScores', {}).get('overall', {}).get('value'))

        def ml_to_oz(ml):
            """Convert milliliters to fluid ounces."""
            return round(ml * 0.033814, 1) if ml else 0

        def g_to_lbs(grams):
            """Convert grams to pounds."""
            return round(grams * 0.00220462, 1) if grams else None

        def safe_avg(vals):
            """Average a list, ignoring None and zero."""
            clean = [v for v in vals if v is not None and v > 0]
            return round(sum(clean) / len(clean), 1) if clean else None

        def sum_nutrient(entries, key):
            """Sum a nutrient key across a list of food log entries."""
            return round(sum(e.get(key, 0) or 0 for e in entries), 1)

        def is_cycling(act):
            tk = act.get('activityType', {}).get('typeKey', '').lower()
            an = act.get('activityName', '').lower()
            return any(k in tk for k in ['cycling', 'ride', 'biking', 'virtual', 'indoor']) or \
                   any(k in an for k in ['zwift', 'ride', 'cycling', 'peloton', 'trainerroad'])

        def fetch_full_act(a):
            try:
                aid = a.get('activityId')
                if not aid: return a
                
                # Fetch both the full summary AND the second-by-second details via mgr client
                full = mgr.client.get_activity(aid)
                details = mgr.client.get_activity_details(aid)
                
                if full: 
                    a.update(full)
                    # Also check nested summaryDTO
                    s_dto = full.get('summaryDTO', {})
                    if s_dto: a.update(s_dto)
                
                if details:
                    descriptors = details.get('metricDescriptors', [])
                    metrics_list = details.get('activityDetailMetrics', [])
                    key_map = {d['key']: d['metricsIndex'] for d in descriptors}
                    
                    # Extract power if available
                    p_key = 'directPower'
                    if p_key in key_map:
                        idx = key_map[p_key]
                        powers = [n(m.get('metrics')[idx]) for m in metrics_list if m.get('metrics') and idx < len(m.get('metrics')) and m.get('metrics')[idx] is not None]
                        if powers:
                            a['extracted_avg_p'] = round(sum(powers) / len(powers))
                            a['extracted_max_p'] = max(powers)
                
                # Fetch exercise sets for strength training
                if a.get('activityType', {}).get('typeKey', '').lower() == 'strength_training':
                    ex_data = mgr.client.get_activity_exercise_sets(aid)
                    if ex_data and 'exerciseSets' in ex_data:
                        a['exercise_sets'] = ex_data['exerciseSets']
                            
            except Exception as e:
                logger.warning(f"Failed to enrich activity {a.get('activityId')}: {e}")
            return a
        # --- END DATA PAYLOAD HELPER FUNCTIONS ---

        today_str = today.isoformat()
        yesterday_str = (today - timedelta(days=1)).isoformat()

        # ── 1. TODAY'S HEALTH SNAPSHOT (from Garmin cache via SyncManager) ─────
        stats        = mgr.get_metric_for_date('stats',    today_str) or {}
        sleep_raw    = mgr.get_metric_for_date('sleep',    today_str) or {}
        hrv          = mgr.get_metric_for_date('hrv',      today_str) or {}
        hydration    = mgr.get_metric_for_date('hydration', today_str) or {}
        weight_raw   = mgr.get_metric_for_date('weight',   today_str) or {}
        im_raw       = mgr.get_metric_for_date('intensity_minutes', today_str) or {}

        steps_today  = n(stats.get('steps', 0))
        steps_goal   = n(stats.get('steps_goal', 10000)) or 10000
        stress_today = n(stats.get('stress_avg', 0))

        sleep_score_today   = get_sleep_score(sleep_raw)
        sleep_seconds_today = n(sleep_raw.get('sleepTimeSeconds', 0))

        # If today's sleep is zero, use yesterday's (Garmin often only has last night's data)
        if sleep_seconds_today == 0:
            y_sleep = mgr.get_metric_for_date('sleep', yesterday_str) or {}
            if n(y_sleep.get('sleepTimeSeconds', 0)) > 0:
                sleep_raw           = y_sleep
                sleep_score_today   = get_sleep_score(sleep_raw)
                sleep_seconds_today = n(sleep_raw.get('sleepTimeSeconds', 0))
                logger.info("AI Insights: Using yesterday's sleep data as today's is zero.")

        sleep_hours_today = round(sleep_seconds_today / 3600, 1)

        # Hydration — stored as {intake: ml, goal: ml} in cache
        hydration_intake_oz = ml_to_oz(n(hydration.get('intake', 0)))
        hydration_goal_oz   = ml_to_oz(n(hydration.get('goal', 2839))) or 96.0
        hydration_pct_today = round(hydration_intake_oz / hydration_goal_oz * 100) if hydration_goal_oz else 0

        # Weight — stored in grams in cache
        weight_lbs_today = g_to_lbs(weight_raw.get('weight'))

        # HRV
        hrv_avg_today     = hrv.get('lastNightAvg')
        hrv_status_today  = hrv.get('status', 'Unknown')
        hrv_baseline      = hrv.get('baseline', {})
        hrv_baseline_str  = (f"{hrv_baseline.get('balancedLow')}–{hrv_baseline.get('balancedUpper')} ms"
                             if hrv_baseline.get('balancedLow') else 'N/A')

        # Intensity minutes
        im_moderate = n(im_raw.get('moderate', 0))
        im_vigorous = n(im_raw.get('vigorous', 0))
        im_total    = n(im_raw.get('total', 0)) or (im_moderate + 2 * im_vigorous)
        im_goal     = n(im_raw.get('goal', 150))

        # ── 2. FOOD LOGS — loaded from local JSON file (not Garmin API) ──────────
        # Format: {"YYYY-MM-DD": [{name, calories, protein, carbs, fat, cholesterol, caffeine}, ...]}
        food_logs = load_json(FOOD_LOGS_FILE, {}) if os.path.exists(FOOD_LOGS_FILE) else {}

        today_log_entries = food_logs.get(today_str, [])
        today_nutrition = None
        if today_log_entries:
            today_nutrition = {
                'calories_in':    sum_nutrient(today_log_entries, 'calories'),
                'protein_g':      sum_nutrient(today_log_entries, 'protein'),
                'carbs_g':        sum_nutrient(today_log_entries, 'carbs'),
                'fat_g':          sum_nutrient(today_log_entries, 'fat'),
                'cholesterol_mg': sum_nutrient(today_log_entries, 'cholesterol'),
                'caffeine_mg':    sum_nutrient(today_log_entries, 'caffeine'),
            }

        # Yesterday's nutrition (for yesterday_summary)
        yesterday_log = food_logs.get(yesterday_str, [])
        yesterday_nutrition = None
        if yesterday_log:
            yesterday_nutrition = {
                'calories_in': sum_nutrient(yesterday_log, 'calories'),
                'protein_g':   sum_nutrient(yesterday_log, 'protein'),
            }

        # ── 3. HISTORICAL DATA — last 30 days for trend analysis ──────────────────
        hist_start_30 = today - timedelta(days=30)
        hist_end_30   = today - timedelta(days=1)

        hist_stats     = mgr.get_range('stats',     hist_start_30, hist_end_30)
        hist_sleep     = mgr.get_range('sleep',     hist_start_30, hist_end_30)
        hist_hrv       = mgr.get_range('hrv',       hist_start_30, hist_end_30)
        hist_hydration = mgr.get_range('hydration', hist_start_30, hist_end_30)
        hist_weight    = mgr.get_range('weight',    hist_start_30, hist_end_30)

        stats_map     = {s['date']: s for s in hist_stats    if 'date' in s}
        sleep_map     = {s['date']: s for s in hist_sleep    if 'date' in s}
        hrv_map       = {s['date']: s for s in hist_hrv      if 'date' in s}
        hydration_map = {s['date']: s for s in hist_hydration if 'date' in s}
        weight_map    = {s['date']: s for s in hist_weight   if 'date' in s}

        # Build the 7-day day-by-day history table (for the AI to spot trends)
        history_list_7d = []
        for i in range(1, 8):
            d_str = (today - timedelta(days=i)).isoformat()
            s  = stats_map.get(d_str, {})
            sl = sleep_map.get(d_str, {})
            h  = hrv_map.get(d_str, {})
            hy = hydration_map.get(d_str, {})
            wt = weight_map.get(d_str, {})
            im = mgr.get_metric_for_date('intensity_minutes', d_str) or {}
            
            # Nutrition for this specific day from local logs
            entries = food_logs.get(d_str, [])
            day_nutr = {
                'calories_in':    sum_nutrient(entries, 'calories'),
                'protein_g':      sum_nutrient(entries, 'protein'),
                'carbs_g':        sum_nutrient(entries, 'carbs'),
                'fat_g':          sum_nutrient(entries, 'fat'),
                'cholesterol_mg': sum_nutrient(entries, 'cholesterol'),
                'caffeine_mg':    sum_nutrient(entries, 'caffeine'),
            }

            hy_goal   = ml_to_oz(n(hy.get('goal', 2839))) or 96.0
            hy_intake = ml_to_oz(n(hy.get('intake', 0)))
            history_list_7d.append({
                'date':               d_str,
                'steps':              n(s.get('steps', 0)),
                'steps_goal':         n(s.get('steps_goal', 10000)) or 10000,
                'calories_out':       n(s.get('total', 0)),
                'stress':             n(s.get('stress_avg', 0)),
                'sleep_score':        get_sleep_score(sl),
                'sleep_hours':        round(n(sl.get('sleepTimeSeconds', 0)) / 3600, 1),
                'hrv_status':         h.get('status', 'Unknown'),
                'hrv_avg':            h.get('lastNightAvg'),
                'resting_hr':         n(s.get('resting_hr', 0)) or None,
                'hydration_oz':       hy_intake,
                'hydration_goal_oz':  hy_goal,
                'hydration_pct':      round(hy_intake / hy_goal * 100) if hy_goal else 0,
                'weight_lbs':         g_to_lbs(wt.get('weight')),
                'intensity_minutes':  n(im.get('total', 0)),
                'nutrition':          day_nutr
            })

        # Compute nutrition 7-day average (only days that have food log entries)
        nutrition_cal_7d = []
        nutrition_prot_7d = []
        for i in range(1, 8):
            entries = food_logs.get((today - timedelta(days=i)).isoformat(), [])
            if entries:
                nutrition_cal_7d.append(sum_nutrient(entries, 'calories'))
                nutrition_prot_7d.append(sum_nutrient(entries, 'protein'))

        avg_nutrition_7d = None
        if nutrition_cal_7d:
            avg_nutrition_7d = {
                'avg_calories_in': safe_avg(nutrition_cal_7d),
                'avg_protein_g':   safe_avg(nutrition_prot_7d),
                'days_logged':     len(nutrition_cal_7d),
            }

        # Compact 30-day averages for trend context
        thirty_day_averages = {
            'avg_steps':          safe_avg([n(s.get('steps', 0)) for s in hist_stats]),
            'avg_sleep_score':    safe_avg([get_sleep_score(s) for s in hist_sleep]),
            'avg_sleep_hours':    safe_avg([round(n(s.get('sleepTimeSeconds', 0)) / 3600, 1) for s in hist_sleep]),
            'avg_stress':         safe_avg([n(s.get('stress_avg', 0)) for s in hist_stats]),
            'avg_resting_hr':     safe_avg([n(s.get('resting_hr', 0)) for s in hist_stats]),
            'avg_hydration_pct':  safe_avg([
                round(ml_to_oz(n(h.get('intake', 0))) / (ml_to_oz(n(h.get('goal', 2839))) or 96) * 100)
                for h in hist_hydration if h.get('goal')
            ]),
            # Weight: last 10 non-null readings (most recent first)
            'weight_readings_lbs': [
                {'date': d, 'lbs': g_to_lbs(weight_map[d].get('weight'))}
                for d in sorted(weight_map.keys(), reverse=True)
                if weight_map[d].get('weight')
            ][:10],
            # HRV: last 14 status strings (most recent first)
            'hrv_statuses_14d': [
                hrv_map[d].get('status', 'Unknown')
                for d in sorted(hrv_map.keys(), reverse=True)
                if hrv_map[d].get('status') and hrv_map[d].get('status') != 'Unknown'
            ][:14],
        }

        # 3. Fetch activities via Sync Manager
        ytd_start = datetime(today.year, 1, 1).date()
        baseline_start = today - timedelta(days=30)
        fetch_start = min(ytd_start, baseline_start)
        
        logger.info(f"AI Insights: Fetching activities since {fetch_start} via Sync Manager")
        acts_hist = mgr.get_range('activities', fetch_start, today)
        
        # Calculate Baselines (30d) and YTD Records
        baselines = {
            'run_avg_pace_min_per_mi': 0, 'run_max_dist_mi': 0, 'run_count': 0,
            'cycle_avg_speed_mph': 0, 'cycle_max_dist_mi': 0, 'cycle_count': 0, 'cycle_avg_power_w': 0,
            'avg_activity_duration_min': 0,
            'ytd_run_max_dist_mi': 0,
            'ytd_cycle_max_dist_mi': 0,
            'ytd_cycle_max_power_w': 0
        }
        
        run_paces_min_per_mi = []
        cycle_speeds_mph = []
        cycle_powers = []
        durations = []
        
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
                    baselines['ytd_run_max_dist_mi'] = max(baselines['ytd_run_max_dist_mi'], d_mi)
                elif is_cycling(a):
                    baselines['ytd_cycle_max_dist_mi'] = max(baselines['ytd_cycle_max_dist_mi'], d_mi)
                    summary = a.get('summaryDTO', {})
                    p = a.get('averagePower') or a.get('avgPower') or summary.get('averagePower') or summary.get('avgPower')
                    baselines['ytd_cycle_max_power_w'] = max(baselines['ytd_cycle_max_power_w'], n(p))

            # 30-Day Rolling Baseline
            if d_mi > 0 and dur_m > 0 and act_date >= baseline_start:
                durations.append(dur_m)
                if 'running' in type_key:
                    baselines['run_count'] += 1
                    run_paces_min_per_mi.append(dur_m / d_mi)
                    baselines['run_max_dist_mi'] = max(baselines['run_max_dist_mi'], d_mi)
                elif is_cycling(a):
                    baselines['cycle_count'] += 1
                    baselines['cycle_max_dist_mi'] = max(baselines['cycle_max_dist_mi'], d_mi)
                    cycle_speeds_mph.append(d_mi / (dur_m / 60))
                    summary = a.get('summaryDTO', {})
                    p = a.get('averagePower') or a.get('avgPower') or summary.get('averagePower') or summary.get('avgPower')
                    if n(p) > 0: cycle_powers.append(p)
        
        if run_paces_min_per_mi: baselines['run_avg_pace_min_per_mi'] = sum(run_paces_min_per_mi) / len(run_paces_min_per_mi)
        if cycle_speeds_mph: baselines['cycle_avg_speed_mph'] = sum(cycle_speeds_mph) / len(cycle_speeds_mph)
        if cycle_powers: baselines['cycle_avg_power_w'] = sum(cycle_powers) / len(cycle_powers)
        if durations: baselines['avg_activity_duration_min'] = sum(durations) / len(durations)

        # ── 4. RECENT SESSIONS FOR DETAILED ANALYSIS ─────────────────────────────
        # acts_hist is chronological (oldest-to-newest). We take the last 15 (most recent).
        acts_raw = acts_hist[-15:] if acts_hist else []
        
        # Enrichment: Fetch full activity objects for the most recent activities
        if acts_raw:
            with ThreadPoolExecutor(max_workers=5) as executor:
                acts_raw = list(executor.map(fetch_full_act, acts_raw))

        # Sort newest first so the AI sees today's workout at the top of the list
        acts_raw.sort(key=lambda x: x.get('startTimeLocal', ''), reverse=True)
        
        sessions = group_activities_into_sessions(acts_raw)
        
        # Summarize sessions for 'Today' (used to prioritize in Daily Summary)
        today_session_ids = []
        for s in sessions:
            if s[0].get('startTimeLocal', '').startswith(today_str):
                today_session_ids.append("|".join([str(a.get('activityId')) for a in s]))
        
        # 2. Memory-Based Context Reduction
        training_history_for_ai = []
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
                            stage_data["pace_min_per_mi"] = f"{m}:{s_rem:02d}"
                        elif this_is_cycle:
                            stage_data["speed_mph"] = round(d_mi / (dur_m / 60), 1)
                            # Priority Check: Extracted / Calculated > Summary > Stats
                            avg_p = a.get('extracted_avg_p') or a.get('averagePower') or a.get('avgPower')
                            max_p = a.get('extracted_max_p') or a.get('maxPower') or a.get('max_power')
                            norm_p = a.get('normalizedPower') or a.get('normPower')
                            
                            if n(avg_p) > 0: stage_data["avg_power_w"] = n(avg_p)
                            if n(max_p) > 0: stage_data["max_power_w"] = n(max_p)
                            if n(norm_p) > 0: stage_data["normalized_power_w"] = n(norm_p)
                            
                            stage_data["is_virtual"] = "virtual" in a.get('activityType', {}).get('typeKey', '').lower() or "zwift" in a.get('activityName', '').lower()
                            
                    # Strength Data Processing
                    if a.get('activityType', {}).get('typeKey', '').lower() == 'strength_training':
                        stage_data["type"] = "STRENGTH"
                        ex_sets = a.get('exercise_sets', [])
                        if ex_sets:
                            active_sets = []
                            for s in ex_sets:
                                if s.get('setType') == 'ACTIVE':
                                    ex_list = [ex.get('name') or ex.get('category', 'Exercise') for ex in s.get('exercises', [])]
                                    # Clean exercise names
                                    ex_list = [e.replace('_', ' ').title() for e in ex_list if e]
                                    active_sets.append({
                                        "exercises": list(set(ex_list)), # Unique set for AI
                                        "reps": s.get('repetitionCount'),
                                        "weight_lbs": round(n(s.get('weight')) * 0.00220462, 1) if s.get('weight') else 0
                                    })
                            stage_data["strength_active_sets"] = active_sets

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
                    # logger.info(f"AI PAYLOAD AUDIT: Session {session_id} - Power: {session_summary.get('session_avg_power_w')}W")

                training_history_for_ai.append(session_summary)

        # ── 5. ASSEMBLE DATA PAYLOAD FOR GEMINI ──────────────────────────────────
        # Edit the sections below to change what data is sent to the AI.
        context = {
            # Today's date
            "today_date": today_str,

            # ── TODAY'S SNAPSHOT ─────────────────────────────────────────────
            "today_steps": {
                "value": steps_today,
                "goal": steps_goal,
                "pct_of_goal": round(steps_today / steps_goal * 100) if steps_goal else 0,
            },
            "today_sleep": {
                "score": sleep_score_today,
                "hours": sleep_hours_today,
            },
            "today_hrv": {
                "last_night_avg_ms": hrv_avg_today,
                "status": hrv_status_today,         # BALANCED / UNBALANCED / LOW
                "baseline_balanced_range": hrv_baseline_str,
            },
            "today_hydration": {
                "intake_oz": hydration_intake_oz,
                "goal_oz": hydration_goal_oz,
                "pct_of_goal": hydration_pct_today,
            },
            "today_stress": stress_today,           # 0-100 scale (0-25=low, 26-50=moderate, 51+=high)
            "today_weight_lbs": weight_lbs_today,   # None if not logged today
            "today_heart_rate": {
                "resting_bpm": n(stats.get('resting_hr', 0)) or None,
                "max_bpm": n(stats.get('max_hr', 0)) or None,
            },
            "today_calories_burned": {
                "total": n(stats.get('total', 0)) or None,
                "active": n(stats.get('active', 0)) or None,
                "resting": n(stats.get('resting', 0)) or None,
            },
            "today_intensity_minutes": {
                "moderate_min": im_moderate,
                "vigorous_min": im_vigorous,
                "total_weighted": im_total,
                "weekly_goal": im_goal,
            },

            # ── TODAY'S NUTRITION (None if nothing logged today) ──────────────
            "today_nutrition": today_nutrition,

            # ── GOALS ─────────────────────────────────────────────────────────
            "goals": {
                "daily_steps": steps_goal,
                "daily_hydration_oz": hydration_goal_oz,
                "weekly_intensity_minutes": im_goal,
            },

            # ── LAST 7 DAYS — day-by-day for trend/outlier detection ──────────
            "seven_day_history": history_list_7d,

            # ── LAST 30 DAYS — compact averages + weight/HRV timelines ────────
            "thirty_day_averages": thirty_day_averages,

            # ── NUTRITION HISTORY — 7-day avg (None if no food logs) ──────────
            "nutrition_7day_avg": avg_nutrition_7d,

            # ── ACTIVITIES — baselines and training session details ───────────
            "today_session_ids": today_session_ids, # IDs of sessions performed today
            "activity_baselines_30d": baselines,
            "training_history": training_history_for_ai,
        }

        logger.info(
            f"AI PAYLOAD SUMMARY | Steps: {steps_today}/{steps_goal} "
            f"| Sleep: {sleep_hours_today}h score={sleep_score_today} "
            f"| HRV: {hrv_avg_today} ({hrv_status_today}) "
            f"| Hydration: {hydration_intake_oz}/{hydration_goal_oz}oz ({hydration_pct_today}%) "
            f"| Weight: {weight_lbs_today}lbs "
            f"| Stress: {stress_today} "
            f"| Today nutrition: {today_nutrition} "
            f"| Sessions: {len(sessions)}"
        )

        # ── 6. GEMINI CALL WITH RETRY LOGIC ─────────────────────────────────────
        ai_client  = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        settings   = load_settings()
        model_name = settings.get('ai_model', 'gemma-3-27b-it')

        def call_gemini_with_retry(client, model, prompt_text, max_retries=3):
            """Call Gemini with exponential backoff for 503/504/overloaded errors."""
            for attempt in range(max_retries):
                try:
                    return client.models.generate_content(model=model, contents=prompt_text)
                except Exception as e:
                    err_str = str(e)
                    is_transient = any(code in err_str for code in
                                       ['503', '504', 'overloaded', 'unavailable', 'Service Unavailable',
                                        'UNAVAILABLE', 'resource_exhausted', 'RESOURCE_EXHAUSTED'])
                    if is_transient and attempt < max_retries - 1:
                        wait_secs = 2 ** attempt  # 1s, 2s, 4s
                        logger.warning(
                            f"Gemini transient error (attempt {attempt+1}/{max_retries}): {e}. "
                            f"Retrying in {wait_secs}s..."
                        )
                        time.sleep(wait_secs)
                    else:
                        raise

        # ═══════════════════════════════════════════════════════════════════════
        # 7. THE PROMPT — Edit this section to change the AI's tone and focus.
        #    The daily_summary and top_highlights fields power the top bar.
        #    The activity_insights field powers the activity cards below.
        # ═══════════════════════════════════════════════════════════════════════
        prompt = f"""
You are my personal health assistant. You've just reviewed all of my Garmin data for today ({today_str})
and the past 30 days. Give me a brief, friendly, plain-English debrief — like a knowledgeable friend
who spots patterns and calls out what actually matters.

FOCUS: Summary first, then trends and outliers.
- Connect the dots: explain how activities impact metrics (e.g. low steps during a cycling day, or elevated stress after a hard run).
- What does today's overall picture look like?
- Are any metrics trending up or down over the past week vs. my 30-day averages?
- Is anything unusually high or low (an outlier)?
- If there are food logs, briefly note calorie balance if interesting.
- For STRENGTH activities (see strength_active_sets), summarize the main exercises performed and the overall intensity/focus of the session.
- For all other activities, find the ONE thing that stands out in each session.

TONE:
- Friendly and direct. Use 'you/your'. No jargon, no clinical language.
- Don't start with "Great job!" or "Hey there!" Just get to the point.
- Be specific with numbers. Don't say "your sleep was good" — say "7.5h with a score of 82".
- Weight in lbs, hydration in oz, pace in min/mi, power in watts, speed in mph.
- HRV status meanings: BALANCED=good, UNBALANCED=elevated stress signal, LOW=needs attention.
- Stress scale: 0-25=low/resting, 26-50=moderate, 51-75=high, 76+=very high.
- Hydration: 0 oz intake usually means nothing was logged, not that no water was drunk.

DATA:
{json.dumps(context)}

ACTIVITY RULES:
- Sessions with "cached_insight" already have an analysis — reuse it as-is.
- For new sessions: the 4 most recent get a detailed multi-paragraph breakdown (Strava-style).
  All older sessions get a concise 2-sentence highlight.
- Every session in 'training_history' MUST appear in 'activity_insights'.
- Compare to activity_baselines_30d for context. Use ytd_run_max_dist_mi / ytd_cycle_max_power_w
  for YTD records — only sessions marked CURRENT_YEAR count for YTD claims.

Return ONLY valid JSON (no markdown, no code fences):
{{
  "daily_summary": "3-5 sentences. A holistic narrative of today's health. DO NOT just list numbers. Connect the dots: if steps are low but you did a hard bike ride, explain that. If sleep was poor but HRV is balanced, acknowledge the resilience. Focus on the 'why' and the 'how' today felt based on the data. Mention today's workouts specifically and how they integrated with your health (sleep/stress/HRV).",
  "top_highlights": [
    "Emoji + concise callout. FOCUS ON STATS/MILESTONES HERE. Use this for specific wins or trends (e.g. '🔥 3rd fastest 5k of the year'). DO NOT REPEAT WHAT YOU WROTE IN THE DAILY SUMMARY.",
    "Another distinct highlight or outlier (2-4 items total). Each chip must be different from the text in daily_summary."
  ],
  "yesterday_summary": "1-2 sentences recap of yesterday's key metrics (steps, sleep, any workout). Use this to bridge the story if today's data is still incoming.",
  "suggestions": ["One concrete, actionable tip.", "Another tip."],
  "activity_insights": [{{
    "session_id": "...",
    "name": "...",
    "highlight": "**BOLD headline** (the one thing that stood out)",
    "was": "Narrative analysis. Compare to 30d baseline. Use **bold** for key numbers.",
    "worked_on": "e.g. Aerobic Endurance",
    "better_next": "One specific improvement suggestion."
  }}]
}}
"""
        # ═══════════════════════════════════════════════════════════════════════

        response = call_gemini_with_retry(ai_client, model_name, prompt)
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
            'daily_summary':    ai_data.get('daily_summary'),
            'top_highlights':   ai_data.get('top_highlights', []),
            'yesterday_summary': ai_data.get('yesterday_summary'),
            'suggestions':      " ".join(ai_data.get('suggestions', [])),
            'activity_insights': final_activity_insights,
            'is_ai':            True,
            'model_name':       model_name
        }
        
        now = time.time()
        ai_insights_cache['data'] = result
        ai_insights_cache['timestamp'] = now
        save_ai_insights_cache(result, now)
        return result

    except Exception as e:
        logger.error(f"Logic generation failed: {e}")
        error_msg = str(e)
        # Try to extract a clean message if it's a Google API error
        if "Quota exceeded" in error_msg or "429" in error_msg:
            error_msg = "Gemini API Quota Exceeded. Please wait a minute before retrying."
        elif "503" in error_msg or "504" in error_msg:
            error_msg = "Gemini API is temporarily overloaded or timed out. Please retry in a few seconds."
            
        return {
            'error':            error_msg,
            'details':          str(e),
            'daily_summary':    "Analysis Interrupted.",
            'top_highlights':   [],
            'yesterday_summary': None,
            'is_ai':            False
        }

@app.route('/api/stats')
@login_required
def get_stats():
    try:
        mgr = get_sync_manager()
        today = get_today()
        today_str = today.isoformat()
        logger.info(f"Dashboard Update: Fetching data for {today_str}")
        
        # 1. Fetch Metrics via Persistent Sync Manager
        cal_data = mgr.get_metric_for_date('stats', today_str) or {}
        sleep_data = mgr.get_metric_for_date('sleep', today_str) or {}
        hrv_data = mgr.get_metric_for_date('hrv', today_str) or {}
        
        # 2. Recent activities (using last 7 days range for cache reliability)
        start_date = today - timedelta(days=7)
        acts_raw = mgr.get_range('activities', start_date, today)
        sessions = group_activities_into_sessions(acts_raw)
        
        # Flatten sessions for UI
        ui_activities = []
        for s in sessions:
            if len(s) == 1:
                ui_activities.append(s[0])
            else:
                total_dist = sum(n(a.get('distance', 0)) for a in s)
                total_dur = sum(n(a.get('duration', 0)) for a in s)
                total_cals = sum(n(a.get('calories') or a.get('summaryDTO', {}).get('calories')) for a in s)
                primary = max(s, key=lambda x: n(x.get('distance', 0))) if s else s[0]
                
                grouped = primary.copy()
                grouped['distance'] = total_dist
                grouped['duration'] = total_dur
                grouped['calories'] = total_cals
                grouped['activityName'] = f"Grouped Session: {len(s)} Stages"
                grouped['is_grouped'] = True
                grouped['grouped_ids'] = [str(a.get('activityId')) for a in s]
                grouped['grouped_activities'] = s
                ui_activities.append(grouped)

        # 3. Weight - Fetch from Sync Manager (it handles looking back for data)
        # We try today, but if empty, mgr uses the specific lookup logic
        weight_doc = mgr.get_metric_for_date('weight', today_str) or {}
        weight_grams = weight_doc.get('weight', 0)
        
        # If today's weight is missing, let's look back 5 days specifically via manager
        if not weight_grams:
            for i in range(1, 6):
                prev_date = (today - timedelta(days=i)).isoformat()
                prev_weight = mgr.get_metric_for_date('weight', prev_date) or {}
                if prev_weight.get('weight'):
                    weight_grams = prev_weight['weight']
                    break

        response_data = {
            'steps': cal_data.get('steps', 0),
            'steps_goal': cal_data.get('steps_goal', 10000),
            'resting_hr': cal_data.get('resting_hr', 0),
            'max_hr': cal_data.get('max_hr', 0),
            'stress_avg': cal_data.get('stress_avg', 0),
            'sleep_seconds': n(sleep_data.get('sleepTimeSeconds')),
            'sleep_score': n(
                sleep_data.get('sleepScore') or 
                sleep_data.get('score') or 
                sleep_data.get('sleepScores', {}).get('overall', {}).get('value')
            ),
            'hrv': hrv_data,
            'activities': ui_activities[:10], # Cap to 10 for UI
            'weight_grams': weight_grams,
            'calories': {
                'total': cal_data.get('total', 0),
                'active': cal_data.get('active', 0),
                'resting': cal_data.get('resting', 0)
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
        mgr = get_sync_manager()
        today = get_today()
        
        # Calculate start dates
        start_of_month = today.replace(day=1)
        start_of_year = today.replace(month=1, day=1)
        
        # Fetch all activities from the cache for the entire year
        all_activities = mgr.get_range('activities', start_of_year, today)
        
        def calculate_mileage(activities, start_date):
            running = 0
            cycling = 0
            for a in activities:
                # Filter by date
                start_str = a.get('startTimeLocal', '')
                if not start_str: continue
                try:
                    act_date = datetime.strptime(start_str.split(' ')[0], '%Y-%m-%d').date()
                    if act_date < start_date: continue
                except: continue
                
                dist_mi = n(a.get('distance', 0)) * 0.000621371
                type_key = a.get('activityType', {}).get('typeKey', '').lower()
                
                if 'running' in type_key:
                    running += dist_mi
                elif any(k in type_key for k in ['cycling', 'ride', 'virtual_ride']):
                    cycling += dist_mi
            return running, cycling

        month_run, month_cycle = calculate_mileage(all_activities, start_of_month)
        year_run, year_cycle = calculate_mileage(all_activities, start_of_year)
        
        return jsonify({
            'month': {
                'running': month_run,
                'cycling': month_cycle
            },
            'year': {
                'running': year_run,
                'cycling': year_cycle
            }
        })
    except Exception as e:
        logger.error(f"Error fetching longterm stats: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/ytd_mileage_comparison')
@login_required
def get_ytd_mileage_comparison():
    try:
        mgr = get_sync_manager()
        today = get_today()
        current_day_of_year = today.timetuple().tm_yday
        
        # Build daily cumulative data for each year
        cycling_daily_data = {}
        running_daily_data = {}
        
        # Years to compare (Current + Previous)
        target_years = [2024, 2025, 2026]
        
        for year in target_years:
            # Target date range: Jan 1 to same day-of-year as today OR Dec 31 if year is past
            start_date = date(year, 1, 1)
            end_of_year = date(year, 12, 31)
            
            # For current year, only fetch up to today
            if year == today.year:
                end_fetch = today
            elif year > today.year:
                # Placeholder for future years if applicable
                cycling_daily_data[str(year)] = [0] * current_day_of_year
                running_daily_data[str(year)] = [0] * current_day_of_year
                continue
            else:
                # Past year - we actually only need the cumulative up to current_day_of_year for comparison
                end_fetch = date(year, 12, 31)

            try:
                logger.info(f"YTD Comparison: Processing year {year} via Sync Manager...")
                # Get activities for the whole year (cached monthly)
                activities = mgr.get_range('activities', start_date, end_fetch)
                
                day_map_cycle = {}
                day_map_run = {}
                
                for act in activities:
                    start_local = act.get('startTimeLocal')
                    if not start_local: continue
                    
                    try:
                        d_str = start_local.split(' ')[0]
                        d = date.fromisoformat(d_str)
                        if d.year != year: continue # Hygiene
                        d_num = d.timetuple().tm_yday
                        
                        dist_meters = n(act.get('distance', 0))
                        type_key = act.get('activityType', {}).get('typeKey', '').lower()
                        
                        # Cycling
                        if any(k in type_key for k in ['cycling', 'ride', 'virtual_ride']):
                            day_map_cycle[d_num] = day_map_cycle.get(d_num, 0) + dist_meters
                        # Running
                        elif 'running' in type_key or 'run' in type_key:
                            day_map_run[d_num] = day_map_run.get(d_num, 0) + dist_meters
                    except: continue

                # Build cumulative arrays up to current_day_of_year
                cycle_cumulative = []
                run_cumulative = []
                cum_c_m = 0
                cum_r_m = 0
                
                M_TO_MI = 0.000621371
                
                for d in range(1, current_day_of_year + 1):
                    cum_c_m += day_map_cycle.get(d, 0)
                    cum_r_m += day_map_run.get(d, 0)
                    cycle_cumulative.append(round(cum_c_m * M_TO_MI, 1))
                    run_cumulative.append(round(cum_r_m * M_TO_MI, 1))
                
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
        mgr = get_sync_manager()
        range_val = request.args.get('range', '1w')
        end_date_str = request.args.get('end_date')
        actual_today = get_today()
        
        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = actual_today
        
        history_days = 7
        if range_val == '1y': history_days = 365
        elif range_val == '1m': history_days = 31
        
        start_date = end_date - timedelta(days=history_days)
        all_data = mgr.get_range('steps', start_date, end_date)
        all_data.sort(key=lambda x: x['calendarDate'], reverse=True)
        
        # Streak calculation (using 90 days of cache/sync)
        streak_start = actual_today - timedelta(days=90)
        streak_data = mgr.get_range('steps', streak_start, actual_today)
        streak_data.sort(key=lambda x: x['calendarDate'], reverse=True)
        
        streak = 0
        temp_expected = actual_today
        today_str = actual_today.isoformat()
        for day in streak_data:
            d_str = day.get('calendarDate')
            if not d_str: continue
            curr_d = date.fromisoformat(d_str)
            if (temp_expected - curr_d).days > 1: break
            steps = n(day.get('totalSteps'))
            goal = n(day.get('stepGoal') or day.get('steps_goal') or 10000)
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
        mgr = get_sync_manager()
        range_val = request.args.get('range', '1w')
        end_date_str = request.args.get('end_date')
        
        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = get_today()

        client = mgr.client
        max_hr = get_user_max_hr(client)
        zones = [round(max_hr * (0.5 + i*0.1)) for i in range(5)]

        if range_val == '1d':
            hr_data = mgr.get_metric_for_date('hr', end_date.isoformat()) or {}
            # Fallback for detailed HR
            if not hr_data:
                hr_data = client.get_heart_rates(end_date.isoformat()) or {}
            
            # Additional fallback for summary from 'stats'
            day_stats = mgr.get_metric_for_date('stats', end_date.isoformat()) or {}
            
            summary = {
                'rhr': hr_data.get('restingHeartRate') or day_stats.get('resting_hr'),
                'max': hr_data.get('maxHeartRate') or day_stats.get('max_hr'),
                'min': hr_data.get('minHeartRate') or day_stats.get('min_hr')
            }
            
            return jsonify({
                'range': '1d',
                'summary': summary,
                'samples': hr_data.get('heartRateValues', []),
                'zones': zones,
                'max_hr': max_hr
            })
        else:
            days = 7
            if range_val == '1w': days = 7
            elif range_val == '1m': days = 31
            elif range_val == '1y': days = 365
            
            start_date = end_date - timedelta(days=days)
            # Use 'stats' for historical RHR/Max metrics
            stats_history = mgr.get_range('stats', start_date, end_date)
            
            history = []
            for day in stats_history:
                d_str = day.get('date')
                max_v = day.get('max_hr') or 0
                rhr_v = day.get('resting_hr') or 0
                
                # If stats are missing HR info, try peeking at the 'hr' detail summary
                if not max_v or not rhr_v:
                    logger.info(f"Deep backfill HR for {d_str}: current max={max_v}, rhr={rhr_v}")
                    hr_detail = mgr.get_metric_for_date('hr', d_str) or {}
                    if not max_v: max_v = hr_detail.get('maxHeartRate') or 0
                    if not rhr_v: rhr_v = hr_detail.get('sleepingRestingHeartRate') or hr_detail.get('restingHeartRate') or 0
                    logger.info(f"Deep backfill HR for {d_str} result: max={max_v}, rhr={rhr_v}")
                
                history.append({
                    'date': d_str,
                    'rhr': rhr_v,
                    'max': max_v,
                    'min': day.get('min_hr') or 0
                })
            
            return jsonify({
                'range': range_val,
                'history': history,
                'zones': zones,
                'max_hr': max_hr
            })
    except Exception as e:
        logger.error(f"Error in HR history: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/stress_history')
@login_required
def get_stress_history():
    try:
        mgr = get_sync_manager()
        range_val = request.args.get('range', '1w')
        end_date_str = request.args.get('end_date')
        
        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = get_today()

        if range_val == '1d':
            stress_data = mgr.client.get_stress_data(end_date.isoformat())
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
            
            start_date = end_date - timedelta(days=days)
            history = mgr.get_range('stress', start_date, end_date)
            return jsonify({'range': range_val, 'history': history})
    except Exception as e:
        logger.error(f"Error in stress history: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/sleep_history')
@login_required
def get_sleep_history():
    try:
        mgr = get_sync_manager()
        range_val = request.args.get('range', '1w')
        end_date_str = request.args.get('end_date')
        
        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = get_today()

        if range_val == '1d':
            sleep_data = mgr.get_metric_for_date('sleep', end_date.isoformat())
            scores = sleep_data.get('sleepScores', {})
            overall_score = scores.get('overall', {}).get('value')
            
            return jsonify({
                'range': '1d',
                'summary': {
                    'score': overall_score,
                    'total': sleep_data.get('sleepTimeSeconds'),
                    'deep': sleep_data.get('deepSleepSeconds'),
                    'light': sleep_data.get('lightSleepSeconds'),
                    'rem': sleep_data.get('remSleepSeconds'),
                    'awake': sleep_data.get('awakeSleepSeconds')
                }
            })
        else:
            days = 7
            if range_val == '1w': days = 7
            elif range_val == '1m': days = 31
            elif range_val == '1y': days = 365
            
            start_date = end_date - timedelta(days=days)
            history_raw = mgr.get_range('sleep', start_date, end_date)
            
            history = []
            for day in history_raw:
                scores = day.get('sleepScores', {})
                history.append({
                    'date': day.get('calendarDate'),
                    'score': scores.get('overall', {}).get('value') if isinstance(scores, dict) else None,
                    'total': day.get('sleepTimeSeconds'),
                    'deep': day.get('deepSleepSeconds'),
                    'light': day.get('lightSleepSeconds'),
                    'rem': day.get('remSleepSeconds'),
                    'awake': day.get('awakeSleepSeconds')
                })
            
            return jsonify({'range': range_val, 'history': history})
    except Exception as e:
        logger.error(f"Error in sleep history: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/calorie_history')
@login_required
def get_calorie_history():
    """Fetch calorie, nutrition, and weight history for the trends chart."""
    try:
        range_val = request.args.get('range', '1w')
        end_date_str = request.args.get('end_date')
        client = get_garmin_client()
        
        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = get_today()
        
        days = 7
        if range_val == '1d': days = 1
        elif range_val == '1w': days = 7
        elif range_val == '1m': days = 31
        elif range_val == '1y': days = 365
        
        dates_to_fetch = [end_date - timedelta(days=i) for i in range(days)]
        dates_to_fetch = sorted(dates_to_fetch)
        
        logs = load_json(FOOD_LOGS_FILE, [])
        
        # Build daily nutrition sums
        def get_day_nutrition(d_str):
            day_logs = [l for l in logs if l['date'] == d_str]
            return {
                'consumed': sum(l.get('calories', 0) for l in day_logs),
                'cholesterol_mg': sum(l.get('cholesterol_mg', 0) for l in day_logs),
                'protein_g': sum(l.get('protein_g', 0) for l in day_logs),
                'carbs_g': sum(l.get('carbs_g', 0) for l in day_logs),
                'sugar_g': sum(l.get('sugar_g', 0) for l in day_logs),
                'fat_g': sum(l.get('fat_g', 0) for l in day_logs),
                'caffeine_mg': sum(l.get('caffeine_mg', 0) for l in day_logs),
            }
        
        # Get weight history for range
        weight_by_date = {}
        try:
            start_date = dates_to_fetch[0]
            res = client.get_weigh_ins(start_date.isoformat(), end_date.isoformat())
            summaries = res if isinstance(res, list) else res.get('dailyWeightSummaries', [])
            for day in summaries:
                d_str = day.get('summaryDate')
                if d_str and 'latestWeight' in day and day['latestWeight'].get('weight'):
                    kg = day['latestWeight']['weight'] / 1000
                    weight_by_date[d_str] = round(kg * 2.20462, 1)
        except Exception as e:
            logger.warning(f"Weight fetch for calorie history: {e}")
        
        from concurrent.futures import ThreadPoolExecutor
        
        def fetch_day(d):
            d_str = d.isoformat()
            try:
                cal_data = get_calorie_data(client, d_str)
                nut = get_day_nutrition(d_str)
                total_burned = cal_data['total']
                consumed = nut['consumed']
                weight = weight_by_date.get(d_str)
                return {
                    'date': d_str,
                    'active_calories': cal_data['active'],
                    'resting_calories': cal_data['resting'],
                    'total_calories': total_burned,
                    'consumed': consumed,
                    'net_energy': consumed - total_burned,
                    'cholesterol_mg': nut['cholesterol_mg'],
                    'protein_g': nut['protein_g'],
                    'carbs_g': nut['carbs_g'],
                    'sugar_g': nut['sugar_g'],
                    'fat_g': nut['fat_g'],
                    'caffeine_mg': nut['caffeine_mg'],
                    'weight_lbs': weight
                }
            except Exception as e:
                logger.warning(f"Calorie history day {d_str}: {e}")
                nut = get_day_nutrition(d_str)
                return {
                    'date': d_str,
                    'active_calories': 0,
                    'resting_calories': 0,
                    'total_calories': 0,
                    'consumed': nut['consumed'],
                    'net_energy': nut['consumed'],
                    'cholesterol_mg': nut['cholesterol_mg'],
                    'protein_g': nut['protein_g'],
                    'carbs_g': nut['carbs_g'],
                    'fat_g': nut['fat_g'],
                    'weight_lbs': weight_by_date.get(d_str)
                }
        
        with ThreadPoolExecutor(max_workers=4) as executor:
            history = list(executor.map(fetch_day, dates_to_fetch))
        
        return jsonify({'history': history, 'range': range_val})
    except Exception as e:
        logger.error(f"Error fetching calorie history: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/weight_history')
@login_required
def get_weight_history():
    try:
        mgr = get_sync_manager()
        range_val = request.args.get('range', '1m')
        end_date_str = request.args.get('end_date')
        
        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = get_today()
        
        days = 31
        if range_val == '1w': days = 7
        elif range_val == '3m': days = 90
        elif range_val == '6m': days = 180
        elif range_val == '1y': days = 366
        elif range_val == '2y': days = 730
        elif range_val == '5y': days = 1825
        
        start_date = end_date - timedelta(days=days)
        history_raw = mgr.get_range('weight', start_date, end_date)
        
        # Format for chart (earliest to latest)
        history = []
        for day in history_raw:
            val = day.get('weight')
            if val:
                kg = val / 1000
                lbs = kg * 2.20462
                history.append({
                    'date': day['date'],
                    'weight_kg': round(kg, 1),
                    'weight_lbs': round(lbs, 1)
                })
        
        # Calculate summary stats
        summary = {}
        if history:
            latest = history[-1]
            summary['latest_lbs'] = latest['weight_lbs']
            summary['latest_kg'] = latest['weight_kg']
            summary['date'] = latest['date']
            
            latest_dt = date.fromisoformat(latest['date'])
            seven_days_ago = latest_dt - timedelta(days=7)
            recent_points = [d['weight_lbs'] for d in history if date.fromisoformat(d['date']) > seven_days_ago]
            if len(history) > 7:
                old = history[-8]
                summary['delta_lbs'] = round(latest['weight_lbs'] - old['weight_lbs'], 1)
            
        return jsonify({'history': history, 'summary': summary})
    except Exception as e:
        logger.error(f"Error fetching weight history: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/hydration')
@login_required
def get_hydration():
    try:
        mgr = get_sync_manager()
        today = get_today().isoformat()
        data = mgr.get_metric_for_date('hydration', today) or {}
        return jsonify({
            'date': today,
            'intake': data.get('intake', 0),
            'goal': data.get('goal', 2000)
        })
    except Exception as e:
        logger.error(f"Error fetching hydration: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/hrv')
@login_required
def get_hrv():
    try:
        mgr = get_sync_manager()
        range_val = request.args.get('range', '1d')
        end_date_str = request.args.get('end_date')
        
        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = get_today()

        if range_val == '1d':
            data = mgr.get_metric_for_date('hrv', end_date.isoformat()) or {}
            return jsonify({
                'range': '1d',
                'hrvSummary': data
            })
        else:
            days = 7
            if range_val == '1w': days = 7
            elif range_val == '1m': days = 31
            elif range_val == '1y': days = 365
            
            start_date = end_date - timedelta(days=days)
            history = mgr.get_range('hrv', start_date, end_date)
            return jsonify({
                'range': range_val,
                'history': history
            })
            
    except Exception as e:
        logger.error(f"Error in HRV: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/hydration_history')
@login_required
def get_hydration_history():
    try:
        mgr = get_sync_manager()
        range_val = request.args.get('range', '1w')
        end_date_str = request.args.get('end_date')
        
        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = get_today()

        if range_val == '1d':
            data = mgr.get_metric_for_date('hydration', end_date.isoformat()) or {}
            return jsonify({
                'range': '1d',
                'summary': {
                    'intake': data.get('intake', 0),
                    'goal': data.get('goal', 2000)
                }
            })
        else:
            days = 7
            if range_val == '1w': days = 7
            elif range_val == '1m': days = 31
            elif range_val == '1y': days = 365
            
            start_date = end_date - timedelta(days=days)
            history = mgr.get_range('hydration', start_date, end_date)
            return jsonify({
                'range': range_val,
                'history': history
            })
    except Exception as e:
        logger.error(f"Error in hydration history: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/intensity_minutes_history')
@login_required
def get_intensity_minutes_history():
    try:
        mgr = get_sync_manager()
        range_val = request.args.get('range', '1w')
        end_date_str = request.args.get('end_date')
        
        if end_date_str:
            end_date = date.fromisoformat(end_date_str)
        else:
            end_date = get_today()

        if range_val == '1d':
            im_data = mgr.client.get_intensity_minutes_data(end_date.isoformat())
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
            days_to_monday = end_date.weekday()
            current_monday = end_date - timedelta(days=days_to_monday)
            
            if range_val == '1w':
                start_date = current_monday
                days = 7
            else: # 1m
                start_date = current_monday - timedelta(weeks=3)
                days = 28
            
            history = mgr.get_range('intensity_minutes', start_date, end_date)
            goal = history[-1].get('goal', 150) if history else 150
            
            return jsonify({
                'range': range_val,
                'history': history,
                'goal': goal
            })

        else: # 6m or 1y
            weeks = 26 if range_val == '6m' else 52
            start_date = end_date - timedelta(weeks=weeks)
            
            wim_data = mgr.client.get_weekly_intensity_minutes(start_date.isoformat(), end_date.isoformat())
            history = []
            for w in wim_data:
                history.append({
                    'date': w.get('calendarDate'),
                    'goal': w.get('weeklyGoal', 150),
                    'moderate': w.get('moderateValue', 0),
                    'vigorous': w.get('vigorousValue', 0),
                    'total': w.get('moderateValue', 0) + 2 * w.get('vigorousValue', 0)
                })
            
            latest_goal = history[-1]['goal'] if history else 150
            return jsonify({
                'range': range_val,
                'history': history,
                'goal': latest_goal
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

        # Summary Refinement: Merge details summary with full activity summary
        activity_info = client.get_activity(activity_id) or {}
        summary = {}
        # Start with the full activity summary (usually has movingDuration, etc.)
        info_summary = activity_info.get('summaryDTO')
        if info_summary: summary.update(info_summary)
        
        # Overlay with details summary (might have more precise measure-based stats)
        details_summary = details.get('summaryDTO')
        if details_summary: summary.update(details_summary)
        
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

        # Determine activity type for splits/logic
        type_info = (activity_info.get('activityType') or 
                     activity_info.get('activityTypeDTO') or {})
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

        # Fetch exercise sets for strength activities
        exercise_sets = None
        muscle_stats = {}
        if 'strength' in type_key:
            try:
                exercise_sets = client.get_activity_exercise_sets(activity_id)
                mappings = load_muscle_mapping()
                # Cleanup names and calculate muscle stats
                if exercise_sets and 'exerciseSets' in exercise_sets:
                    for s in exercise_sets['exerciseSets']:
                        is_active = s.get('setType') == 'ACTIVE'
                        reps = n(s.get('repetitionCount'))
                        dur = n(s.get('duration'))
                        s['targeted_muscles'] = []
                        
                        if 'exercises' in s:
                            for ex in s['exercises']:
                                name = (ex.get('name') or '').upper()
                                cat = (ex.get('category') or '').upper()
                                
                                if ex.get('name'):
                                    ex['name'] = ex['name'].replace('_', ' ').title()
                                
                                if is_active:
                                    # Find muscle mapping
                                    for key, meta in mappings.items():
                                        if key in name or key in cat:
                                            for pm in meta['primary']:
                                                if pm not in s['targeted_muscles']:
                                                    s['targeted_muscles'].append(pm)
                                                if pm not in muscle_stats:
                                                    muscle_stats[pm] = {'reps': 0, 'seconds': 0, 'priority': 'primary'}
                                                muscle_stats[pm]['reps'] += reps
                                                muscle_stats[pm]['seconds'] += dur
                                            break # Found mapping for this exercise segment
            except Exception as ex_err:
                logger.warning(f"Failed to fetch exercise sets for {activity_id}: {ex_err}")
        
        return jsonify({
            'activityId': activity_id,
            'charts': charts,
            'summary': summary,
            'splits': splits,
            'avg_pace_str': avg_pace_str,
            'avg_speed': avg_speed,
            'polyline': compact_poly,
            'exercise_sets': exercise_sets,
            'muscle_stats': muscle_stats
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
    all_logs = request.args.get('all') == 'true'
    logs = load_json(FOOD_LOGS_FILE, [])
    
    if all_logs:
        return jsonify(logs)
        
    date_str = request.args.get('date', get_today().isoformat())
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
            name (string), calories (int), cholesterol_mg (int), protein_g (int), carbs_g (int), sugar_g (int), fat_g (int), caffeine_mg (int), ai_note (str).
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
                    'calories': 0, 'cholesterol_mg': 0, 'protein_g': 0, 'carbs_g': 0, 'sugar_g': 0, 'fat_g': 0, 'caffeine_mg': 0, 'ai_note': 'Failed'
                })

    dry_run = request.args.get('dry_run') == 'true'
    if not dry_run:
        logs = load_json(FOOD_LOGS_FILE, [])
        logs.extend(logged_entries)
        save_json(FOOD_LOGS_FILE, logs)
    
    return jsonify(logged_entries)

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
        'sugar_g': data.get('sugar_g', 0),
        'fat_g': data.get('fat_g', 0),
        'caffeine_mg': data.get('caffeine_mg', 0),
        'category': data.get('category', 'Meal'),
        'ingredients': data.get('ingredients', [])
    }
    save_json(CUSTOM_FOODS_FILE, custom_foods)
    return jsonify({'status': 'success'})

@app.route('/api/nutrition/chat', methods=['POST'])
@login_required
def nutrition_chat():
    try:
        data = request.json
        text = data.get('text', '')
        image_b64 = data.get('image')
        current_items = data.get('current_items', [])
        
        ai_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        settings = load_settings()
        model_name = settings.get('ai_model', 'gemini-2.0-flash-exp')
        
        # Provide context on recent meals for 'treat frequency' tips
        logs = load_json(FOOD_LOGS_FILE, [])
        recent_meals = [l.get('name') for l in logs[-15:]] # last 15 items
        
        prompt = f"""
        Analyze this food log request for Aaron.
        Goal: Weight loss and low cholesterol.
        
        If current_items is provided, use the INPUT to refine those items (update quantities, brands, etc).
        
        Return a JSON object:
        1. "reply": A friendly response (brief).
        2. "confidence_score": 0-100 (accuracy of calorie estimation).
        3. "health_tip": A supportive tip based on goals and recent history. 
           (e.g. "Add a side salad", "You've had a few treats lately, maybe skip the soda").
        4. "clarifying_questions": 1-2 specific questions to increase confidence.
        5. "meal_name": Title of the meal.
        6. "items": Updated list of {{"name", "qty", "unit", "calories", "cholesterol_mg", "protein_g", "carbs_g", "sugar_g", "fat_g", "caffeine_mg"}}.
        
        Context:
        INPUT: "{text}"
        CURRENT_ITEMS: {json.dumps(current_items)}
        RECENT_MEALS: {", ".join(recent_meals)}
        
        Return ONLY valid JSON.
        """
        
        contents = [prompt]
        if image_b64:
            import base64
            header, encoded = image_b64.split(",", 1)
            img_data = base64.b64decode(encoded)
            contents.append(genai.Part.from_bytes(data=img_data, mime_type="image/jpeg"))

        response = ai_client.models.generate_content(model=model_name, contents=contents)
        clean_text = response.text.replace('```json', '').replace('```', '').strip()
        result = json.loads(clean_text)
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Nutrition chat failed: {e}")
        return jsonify({'error': str(e)}), 500

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
        calories (int), cholesterol_mg (int), protein_g (int), carbs_g (int), sugar_g (int), fat_g (int), caffeine_mg (int).
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
    cw.writerow(['Name', 'Category', 'Calories', 'Cholesterol (mg)', 'Protein (g)', 'Carbs (g)', 'Sugar (g)', 'Fat (g)', 'Caffeine (mg)', 'Ingredients'])
    
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
            data.get('sugar_g'),
            data.get('fat_g'),
            data.get('caffeine_mg'),
            ing_list
        ])
    
    output = make_response(si.getvalue())
    output.headers["Content-Disposition"] = "attachment; filename=food_library.csv"
    output.headers["Content-Type"] = "text/csv"
    return output


@app.route('/api/nutrition/export')
@login_required
def export_logs_csv():
    import csv
    import io
    from flask import make_response
    
    logs = load_json(FOOD_LOGS_FILE, [])
    si = io.StringIO()
    cw = csv.writer(si)
    # Header matching the user's request for "exact same format" for re-import
    cw.writerow(['Date', 'Time', 'Name', 'Calories', 'Cholesterol (mg)', 'Protein (g)', 'Carbs (g)', 'Sugar (g)', 'Fat (g)', 'Caffeine (mg)', 'Category', 'Ingredients', 'AI Note'])
    
    for log in logs:
        # Flatten ingredients if present
        ing_data = log.get('ingredients', [])
        ing_str = "; ".join([f"{i.get('qty','')} {i.get('unit','')} {i.get('name','')}" for i in ing_data]) if ing_data else ""
        
        cw.writerow([
            log.get('date', ''),
            log.get('time', ''),
            log.get('name', ''),
            log.get('calories', 0),
            log.get('cholesterol_mg', 0),
            log.get('protein_g', 0),
            log.get('carbs_g', 0),
            log.get('sugar_g', 0),
            log.get('fat_g', 0),
            log.get('caffeine_mg', 0),
            log.get('category', ''),
            ing_str,
            log.get('ai_note', '')
        ])
    
    output = make_response(si.getvalue())
    output.headers["Content-Disposition"] = f"attachment; filename=food_logs_{get_today()}.csv"
    output.headers["Content-Type"] = "text/csv"
    return output

@app.route('/api/nutrition/import', methods=['POST'])
@login_required
def import_logs_csv():
    import csv
    import io
    
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    try:
        stream = io.StringIO(file.stream.read().decode("UTF8"), newline=None)
        csv_input = csv.reader(stream)
        
        header = next(csv_input, None)
        # We expect a header but won't strictly validate every column name to allow for slight variations if user edits manually
        # Expected: Date, Time, Name, Calories, Cholesterol (mg), Protein (g), Carbs (g), Fat (g), Category, Ingredients, AI Note
        
        new_logs = []
        current_logs = load_json(FOOD_LOGS_FILE, [])
        existing_ids = {l['id'] for l in current_logs} # Although we generate new IDs, we could check for duplicates based on content?
        # For now, just append. User said "pick up where I left off", implies filling gaps or restoring.
        
        base_id = int(time.time() * 1000)
        
        for i, row in enumerate(csv_input):
            if not row: continue
            
            # Basic parsing based on index
            # 0: Date, 1: Time, 2: Name ...
            try:
                date_val = row[0]
                time_val = row[1]
                name_val = row[2]
                calories = int(row[3]) if len(row) > 3 else 0
                chol = int(row[4]) if len(row) > 4 else 0
                pro = int(row[5]) if len(row) > 5 else 0
                carb = int(row[6]) if len(row) > 6 else 0
                sugar = int(row[7]) if len(row) > 7 else 0
                fat = int(row[8]) if len(row) > 8 else 0
                caf = int(row[9]) if len(row) > 9 else 0
                category = row[10] if len(row) > 10 else "Meal"
                ing_str = row[11] if len(row) > 11 else ""
                ai_note = row[12] if len(row) > 12 else ""
                
                new_logs.append({
                    'id': base_id + i,
                    'date': date_val,
                    'time': time_val,
                    'name': name_val,
                    'calories': calories,
                    'cholesterol_mg': chol,
                    'protein_g': pro,
                    'carbs_g': carb,
                    'sugar_g': sugar,
                    'fat_g': fat,
                    'caffeine_mg': caf,
                    'category': category,
                    'ai_note': ai_note
                })
            except Exception as e:
                logger.warning(f"Error parsing CSV row {i}: {e}")
                continue
                
        current_logs.extend(new_logs)
        save_json(FOOD_LOGS_FILE, current_logs)
        
        return jsonify({'status': 'success', 'count': len(new_logs)})
        
    except Exception as e:
        logger.error(f"Import failed: {e}")
        return jsonify({'error': str(e)}), 500

    

@app.route('/api/nutrition/analysis')
@login_required
def get_nutrition_analysis():
    date_str = request.args.get('date', get_today().isoformat())
    
    # Get intakes
    logs = load_json(FOOD_LOGS_FILE, [])
    day_logs = [log for log in logs if log['date'] == date_str]
    total_in = sum(l.get('calories', 0) for l in day_logs)
    total_chol = sum(l.get('cholesterol_mg', 0) for l in day_logs)

    # Convert date_str to a date object to find the range
    target_date = datetime.fromisoformat(date_str).date()
    seven_days_ago = target_date - timedelta(days=7)

    history_summary = []
    for i in range(7):
        d = (seven_days_ago + timedelta(days=i)).isoformat()
        daily_sum = sum(l.get('calories', 0) for l in logs if l['date'] == d)
        history_summary.append(f"{d}: {daily_sum} kcal")
    
    history_str = ", ".join(history_summary)
    
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

        # 1. Define the current status based on time
        now_est = datetime.now(EST)
        current_hour = now_est.hour
        time_str = now_est.strftime("%I:%M %p")

        # 2. Logic to handle the "Meal Expectation"
        # Assume 3 main meals: breakfast, lunch, dinner
        if current_hour < 12:
            meals_remaining = "at least 2 main meals (lunch and dinner)"
            time_context = "early morning"
        elif current_hour < 18:
            meals_remaining = "at least 1 major meal (dinner)"
            time_context = "mid-afternoon"
        else:
            meals_remaining = "potentially a late snack or the day is concluding"
            time_context = "evening"
        
        prompt = f"""
        You are 'Athlete Intelligence', a personal health coach. Analyze my nutrition for {date_str}.
        My Goals: Weight loss, low cholesterol.
        
        Metabolic Data:
        - Total Energy Out: {total_out} kcal (Resting: {resting_out}, Active: {active_out})
        - Total Energy In: {total_in} kcal
        - Total Cholesterol: {total_chol} mg
        - Logged Foods: {food_list}

        7-Day Calorie History (for trend analysis): {history_str}
        
        - Address me directly as 'you'. 
        - I still have {meals_remaining} expected for the rest of the day since it is {time_str}
          DO NOT praise a 'significant deficit' as an achievement if the day is not over;
          instead, frame it as 'Available Fuel Capacity' for my upcoming meals.
        -I already know what time of day it is you dont need to be explicit. 
        
        Provide a concise analysis (2-3 sentences). 
        Focus on how my energy balance (intake vs total out) and cholesterol align with my weight loss and heart health goals. 
        If 'Active' calories are high, mention my workout efficiency. 
        Note the current time and how many meal I have expected for the rest of the day.
        Let me know if there are any trends over time of my calories.
        If I overate yesteday, motivate me to eat less today, or if I underate yesterday, suggest that I can eat more today. 
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
        # Use shorter cache when actively syncing routes
        cache_ttl = HEATMAP_CACHE_EXPIRY_SYNCING if (heatmap_cache['data'] or {}).get('missing_count', 0) > 0 else HEATMAP_CACHE_EXPIRY
        if now - heatmap_cache['timestamp'] < cache_ttl:
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
            start_date = date(2010, 1, 1) # Start from 2010 per user request
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
        type_counter = {}  # Debug: count activity types
        
        for act in activities:
            aid = act.get('activityId')
            type_key = act.get('activityType', {}).get('typeKey', 'unknown') or 'unknown'
            
            # Debug: track type distribution
            type_counter[type_key] = type_counter.get(type_key, 0) + 1
            
            if poly_cache.has(aid):
                # Retrieve from cache
                poly = poly_cache.get(aid)
                if poly:
                    result_points.append({
                        'id': aid,
                        'type': type_key,
                        'poly': poly
                    })
            else:
                # Try to fetch polyline for ANY activity we haven't checked yet.
                # The polyline fetcher will cache [] for activities with no GPS data,
                # so they won't be re-fetched on subsequent requests.
                missing_ids.append(aid)
        
        logger.info(f"Heatmap types: {type_counter}")

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
