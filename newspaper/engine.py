import base64
import glob
import html
import json
import logging
import os
import re
import ssl
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

from google import genai
from google.genai import types

from . import storage

logger = logging.getLogger(__name__)

try:
    EST = ZoneInfo("America/New_York")
except Exception:
    EST = timezone(timedelta(hours=-5))
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

SECTION_META = {
    "global": {"title": "Global News", "kicker": "WORLD DESK", "description": "International affairs, diplomacy, and dispatches from abroad."},
    "national": {"title": "National News", "kicker": "NATIONAL DESK", "description": "Major domestic developments, economy, and society."},
    "politics": {"title": "Politics & Policy", "kicker": "CAPITOL BUREAU", "description": "Legislation, governance, elections, and public policy."},
    "local": {"title": "Local Dispatch", "kicker": "METRO & REGIONAL", "description": "News and happenings close to home."},
    "sports": {"title": "Sports Pages", "kicker": "ATHLETICS & ARENA", "description": "Endurance, cycling, pro leagues, and scoreboards."},
    "scitech": {"title": "Science & Tech", "kicker": "DISCOVERY & SILICON", "description": "Research breakthroughs, engineering, space, and computing."},
    "opinions": {"title": "Opinions & Essays", "kicker": "EDITORIAL & IDEAS", "description": "Longform commentary, philosophy, and cultural criticism."},
}

DEFAULT_FEEDS = {
    "global": [
        ("BBC World", "http://feeds.bbci.co.uk/news/world/rss.xml"),
        ("NPR World", "https://feeds.npr.org/1004/rss.xml"),
        ("The Guardian World", "https://www.theguardian.com/world/rss"),
    ],
    "national": [
        ("NPR National", "https://feeds.npr.org/1003/rss.xml"),
        ("PBS NewsHour", "https://www.pbs.org/newshour/feeds/rss/headlines"),
    ],
    "politics": [
        ("NPR Politics", "https://feeds.npr.org/1014/rss.xml"),
        ("The Hill", "https://thehill.com/homenews/feed/"),
    ],
    "sports": [
        ("ESPN Top News", "https://www.espn.com/espn/rss/news"),
    ],
    "scitech": [
        ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"),
        ("ScienceDaily", "https://www.sciencedaily.com/rss/top/science.xml"),
        ("Hacker News", "https://hnrss.org/frontpage?count=8"),
    ],
    "opinions": [
        ("Aeon Magazine", "https://aeon.co/feed.rss"),
        ("The Guardian Opinion", "https://www.theguardian.com/uk/commentisfree/rss"),
        ("Astral Codex Ten", "https://www.astralcodexten.com/feed"),
    ],
}

COMIC_META = {
    "xkcd": {"name": "XKCD", "creator": "Randall Munroe", "home": "https://xkcd.com/"},
    "calvinandhobbes": {"name": "Calvin and Hobbes", "creator": "Bill Watterson", "home": "https://www.gocomics.com/calvinandhobbes"},
    "peanuts": {"name": "Peanuts", "creator": "Charles M. Schulz", "home": "https://www.gocomics.com/peanuts"},
    "garfield": {"name": "Garfield", "creator": "Jim Davis", "home": "https://www.gocomics.com/garfield"},
}

WMO_WEATHER_CODES = {
    0: ("Clear Sky", "☀️"),
    1: ("Mainly Clear", "🌤️"),
    2: ("Partly Cloudy", "⛅"),
    3: ("Overcast", "☁️"),
    45: ("Foggy", "🌫️"),
    48: ("Rime Fog", "🌫️"),
    51: ("Light Drizzle", "🌦️"),
    53: ("Drizzle", "🌦️"),
    55: ("Dense Drizzle", "🌧️"),
    61: ("Light Rain", "🌧️"),
    63: ("Moderate Rain", "🌧️"),
    65: ("Heavy Rain", "🌧️"),
    71: ("Light Snow", "🌨️"),
    73: ("Snow", "❄️"),
    75: ("Heavy Snow", "❄️"),
    80: ("Rain Showers", "🌦️"),
    81: ("Showers", "🌧️"),
    82: ("Heavy Showers", "⛈️"),
    95: ("Thunderstorm", "⛈️"),
    96: ("Thunderstorm & Hail", "⛈️"),
    99: ("Severe Thunderstorm", "⛈️"),
}


try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    cffi_requests = None

PAYWALLED_DOMAINS = {
    "nytimes.com",
    "wsj.com",
    "washingtonpost.com",
    "bloomberg.com",
    "ft.com",
    "economist.com",
    "newyorker.com",
    "theathletic.com",
    "theatlantic.com",
    "wired.com",
    "businessinsider.com",
    "insider.com",
    "barrons.com",
    "telegraph.co.uk",
    "thetimes.co.uk",
    "latimes.com",
    "bostonglobe.com",
    "chicagotribune.com",
    "sfchronicle.com",
    "houstonchronicle.com",
    "dallasnews.com",
    "seattletimes.com",
    "miamiherald.com",
    "star-telegram.com",
    "sacbee.com",
    "charlotteobserver.com",
    "kansascity.com",
    "indystar.com",
    "azcentral.com",
    "freep.com",
    "jsonline.com",
    "baltimoresun.com",
    "courant.com",
    "nydailynews.com",
    "newsday.com",
    "theinformation.com",
    "foreignaffairs.com",
    "foreignpolicy.com",
    "scientificamerican.com",
    "technologyreview.com",
    "hbr.org",
    "seekingalpha.com",
    "statnews.com",
    "marketwatch.com",
    "fortune.com",
    "forbes.com",
}

PAYWALLED_SOURCES = {
    "new york times",
    "the new york times",
    "wall street journal",
    "the wall street journal",
    "washington post",
    "the washington post",
    "bloomberg",
    "financial times",
    "the economist",
    "the new yorker",
    "new yorker",
    "the athletic",
    "the atlantic",
    "wired",
    "business insider",
    "barron's",
    "the telegraph",
    "the times",
    "los angeles times",
    "boston globe",
    "the boston globe",
    "chicago tribune",
    "san francisco chronicle",
    "houston chronicle",
    "dallas morning news",
    "the dallas morning news",
    "seattle times",
    "the seattle times",
    "miami herald",
    "scientific american",
    "mit technology review",
    "harvard business review",
    "stat",
    "fortune",
    "forbes",
}


def _host_matches_paywall(url):
    if not url:
        return False
    try:
        host = urllib.parse.urlparse(str(url).strip()).netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        if not host:
            return False
        return any(host == dom or host.endswith(f".{dom}") for dom in PAYWALLED_DOMAINS)
    except Exception:
        return False


def _is_paywalled(url, source_name="", source_url=""):
    """Return True if URL, source_url, or source_name belongs to a known paywalled outlet."""
    if _host_matches_paywall(url) or _host_matches_paywall(source_url):
        return True
    src = re.sub(r"\s+", " ", str(source_name or "")).strip().lower()
    if src and src in PAYWALLED_SOURCES:
        return True
    if any(ps in src for ps in ("new york times", "wall street journal", "washington post", "bloomberg", "financial times", "the athletic", "boston globe", "los angeles times")):
        return True
    return False


def _parse_pub_date(pub_str):
    """Parse RSS/Atom timestamp string into a timezone-aware UTC datetime, or None."""
    if not pub_str:
        return None
    s = str(pub_str).strip()
    if not s:
        return None
    try:
        dt = parsedate_to_datetime(s)
        if dt is not None:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
    except Exception:
        pass
    try:
        iso = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _http_get(url, timeout=8, extra_headers=None):
    if cffi_requests is not None:
        try:
            resp = cffi_requests.get(
                url,
                impersonate="chrome",
                timeout=timeout,
                headers=extra_headers or None,
                allow_redirects=True,
            )
            if resp.status_code < 400:
                return resp.content
        except Exception as e:
            logger.debug(f"curl_cffi request failed for {url}, falling back to urllib: {e}")

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
    }
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _http_get_json(url, timeout=8, extra_headers=None):
    raw = _http_get(url, timeout=timeout, extra_headers=extra_headers)
    return json.loads(raw.decode("utf-8", errors="replace"))


