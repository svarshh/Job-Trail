import re
import subprocess
from datetime import datetime
from pathlib import Path

# The resume has its own git repo where it stores only one file and one commit per upload. Every resume version
# is kept using git version tracking without storing a separate PDF for each 

REPO_DIR = Path(__file__).parent / "resumes"
RESUME_FILE = "resume.pdf"

# Commits are made by the app, so not using user's global configs
GIT_IDENTITY = ["-c", "user.name=Job Bud", "-c", "user.email=job-bud@localhost"]
COMMIT_PATTERN = re.compile(r"^[0-9a-f]{7,40}$")


def git(*args, text=True):
    return subprocess.run(
        ["git", "-C", str(REPO_DIR), *GIT_IDENTITY, *args],
        capture_output=True,
        text=text,
        check=True,
    ).stdout


def ensure_repo():
    """If resume repo doesn't exist, create it with a .gitkeep as its first commit."""
    if (REPO_DIR / ".git").exists():
        return
    REPO_DIR.mkdir(parents=True, exist_ok=True)
    git("init", "--quiet")
    (REPO_DIR / ".gitkeep").touch()
    git("add", ".gitkeep")
    git("commit", "--quiet", "-m", "init")


def commit_resume(pdf_bytes):
    """Save uploaded pdf for resume as resume.pdf and commit it. Returns (commit hash (string), whether anything changed (bool))"""
    ensure_repo()
    (REPO_DIR / RESUME_FILE).write_bytes(pdf_bytes)
    git("add", RESUME_FILE)

    # Uploading the same file again shouldn't create an empty commit.
    if not git("status", "--porcelain", "--", RESUME_FILE).strip():
        return current_commit(), False

    git("commit", "--quiet", "-m", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    return current_commit(), True


def current_commit():
    """The commit of the latest resume upload, or None if no resume has been uploaded yet"""
    if not (REPO_DIR / ".git").exists():
        return None
    return git("log", "-1", "--format=%H", "--", RESUME_FILE).strip() or None


def resume_at(commit):
    """The resume PDF as it was at a commit, or None if the commit is not known."""
    if not COMMIT_PATTERN.match(commit) or not (REPO_DIR / ".git").exists():
        return None
    try:
        return git("show", f"{commit}:{RESUME_FILE}", text=False)
    except subprocess.CalledProcessError:
        return None
