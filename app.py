import os
import logging
from flask import Flask, render_template, jsonify, request
from garminconnect import Garmin
from datetime import date, timedelta, datetime
from dotenv import load_dotenv

load_dotenv()

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
            today = date.today()
            age = today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))
            return 220 - age
    except:
        pass
    return 190 # Default fallback

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/ai_insights')
def get_ai_insights():
    try:
        client = get_garmin_client()
        today = date.today()
        
        # 1. Fetch Today's Deep Health Data
        stats = client.get_stats(today.isoformat())
        sleep = client.get_sleep_data(today.isoformat())
        hrv = client.get_hrv_data(today.isoformat()).get('hrvSummary', {})
        im_data = client.get_intensity_minutes_data(today.isoformat())
        
        # 2. Fetch Deep Historical Data (Last 7 Days)
        from concurrent.futures import ThreadPoolExecutor
        def fetch_historical(d):
            try:
                s = client.get_stats(d.isoformat())
                h = client.get_hydration_data(d.isoformat())
                sl = client.get_sleep_data(d.isoformat())
                # Fix Sleep Score Retrieval: try multiple locations
                dto = sl.get('dailySleepDTO', {})
                s_score = dto.get('sleepScore') or dto.get('score') or sl.get('sleepScore', 0)
                
                return {
                    'date': d.isoformat(),
                    'steps': s.get('totalSteps', 0),
                    'goal': s.get('totalStepsGoal', 10000),
                    'hydration': h.get('hydrationValueProcessed', 0),
                    'stress': s.get('averageStressLevel', 0),
                    'sleep_score': s_score,
                    'sleep_feedback': dto.get('sleepScoreFeedback', 'unknown')
                }
            except:
                return None

        past_dates = [today - timedelta(days=i) for i in range(1, 8)]
        with ThreadPoolExecutor(max_workers=7) as executor:
            history_list = list(executor.map(fetch_historical, past_dates))
        history_list = [h for h in history_list if h]
        
        # 3. Calculate Narratives and Trends
        avg_steps = sum(h['steps'] for h in history_list) / len(history_list) if history_list else 10000
        avg_sleep = sum(h['sleep_score'] for h in history_list if h['sleep_score'] > 0) / max(1, len([h for h in history_list if h['sleep_score'] > 0]))
        avg_stress = sum(h['stress'] for h in history_list if h['stress'] > 0) / max(1, len([h for h in history_list if h['stress'] > 0]))
        
        # 4. Compare Today to Trends
        steps_today = stats.get('totalSteps', 0)
        stress_today = stats.get('averageStressLevel', 0)
        dto_today = sleep.get('dailySleepDTO', {})
        sleep_score_today = dto_today.get('sleepScore') or dto_today.get('score') or sleep.get('sleepScore', 0)
        
        # Today's Narrative
        today_blurb = []
        if steps_today > avg_steps * 1.2:
            today_blurb.append(f"You're significantly more active today than your usual trend. This extra volume is building great aerobic capacity.")
        elif steps_today < avg_steps * 0.8:
            today_blurb.append(f"Today is a lower volume day for you. While this might feel like a 'dip', it's actually providing your joints and nervous system a much-needed break from the usual impact.")
        else:
            today_blurb.append(f"You're maintaining a very consistent movement rhythm today, which is the backbone of long-term fitness.")

        if stress_today > avg_stress + 5:
            today_blurb.append(f"Your internal load (stress: {stress_today}) is higher than your weekly average. This suggests your body is working harder to maintain equilibrium, possibly due to lingering fatigue from yesterday.")
        elif stress_today < avg_stress - 5:
            today_blurb.append(f"Your body is in a prime 'growth' state today with unusually low stress. This is the optimal time for high-quality work or deep physiological adaptation.")

        # Yesterday's Detailed Narrative
        yesterday_blurb = "No data for yesterday."
        if history_list:
            y = history_list[0]
            y_steps = y['steps']
            y_stress = y['stress']
            y_sleep = y['sleep_score']
            y_feedback = y['sleep_feedback']
            
            y_narrative = []
            if y_steps > 12000:
                y_narrative.append(f"Yesterday was a high-output day ({y_steps:,} steps).")
            elif y_steps < 5000:
                y_narrative.append(f"Yesterday was a quiet, restorative day movement-wise.")
            else:
                y_narrative.append(f"Yesterday was a typical, balanced movement day.")

            if y_stress > 35:
                y_narrative.append(f"You carried quite a bit of physiological stress ({y_stress}), which likely explains why your recovery feels slower today.")
            
            if y_sleep > 80:
                y_narrative.append(f"The highlight was your exceptional recovery—a sleep score of {y_sleep} means you likely entered today with 'full batteries' even if the day was busy.")
            elif y_sleep > 0:
                y_narrative.append(f"Your sleep ({y_sleep}) was {y_feedback.lower()}. If you feel sluggish, this deficit is likely the culprit.")
            
            yesterday_blurb = " ".join(y_narrative)

        # 5. Optimization Suggestions (Coaching Style)
        suggestions = []
        if hrv.get('status') in ['UNBALANCED', 'LOW']:
             suggestions.append("Your HRV trend is signaling a 'red light'. High-intensity work now will likely delay your next 3 days of progress. Opt for Zone 1 movement or mobility work.")
        elif stress_today > 40:
             suggestions.append("With your stress spiking today, prioritize magnesium and deep breathing before bed to prevent this stress from 'bleeding' into your sleep quality tonight.")
        
        today_hyd = client.get_hydration_data(today.isoformat()).get('hydrationValueProcessed', 0)
        if today_hyd < 1500:
            suggestions.append(f"You're historically most consistent when you log at least 2L of water. You're behind pace today—grab a glass now to help your muscles flush waste.")

        if not suggestions:
            suggestions.append("Every metric is in the 'green zone'. This is your green light to push a little harder in your next session or try a new movement challenge.")

        # 6. Activity Insights
        activity_insights = []
        max_hr = get_user_max_hr(client)
        all_activities = client.get_activities(0, 5)
        for act in all_activities:
            if act.get('startTimeLocal', '').split(' ')[0] == today.isoformat():
                avg_hr = act.get('averageHR', 0)
                hr_pct = (avg_hr / max_hr) if max_hr > 0 and avg_hr > 0 else 0
                
                was, worked, better = "Activity logged.", "General fitness.", "Keep it up."
                if hr_pct > 0.85:
                    was = "This was a high-intensity 'peak' session that pushed your cardiovascular limits."
                    worked = "VO2 Max and Anaerobic capacity."
                    better = "Don't try to repeat this tomorrow; your muscle glycogen is likely depleted."
                elif hr_pct > 0.70:
                    was = "This was your 'bread and butter' aerobic conditioning."
                    worked = "Mitochondrial density and fat adaptation."
                    better = "Try to focus on steady breathing to stay in control of the effort."
                
                activity_insights.append({
                    'name': act.get('activityName', 'Activity'),
                    'was': was,
                    'worked_on': worked,
                    'better_next': better
                })

        return jsonify({
            'daily_summary': " ".join(today_blurb),
            'yesterday_summary': yesterday_blurb,
            'suggestions': " ".join(suggestions),
            'activity_insights': activity_insights
        })
        
    except Exception as e:
        logger.error(f"Error generating AI insights: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/stats')
def get_stats():
    try:
        client = get_garmin_client()
        today = date.today()
        
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
        today = date.today()
        
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
        today = date.today()
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
        
        actual_today = date.today()
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
            end_date = date.today()

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

            # Use more threads for 1y to blast through it
            workers = 40 if range_val == '1y' else 0
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
            end_date = date.today()

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

            workers = 20 if range_val == '1y' else 10
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
            end_date = date.today()

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

            workers = 20 if range_val == '1y' else 10
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
            end_date = date.today()
        
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
        today = date.today().isoformat()
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
            end_date = date.today()

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

            workers = 20 if range_val == '1y' else 10
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
            end_date = date.today()

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

            workers = 20 if range_val == '1y' else 10
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
            end_date = date.today()

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
                    if d > date.today():
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
                today_stats = client.get_intensity_minutes_data(date.today().isoformat())
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
        client = get_garmin_client()
        details = client.get_activity_details(activity_id)
        # Also get general activity info which contains summaryDTO
        activity_info = client.get_activity(activity_id)
        
        # Extract metrics and descriptors
        descriptors = details.get('metricDescriptors', [])
        metrics_list = details.get('activityDetailMetrics', [])
        
        # Create a mapping of key to index
        key_map = {d['key']: d['metricsIndex'] for d in descriptors}
        
        charts = {
            'heart_rate': [],
            'speed': [],
            'elevation': [],
            'cadence': [],
            'power': [],
            'timestamps': [],
            'distance': []
        }
        
        for m in metrics_list:
            row = m.get('metrics', [])
            if not row: continue
            
            # Timestamp (ms)
            ts = row[key_map['directTimestamp']] if 'directTimestamp' in key_map else None
            if ts:
                charts['timestamps'].append(ts)
                
                # Heart Rate
                if 'directHeartRate' in key_map:
                    charts['heart_rate'].append(row[key_map['directHeartRate']])
                
                # Speed (m/s)
                if 'directSpeed' in key_map:
                    charts['speed'].append(row[key_map['directSpeed']])
                
                # Elevation (m)
                if 'directElevation' in key_map:
                    charts['elevation'].append(row[key_map['directElevation']])
                
                # Cadence
                if 'directBikeCadence' in key_map:
                    charts['cadence'].append(row[key_map['directBikeCadence']])
                elif 'directRunCadence' in key_map:
                    charts['cadence'].append(row[key_map['directRunCadence']])
                elif 'directDoubleCadence' in key_map:
                    charts['cadence'].append(row[key_map['directDoubleCadence']])
                elif 'directFractionalCadence' in key_map:
                    charts['cadence'].append(row[key_map['directFractionalCadence']])

                # Power
                if 'directPower' in key_map:
                    charts['power'].append(row[key_map['directPower']])
                
                # Distance (meters)
                if 'sumDistance' in key_map:
                    charts['distance'].append(row[key_map['sumDistance']])

        # Summary stats from DTO
        summary = details.get('summaryDTO')
        if not summary or not isinstance(summary, dict) or len(summary) < 5:
            # If summary in details is missing or small, try the main activity info
            summary = activity_info.get('summaryDTO', summary or {})
        avg_speed = summary.get('averageSpeed') # m/s
        avg_pace_str = "--"
        if avg_speed and avg_speed > 0.1:
            pace_seconds = 1609.34 / avg_speed
            avg_pace_str = f"{int(pace_seconds//60)}:{int(pace_seconds%60):02d}"

        # Distance calculation
        splits = []
        if 'sumDuration' in key_map and 'sumDistance' in key_map:
            mile_in_meters = 1609.34
            next_mile = 1
            last_duration = 0
            last_dist = 0
            
            for i in range(len(metrics_list)):
                m_row = metrics_list[i].get('metrics', [])
                dist_m = m_row[key_map['sumDistance']] if len(m_row) > key_map['sumDistance'] else 0
                dist_mi = dist_m / mile_in_meters
                
                if dist_mi >= next_mile:
                    curr_duration = m_row[key_map['sumDuration']] if len(m_row) > key_map['sumDuration'] else 0
                    split_duration = curr_duration - last_duration
                    splits.append({
                        'mile': next_mile,
                        'duration': split_duration, 
                        'pace_str': f"{int(split_duration//60)}:{int(split_duration%60):02d}"
                    })
                    last_duration = curr_duration
                    last_dist = dist_m
                    next_mile += 1
            
            # Add final partial mile if it's significant
            if metrics_list:
                final_row = metrics_list[-1].get('metrics', [])
                final_dist_m = final_row[key_map['sumDistance']] if len(final_row) > key_map['sumDistance'] else 0
                final_duration = final_row[key_map['sumDuration']] if len(final_row) > key_map['sumDuration'] else 0
                if final_dist_m > last_dist:
                    diff_m = final_dist_m - last_dist
                    diff_mi = diff_m / mile_in_meters
                    diff_duration = final_duration - last_duration
                    if diff_mi > 0.05: # Only if more than 0.05 miles left
                        pace_per_mile = diff_duration / diff_mi
                        splits.append({
                            'mile': round((next_mile - 1) + diff_mi, 2),
                            'duration': diff_duration,
                            'pace_str': f"{int(pace_per_mile//60)}:{int(pace_per_mile%60):02d}"
                        })

        return jsonify({
            'activityId': activity_id,
            'charts': charts,
            'summary': summary,
            'splits': splits,
            'avg_pace_str': avg_pace_str
        })
    except Exception as e:
        logger.error(f"Error fetching activity details: {e}")
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
        timestamp = datetime.now().isoformat()
        
        client.add_body_composition(timestamp, float(weight))
        
        return jsonify({'status': 'success', 'message': 'Weight added successfully'})

    except Exception as e:
        logger.error(f"Error adding weight: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/activity_heatmap')
def get_activity_heatmap():
    try:
        client = get_garmin_client()
        today = date.today()
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

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