def _clean_html(raw_text, max_len=350):
    if not raw_text:
        return ""
    text = html.unescape(str(raw_text))
    text = re.sub(r"<script[^>]*>.*?</script>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if max_len and len(text) > max_len:
        cut = text[:max_len].rsplit(" ", 1)[0]
        return f"{cut}..."
    return text


def _local_tag(tag_name):
    if "}" in tag_name:
        return tag_name.split("}", 1)[1].lower()
    return tag_name.lower()


def _child_text(elem, candidate_names):
    names = {n.lower() for n in candidate_names}
    for child in elem:
        if _local_tag(child.tag) in names and child.text:
            return child.text.strip()
    return ""


def _extract_media_image(elem):
    for child in elem.iter():
        lt = _local_tag(child.tag)
        if lt in ("content", "thumbnail"):
            url = child.attrib.get("url")
            if url and url.startswith("http"):
                return url
        if lt == "enclosure":
            mtype = child.attrib.get("type", "")
            url = child.attrib.get("url", "")
            if url.startswith("http") and ("image" in mtype or any(url.lower().endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp"))):
                return url
    return ""


def fetch_rss_feed(url, source_name, max_items=8, max_age_days=7, require_recent_date=False):
    """Fetch and parse an RSS 2.0 or Atom feed into normalized, recent, non-paywalled article dicts."""
    articles = []
    try:
        raw = _http_get(url, timeout=8)
        root = ET.fromstring(raw)
        root_tag = _local_tag(root.tag)

        items = []
        if root_tag == "feed":
            items = [c for c in root if _local_tag(c.tag) == "entry"]
        else:
            channel = next((c for c in root if _local_tag(c.tag) == "channel"), None)
            if channel is not None:
                items = [c for c in channel if _local_tag(c.tag) == "item"]
            else:
                items = [c for c in root.iter() if _local_tag(c.tag) == "item"]

        now_utc = datetime.now(timezone.utc)

        for idx, item in enumerate(items):
            if len(articles) >= max_items:
                break

            title = _clean_html(_child_text(item, ["title"]), max_len=200)
            if not title:
                continue

            link = _child_text(item, ["link"])
            if not link:
                for child in item:
                    if _local_tag(child.tag) == "link":
                        rel = child.attrib.get("rel", "alternate")
                        href = child.attrib.get("href")
                        if href and rel in ("alternate", ""):
                            link = href.strip()
                            break
                if not link:
                    for child in item:
                        if _local_tag(child.tag) == "link" and child.attrib.get("href"):
                            link = child.attrib["href"].strip()
                            break

            # Extract Google News embedded source + source url if present
            item_source = source_name
            source_url = ""
            for child in item:
                if _local_tag(child.tag) == "source":
                    if child.text and child.text.strip():
                        item_source = child.text.strip()
                    if child.attrib.get("url"):
                        source_url = child.attrib.get("url", "").strip()
                    break

            if _is_paywalled(link, item_source, source_url):
                continue

            pub_date = _child_text(item, ["pubDate", "published", "updated", "date"])
            pub_dt = _parse_pub_date(pub_date)
            if max_age_days is not None:
                if pub_dt is not None:
                    if (now_utc - pub_dt).total_seconds() > max_age_days * 86400:
                        continue
                elif require_recent_date:
                    continue

            # Strip duplicate " - Source Name" suffix from Google News titles
            if item_source and title.endswith(f" - {item_source}"):
                title = title[: -len(f" - {item_source}")].strip()

            summary_raw = _child_text(item, ["description", "summary", "content", "encoded"])
            summary = _clean_html(summary_raw, max_len=350)

            # Avoid duplicating the headline when Google News puts the headline in <description>
            norm_title = re.sub(r"[^a-z0-9]", "", title.lower())
            norm_sum = re.sub(r"[^a-z0-9]", "", summary.lower())
            if norm_title and norm_sum and (norm_sum.startswith(norm_title) or norm_title in norm_sum[: len(norm_title) + 12]):
                summary = ""

            image = _extract_media_image(item)

            articles.append({
                "id": f"{re.sub(r'[^a-z0-9]', '', source_name.lower())[:8]}-{idx}-{abs(hash(link or title)) % 100000}",
                "title": title,
                "link": link,
                "summary": summary,
                "pub_date": pub_date,
                "pub_ts": pub_dt.timestamp() if pub_dt else 0,
                "source": item_source,
                "image": image,
            })
    except Exception as e:
        logger.warning(f"Newspaper RSS fetch failed for {source_name} ({url}): {e}")
    return articles


def _google_news_rss(query, max_age_days=7):
    paywall_exclusions = (
        "-site:nytimes.com -site:wsj.com -site:washingtonpost.com -site:bloomberg.com "
        "-site:ft.com -site:theathletic.com -site:bostonglobe.com -site:latimes.com "
        "-site:economist.com -site:theatlantic.com -site:businessinsider.com"
    )
    full_query = f"({query}) when:{max_age_days}d {paywall_exclusions}"
    encoded = urllib.parse.quote_plus(full_query)
    return f"https://news.google.com/rss/search?q={encoded}&hl=en-US&gl=US&ceid=US:en"


def _dedupe_articles(articles, limit=12):
    sorted_arts = sorted(articles, key=lambda a: a.get("pub_ts") or 0, reverse=True)
    seen_keys = set()
    unique = []
    for art in sorted_arts:
        title_key = re.sub(r"[^a-z0-9]", "", art.get("title", "").lower())[:60]
        if not title_key or title_key in seen_keys:
            continue
        seen_keys.add(title_key)
        unique.append(art)
        if len(unique) >= limit:
            break
    return unique


def _load_latest_garmin_snapshot():
    """Read cached Garmin readiness/AI insights and latest activity from garmin_cache/."""
    snapshot = {
        "readiness_score": None,
        "readiness_category": None,
        "headline": None,
        "recommended_workout": None,
        "latest_activity": None,
        "lat": None,
        "lon": None,
    }

    insights_path = os.path.join("garmin_cache", "ai_insights.json")
    if os.path.exists(insights_path):
        try:
            with open(insights_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            data = raw.get("data") if isinstance(raw, dict) and isinstance(raw.get("data"), dict) else raw
            if isinstance(data, dict):
                snapshot["readiness_score"] = data.get("readiness_score") or data.get("score")
                snapshot["readiness_category"] = data.get("readiness_category") or data.get("category")
                snapshot["headline"] = data.get("headline") or data.get("summary")
                snapshot["recommended_workout"] = data.get("recommended_workout") or data.get("prescription")
        except Exception as e:
            logger.debug(f"Could not read garmin_cache/ai_insights.json: {e}")

    act_files = sorted(glob.glob(os.path.join("garmin_cache", "activities", "*.json")), reverse=True)
    latest_act = None
    latest_date = ""
    for fpath in act_files[:3]:
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                month_data = json.load(f)
            if isinstance(month_data, dict):
                for day_key, day_list in month_data.items():
                    if isinstance(day_list, list):
                        for act in day_list:
                            if not isinstance(act, dict):
                                continue
                            st = str(act.get("startTimeLocal") or day_key or "")
                            if st >= latest_date:
                                latest_date = st
                                latest_act = act
        except Exception:
            continue

    if latest_act:
        dist_m = latest_act.get("distance") or 0
        dur_s = latest_act.get("duration") or 0
        dist_mi = round(float(dist_m) * 0.000621371, 2) if dist_m else None
        mins = int(round(float(dur_s) / 60)) if dur_s else None
        at = latest_act.get("activityType")
        act_type = at.get("typeKey") if isinstance(at, dict) else (at or "workout")
        snapshot["latest_activity"] = {
            "name": latest_act.get("activityName") or "Recent Activity",
            "type": str(act_type).replace("_", " ").title(),
            "date": str(latest_act.get("startTimeLocal") or "")[:10],
            "distance_mi": dist_mi,
            "duration_min": mins,
        }
        lat = latest_act.get("startLatitude")
        lon = latest_act.get("startLongitude")
        if lat and lon:
            snapshot["lat"] = float(lat)
            snapshot["lon"] = float(lon)

    return snapshot


def _reverse_geocode(lat, lon):
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lon}&zoom=10"
        data = _http_get_json(url, timeout=6, extra_headers={"User-Agent": "MyGarminDash-DailyDispatch/1.0"})
        addr = data.get("address") or {}
        city = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("county") or ""
        state = addr.get("state") or ""
        if city and state:
            return f"{city}, {state}"
        return city or state or ""
    except Exception as e:
        logger.debug(f"Reverse geocode failed: {e}")
        return ""


def fetch_garmin_and_weather(settings):
    """Load Garmin Athlete's Corner, resolve location, and fetch today's Open-Meteo forecast."""
    garmin = _load_latest_garmin_snapshot()

    lat = settings.get("weather_lat") or garmin.get("lat")
    lon = settings.get("weather_lon") or garmin.get("lon")
    local_location = (settings.get("local_location") or "").strip()

    # Auto-infer city from Garmin GPS if user left local_location blank
    if not local_location and garmin.get("lat") and garmin.get("lon"):
        inferred = _reverse_geocode(garmin["lat"], garmin["lon"])
        if inferred:
            local_location = inferred
            storage.save_editorial_settings({
                "local_location": inferred,
                "weather_lat": garmin["lat"],
                "weather_lon": garmin["lon"],
            })

    if not lat or not lon:
        lat, lon = 40.7128, -74.0060

    weather = {
        "location": local_location or "Your Desk",
        "temp_f": None,
        "high_f": None,
        "low_f": None,
        "wind_mph": None,
        "condition": "Forecast Unavailable",
        "icon": "🗞️",
    }

    try:
        url = (
            f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
            f"&current=temperature_2m,weather_code,wind_speed_10m"
            f"&daily=temperature_2m_max,temperature_2m_min"
            f"&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1"
        )
        wdata = _http_get_json(url, timeout=6)
        current = wdata.get("current") or {}
        daily = wdata.get("daily") or {}
        code = int(current.get("weather_code")) if current.get("weather_code") is not None else 0
        cond, icon = WMO_WEATHER_CODES.get(code, ("Clear", "🌤️"))
        weather["temp_f"] = round(current["temperature_2m"]) if current.get("temperature_2m") is not None else None
        weather["wind_mph"] = round(current["wind_speed_10m"]) if current.get("wind_speed_10m") is not None else None
        highs = daily.get("temperature_2m_max") or []
        lows = daily.get("temperature_2m_min") or []
        weather["high_f"] = round(highs[0]) if highs and highs[0] is not None else None
        weather["low_f"] = round(lows[0]) if lows and lows[0] is not None else None
        weather["condition"] = cond
        weather["icon"] = icon
    except Exception as e:
        logger.warning(f"Newspaper weather fetch failed: {e}")

    return garmin, weather, local_location


def fetch_random_wikipedia_articles(count=3):
    """Fetch random Wikipedia article summaries in parallel."""
    articles = []

    def _fetch_one(_):
        data = _http_get_json(
            "https://en.wikipedia.org/api/rest_v1/page/random/summary",
            timeout=6,
            extra_headers={"User-Agent": "MyGarminDash-DailyDispatch/1.0"},
        )
        title = data.get("title") or ""
        extract = data.get("extract") or ""
        url = ((data.get("content_urls") or {}).get("desktop") or {}).get("page") or ""
        thumb = (data.get("thumbnail") or {}).get("source") or ""
        if title and extract:
            return {
                "title": title,
                "description": data.get("description") or "Encyclopedia Entry",
                "extract": extract,
                "url": url or f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}",
                "image": thumb,
            }
        return None

    with ThreadPoolExecutor(max_workers=count) as pool:
        futures = [pool.submit(_fetch_one, i) for i in range(count)]
        for fut in as_completed(futures):
            try:
                res = fut.result()
                if res:
                    articles.append(res)
            except Exception as e:
                logger.debug(f"Random Wikipedia fetch failed: {e}")
    return articles


def fetch_wikipedia_curiosity(today_date):
    """Fetch Wikipedia Featured Article, On This Day, Most Read, and Random Rabbit Holes."""
    result = {
        "featured_article": None,
        "on_this_day": [],
        "most_read": [],
        "random_articles": [],
    }

    yyyy = today_date.strftime("%Y")
    mm = today_date.strftime("%m")
    dd = today_date.strftime("%d")

    def _fetch_featured():
        url = f"https://en.wikipedia.org/api/rest_v1/feed/featured/{yyyy}/{mm}/{dd}"
        data = _http_get_json(url, timeout=8, extra_headers={"User-Agent": "MyGarminDash-DailyDispatch/1.0"})
        tfa = data.get("tfa")
        if isinstance(tfa, dict) and tfa.get("title"):
            result["featured_article"] = {
                "title": tfa.get("normalizedtitle") or tfa.get("title"),
                "description": tfa.get("description") or "Today's Wikipedia Featured Article",
                "extract": tfa.get("extract") or "",
                "url": ((tfa.get("content_urls") or {}).get("desktop") or {}).get("page") or "",
                "image": (tfa.get("thumbnail") or {}).get("source") or "",
            }

        otd_raw = data.get("onthisday") or []
        otd_list = []
        for ev in otd_raw[:5]:
            pages = ev.get("pages") or []
            primary = pages[0] if pages else {}
            page_url = ((primary.get("content_urls") or {}).get("desktop") or {}).get("page") or ""
            otd_list.append({
                "year": ev.get("year"),
                "text": ev.get("text") or "",
                "url": page_url,
                "page_title": primary.get("normalizedtitle") or primary.get("title") or "",
            })
        result["on_this_day"] = otd_list

        mostread = (data.get("mostread") or {}).get("articles") or []
        mr_list = []
        for art in mostread:
            title = art.get("normalizedtitle") or art.get("title") or ""
            if not title or title.lower() in ("main page", "special:search") or title.startswith("Wikipedia:"):
                continue
            mr_list.append({
                "title": title,
                "description": art.get("description") or "",
                "extract": _clean_html(art.get("extract") or "", max_len=240),
                "views": art.get("views") or 0,
                "url": ((art.get("content_urls") or {}).get("desktop") or {}).get("page") or "",
            })
            if len(mr_list) >= 4:
                break
        result["most_read"] = mr_list

    with ThreadPoolExecutor(max_workers=2) as pool:
        f_feat = pool.submit(_fetch_featured)
        f_rand = pool.submit(fetch_random_wikipedia_articles, 3)
        try:
            f_feat.result()
        except Exception as e:
            logger.warning(f"Wikipedia featured feed failed: {e}")
        try:
            result["random_articles"] = f_rand.result()
        except Exception as e:
            logger.warning(f"Wikipedia random articles failed: {e}")

    return result


BSKY_COMIC_ACTORS = {
    "calvinandhobbes": [
        "calvin-and-hobbes.bsky.social",
        "calvin.cowtools.org",
        "calvinethobbes.bsky.social",
    ],
    "peanuts": [
        "esnupi.me",
        "peanutscomics.bsky.social",
        "peanuts60yrsago.bsky.social",
    ],
    "garfield": [
        "garfield.cowtools.org",
        "garfieldthecat.bsky.social",
    ],
}

ARAMAX_COMIC_SLUGS = {
    "peanuts": "peanuts",
    "garfield": "garfield",
}


def _download_image_as_data_uri(img_url, timeout=6):
    """Download a comic strip image and encode it as an inline data:image URI."""
    if not img_url:
        return ""
    if str(img_url).startswith("data:image/"):
        return img_url

    def _detect_mime(payload):
        if not payload or len(payload) <= 500:
            return ""
        if payload.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if payload.startswith((b"GIF87a", b"GIF89a")):
            return "image/gif"
        if payload.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if payload.startswith(b"RIFF") and payload[8:12] == b"WEBP":
            return "image/webp"
        return ""

    raw = None
    mime = ""
    try:
        raw = _http_get(img_url, timeout=timeout)
        mime = _detect_mime(raw)
    except Exception:
        raw = None
        mime = ""

    if not mime:
        try:
            req = urllib.request.Request(
                img_url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                },
            )
            ctx = ssl._create_unverified_context()
            with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
                raw = resp.read()
            mime = _detect_mime(raw)
        except Exception as e:
            logger.debug(f"Fallback image download failed for {img_url}: {e}")
            return ""

    if not mime or not raw:
        return ""

    return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")


def _fetch_xkcd():
    data = _http_get_json("https://xkcd.com/info.0.json", timeout=6)
    num = data.get("num")
    raw_img = data.get("img") or ""
    data_uri = _download_image_as_data_uri(raw_img) if raw_img else ""
    image = data_uri or raw_img
    return {
        "id": "xkcd",
        "name": COMIC_META["xkcd"]["name"],
        "creator": COMIC_META["xkcd"]["creator"],
        "title": data.get("safe_title") or data.get("title") or "XKCD",
        "image": image,
        "alt": data.get("alt") or "",
        "url": f"https://xkcd.com/{num}/" if num else "https://xkcd.com/",
        "available": bool(image),
    }


def _extract_gocomics_image_url(html_str):
    for pattern in (
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
    ):
        match = re.search(pattern, html_str, flags=re.IGNORECASE)
        if match:
            candidate = html.unescape(match.group(1))
            if (
                candidate
                and ("featureassets.gocomics.com/assets/" in candidate.lower() or "assets.amuniversal.com/" in candidate.lower())
                and not candidate.endswith("avatar.png")
            ):
                return candidate

    for match in re.findall(r'https://featureassets\.gocomics\.com/assets/[a-zA-Z0-9]+', html_str):
        if match:
            return match
    return ""


def _fetch_arcamax_strip(strip_id, today_date):
    slug = ARAMAX_COMIC_SLUGS.get(strip_id)
    if not slug:
        return None
    meta = COMIC_META.get(strip_id, {"name": strip_id.title(), "creator": "", "home": f"https://www.arcamax.com/thefunnies/{slug}/"})
    page_url = f"https://www.arcamax.com/thefunnies/{slug}/"
    try:
        raw = None
        try:
            raw = _http_get(page_url, timeout=5)
        except Exception:
            req = urllib.request.Request(page_url, headers={"User-Agent": USER_AGENT})
            ctx = ssl._create_unverified_context()
            with urllib.request.urlopen(req, context=ctx, timeout=5) as resp:
                raw = resp.read()
        html_str = raw.decode("utf-8", errors="replace") if raw else ""
        match = re.search(
            r'<img[^>]+src=["\'](https://resources\.arcamax\.com/newspics/[^"\']+)["\']',
            html_str,
            flags=re.IGNORECASE,
        )
        if not match:
            return None
        img_url = html.unescape(match.group(1))
        data_uri = _download_image_as_data_uri(img_url)
        if data_uri:
            return {
                "id": strip_id,
                "name": meta["name"],
                "creator": meta["creator"],
                "title": f"{meta['name']} — {today_date.strftime('%b %d, %Y')}",
                "image": data_uri,
                "alt": "",
                "url": page_url,
                "available": True,
            }
    except Exception as e:
        logger.debug(f"ArcaMax strip fetch failed for {strip_id}: {e}")
    return None


def _fetch_bluesky_comic_strip(strip_id, today_date):
    actors = BSKY_COMIC_ACTORS.get(strip_id) or []
    if not actors:
        return None
    meta = COMIC_META.get(strip_id, {"name": strip_id.title(), "creator": "", "home": f"https://www.gocomics.com/{strip_id}"})
    today_iso = today_date.isoformat()

    for actor in actors:
        try:
            api_url = (
                "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed"
                f"?actor={urllib.parse.quote(actor)}&limit=25&filter=posts_with_media"
            )
            data = _http_get_json(api_url, timeout=5)
            feed = data.get("feed") or []
            candidates = []
            today_matches = []
            for item in feed:
                post = item.get("post") or {}
                embed = post.get("embed") or {}
                images = embed.get("images") or (embed.get("media") or {}).get("images") or []
                if not images:
                    continue
                img_obj = images[0] or {}
                fullsize = img_obj.get("fullsize") or img_obj.get("thumb") or ""
                if not fullsize:
                    continue
                record = post.get("record") or {}
                created_at = str(record.get("createdAt") or "")
                alt_text = str(img_obj.get("alt") or "").strip()
                entry = (fullsize, alt_text, created_at)
                candidates.append(entry)
                if created_at.startswith(today_iso):
                    today_matches.append(entry)

            if not candidates:
                continue

            ordered = []
            if today_matches:
                ordered.extend(today_matches)
            start_idx = today_date.toordinal() % len(candidates)
            for offset in range(len(candidates)):
                cand = candidates[(start_idx + offset) % len(candidates)]
                if cand not in ordered:
                    ordered.append(cand)

            for img_url, alt_text, _ in ordered[:4]:
                data_uri = _download_image_as_data_uri(img_url)
                if data_uri:
                    return {
                        "id": strip_id,
                        "name": meta["name"],
                        "creator": meta["creator"],
                        "title": f"{meta['name']} — {today_date.strftime('%b %d, %Y')}",
                        "image": data_uri,
                        "alt": alt_text[:260] if alt_text else "",
                        "url": f"https://www.gocomics.com/{strip_id}/{today_date.strftime('%Y/%m/%d')}",
                        "available": True,
                    }
        except Exception as e:
            logger.debug(f"Bluesky comic fetch failed for {strip_id} ({actor}): {e}")
    return None


_GOCOMICS_BLOCKED = False


def _fetch_gocomics(strip_id, today_date):
    global _GOCOMICS_BLOCKED
    meta = COMIC_META.get(strip_id, {"name": strip_id.title(), "creator": "", "home": f"https://www.gocomics.com/{strip_id}"})
    date_path = today_date.strftime("%Y/%m/%d")
    page_url = f"https://www.gocomics.com/{strip_id}/{date_path}"

    # Tier 1: Try datacenter-friendly syndication / Bluesky sources first so cloud VMs don't stall on GoComics Cloudflare
    if strip_id in ARAMAX_COMIC_SLUGS:
        arcamax_result = _fetch_arcamax_strip(strip_id, today_date)
        if arcamax_result and str(arcamax_result.get("image", "")).startswith("data:image/"):
            return arcamax_result

    if strip_id in BSKY_COMIC_ACTORS:
        bsky_result = _fetch_bluesky_comic_strip(strip_id, today_date)
        if bsky_result and str(bsky_result.get("image", "")).startswith("data:image/"):
            return bsky_result

    # Tier 2: GoComics direct (short timeout; stop retrying across strips once blocked in this process)
    if not _GOCOMICS_BLOCKED:
        try:
            raw = _http_get(page_url, timeout=3.5)
            html_str = raw.decode("utf-8", errors="replace")
            img_url = _extract_gocomics_image_url(html_str)
            if img_url:
                data_uri = _download_image_as_data_uri(img_url, timeout=5)
                if data_uri:
                    return {
                        "id": strip_id,
                        "name": meta["name"],
                        "creator": meta["creator"],
                        "title": f"{meta['name']} — {today_date.strftime('%b %d, %Y')}",
                        "image": data_uri,
                        "alt": "",
                        "url": page_url,
                        "available": True,
                    }
        except Exception as e:
            _GOCOMICS_BLOCKED = True
            logger.debug(f"GoComics direct fetch failed for {strip_id} ({page_url}): {e}")
        _GOCOMICS_BLOCKED = True

    # Secondary fallbacks if primary source differed or failed
    if strip_id not in ARAMAX_COMIC_SLUGS:
        arcamax_result = _fetch_arcamax_strip(strip_id, today_date)
        if arcamax_result:
            return arcamax_result

    if strip_id not in BSKY_COMIC_ACTORS:
        bsky_result = _fetch_bluesky_comic_strip(strip_id, today_date)
        if bsky_result:
            return bsky_result

    return {
        "id": strip_id,
        "name": meta["name"],
        "creator": meta["creator"],
        "title": f"{meta['name']} — {today_date.strftime('%b %d, %Y')}",
        "image": "",
        "alt": "",
        "url": page_url,
        "available": False,
        "fallback_message": f"Today's {meta['name']} strip is ready on GoComics.",
    }


def fetch_daily_comics(today_date, enabled_comics):
    """Fetch XKCD and GoComics daily strips in parallel."""
    if not enabled_comics:
        enabled_comics = ["xkcd", "calvinandhobbes", "peanuts", "garfield"]

    comics_map = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {}
        for cid in enabled_comics:
            if cid == "xkcd":
                futures[pool.submit(_fetch_xkcd)] = cid
            else:
                futures[pool.submit(_fetch_gocomics, cid, today_date)] = cid

        for fut, cid in futures.items():
            try:
                comics_map[cid] = fut.result()
            except Exception as e:
                logger.warning(f"Comic {cid} failed: {e}")
                meta = COMIC_META.get(cid, {"name": cid.title(), "creator": "", "home": "#"})
                comics_map[cid] = {
                    "id": cid,
                    "name": meta["name"],
                    "creator": meta["creator"],
                    "title": meta["name"],
                    "image": "",
                    "alt": "",
                    "url": meta["home"],
                    "available": False,
                    "fallback_message": "Strip preview unavailable right now — open on publisher site.",
                }

    return [comics_map[cid] for cid in enabled_comics if cid in comics_map]


def fetch_all_section_feeds(settings, local_location):
    """Fetch RSS feeds for all 7 newspaper sections in parallel."""
    feed_tasks = []

    for sec, feeds in DEFAULT_FEEDS.items():
        for src_name, url in feeds:
            feed_tasks.append((sec, src_name, url, False))

    # Local section feed (strictly <= 7 days old)
    if local_location:
        feed_tasks.append(("local", f"Local ({local_location})", _google_news_rss(f"{local_location} news", max_age_days=7), True))
    else:
        feed_tasks.append(("local", "Local & Regional US", _google_news_rss("local community news United States", max_age_days=7), True))

    # Personalized sports query (strictly <= 7 days old)
    sports_terms = settings.get("sports_interests") or ["Cycling", "NFL", "NBA"]
    sports_query = " OR ".join(sports_terms[:5])
    feed_tasks.append(("sports", "Personalized Sports", _google_news_rss(sports_query, max_age_days=7), True))

    # Custom user RSS feeds
    for cf in settings.get("custom_rss_feeds") or []:
        sec = cf.get("section") if cf.get("section") in SECTION_META else "global"
        feed_tasks.append((sec, cf.get("name") or "Custom Feed", cf.get("url"), False))

    raw_by_section = {sec: [] for sec in SECTION_META}
    with ThreadPoolExecutor(max_workers=8) as pool:
        future_map = {
            pool.submit(fetch_rss_feed, url, src_name, 10, 7, req_date): (sec, src_name)
            for sec, src_name, url, req_date in feed_tasks
        }
        for fut in as_completed(future_map):
            sec, _ = future_map[fut]
            try:
                items = fut.result()
                for item in items:
                    item["section"] = sec
                raw_by_section[sec].extend(items)
            except Exception as e:
                logger.warning(f"Section feed error ({sec}): {e}")

    cleaned = {}
    for sec, arts in raw_by_section.items():
        cleaned[sec] = _dedupe_articles(arts, limit=10)
    return cleaned


def _get_preferred_ai_model(settings=None):
    """Read global ai_model from settings.json first, falling back to editorial settings or gemini-4-hydrogen."""
    try:
        if os.path.exists("settings.json"):
            with open("settings.json", "r", encoding="utf-8") as f:
                global_settings = json.load(f)
            if isinstance(global_settings, dict) and global_settings.get("ai_model"):
                return str(global_settings["ai_model"]).strip()
    except Exception as e:
        logger.debug(f"Could not read settings.json for ai_model: {e}")
    if isinstance(settings, dict) and settings.get("ai_model"):
        return str(settings["ai_model"]).strip()
    return "gemini-4-hydrogen"


_UNAVAILABLE_MODELS = set()
_LAST_WORKING_MODEL = None


def _call_gemini_json(prompt, model_name="gemini-4-hydrogen"):
    """Call Gemini API with model fallback chain and parse JSON response."""
    global _LAST_WORKING_MODEL
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured")

    client = genai.Client(api_key=api_key)
    candidates = []
    if _LAST_WORKING_MODEL and model_name in _UNAVAILABLE_MODELS:
        candidates.append(_LAST_WORKING_MODEL)
    candidates.extend([
        model_name,
        "gemini-4-hydrogen",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3-flash-preview",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
    ])
    if _LAST_WORKING_MODEL:
        candidates.append(_LAST_WORKING_MODEL)

    models_to_try = []
    for m in candidates:
        if m and m not in _UNAVAILABLE_MODELS and m not in models_to_try:
            models_to_try.append(m)

    if not models_to_try:
        _UNAVAILABLE_MODELS.clear()
        models_to_try = ["gemini-2.5-flash", "gemini-2.5-flash-lite"]

    def _build_config(fast_thinking=True):
        if fast_thinking:
            try:
                return types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.35,
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                )
            except Exception:
                pass
        return types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.35,
        )

    last_err = None
    for m in models_to_try:
        fast_thinking = "flash" in m.lower()
        for attempt in range(2):
            try:
                resp = client.models.generate_content(
                    model=m,
                    contents=prompt,
                    config=_build_config(fast_thinking=fast_thinking),
                )
                text = (resp.text or "").strip()
                text = re.sub(r"^```(?:json)?\s*", "", text)
                text = re.sub(r"\s*```$", "", text)
                parsed = json.loads(text)
                _LAST_WORKING_MODEL = m
                return parsed, m
            except Exception as e:
                last_err = e
                err_str = str(e)
                err_lower = err_str.lower()
                if fast_thinking and ("thinking" in err_lower or "invalid_argument" in err_lower) and attempt == 0:
                    fast_thinking = False
                    continue
                if "404" in err_str or "not_found" in err_lower or "not found" in err_lower:
                    _UNAVAILABLE_MODELS.add(m)
                    logger.info(f"Newspaper Gemini model {m} unavailable (cached skip): {e}")
                    break
                if ("503" in err_str or "429" in err_str) and attempt == 0:
                    time.sleep(1.5)
                    continue
                logger.warning(f"Newspaper Gemini model {m} failed: {e}")
                break
    raise last_err or RuntimeError("All Gemini models failed")


