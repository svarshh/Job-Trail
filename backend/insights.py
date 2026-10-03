from collections import Counter
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from details import FIELDS, LEVELS, WORK_MODES
from storage import STATUSES, list_pages

RANGES = {"7": 7, "30": 30, "90": 90, "all": None}  # days of history each range covers
UNKNOWN = "Not detected"  # class for applications the LLM hasn't classified yet

# parts of the day hour ranges
TIMES_OF_DAY = [
    ("Morning", "5am–12pm", range(5, 12)),
    ("Afternoon", "12–5pm", range(12, 17)),
    ("Evening", "5–9pm", range(17, 21)),
    ("Night", "9pm–5am", [*range(21, 24), *range(0, 5)]),
]


class InsightsError(ValueError):
    """Bad range or time zone; the message is shown to the user."""


def build_insights(range_key="30", tz_name="UTC"):
    """everything the insights charts need, for one date range, in the user's time zone."""
    if range_key not in RANGES:
        raise InsightsError(f"range must be one of: {', '.join(RANGES)}")
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError) as e:
        raise InsightsError(f"unknown time zone: {tz_name}") from e

    pages = list_pages()
    for page in pages:
        page["local_time"] = datetime.fromisoformat(page["saved_at"]).astimezone(tz)

    today = datetime.now(tz).date()
    days = RANGES[range_key]
    if days is None:
        first = min((page["local_time"].date() for page in pages), default=today)
        start = min(first, today)
    else:
        start = today - timedelta(days=days - 1)
    in_range = [page for page in pages if page["local_time"].date() >= start]

    responses = sum(page["status"] in ("callback", "accepted") for page in in_range)
    return {
        "range": {"key": range_key, "start": start.isoformat(), "end": today.isoformat()},
        "totals": {
            "all_time": len(pages),
            "in_range": len(in_range),
            "responses": responses,
            "response_rate": responses / len(in_range) if in_range else None,
        },
        "per_day": per_day(in_range, start, today),
        "time_of_day": time_of_day(in_range),
        "by_status": breakdown(in_range, lambda page: page["status"], STATUSES),
        "by_work_mode": breakdown(in_range, lambda page: detail(page, "work_mode"), WORK_MODES),
        "by_level": breakdown(in_range, lambda page: detail(page, "level"), LEVELS),
        # fields have no order, so the biggest come first, empty ones are dropped
        "by_field": sorted(
            (row for row in breakdown(in_range, lambda page: detail(page, "field"), FIELDS) if row["count"]),
            key=lambda row: (row["label"] == UNKNOWN, -row["count"]),
        ),
    }


def detail(page, key):
    """one details field of a page, or None."""
    return (page["details"] or {}).get(key)


def per_day(pages, start, end):
    """applications on each day from start to end, including days with none."""
    counts = Counter(page["local_time"].date() for page in pages)
    days = (end - start).days + 1
    return [
        {"date": day.isoformat(), "count": counts[day]}
        for day in (start + timedelta(days=offset) for offset in range(days))
    ]


def time_of_day(pages):
    """applications per part of the day """
    counts = Counter(page["local_time"].hour for page in pages)
    return [
        {"label": label, "hours": hours, "count": sum(counts[hour] for hour in span)}
        for label, hours, span in TIMES_OF_DAY
    ]


def breakdown(pages, value_of, choices):
    """count for every choice, in its usual order, plus one for pages without a value."""
    counts = Counter(value_of(page) for page in pages)
    rows = [{"label": choice, "count": counts[choice]} for choice in choices]
    unknown = sum(count for value, count in counts.items() if value not in choices)
    if unknown:
        rows.append({"label": UNKNOWN, "count": unknown})
    return rows

