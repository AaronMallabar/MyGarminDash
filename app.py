import os
import logging
from google import genai
import json
import traceback
from flask import Flask, render_template, jsonify, request
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

# Timezone Configuration
EST = ZoneInfo("America/New_York")

def get_today():
    """Get today's date in Eastern Standard Time."""
    return datetime.now(EST).date()

# Gemini configuration is now handled per-client instance

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global client cache (simple version)
garmin_client = None

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

def get_user_max_hr(client):
    try:
        profile = client.get_user_profile()
        birth_str = profile.get('userData', {}).get('birthDate')
        if birth_str:
            birth_date = date.fromisoformat(birth_str)
            today = get_today()
            age = today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))
            return 220 - age
    except:
        pass
    return 190 # Default fallback

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

# Initialize Cache
poly_cache = PolylineCache()

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
AI_CACHE_EXPIRY = 3600  # 1 hour cache duration

# Heatmap Cache
heatmap_cache = {
    'data': None,
    'timestamp': None,
    'range': None
}
HEATMAP_CACHE_EXPIRY = 120  # 2 minute cache duration

# Background Worker
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


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/ai_insights')
def get_ai_insights():
    global ai_insights_cache
    
    # Check cache first
    now = time.time()
    if ai_insights_cache['data'] and ai_insights_cache['timestamp']:
        if now - ai_insights_cache['timestamp'] < AI_CACHE_EXPIRY:
            logger.info("AI Insights: Returning cached response")
            return jsonify(ai_insights_cache['data'])

    try:
        client = get_garmin_client()
        today = get_today()
        
        # 1. Fetch Today's Deep Health Data (with safe fallbacks)
        def safe_fetch(func, *args, **kwargs):
            try:
                res = func(*args, **kwargs)
                return res if res is not None else {}
            except Exception as e:
                logger.warning(f"AI Insights: Failed to fetch {func.__name__ if hasattr(func, '__name__') else 'unknown'}: {e}")
                return {}

        def n(val):
            """Ensure value is a number, default to 0 if None."""
            return val if val is not None else 0

        stats = safe_fetch(client.get_stats, today.isoformat())
        sleep = safe_fetch(client.get_sleep_data, today.isoformat())
        hrv_res = safe_fetch(client.get_hrv_data, today.isoformat())
        hrv = hrv_res.get('hrvSummary', {}) if isinstance(hrv_res, dict) else {}
        
        # Ensure we have common fields with defaults
        steps_today = n(stats.get('totalSteps', 0)) if isinstance(stats, dict) else 0
        stress_today = n(stats.get('averageStressLevel', 0)) if isinstance(stats, dict) else 0
        
        dto_today = sleep.get('dailySleepDTO', {}) if isinstance(sleep, dict) else {}
        if not isinstance(dto_today, dict): dto_today = {}
        sleep_score_today = n(dto_today.get('sleepScore') or dto_today.get('score') or (sleep.get('sleepScore', 0) if isinstance(sleep, dict) else 0))
        
        # 2. Fetch Deep Historical Data (Last 7 Days)
        from concurrent.futures import ThreadPoolExecutor
        def fetch_historical(d):
            try:
                s = client.get_stats(d.isoformat())
                h = client.get_hydration_data(d.isoformat())
                sl = client.get_sleep_data(d.isoformat())
                
                # Safe key retrieval
                s_dict = s if isinstance(s, dict) else {}
                h_dict = h if isinstance(h, dict) else {}
                sl_dict = sl if isinstance(sl, dict) else {}
                
                dto = sl_dict.get('dailySleepDTO', {}) if isinstance(sl_dict, dict) else {}
                if not isinstance(dto, dict): dto = {}
                s_score = n(dto.get('sleepScore') or dto.get('score') or sl_dict.get('sleepScore', 0))
                
                return {
                    'date': d.isoformat(),
                    'steps': n(s_dict.get('totalSteps', 0)),
                    'goal': n(s_dict.get('totalStepsGoal', 10000)),
                    'hydration': n(h_dict.get('valueInML', 0) if h_dict else 0),
                    'stress': n(s_dict.get('averageStressLevel', 0)),
                    'sleep_score': s_score,
                    'sleep_feedback': dto.get('sleepScoreFeedback', 'unknown')
                }
            except:
                return None

        past_dates = [today - timedelta(days=i) for i in range(1, 8)]
        # Reduce max_workers to 4 to save memory on Render's 512MB tier
        with ThreadPoolExecutor(max_workers=4) as executor:
            history_list = list(executor.map(fetch_historical, past_dates))
        history_list = [h for h in history_list if h]
        
        # 3. Calculate Narratives and Trends
        avg_steps = sum(n(h.get('steps', 0)) for h in history_list) / len(history_list) if history_list else 10000
        valid_sleeps = [n(h.get('sleep_score', 0)) for h in history_list if n(h.get('sleep_score', 0)) > 0]
        avg_sleep = sum(valid_sleeps) / max(1, len(valid_sleeps)) if valid_sleeps else 70
        
        valid_stress = [n(h.get('stress', 0)) for h in history_list if n(h.get('stress', 0)) > 0]
        avg_stress = sum(valid_stress) / max(1, len(valid_stress)) if valid_stress else 25
        
        # 4. Today's Narrative
        today_blurb = []
        if steps_today > avg_steps * 1.2:
            today_blurb.append(f"You're significantly more active today than your usual trend. This extra volume is building great aerobic capacity.")
        elif steps_today < avg_steps * 0.8:
            today_blurb.append(f"Today is a lower volume day for you. Your body might be calling for some lighter movement.")
        else:
            today_blurb.append(f"You're maintaining a very consistent movement rhythm today, which is the backbone of long-term fitness.")

        if stress_today > avg_stress + 5:
            today_blurb.append(f"Your internal load (stress: {stress_today}) is higher than your weekly average. This suggests your body is working harder to maintain equilibrium.")
        elif stress_today < avg_stress - 5:
            today_blurb.append(f"Your body is in a prime 'growth' state today with unusually low stress.")

        # Yesterday's Detailed Narrative
        yesterday_blurb = "No data for yesterday."
        if history_list:
            y = history_list[0]
            y_steps = n(y.get('steps', 0))
            y_stress = n(y.get('stress', 0))
            y_sleep = n(y.get('sleep_score', 0))
            y_feedback = y.get('sleep_feedback', 'unknown')
            
            y_narrative = []
            if y_steps > 12000:
                y_narrative.append(f"Yesterday was a high-output day ({y_steps:,} steps).")
            elif y_steps < 5000:
                y_narrative.append(f"Yesterday was a quiet, restorative day movement-wise.")
            else:
                y_narrative.append(f"Yesterday was a typical, balanced movement day.")

            if y_stress > 35:
                y_narrative.append(f"You carried quite a bit of physiological stress ({y_stress}).")
            
            if y_sleep > 80:
                y_narrative.append(f"The highlight was your exceptional recovery—a sleep score of {y_sleep}.")
            elif y_sleep > 0:
                y_narrative.append(f"Your sleep ({y_sleep}) was {str(y_feedback).lower()}.")
            
            yesterday_blurb = " ".join(y_narrative)

        # 5. Optimization Suggestions
        suggestions = []
        hrv_status = hrv.get('status') if isinstance(hrv, dict) else None
        if hrv_status in ['UNBALANCED', 'LOW']:
             suggestions.append("Your HRV trend is signaling a 'red light'. Opt for Zone 1 movement or mobility work.")
        elif stress_today > 40:
             suggestions.append("With your stress spiking today, prioritize deep breathing before bed.")
        
        # Robust hydration fetch
        today_hyd = 0
        try:
            h_data = client.get_hydration_data(today.isoformat())
            if isinstance(h_data, dict):
                today_hyd = n(h_data.get('valueInML', 0))
            elif isinstance(h_data, list) and len(h_data) > 0:
                today_hyd = sum(n(item.get('valueInML', 0)) for item in h_data if isinstance(item, dict))
        except:
            today_hyd = 0

        if n(today_hyd) < 2000:
            oz = round(n(today_hyd) * 0.033814, 1)
            suggestions.append(f"You're behind your 2L hydration target ({oz} oz logged)—grab a glass now.")

        if not suggestions:
            suggestions.append("Everything looks solid. This is your green light to stay the course or push a little harder.")

        # Fetch Recent Activities for context (Reduced further to 5 to save memory and stay within 30s timeout)
        try:
            acts_all = client.get_activities(0, 5)
            # Filter for today only for the 'Today's Narrative' section
            acts_today = [a for a in acts_all if a.get('startTimeLocal', '').split(' ')[0] == today.isoformat()]
            if acts_today:
                today_blurb.append(f"You've already logged {len(acts_today)} activity{'ies' if len(acts_today) > 1 else ''} today, which is fantastic for your metabolic momentum.")
        except Exception as e:
            logger.warning(f"AI Insights: Failed to fetch recent activities: {e}")
            acts_all = []
            acts_today = []

        # Try to fetch current weight for context
        current_weight_lbs = "Unknown"
        try:
            body = client.get_body_composition(today.isoformat())
            if isinstance(body, dict) and 'totalBodyComposition' in body:
                w_grams = body['totalBodyComposition'].get('weight')
                if w_grams:
                    current_weight_lbs = round((w_grams / 1000) * 2.20462, 1)
        except:
            pass

        # Prepare context for Gemini
        context = {
            "persona": "Balanced fitness mentor with a focus on consistency and healthy body composition",
            "user_meta_goal": "Healthy weight management & workout frequency",
            "today_stats": {
                "steps": steps_today,
                "stress": stress_today,
                "sleep_score": sleep_score_today,
                "hydration_oz": round(today_hyd * 0.033814, 1),
                "current_weight_lbs": current_weight_lbs,
                "hrv_status": hrv.get('status', 'Unknown')
            },
            "seven_day_history": history_list,
            "training_history": [{
                "activity_id": a.get('activityId'),
                "name": a.get('activityName'),
                "type": a.get('activityType', {}).get('typeKey'),
                "distance_mi": round(n(a.get('distance', 0)) * 0.000621371, 2),
                "duration_min": round(n(a.get('duration', 0)) / 60),
                "date": a.get('startTimeLocal', '').split(' ')[0]
            } for a in acts_all] if 'acts_all' in locals() and acts_all else []
        }

        # 6. Generate Generative AI Response (with Fallback)
        try:
            # Initialize the client per request (or globally if preferred, but local is safe)
            ai_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
            
            prompt = f"""
            You are a balanced, knowledgeable fitness mentor. 
            Your goal is to provide a concise, professional check-in based on the user's Garmin health data.

            CRITICAL CONTEXT: The user is working towards healthy weight management. 
            Tone Guidelines:
            - Find a "happy medium": Professional and encouraging, but not overly focused on weight loss or calories.
            - Focus on overall consistency, metabolic health, and performance.
            - AVOID over-emphasizing "caloric burn" or "weight loss" in every sentence; treat them as secondary benefits of a solid training routine.
            - Stay data-driven but keep the language comfortable and modern.

            DATA CONTEXT:
            {json.dumps(context, indent=2)}

            REQUIRED OUTPUT FORMAT:
            You must return a valid JSON object with:
            - "daily_summary": 2-3 sentences. Focus on today's health outlook and consistency.
            - "yesterday_summary": 1-2 sentences recap.
            - "suggestions": An array of EXACTLY 2 strings. Helpful, high-value coaching tips for general wellness/performance.
            - "activity_insights": An array of objects for EVERY activity listed in the "training_history".
              Each activity insight object MUST include:
              - "activity_id": The exact numeric ID.
              - "name": Exact activity name.
              - "highlight": 1 standout performance "win" from the workout.
              - "was": 1 sentence recap of the metabolic or fitness achievement (e.g. Aerobic base building).
              - "worked_on": 1-3 words on the focus (e.g. "Metabolic Efficiency").
              - "better_next": A practical tip for next time.

            Return ONLY the JSON.
            """

            # Use Gemini 2.0 Flash for superior speed and reliability in 2026
            model_name = 'gemini-2.0-flash'
            
            logger.info(f"AI Insights: Sending request to Gemini ({model_name})...")
            start_ai = time.time()
            response = ai_client.models.generate_content(
                model=model_name,
                contents=prompt
            )
            logger.info(f"AI Insights: Gemini response received in {time.time() - start_ai:.2f}s")
            # Robust JSON cleaning
            clean_text = response.text.replace('```json', '').replace('```', '').strip()
            ai_data = json.loads(clean_text)
            
            # Robust suggestions parsing
            suggestions_raw = ai_data.get('suggestions', [])
            if isinstance(suggestions_raw, list):
                # Ensure all items are strings before joining
                suggestions_text = " ".join([str(s) for s in suggestions_raw])
            else:
                suggestions_text = str(suggestions_raw)

            result = {
                'daily_summary': ai_data.get('daily_summary'),
                'yesterday_summary': ai_data.get('yesterday_summary'),
                'suggestions': suggestions_text,
                'activity_insights': ai_data.get('activity_insights', []),
                'is_ai': True
            }
            
            # Cache the successful AI response
            ai_insights_cache['data'] = result
            ai_insights_cache['timestamp'] = time.time()
            
            return jsonify(result)

        except Exception as ai_err:
            if "RESOURCES_EXHAUSTED" in str(ai_err) or "429" in str(ai_err):
                logger.warning(f"Gemini API Quota Exceeded (429). You've hit the rate limit for the Gemini 2.0 Flash model. Falling back to local logic.")
            else:
                logger.warning(f"Gemini API Error: {ai_err}. Falling back to local logic.")
            
            # FALLBACK TO HARDCODED LOGIC
            activity_insights = []
            max_hr = get_user_max_hr(client)
            for act in (acts_all if 'acts_all' in locals() and acts_all else []):
                avg_hr = n(act.get('averageHR', 0))
                hr_pct = (avg_hr / max_hr) if max_hr > 0 and avg_hr > 0 else 0
                was, worked, better = "Activity logged.", "General fitness.", "Keep it up."
                highlight = "Great consistency."
                if hr_pct > 0.85:
                    was, worked, better = "Peak intensity session.", "Anaerobic capacity.", "Prioritize recovery tomorrow."
                    highlight = "High intensity effort."
                elif hr_pct > 0.70:
                    was, worked, better = "Aerobic conditioning.", "Endurance.", "Maintain this pace."
                    highlight = "Solid aerobic work."
                
                activity_insights.append({
                    'activity_id': act.get('activityId'),
                    'name': act.get('activityName', 'Activity'),
                    'highlight': highlight,
                    'was': was, 
                    'worked_on': worked, 
                    'better_next': better
                })

            return jsonify({
                'daily_summary': " ".join(today_blurb),
                'yesterday_summary': yesterday_blurb,
                'suggestions': " ".join(suggestions),
                'activity_insights': activity_insights,
                'is_ai': False
            })
        
    except Exception as e:
        logger.error(f"Error generating AI insights: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/api/stats')
def get_stats():
    try:
        client = get_garmin_client()
        today = get_today()
        
        # specific date for stats (today)
        stats = client.get_stats(today.isoformat())
        
        # Sleep data (often for "last night" which might be today's date or yesterday's depending on API)
        # We try today first
        sleep = client.get_sleep_data(today.isoformat())
        
        # Recent activities (last 5)
        activities = client.get_activities(0, 5)
        
        # Weight (Body composition) - search last 7 days for most recent entry
        weight_grams = None
        for i in range(7):
            check_date = (today - timedelta(days=i)).isoformat()
            try:
                body_comp = client.get_body_composition(check_date)
                if body_comp and 'totalAverage' in body_comp and body_comp['totalAverage'].get('weight'):
                    weight_grams = body_comp['totalAverage']['weight']
                    break
            except:
                continue

        data = {
            'steps': stats.get('totalSteps'),
            'steps_goal': stats.get('totalStepsGoal'),
            'resting_hr': stats.get('restingHeartRate'),
            'stress_avg': stats.get('averageStressLevel'),
            'sleep_seconds': sleep.get('dailySleepDTO', {}).get('sleepTimeSeconds'),
            'sleep_score': sleep.get('dailySleepDTO', {}).get('sleepScoreFeedback'),
            'hrv': client.get_hrv_data(today.isoformat()).get('hrvSummary'),
            'activities': activities,
            'weight_grams': weight_grams
        }
        
        return jsonify(data)
        
    except ValueError as ve:
        return jsonify({'error': str(ve)}), 500
    except Exception as e:
        logger.error(f"Error fetching data: {e}")
        return jsonify({'error': 'Failed to fetch data from Garmin. Check server logs.'}), 500

@app.route('/api/goals')
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
        
        history = list(reversed(all_data[:requested_days]))

        return jsonify({
            'history': history,
            'streak': streak,
            'range': range_val
        })
    except Exception as e:
        logger.error(f"Error fetching steps history: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/hr_history')
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

        # Mile Splits logic
        splits = []
        try:
            if 'sumDistance' in key_map:
                mile_in_m = 1609.34
                next_mile = 1
                last_dur = 0
                last_dist = 0
                start_ts = charts['timestamps'][0] if charts['timestamps'] else 0
                
                for m in metrics_list:
                    row = m.get('metrics')
                    if not row: continue
                    
                    curr_dist = get_val(row, 'sumDistance')
                    if curr_dist and curr_dist >= next_mile * mile_in_m:
                        # Find duration
                        curr_dur = get_val(row, 'sumDuration')
                        if curr_dur is None: # Fallback to timestamp
                            ts = get_val(row, 'directTimestamp')
                            curr_dur = (ts - start_ts) / 1000 if ts else 0
                        
                        split_dur = curr_dur - last_dur
                        if split_dur > 0:
                            splits.append({
                                'mile': next_mile,
                                'duration': split_dur,
                                'pace_str': f"{int(split_dur//60)}:{int(split_dur%60):02d}"
                            })
                        last_dur = curr_dur
                        last_dist = curr_dist
                        next_mile += 1
                
                # Final partial mile
                if total_dist_m and total_dist_m > last_dist:
                    remain_m = total_dist_m - last_dist
                    remain_mi = remain_m / mile_in_m
                    if remain_mi > 0.02:
                        remain_dur = total_dur_s - last_dur
                        if remain_dur > 0:
                            pace_pm = remain_dur / remain_mi
                            splits.append({
                                'mile': round((next_mile - 1) + remain_mi, 2),
                                'duration': remain_dur,
                                'pace_str': f"{int(pace_pm//60)}:{int(pace_pm%60):02d}"
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

@app.route('/api/activity_heatmap')
def get_activity_heatmap():
    try:
        client = get_garmin_client()
        today = get_today()
        start_date = today - timedelta(days=365)
        
        # Fetch last 1000 activities (should cover a year for most users)
        activities = client.get_activities(0, 1000) 
        
        # Aggregate counts by date
        # Format: { 'YYYY-MM-DD': count }
        heatmap = {}
        
        for activity in activities:
            start_local = activity.get('startTimeLocal')
            if start_local:
                date_str = start_local.split(' ')[0]
                heatmap[date_str] = heatmap.get(date_str, 0) + 1

        return jsonify(heatmap)

    except Exception as e:
        logger.error(f"Error fetching activity heatmap: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/calendar_activities')
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
