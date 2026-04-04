import time
import logging

logger = logging.getLogger(__name__)

def get_max_power_peaks(powers, times, original_indices):
    # Returns a dict of best powers: { "5": {"value": X, "start": Y, "end": Z}, ... }
    windows = [5, 30, 60, 120, 300, 600, 1200, 1800, 3600]
    bests = {str(w): {"value": 0, "start": 0, "end": 0} for w in windows}
    if not powers or not times: return bests
    
    for w in windows:
        window_ms = w * 1000
        max_avg = 0
        best_left = 0
        best_right = 0
        left = 0
        current_sum = 0
        for right in range(len(powers)):
            current_sum += powers[right]
            while times[right] - times[left] > window_ms and left < right:
                current_sum -= powers[left]
                left += 1
            if times[right] - times[left] >= window_ms - 2000:
                count = right - left + 1
                if count > 0:
                    avg = current_sum / count
                    if avg > max_avg:
                        max_avg = avg
                        best_left = original_indices[left]
                        best_right = original_indices[right]
        bests[str(w)] = {
            "value": round(max_avg),
            "start": best_left,
            "end": best_right
        }
    return bests

def get_fastest_paces(dists, times, original_indices):
    # Target dists: 1mi(1609.34), 5k(5000), 5mi(8046.72)
    targets = {'1mi': 1609.34, '5k': 5000, '5mi': 8046.72}
    bests = {k: {"value": None, "start": 0, "end": 0} for k in targets.keys()}
    if not dists or not times: return bests
    
    for k, target_m in targets.items():
        min_time = float('inf')
        best_left = 0
        best_right = 0
        left = 0
        for right in range(len(dists)):
            while dists[right] - dists[left] >= target_m:
                time_diff = times[right] - times[left]
                if time_diff < min_time:
                    min_time = time_diff
                    best_left = original_indices[left]
                    best_right = original_indices[right]
                left += 1
        bests[k] = {
            "value": round(min_time / 1000) if min_time != float('inf') else None,
            "start": best_left,
            "end": best_right
        }
    return bests

def pb_parse_activity_details(details):
    # Returns a tuple of (power_bests_dict, pace_bests_dict)
    if not details:
        return {}, {}
        
    keys = details.get('metricDescriptors', [])
    key_map = {d['key']: d['metricsIndex'] for d in keys if 'key' in d and 'metricsIndex' in d}
    
    p_idx = key_map.get('directPower')
    d_idx = key_map.get('sumDistance')
    t_idx = key_map.get('directTimestamp')
    
    metrics = details.get('activityDetailMetrics', [])
    
    powers = []
    ptimes = []
    p_orig_idx = []
    
    dists = []
    dtimes = []
    d_orig_idx = []
    
    for i, m in enumerate(metrics):
        vals = m.get('metrics', [])
        # Extract power
        if p_idx is not None and t_idx is not None and p_idx < len(vals) and t_idx < len(vals):
            p = vals[p_idx]
            t = vals[t_idx]
            if p is not None and t is not None:
                powers.append(p)
                ptimes.append(t)
                p_orig_idx.append(i)
                
        # Extract distance
        if d_idx is not None and t_idx is not None and d_idx < len(vals) and t_idx < len(vals):
            d = vals[d_idx]
            t = vals[t_idx]
            if d is not None and t is not None:
                dists.append(d)
                dtimes.append(t)
                d_orig_idx.append(i)
                
    power_bests = get_max_power_peaks(powers, ptimes, p_orig_idx)
    pace_bests = get_fastest_paces(dists, dtimes, d_orig_idx)
    
    return power_bests, pace_bests
