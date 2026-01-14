import os
import logging
from flask import Flask, render_template, jsonify, request
from garminconnect import Garmin
from datetime import date, timedelta
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

@app.route('/')
def index():
    return render_template('index.html')

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
        current_day = today.timetuple().tm_yday
        
        # Build daily cumulative data for each year
        cycling_daily_data = {}
        running_daily_data = {}
        
        for year in [2024, 2025, 2026]:
            cycle_cumulative = []
            run_cumulative = []
            cumulative_cycle_miles = 0
            cumulative_run_miles = 0
            
            # For each day from Jan 1 to current day of year
            for day_num in range(1, current_day + 1):
                try:
                    # Calculate the date for this day number
                    current_date = date(year, 1, 1) + timedelta(days=day_num - 1)
                    
                    # Skip future dates
                    if current_date > date.today():
                        break
                    
                    # Fetch data for this single day
                    summary = client.get_progress_summary_between_dates(
                        current_date.isoformat(), 
                        current_date.isoformat()
                    )
                    
                    day_cycle_cm = 0
                    day_run_cm = 0
                    for item in summary:
                        stats = item.get('stats', {})
                        # Cycling
                        if 'cycling' in stats:
                            day_cycle_cm += stats['cycling'].get('distance', {}).get('sum', 0)
                        # Running
                        if 'running' in stats:
                            day_run_cm += stats['running'].get('distance', {}).get('sum', 0)
                    
                    # Add to cumulative totals
                    cumulative_cycle_miles += day_cycle_cm * 0.00000621371
                    cumulative_run_miles += day_run_cm * 0.00000621371
                    
                    cycle_cumulative.append(round(cumulative_cycle_miles, 1))
                    run_cumulative.append(round(cumulative_run_miles, 1))
                    
                except Exception as e:
                    logger.warning(f"Error fetching data for {year}-{day_num}: {e}")
                    # Use previous values if error
                    cycle_cumulative.append(cycle_cumulative[-1] if cycle_cumulative else 0)
                    run_cumulative.append(run_cumulative[-1] if run_cumulative else 0)
            
            cycling_daily_data[str(year)] = cycle_cumulative
            running_daily_data[str(year)] = run_cumulative
        
        # Calculate goal lines
        cycle_goal = float(os.getenv('YEARLY_CYCLING_GOAL', 5000))
        run_goal = float(os.getenv('YEARLY_RUNNING_GOAL', 365))
        
        cycle_goal_increment = cycle_goal / 365
        run_goal_increment = run_goal / 365
        
        cycle_goal_line = [round(cycle_goal_increment * (i + 1), 1) for i in range(current_day)]
        run_goal_line = [round(run_goal_increment * (i + 1), 1) for i in range(current_day)]
        
        # Create day labels
        day_labels = [f"Day {i+1}" for i in range(current_day)]
        
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

@app.route('/api/weight_history')
def get_weight_history():
    try:
        range_val = request.args.get('range', '1m')
        client = get_garmin_client()
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

@app.route('/api/activity/<int:activity_id>')
def get_activity_details(activity_id):
    try:
        client = get_garmin_client()
        details = client.get_activity_details(activity_id)
        
        # Extract metrics and descriptors
        descriptors = details.get('metricDescriptors', [])
        metrics_list = details.get('activityDetailMetrics', [])
        
        # Create a mapping of key to index
        key_map = {d['key']: d['metricsIndex'] for d in descriptors}
        
        charts = {
            'heart_rate': [],
            'speed': [],
            'elevation': [],
            'timestamps': []
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

        return jsonify({
            'activityId': activity_id,
            'charts': charts,
            'summary': details.get('summaryDTO', {}) # Basic summary like avgHR, maxHR, etc.
        })
    except Exception as e:
        logger.error(f"Error fetching activity details: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
