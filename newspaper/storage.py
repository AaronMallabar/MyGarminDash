import json
import os
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

try:
    EST = ZoneInfo("America/New_York")
except Exception:
    EST = timezone(timedelta(hours=-5))

BASE_DIR = os.path.join("garmin_cache", "newspaper")
EDITIONS_DIR = os.path.join(BASE_DIR, "editions")
SETTINGS_FILE = os.path.join(BASE_DIR, "editorial_settings.json")
CLIPS_FILE = os.path.join(BASE_DIR, "archive_clips.json")
HISTORY_FILE = os.path.join(BASE_DIR, "covered_topics.json")

_storage_lock = threading.RLock()

DEFAULT_EDITORIAL_SETTINGS = {
    "masthead_title": "The Daily Dispatch",
    "masthead_subtitle": "All the News & Curiosity Fit to Print — Personal Edition",
    "local_location": "",
    "weather_lat": None,
    "weather_lon": None,
    "sports_interests": ["Cycling", "Endurance Sports", "NFL", "NBA", "MLB"],
    "curiosity_topics": [
        "How Things Work",
        "Mental Models & Psychology",
        "Hidden History",
        "Science & Space Breakthroughs",
        "Engineering Marvels",
        "Economics & Philosophy",
        "Human Physiology",
    ],
    "custom_prompt": "",
    "custom_rss_feeds": [],
    "liked_topics": [],
    "disliked_topics": [],
    "enabled_comics": ["xkcd", "calvinandhobbes", "peanuts", "garfield"],
    "ai_model": "gemini-3.5-flash",
}


def get_today_str():
    """Return today's date string (YYYY-MM-DD) in Eastern Time."""
    return datetime.now(EST).date().isoformat()


def _ensure_dirs():
    os.makedirs(BASE_DIR, exist_ok=True)
    os.makedirs(EDITIONS_DIR, exist_ok=True)


def _read_json(path, default):
    with _storage_lock:
        if not os.path.exists(path):
            return default() if callable(default) else default
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data
        except Exception:
            return default() if callable(default) else default


def _write_json(path, data):
    with _storage_lock:
        _ensure_dirs()
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        tmp_path = f"{path}.{uuid.uuid4().hex[:8]}.tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            os.replace(tmp_path, path)
            return True
        except Exception:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
            raise


def load_editorial_settings():
    """Load editorial settings merged with defaults."""
    saved = _read_json(SETTINGS_FILE, dict)
    merged = dict(DEFAULT_EDITORIAL_SETTINGS)
    if isinstance(saved, dict):
        for k, v in saved.items():
            merged[k] = v
    return merged


def save_editorial_settings(data):
    """Validate and save editorial settings."""
    current = load_editorial_settings()
    if not isinstance(data, dict):
        return current

    string_fields = ["masthead_title", "masthead_subtitle", "local_location", "custom_prompt", "ai_model"]
    for field in string_fields:
        if field in data and data[field] is not None:
            current[field] = str(data[field]).strip()

    for coord in ["weather_lat", "weather_lon"]:
        if coord in data:
            val = data[coord]
            if val in (None, "", "null"):
                current[coord] = None
            else:
                try:
                    current[coord] = float(val)
                except (TypeError, ValueError):
                    pass

    list_fields = ["sports_interests", "curiosity_topics", "liked_topics", "disliked_topics", "enabled_comics"]
    for field in list_fields:
        if field in data and isinstance(data[field], list):
            cleaned = [str(item).strip() for item in data[field] if str(item).strip()]
            current[field] = cleaned

    if "custom_rss_feeds" in data and isinstance(data["custom_rss_feeds"], list):
        cleaned_feeds = []
        for feed in data["custom_rss_feeds"]:
            if isinstance(feed, dict) and feed.get("url"):
                cleaned_feeds.append({
                    "name": str(feed.get("name") or "Custom Feed").strip(),
                    "url": str(feed.get("url")).strip(),
                    "section": str(feed.get("section") or "global").strip().lower(),
                })
        current["custom_rss_feeds"] = cleaned_feeds

    _write_json(SETTINGS_FILE, current)
    return current


def _edition_path(date_str):
    safe_date = "".join(ch for ch in str(date_str) if ch.isdigit() or ch == "-")[:10]
    return os.path.join(EDITIONS_DIR, f"{safe_date}.json")


def get_edition(date_str):
    """Load a cached daily edition by YYYY-MM-DD."""
    path = _edition_path(date_str)
    data = _read_json(path, None)
    return data if isinstance(data, dict) else None


def save_edition(date_str, edition_data):
    """Save a daily edition to disk."""
    path = _edition_path(date_str)
    _write_json(path, edition_data)
    return edition_data


def set_edition_archived(date_str, archived=True, note=None):
    """Mark an existing edition as starred/archived with an optional note."""
    edition = get_edition(date_str)
    if not edition:
        return None
    edition["archived"] = bool(archived)
    if note is not None:
        edition["archive_note"] = str(note).strip()
    edition["archived_at"] = datetime.now(EST).isoformat() if archived else None
    save_edition(date_str, edition)
    return edition