def _build_fallback_synthesis(today_date, sections_raw, wikipedia, settings, local_location):
    """Deterministic fallback edition synthesis when Gemini is unavailable."""
    lead_art = None
    for sec in ("global", "national", "scitech", "politics"):
        if sections_raw.get(sec):
            lead_art = sections_raw[sec][0]
            lead_sec = SECTION_META[sec]["title"]
            break
    if not lead_art:
        lead_sec = "Front Page"
        lead_art = {
            "title": "Morning Edition Ready",
            "summary": "Today's curated headlines and encyclopedia discoveries have been gathered for your morning briefing.",
            "link": "https://en.wikipedia.org/wiki/Main_Page",
            "source": "The Daily Dispatch",
        }

    lead_story = {
        "headline": lead_art["title"],
        "subheadline": f"Top dispatch from {lead_art.get('source', 'wire services')} leading today's edition.",
        "byline": f"By {lead_art.get('source', 'Wire Services')}",
        "section": lead_sec,
        "dateline": local_location.upper() if local_location else "MORNING EDITION",
        "body_paragraphs": [
            lead_art.get("summary") or "Read the full report via the link below.",
            "Browse the section tabs above to explore headlines across Global, National, Politics, Local, Sports, Science & Tech, and Opinions.",
        ],
        "why_it_matters": "Selected as today's lead story from the morning wire.",
        "related_links": [
            {
                "title": lead_art.get("title", "Read Full Story"),
                "url": lead_art.get("link", "#"),
                "source": lead_art.get("source", "Source"),
            }
        ],
    }

    morning_briefing = []
    for sec in ("global", "national", "politics", "scitech"):
        arts = sections_raw.get(sec) or []
        if arts:
            morning_briefing.append(f"[{SECTION_META[sec]['title']}] {arts[0]['title']} ({arts[0]['source']})")
    if not morning_briefing:
        morning_briefing = ["Today's newspaper edition is ready to explore across all sections."]

    deep_dives = []
    tfa = wikipedia.get("featured_article")
    if tfa:
        deep_dives.append({
            "id": "dive-tfa",
            "title": tfa["title"],
            "subtitle": tfa.get("description") or "Featured Encyclopedia Deep Dive",
            "category": "Encyclopedia Feature",
            "reading_time": "3 min read",
            "body_paragraphs": [tfa.get("extract") or "Explore today's featured encyclopedia subject."],
            "key_takeaways": [
                "Featured on Wikipedia's front page today.",
                "Click the Wikipedia link below to dive deeper into primary sources and history.",
            ],
            "learn_more_links": [{"title": f"{tfa['title']} — Wikipedia", "url": tfa["url"], "source": "Wikipedia"}],
            "topic_tag": "Featured Knowledge",
        })

    for idx, r_art in enumerate(wikipedia.get("random_articles") or []):
        if len(deep_dives) >= 3:
            break
        deep_dives.append({
            "id": f"dive-rand-{idx}",
            "title": r_art["title"],
            "subtitle": r_art.get("description") or "Serendipitous Rabbit Hole",
            "category": "Curiosity",
            "reading_time": "2 min read",
            "body_paragraphs": [r_art.get("extract") or "An unexpected topic worth learning about today."],
            "key_takeaways": [f"Topic: {r_art.get('description') or 'General Knowledge'}"],
            "learn_more_links": [{"title": f"{r_art['title']} — Wikipedia", "url": r_art["url"], "source": "Wikipedia"}],
            "topic_tag": r_art.get("description") or "Curiosity",
        })

    section_highlights = {}
    for sec, meta in SECTION_META.items():
        arts = sections_raw.get(sec) or []
        if arts:
            section_highlights[sec] = f"Top story: {arts[0]['title']} — plus {max(0, len(arts) - 1)} more dispatches."
        else:
            section_highlights[sec] = meta["description"]

    return {
        "lead_story": lead_story,
        "morning_briefing": morning_briefing,
        "editorial_column": {
            "title": "From the Editor's Desk",
            "body": "Good morning. Even on days when the automated AI synthesis desk is offline, the printing press still rolls with fresh dispatches from trusted wires and encyclopedia rabbit holes.",
        },
        "deep_dives": deep_dives,
        "section_highlights": section_highlights,
        "daily_extras": {
            "word_of_the_day": {
                "word": "Serendipity",
                "pronunciation": "ser-uh n-DIP-i-tee",
                "part_of_speech": "noun",
                "definition": "The occurrence and development of events by chance in a happy or beneficial way.",
                "example": "Browsing the Curiosity section led to a moment of serendipity when an obscure engineering story sparked a new idea.",
                "etymology": "Coined by Horace Walpole in 1754 from the Persian fairy tale 'The Three Princes of Serendip'.",
            },
            "brain_teaser": {
                "question": "I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?",
                "hint": "Think about acoustics in mountains or canyons.",
                "answer": "An echo.",
            },
            "quote_of_the_day": {
                "quote": "Live as if you were to die tomorrow. Learn as if you were to live forever.",
                "author": "Mahatma Gandhi",
                "context": "A timeless reminder on lifelong curiosity.",
            },
        },
        "ai_model_used": "Wire Fallback (No AI Key/Quota)",
    }


