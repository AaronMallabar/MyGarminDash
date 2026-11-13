import logging
import os
from functools import wraps
from flask import current_app, jsonify, redirect, render_template, request, session, url_for

from . import engine, storage

logger = logging.getLogger(__name__)

from . import newspaper_bp


def newspaper_login_required(f):
    """Mirror MyGarminDash session/token authentication without importing app.py."""
    @wraps(f)
    def decorated(*args, **kwargs):
        api_key = (
            request.args.get("key")
            or request.args.get("token")
            or request.args.get("api_key")
            or request.headers.get("X-API-Key")
        )
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            api_key = auth_header.split(" ", 1)[1].strip()

        app_password = os.getenv("APP_PASSWORD", "admin")
        flask_secret = os.getenv("FLASK_SECRET_KEY") or current_app.secret_key
        if api_key and (api_key == app_password or (flask_secret and api_key == flask_secret)):
            session["logged_in"] = True
            return f(*args, **kwargs)

        if not session.get("logged_in"):
            if request.is_json or "/api/" in request.path:
                return jsonify({
                    "error": "Unauthorized",
                    "message": "Authentication required. Pass session cookie or ?key=APP_PASSWORD",
                }), 401
            return redirect(url_for("login", next=request.url))
        return f(*args, **kwargs)

    return decorated


@newspaper_bp.route("/")
@newspaper_login_required
def index():
    settings = storage.load_editorial_settings()
    return render_template(
        "newspaper/index.html",
        masthead_title=settings.get("masthead_title", "The Daily Dispatch"),
        masthead_subtitle=settings.get("masthead_subtitle", "All the News & Curiosity Fit to Print"),
    )


@newspaper_bp.route("/api/edition", methods=["GET"])
@newspaper_login_required
def get_edition():
    date_param = (request.args.get("date") or "").strip()
    refresh = request.args.get("refresh", "").lower() in ("1", "true", "yes")
    today_str = storage.get_today_str()

    try:
        if date_param and date_param != today_str:
            edition = storage.get_edition(date_param)
            if not edition:
                return jsonify({"error": f"No cached edition found for {date_param}"}), 404
            edition["is_past_edition"] = True
            return jsonify(edition)

        edition = engine.build_daily_edition(force_refresh=refresh)
        edition["is_past_edition"] = False
        return jsonify(edition)
    except Exception as e:
        logger.error(f"Error getting newspaper edition: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@newspaper_bp.route("/api/edition/archive", methods=["POST"])
@newspaper_login_required
def archive_edition():
    try:
        data = request.get_json() or {}
        date_str = data.get("date") or storage.get_today_str()
        archived = data.get("archived", True)
        note = data.get("note")
        edition = storage.set_edition_archived(date_str, archived=archived, note=note)
        if not edition:
            return jsonify({"error": f"Edition {date_str} not found"}), 404
        return jsonify({"success": True, "date": date_str, "archived": edition["archived"], "archive_note": edition.get("archive_note", "")})
    except Exception as e:
        logger.error(f"Error archiving edition: {e}")
        return jsonify({"error": str(e)}), 500


@newspaper_bp.route("/api/archive", methods=["GET"])
@newspaper_login_required
def get_archive():
    try:
        clips = storage.get_clips()
        editions = storage.list_archived_editions()
        return jsonify({"clips": clips, "editions": editions})
    except Exception as e:
        logger.error(f"Error loading archive: {e}")
        return jsonify({"error": str(e)}), 500


@newspaper_bp.route("/api/clips", methods=["POST"])
@newspaper_login_required
def create_clip():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No clipping data provided"}), 400
        clip = storage.save_clip(data)
        return jsonify({"success": True, "clip": clip}), 201
    except Exception as e:
        logger.error(f"Error saving clip: {e}")
        return jsonify({"error": str(e)}), 500


@newspaper_bp.route("/api/clips/<clip_id>", methods=["PUT"])
@newspaper_login_required
def update_clip_route(clip_id):
    try:
        data = request.get_json() or {}
        updated = storage.update_clip(clip_id, notes=data.get("notes"), tags=data.get("tags"))
        if not updated:
            return jsonify({"error": "Clipping not found"}), 404
        return jsonify({"success": True, "clip": updated})
    except Exception as e:
        logger.error(f"Error updating clip {clip_id}: {e}")
        return jsonify({"error": str(e)}), 500


@newspaper_bp.route("/api/clips/<clip_id>", methods=["DELETE"])
@newspaper_login_required
def delete_clip_route(clip_id):
    try:
        deleted = storage.delete_clip(clip_id)
        if not deleted:
            return jsonify({"error": "Clipping not found"}), 404
        return jsonify({"success": True, "id": clip_id})
    except Exception as e:
        logger.error(f"Error deleting clip {clip_id}: {e}")
        return jsonify({"error": str(e)}), 500


@newspaper_bp.route("/api/feedback", methods=["POST"])
@newspaper_login_required
def submit_feedback():
    try:
        data = request.get_json() or {}
        sentiment = data.get("sentiment")
        topic = data.get("topic") or data.get("section") or ""
        title = data.get("title") or ""
        if sentiment not in ("like", "dislike"):
            return jsonify({"error": "sentiment must be 'like' or 'dislike'"}), 400
        res = storage.record_topic_feedback(topic, title, sentiment)
        return jsonify({"success": True, **res})
    except Exception as e:
        logger.error(f"Error recording feedback: {e}")
        return jsonify({"error": str(e)}), 500


@newspaper_bp.route("/api/deep_dive", methods=["POST"])
@newspaper_login_required
def create_deep_dive():
    try:
        data = request.get_json() or {}
        topic_query = data.get("topic") or ""
        date_str = data.get("date") or storage.get_today_str()
        settings = storage.load_editorial_settings()
        dive = engine.generate_custom_deep_dive(topic_query, settings, date_str=date_str)
        return jsonify({"success": True, "deep_dive": dive})
    except Exception as e:
        logger.error(f"Error generating deep dive: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@newspaper_bp.route("/api/shuffle_wikipedia", methods=["POST"])
@newspaper_login_required
def shuffle_wikipedia():
    try:
        data = request.get_json() or {}
        date_str = data.get("date") or storage.get_today_str()
        articles = engine.fetch_random_wikipedia_articles(3)
        edition = storage.get_edition(date_str)
        if edition and articles:
            wiki = edition.get("wikipedia") or {}
            wiki["random_articles"] = articles
            edition["wikipedia"] = wiki
            storage.save_edition(date_str, edition)
        return jsonify({"success": True, "random_articles": articles})
    except Exception as e:
        logger.error(f"Error shuffling Wikipedia articles: {e}")
        return jsonify({"error": str(e)}), 500


@newspaper_bp.route("/api/settings", methods=["GET", "POST"])
@newspaper_login_required
def editorial_settings():
    if request.method == "GET":
        settings = storage.load_editorial_settings()
        return jsonify(settings)
    try:
        data = request.get_json() or {}
        saved = storage.save_editorial_settings(data)
        return jsonify({"success": True, "settings": saved})
    except Exception as e:
        logger.error(f"Error saving editorial settings: {e}")
        return jsonify({"error": str(e)}), 500