def list_archived_editions():
    """Return sorted metadata for all saved daily editions (newest first)."""
    _ensure_dirs()
    editions = []
    with _storage_lock:
        if not os.path.exists(EDITIONS_DIR):
            return []
        files = sorted(
            [f for f in os.listdir(EDITIONS_DIR) if f.endswith(".json")],
            reverse=True,
        )
    for fname in files:
        fpath = os.path.join(EDITIONS_DIR, fname)
        data = _read_json(fpath, None)
        if not isinstance(data, dict):
            continue
        sections = data.get("sections") or {}
        article_count = sum(
            len(sec.get("articles") or [])
            for sec in sections.values()
            if isinstance(sec, dict)
        )
        lead = data.get("lead_story") or {}
        editions.append({
            "date": data.get("date") or fname.replace(".json", ""),
            "date_display": data.get("date_display") or fname.replace(".json", ""),
            "issue_number": data.get("issue_number") or "",
            "lead_headline": lead.get("headline") or "Daily Edition",
            "article_count": article_count,
            "deep_dive_count": len(data.get("deep_dives") or []),
            "archived": bool(data.get("archived", False)),
            "archive_note": data.get("archive_note") or "",
            "generated_at": data.get("generated_at") or "",
        })
    return editions


def get_clips():
    """Return all saved archive clippings (newest first)."""
    clips = _read_json(CLIPS_FILE, list)
    if not isinstance(clips, list):
        return []
    return sorted(clips, key=lambda c: c.get("clipped_at", ""), reverse=True)


def save_clip(clip_item):
    """Save a new clipping to archive_clips.json."""
    if not isinstance(clip_item, dict):
        raise ValueError("Clip item must be a JSON object")

    with _storage_lock:
        clips = _read_json(CLIPS_FILE, list)
        if not isinstance(clips, list):
            clips = []

        tags = clip_item.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        elif isinstance(tags, list):
            tags = [str(t).strip() for t in tags if str(t).strip()]
        else:
            tags = []

        new_clip = {
            "id": uuid.uuid4().hex[:12],
            "title": str(clip_item.get("title") or "Untitled Clipping").strip(),
            "summary": str(clip_item.get("summary") or "").strip(),
            "content": clip_item.get("content") or "",
            "url": str(clip_item.get("url") or "").strip(),
            "source": str(clip_item.get("source") or "The Daily Dispatch").strip(),
            "section": str(clip_item.get("section") or "general").strip(),
            "edition_date": str(clip_item.get("edition_date") or get_today_str()).strip(),
            "notes": str(clip_item.get("notes") or "").strip(),
            "tags": tags,
            "image": str(clip_item.get("image") or "").strip(),
            "clipped_at": datetime.now(EST).isoformat(),
            "timestamp": time.time(),
        }
        clips.insert(0, new_clip)
        _write_json(CLIPS_FILE, clips)
        return new_clip


def update_clip(clip_id, notes=None, tags=None):
    """Update notes and/or tags on an existing clipping."""
    with _storage_lock:
        clips = _read_json(CLIPS_FILE, list)
        if not isinstance(clips, list):
            return None
        updated = None
        for c in clips:
            if c.get("id") == clip_id:
                if notes is not None:
                    c["notes"] = str(notes).strip()
                if tags is not None:
                    if isinstance(tags, str):
                        c["tags"] = [t.strip() for t in tags.split(",") if t.strip()]
                    elif isinstance(tags, list):
                        c["tags"] = [str(t).strip() for t in tags if str(t).strip()]
                c["updated_at"] = datetime.now(EST).isoformat()
                updated = c
                break
        if updated is not None:
            _write_json(CLIPS_FILE, clips)
        return updated


def delete_clip(clip_id):
    """Delete a clipping by ID."""
    with _storage_lock:
        clips = _read_json(CLIPS_FILE, list)
        if not isinstance(clips, list):
            return False
        new_clips = [c for c in clips if c.get("id") != clip_id]
        if len(new_clips) == len(clips):
            return False
        _write_json(CLIPS_FILE, new_clips)
        return True


def load_topic_history():
    """Load covered deep-dive titles and user topic feedback history."""
    data = _read_json(HISTORY_FILE, dict)
    if not isinstance(data, dict):
        data = {}
    data.setdefault("covered_deep_dives", [])
    data.setdefault("feedback_log", [])
    return data


def record_covered_deep_dives(titles):
    """Append newly covered deep-dive titles so AI avoids repeating them."""
    if not titles:
        return
    with _storage_lock:
        hist = load_topic_history()
        existing = list(hist.get("covered_deep_dives") or [])
        for t in titles:
            t_clean = str(t).strip()
            if t_clean and t_clean not in existing:
                existing.append(t_clean)
        hist["covered_deep_dives"] = existing[-100:]
        _write_json(HISTORY_FILE, hist)


def record_topic_feedback(topic, title, sentiment):
    """Record thumbs-up ('like') or thumbs-down ('dislike') on a topic/article."""
    if sentiment not in ("like", "dislike"):
        raise ValueError("sentiment must be 'like' or 'dislike'")

    topic_clean = str(topic or "").strip()
    title_clean = str(title or "").strip()

    with _storage_lock:
        hist = load_topic_history()
        log = list(hist.get("feedback_log") or [])
        log.append({
            "topic": topic_clean,
            "title": title_clean,
            "sentiment": sentiment,
            "timestamp": datetime.now(EST).isoformat(),
        })
        hist["feedback_log"] = log[-200:]
        _write_json(HISTORY_FILE, hist)

        settings = load_editorial_settings()
        liked = list(settings.get("liked_topics") or [])
        disliked = list(settings.get("disliked_topics") or [])

        label = topic_clean or title_clean[:60]
        if label:
            if sentiment == "like":
                if label in disliked:
                    disliked.remove(label)
                if label not in liked:
                    liked.append(label)
            else:
                if label in liked:
                    liked.remove(label)
                if label not in disliked:
                    disliked.append(label)

            settings["liked_topics"] = liked[-40:]
            settings["disliked_topics"] = disliked[-40:]
            _write_json(SETTINGS_FILE, settings)

    return {"liked_topics": settings.get("liked_topics", []), "disliked_topics": settings.get("disliked_topics", [])}