def synthesize_newspaper_edition(today_date, sections_raw, wikipedia, settings, local_location):
    """Use Gemini to synthesize the front page, section highlights, deep dives, and daily extras."""
    history = storage.load_topic_history()
    covered = history.get("covered_deep_dives") or []

    # Compact headlines payload for Gemini prompt
    headlines_digest = {}
    for sec, arts in sections_raw.items():
        headlines_digest[sec] = [
            {
                "id": a["id"],
                "title": a["title"],
                "source": a["source"],
                "summary": a["summary"][:200],
                "link": a["link"],
            }
            for a in arts[:6]
        ]

    tfa = wikipedia.get("featured_article")
    otd = wikipedia.get("on_this_day") or []

    prompt = f"""
You are the Editor-in-Chief of "{settings.get('masthead_title', 'The Daily Dispatch')}", a distinguished classic broadsheet newspaper & daily intellectual briefing.
Today's date: {today_date.strftime('%A, %B %d, %Y')}.
Reader's location: {local_location or 'United States'}.
Reader's sports interests: {', '.join(settings.get('sports_interests') or [])}.
Reader's curiosity/learning interests: {', '.join(settings.get('curiosity_topics') or [])}.
Topics the reader recently LIKED (lean into similar themes): {', '.join(settings.get('liked_topics') or ['None yet'])}.
Topics the reader DISLIKED (avoid in deep dives): {', '.join(settings.get('disliked_topics') or ['None yet'])}.
Custom reader instructions: {settings.get('custom_prompt') or 'None'}.
Recently covered deep-dive titles (DO NOT repeat these): {', '.join(covered[-20:]) or 'None'}.

Today's raw news headlines by section:
{json.dumps(headlines_digest, ensure_ascii=False)}

Wikipedia Featured Article today: {json.dumps(tfa, ensure_ascii=False) if tfa else 'None'}
On This Day highlights: {json.dumps(otd[:3], ensure_ascii=False)}

Return ONLY valid JSON with this exact schema:
{{
  "lead_story": {{
    "headline": "Compelling newspaper headline synthesizing the biggest story of the day",
    "subheadline": "Concise broadsheet deck/subheadline",
    "byline": "By The Daily Dispatch Editorial Desk",
    "section": "Global News / National News / Science & Tech",
    "dateline": "CITY OR REGION IN CAPS",
    "body_paragraphs": ["Paragraph 1 (3-4 sentences)", "Paragraph 2 (3-4 sentences)", "Paragraph 3 (2-3 sentences)"],
    "why_it_matters": "1-2 sentences on the broader significance",
    "related_links": [{{"title": "Source Article Title", "url": "exact URL from input headlines", "source": "Source Name"}}]
  }},
  "morning_briefing": [
    "Bullet 1: concise morning summary covering a major story",
    "Bullet 2: ...",
    "Bullet 3: ...",
    "Bullet 4: ..."
  ],
  "editorial_column": {{
    "title": "Short thoughtful column title",
    "body": "A crisp 2-paragraph (~120 word) Editor's Note connecting today's news or a big idea worth reflecting on."
  }},
  "deep_dives": [
    {{
      "id": "dive-1",
      "title": "Fascinating non-news topic title the reader should learn about",
      "subtitle": "Intriguing deck explaining why it's worth knowing",
      "category": "One of the reader's curiosity categories (e.g. How Things Work, Hidden History, Mental Models, Science)",
      "reading_time": "3 min read",
      "body_paragraphs": ["Rich, concrete paragraph 1", "Paragraph 2 with real facts/mechanisms", "Paragraph 3 connecting to everyday life or bigger picture"],
      "key_takeaways": ["Takeaway 1", "Takeaway 2", "Takeaway 3"],
      "learn_more_links": [
        {{"title": "Wikipedia: Topic Name", "url": "https://en.wikipedia.org/wiki/Exact_Underscored_Topic", "source": "Wikipedia"}},
        {{"title": "Explore further on Google", "url": "https://www.google.com/search?q=Exact+Topic+Explained", "source": "Web Search"}}
      ],
      "topic_tag": "Short 2-3 word topic tag"
    }}
  ],
  "section_highlights": {{
    "global": "1-2 sentence editorial overview of today's global news",
    "national": "1-2 sentence editorial overview of today's national news",
    "politics": "1-2 sentence editorial overview of today's politics",
    "local": "1-2 sentence editorial overview of today's local news",
    "sports": "1-2 sentence editorial overview of today's sports",
    "scitech": "1-2 sentence editorial overview of today's science & tech",
    "opinions": "1-2 sentence editorial overview of today's opinion essays"
  }},
  "article_takeaways": {{
    "article_id_from_input": "One punchy sentence explaining why this specific story matters"
  }},
  "article_summaries": {{
    "article_id_with_empty_summary": "Concise 1-2 sentence factual summary of the headline for the reader"
  }},
  "excluded_article_ids": ["any_article_id_that_violates_custom_instructions_or_is_paywalled_or_off_topic"],
  "daily_extras": {{
    "word_of_the_day": {{
      "word": "Sophisticated but useful English word",
      "pronunciation": "phonetic guide",
      "part_of_speech": "noun/verb/adj",
      "definition": "Clear definition",
      "example": "Natural example sentence",
      "etymology": "Brief origin"
    }},
    "brain_teaser": {{
      "question": "Clever lateral-thinking, math, or trivia riddle",
      "hint": "Helpful clue",
      "answer": "Clear answer & brief explanation"
    }},
    "quote_of_the_day": {{
      "quote": "Memorable real quote",
      "author": "Author Name",
      "context": "Brief context"
    }}
  }}
}}

Strict Editorial Rules:
1. Provide exactly 3 distinct, deeply interesting items in "deep_dives" (timeless topics worth learning: engineering marvels, hidden history, psychology/mental models, physics/biology, economics, etc.).
2. NEVER output links to paywalled or subscription websites (NO nytimes.com, wsj.com, washingtonpost.com, bloomberg.com, ft.com, economist.com, newyorker.com, theatlantic.com, theathletic.com, wired.com, businessinsider.com, or any paywalled local newspaper). Only link to free, open-access sources (Wikipedia, NPR, BBC, PBS, AP News, The Guardian, Ars Technica, ScienceDaily, NASA, .gov/.edu sites, or open Google Search links).
3. Strictly honor the reader's "Custom reader instructions" above. If the reader asked to exclude a topic, region, or timeframe, list any matching input article IDs in "excluded_article_ids" so they are removed from every section.
4. For any input article where "summary" is empty, provide a concise 1-2 sentence summary in "article_summaries" (do NOT repeat the headline verbatim).
5. Ensure all URLs in related_links come directly from the non-paywalled input headlines.
"""

    try:
        model_pref = _get_preferred_ai_model(settings)
        ai_data, used_model = _call_gemini_json(prompt, model_name=model_pref)
        ai_data["ai_model_used"] = used_model

        lead = ai_data.get("lead_story") or {}
        if isinstance(lead, dict) and isinstance(lead.get("related_links"), list):
            lead["related_links"] = [
                lnk for lnk in lead["related_links"]
                if isinstance(lnk, dict) and not _is_paywalled(lnk.get("url", ""), lnk.get("source", ""))
            ]
        for dive in ai_data.get("deep_dives") or []:
            if isinstance(dive, dict) and isinstance(dive.get("learn_more_links"), list):
                dive["learn_more_links"] = [
                    lnk for lnk in dive["learn_more_links"]
                    if isinstance(lnk, dict) and not _is_paywalled(lnk.get("url", ""), lnk.get("source", ""))
                ]

        return ai_data
    except Exception as e:
        logger.warning(f"Gemini edition synthesis failed, using wire fallback: {e}")
        return _build_fallback_synthesis(today_date, sections_raw, wikipedia, settings, local_location)


