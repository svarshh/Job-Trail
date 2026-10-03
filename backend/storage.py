import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from details import merge_details

# Page details and OCR text are stored in SQLite. Each page's snapshots are PNGs named <id>-1.png, <id>-2.png, ... and so on.
DATA_DIR = Path(__file__).parent / "data"
DB_PATH = DATA_DIR / "job_bud.db"
PAGES_DIR = DATA_DIR / "pages"

SCHEMA = """
CREATE TABLE IF NOT EXISTS pages (
    id        TEXT PRIMARY KEY,
    url       TEXT NOT NULL,
    final_url TEXT NOT NULL,
    title     TEXT,
    saved_at  TEXT NOT NULL,
    text      TEXT,
    resume_commit TEXT,
    company   TEXT,
    notes     TEXT,
    status    TEXT NOT NULL DEFAULT 'submitted',
    details   TEXT,
    details_status TEXT
)
"""

# Application statuses.
STATUSES = ("submitted", "callback", "accepted", "rejected")

# The history list leaves out the text and notes, which can be long.
SUMMARY_COLUMNS = (
    "id, url, final_url, title, saved_at, resume_commit, company, status, details, details_status"
)


def connect():
    # connect to db
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(SCHEMA)
    return conn


def save_page(url, page, resume_commit, company=None, notes=None, status="submitted", entered=None):
    PAGES_DIR.mkdir(parents=True, exist_ok=True)

    saved_at = datetime.now(timezone.utc)
    page_id = f"{saved_at:%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}"
    meta = {
        "id": page_id,
        "url": url,
        "final_url": page["final_url"],
        "title": page["title"],
        "saved_at": saved_at.isoformat(),
        "resume_commit": resume_commit,
        "company": company,
        "notes": notes,
        "status": status,
        "details": entered or None,
    }

    # write the snapshots first so a row never points at a missing file.
    for number, snapshot in enumerate(page["snapshots"], start=1):
        (PAGES_DIR / f"{page_id}-{number}.png").write_bytes(snapshot)
    with connect() as conn:
        conn.execute(
            "INSERT INTO pages"
            " (id, url, final_url, title, saved_at, resume_commit, company, notes, status, details, text)"
            " VALUES (:id, :url, :final_url, :title, :saved_at, :resume_commit, :company, :notes,"
            " :status, :details, :text)",
            {**meta, "details": json.dumps({"entered": entered or {}, "found": None}), "text": page["text"]},
        )
    conn.close()
    return meta


def list_pages():
    """Get details for every saved page from db, newest shown on top"""
    with connect() as conn:
        rows = conn.execute(f"SELECT {SUMMARY_COLUMNS} FROM pages ORDER BY saved_at DESC").fetchall()
    conn.close()
    return [row_to_page(row) for row in rows]


def row_to_page(row):
    """A row as a dict, with the user's and the LLM's details merged (the user's win).

    "entered" lists the fields the user typed, so the page can mark the rest as auto-detected.
    """
    page = dict(row)
    raw = json.loads(page["details"]) if page["details"] else {}
    entered, found = raw.get("entered") or {}, raw.get("found") or {}
    page["details"] = merge_details(found, entered) if (entered or found) else None
    page["entered"] = sorted(entered)
    return page


def get_page(page_id):
    """Details and text for one saved page, or None if the id is unknown."""
    with connect() as conn:
        row = conn.execute("SELECT * FROM pages WHERE id = ?", (page_id,)).fetchone()
    conn.close()
    if row is None:
        return None
    return {**row_to_page(row), "snapshots": len(snapshot_paths(page_id))}


def update_status(page_id, status):
    """Change an application's status. Returns False if the id is unknown."""
    with connect() as conn:
        updated = conn.execute("UPDATE pages SET status = ? WHERE id = ?", (status, page_id)).rowcount
    conn.close()
    return updated == 1


def set_details(page_id, details_status, found=None):
    """record the LLM's progress on a page, and what it found once it's done.

    What the user entered is kept. company it found fills in the company field only if the
    user left that blank.
    """
    with connect() as conn:
        row = conn.execute("SELECT details FROM pages WHERE id = ?", (page_id,)).fetchone()
        if row is None:
            return
        raw = json.loads(row["details"]) if row["details"] else {}
        if found is not None:
            raw["found"] = found
        conn.execute(
            "UPDATE pages SET details_status = ?, details = ?, company = COALESCE(company, ?)"
            " WHERE id = ?",
            (details_status, json.dumps(raw), (found or {}).get("company"), page_id),
        )
    conn.close()


def delete_page(page_id):
    """Delete an application and its snapshots. Returns False if the id is unknown.
    resume it used stays in the resume repo
    """
    paths = snapshot_paths(page_id)
    with connect() as conn:
        deleted = conn.execute("DELETE FROM pages WHERE id = ?", (page_id,)).rowcount
    conn.close()
    if deleted:
        for path in paths:
            path.unlink(missing_ok=True)
    return deleted == 1


def fail_unfinished_details():
    """mark readings terminated by a restart as failed so they can be retried instead of left stuck"""
    with connect() as conn:
        conn.execute("UPDATE pages SET details_status = 'failed' WHERE details_status = 'pending'")
    conn.close()


def snapshot_paths(page_id):
    """The page's snapshot file paths from top to bottom based on page id"""
    single = PAGES_DIR / f"{page_id}.png"
    if single.exists():
        return [single]
    chunks = PAGES_DIR.glob(f"{page_id}-*.png")
    return sorted(chunks, key=lambda path: int(path.stem.rsplit("-", 1)[1]))
