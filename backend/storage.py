import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

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
    status    TEXT NOT NULL DEFAULT 'submitted'
)
"""

# Application statuses.
STATUSES = ("submitted", "callback", "accepted", "rejected")

# The history list leaves out the text and notes, which can be long.
SUMMARY_COLUMNS = "id, url, final_url, title, saved_at, resume_commit, company, status"


def connect():
    # connect to db
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(SCHEMA)
    return conn


def save_page(url, page, resume_commit, company=None, notes=None, status="submitted"):
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
    }

    # Write the snapshots first so a row never points at a missing file.
    for number, snapshot in enumerate(page["snapshots"], start=1):
        (PAGES_DIR / f"{page_id}-{number}.png").write_bytes(snapshot)
    with connect() as conn:
        conn.execute(
            "INSERT INTO pages"
            " (id, url, final_url, title, saved_at, resume_commit, company, notes, status, text)"
            " VALUES (:id, :url, :final_url, :title, :saved_at, :resume_commit, :company, :notes,"
            " :status, :text)",
            {**meta, "text": page["text"]},
        )
    conn.close()
    return meta


def list_pages():
    """Get details for every saved page from db, newest shown on top"""
    with connect() as conn:
        rows = conn.execute(f"SELECT {SUMMARY_COLUMNS} FROM pages ORDER BY saved_at DESC").fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_page(page_id):
    """Details and text for one saved page, or None if the id is unknown."""
    with connect() as conn:
        row = conn.execute("SELECT * FROM pages WHERE id = ?", (page_id,)).fetchone()
    conn.close()
    if row is None:
        return None
    return {**dict(row), "snapshots": len(snapshot_paths(page_id))}


def update_status(page_id, status):
    """Change an application's status. Returns False if the id is unknown."""
    with connect() as conn:
        updated = conn.execute("UPDATE pages SET status = ? WHERE id = ?", (status, page_id)).rowcount
    conn.close()
    return updated == 1


def snapshot_paths(page_id):
    """The page's snapshot file paths from top to bottom based on page id"""
    single = PAGES_DIR / f"{page_id}.png"
    if single.exists():
        return [single]
    chunks = PAGES_DIR.glob(f"{page_id}-*.png")
    return sorted(chunks, key=lambda path: int(path.stem.rsplit("-", 1)[1]))