def generate_custom_deep_dive(topic_query, settings, date_str=None):
    """Generate an on-demand 'Things to Learn About' newspaper feature article."""
    topic_clean = (topic_query or "").strip()
    history = storage.load_topic_history()
    covered = history.get("covered_deep_dives") or []

    if topic_clean:
        topic_instruction = f'Write a rich newspaper feature deep-dive specifically about: "{topic_clean}".'
    else:
        topics = ", ".join(settings.get("curiosity_topics") or ["How Things Work", "Hidden History", "Science"])
        topic_instruction = (
            f"Surprise the reader with an extraordinary, lesser-known topic from these interests: {topics}. "
            f"Do NOT repeat any of these already-covered topics: {', '.join(covered[-25:]) or 'None'}."
        )

    prompt = f"""
You are a master feature writer for "The Daily Dispatch".
{topic_instruction}

Return ONLY valid JSON with this exact schema:
{{
  "title": "Engaging newspaper feature title",
  "subtitle": "Compelling deck summarizing the hook",
  "category": "Category name (e.g. Science, History, Engineering, Psychology)",
  "reading_time": "3 min read",
  "body_paragraphs": [
    "Paragraph 1: compelling hook and core concept",
    "Paragraph 2: how it works / historical story / concrete mechanisms",
    "Paragraph 3: surprising twist, nuance, or broader impact"
  ],
  "key_takeaways": ["Key takeaway 1", "Key takeaway 2", "Key takeaway 3"],
  "learn_more_links": [
    {{"title": "Wikipedia: Exact Subject", "url": "https://en.wikipedia.org/wiki/Exact_Subject", "source": "Wikipedia"}},
    {{"title": "Search & Further Reading", "url": "https://www.google.com/search?q=Exact+Subject", "source": "Web Search"}}
  ],
  "topic_tag": "Short 2-3 word tag"
}}

IMPORTANT: NEVER link to paywalled/subscription sites (no nytimes.com, wsj.com, washingtonpost.com, bloomberg.com, ft.com, economist.com, newyorker.com, theatlantic.com, wired.com, etc.). Only link to free, open-access sources like Wikipedia, NASA, .gov/.edu, or open web search.
"""
    model_pref = _get_preferred_ai_model(settings)
    try:
        dive, used_model = _call_gemini_json(prompt, model_name=model_pref)
    except Exception as e:
        logger.warning(f"Custom deep dive Gemini call failed, trying Wikipedia fallback: {e}")
        # Fallback using Wikipedia search/random summary
        if topic_clean:
            slug = urllib.parse.quote(topic_clean.replace(" ", "_"))
            try:
                w = _http_get_json(
                    f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}",
                    timeout=6,
                    extra_headers={"User-Agent": "MyGarminDash-DailyDispatch/1.0"},
                )
                dive = {
                    "title": w.get("title") or topic_clean.title(),
                    "subtitle": w.get("description") or "Encyclopedia Feature",
                    "category": "Encyclopedia",
                    "reading_time": "2 min read",
                    "body_paragraphs": [w.get("extract") or f"Explore {topic_clean} on Wikipedia."],
                    "key_takeaways": ["Retrieved from Wikipedia reference desk."],
                    "learn_more_links": [{
                        "title": f"{w.get('title', topic_clean)} — Wikipedia",
                        "url": ((w.get("content_urls") or {}).get("desktop") or {}).get("page") or f"https://en.wikipedia.org/wiki/{slug}",
                        "source": "Wikipedia",
                    }],
                    "topic_tag": topic_clean[:25],
                }
            except Exception:
                raise RuntimeError("Could not generate deep dive (Gemini unavailable and Wikipedia lookup failed)")
        else:
            rands = fetch_random_wikipedia_articles(1)
            if not rands:
                raise RuntimeError("Could not generate deep dive")
            r = rands[0]
            dive = {
                "title": r["title"],
                "subtitle": r.get("description") or "Serendipitous Encyclopedia Dispatch",
                "category": "Curiosity",
                "reading_time": "2 min read",
                "body_paragraphs": [r["extract"]],
                "key_takeaways": ["Discovered via Wikipedia Random Feature."],
                "learn_more_links": [{"title": f"{r['title']} — Wikipedia", "url": r["url"], "source": "Wikipedia"}],
                "topic_tag": r.get("description") or "Curiosity",
            }
        used_model = "Wikipedia Fallback"

    dive["id"] = f"dive-custom-{int(time.time())}"
    dive["generated_by"] = used_model
    if isinstance(dive.get("learn_more_links"), list):
        dive["learn_more_links"] = [
            lnk for lnk in dive["learn_more_links"]
            if isinstance(lnk, dict) and not _is_paywalled(lnk.get("url", ""), lnk.get("source", ""))
        ]
    storage.record_covered_deep_dives([dive.get("title")])

    target_date = date_str or storage.get_today_str()
    edition = storage.get_edition(target_date)
    if edition:
        dives = list(edition.get("deep_dives") or [])
        dives.insert(0, dive)
        edition["deep_dives"] = dives
        storage.save_edition(target_date, edition)

    return dive


def _comics_need_embed(comics_list):
    if not comics_list:
        return True
    return any(
        (not c.get("available")) or (not str(c.get("image", "")).startswith("data:image/"))
        for c in comics_list
        if isinstance(c, dict)
    )


def build_daily_edition(force_refresh=False):
    """Build (or load cached) today's full newspaper edition."""
    now_est = datetime.now(EST)
    today_date = now_est.date()
    today_str = today_date.isoformat()

    if not force_refresh:
        cached = storage.get_edition(today_str)
        if cached:
            if _comics_need_embed(cached.get("comics")):
                try:
                    settings = storage.load_editorial_settings()
                    cached["comics"] = fetch_daily_comics(today_date, settings.get("enabled_comics"))
                    storage.save_edition(today_str, cached)
                except Exception as e:
                    logger.warning(f"Failed to auto-heal cached comics for {today_str}: {e}")
            return cached

    settings = storage.load_editorial_settings()

    # Step 1: Garmin + Weather + Location resolution
    garmin_corner, weather, local_location = fetch_garmin_and_weather(settings)
    # Reload settings in case local_location was inferred & saved
    settings = storage.load_editorial_settings()

    # Step 2: Parallel fetch of RSS feeds, Wikipedia Curiosity, and Comics
    with ThreadPoolExecutor(max_workers=3) as pool:
        f_feeds = pool.submit(fetch_all_section_feeds, settings, local_location)
        f_wiki = pool.submit(fetch_wikipedia_curiosity, today_date)
        f_comics = pool.submit(fetch_daily_comics, today_date, settings.get("enabled_comics"))

        sections_raw = f_feeds.result()
        wikipedia = f_wiki.result()
        comics = f_comics.result()

    # Step 3: Gemini editorial synthesis
    ai_edition = synthesize_newspaper_edition(today_date, sections_raw, wikipedia, settings, local_location)

    # Record deep-dive titles to avoid repeats in future editions
    dive_titles = [d.get("title") for d in (ai_edition.get("deep_dives") or []) if isinstance(d, dict) and d.get("title")]
    if dive_titles:
        storage.record_covered_deep_dives(dive_titles)

    # Step 4: Merge section highlights, summaries, exclusions & article takeaways
    highlights = ai_edition.get("section_highlights") or {}
    takeaways = ai_edition.get("article_takeaways") or {}
    ai_summaries = ai_edition.get("article_summaries") or {}
    excluded_ids = set(ai_edition.get("excluded_article_ids") or [])
    sections = {}
    for sec, meta in SECTION_META.items():
        arts = [
            art for art in (sections_raw.get(sec) or [])
            if art.get("id") not in excluded_ids
            and not _is_paywalled(art.get("link", ""), art.get("source", ""))
        ]
        for art in arts:
            if not art.get("summary") and art["id"] in ai_summaries:
                art["summary"] = str(ai_summaries[art["id"]]).strip()
            if art["id"] in takeaways:
                art["why_it_matters"] = takeaways[art["id"]]
        sections[sec] = {
            "key": sec,
            "title": meta["title"],
            "kicker": meta["kicker"],
            "description": meta["description"],
            "highlight": highlights.get(sec) or meta["description"],
            "articles": arts,
        }

    # Issue number: days since Jan 1, 2026 + 1
    issue_num = max(1, (today_date - datetime(2026, 1, 1).date()).days + 1)

    edition = {
        "date": today_str,
        "date_display": today_date.strftime("%A, %B %d, %Y"),
        "issue_number": f"Vol. I • No. {issue_num}",
        "masthead_title": settings.get("masthead_title") or "The Daily Dispatch",
        "masthead_subtitle": settings.get("masthead_subtitle") or "All the News & Curiosity Fit to Print — Personal Edition",
        "generated_at": now_est.isoformat(),
        "generated_display": now_est.strftime("%I:%M %p %Z"),
        "ai_model_used": ai_edition.get("ai_model_used", _get_preferred_ai_model(settings)),
        "archived": False,
        "weather": weather,
        "garmin_corner": garmin_corner,
        "lead_story": ai_edition.get("lead_story") or {},
        "morning_briefing": ai_edition.get("morning_briefing") or [],
        "editorial_column": ai_edition.get("editorial_column") or {},
        "deep_dives": ai_edition.get("deep_dives") or [],
        "sections": sections,
        "wikipedia": wikipedia,
        "comics": comics,
        "daily_extras": ai_edition.get("daily_extras") or {},
    }

    storage.save_edition(today_str, edition)
    return edition


_press_lock = threading.Lock()
_press_building = False
_heal_in_progress = set()
_scheduler_started = False


def _get_press_lock_path():
    return os.path.join(storage.BASE_DIR, "press.lock")


def _get_last_scheduled_press_path():
    return os.path.join(storage.BASE_DIR, "last_scheduled_press.txt")


def _acquire_cross_process_press_lock():
    """Atomically create press.lock across worker processes; return True if acquired."""
    lock_path = _get_press_lock_path()
    storage._ensure_dirs()
    for _ in range(2):
        try:
            fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            try:
                os.write(fd, f"{os.getpid()}:{time.time()}".encode("utf-8"))
            finally:
                os.close(fd)
            return True
        except FileExistsError:
            try:
                age = time.time() - os.path.getmtime(lock_path)
                if age >= 180:
                    os.remove(lock_path)
                    continue
            except OSError:
                continue
            return False
        except OSError:
            return False
    return False


def _release_cross_process_press_lock():
    lock_path = _get_press_lock_path()
    try:
        if os.path.exists(lock_path):
            os.remove(lock_path)
    except OSError:
        pass


def is_edition_printing():
    """Return True while a background newspaper print job is active (thread or cross-worker lock)."""
    if _press_building:
        return True
    lock_path = _get_press_lock_path()
    if os.path.exists(lock_path):
        try:
            age = time.time() - os.path.getmtime(lock_path)
            if age < 180:
                return True
            os.remove(lock_path)
        except OSError:
            pass
    return False


def trigger_background_edition_build(force_refresh=False):
    """Trigger build_daily_edition in a background daemon thread without blocking HTTP requests."""
    global _press_building
    with _press_lock:
        if _press_building:
            return True
        if not _acquire_cross_process_press_lock():
            return True
        _press_building = True

    def _worker():
        global _press_building
        try:
            build_daily_edition(force_refresh=force_refresh)
        except Exception as e:
            logger.error(f"Background newspaper edition build failed: {e}", exc_info=True)
        finally:
            with _press_lock:
                _press_building = False
                _release_cross_process_press_lock()

    threading.Thread(target=_worker, name="newspaper-press-worker", daemon=True).start()
    return True


def trigger_background_comics_heal(date_str, edition=None):
    """Embed inline comic data URIs for a cached edition in the background."""
    with _press_lock:
        if date_str in _heal_in_progress:
            return
        _heal_in_progress.add(date_str)

    def _heal_worker():
        try:
            ed = edition or storage.get_edition(date_str)
            if not ed:
                return
            target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            existing_ids = [
                c.get("id") for c in (ed.get("comics") or [])
                if isinstance(c, dict) and c.get("id")
            ]
            enabled_ids = existing_ids or storage.load_editorial_settings().get("enabled_comics")
            ed["comics"] = fetch_daily_comics(target_date, enabled_ids)
            storage.save_edition(date_str, ed)
        except Exception as e:
            logger.warning(f"Background comics heal failed for {date_str}: {e}")
        finally:
            with _press_lock:
                _heal_in_progress.discard(date_str)

    threading.Thread(target=_heal_worker, name=f"newspaper-heal-{date_str}", daemon=True).start()


def _needs_3am_press(now_est):
    """Return True if it is >= 3:00 AM EST today and today's 3 AM edition hasn't printed yet."""
    if now_est.hour < 3:
        return False
    today_str = now_est.date().isoformat()
    marker_path = _get_last_scheduled_press_path()
    existing = storage.get_edition(today_str)

    if os.path.exists(marker_path):
        try:
            with open(marker_path, "r", encoding="utf-8") as f:
                last_date = f.read().strip()
            if last_date == today_str and existing:
                return False
        except OSError:
            pass

    if existing:
        gen_at = str(existing.get("generated_at") or "")
        if gen_at >= f"{today_str}T03:00:00":
            try:
                storage._ensure_dirs()
                with open(marker_path, "w", encoding="utf-8") as f:
                    f.write(today_str)
            except OSError:
                pass
            return False

    return True


def start_daily_press_scheduler():
    """Start daemon thread that pre-prints missing today's edition on boot and prints daily at 3:00 AM EST."""
    global _scheduler_started
    with _press_lock:
        if _scheduler_started:
            return
        _scheduler_started = True

    def _scheduler_loop():
        # Small stagger per worker PID to avoid simultaneous startup bursts
        time.sleep(4.0 + (os.getpid() % 5) * 0.4)
        try:
            now_est = datetime.now(EST)
            today_str = now_est.date().isoformat()
            existing = storage.get_edition(today_str)
            if not existing:
                logger.info(f"Morning Press: Edition for {today_str} missing on startup; pre-printing in background...")
                trigger_background_edition_build(force_refresh=False)
                if now_est.hour >= 3:
                    try:
                        storage._ensure_dirs()
                        with open(_get_last_scheduled_press_path(), "w", encoding="utf-8") as f:
                            f.write(today_str)
                    except OSError:
                        pass
            elif _comics_need_embed(existing.get("comics")):
                trigger_background_comics_heal(today_str, existing)
        except Exception as e:
            logger.warning(f"Morning Press startup check failed: {e}")

        while True:
            time.sleep(60)
            try:
                now_est = datetime.now(EST)
                if _needs_3am_press(now_est) and not is_edition_printing():
                    today_str = now_est.date().isoformat()
                    try:
                        storage._ensure_dirs()
                        with open(_get_last_scheduled_press_path(), "w", encoding="utf-8") as f:
                            f.write(today_str)
                    except OSError:
                        pass
                    logger.info(f"Morning Press: Running scheduled 3:00 AM EST print for {today_str}...")
                    trigger_background_edition_build(force_refresh=True)
            except Exception as e:
                logger.warning(f"Morning Press scheduler loop error: {e}")

    threading.Thread(target=_scheduler_loop, name="newspaper-3am-scheduler", daemon=True).start()
