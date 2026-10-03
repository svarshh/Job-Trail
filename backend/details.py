import json
import os
import urllib.error
import urllib.request

# job details are pulled out of a posting's OCR text by a local LLM running in Ollama.
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
TIMEOUT_SECONDS = 300  # a 7B model can take a minute, let timeout be 5 min
MAX_TEXT_CHARS = 12_000  # postings are rarely longer
CONTEXT_TOKENS = 8_192  # ollama's default is smaller and silently cuts off long prompts

# choices for the classified fields form offers and the LLM must pick from these.
LEVELS = ["Intern", "New grad", "Junior", "Mid-level", "Senior", "Staff+", "Manager"]
FIELDS = [
    "Frontend", "Backend", "Full-stack", "Mobile", "ML / AI", "Data science", "Data engineering",
    "DevOps / Infrastructure", "Security", "Embedded / Hardware", "Research", "Product", "Design",
    "QA / Testing", "Other",
]
WORK_MODES = ["Remote", "Hybrid", "On-site"]

# fields  user can set in the form (overriding llm classification).
USER_FIELDS = {"location": None, "level": LEVELS, "field": FIELDS, "work_mode": WORK_MODES}

# ollama enforces the model to answer with exactly this shape
SCHEMA = {
    "type": "object",
    "properties": {
        "role": {"type": ["string", "null"]},
        "company": {"type": ["string", "null"]},
        "location": {"type": ["string", "null"]},
        "level": {"enum": [*LEVELS, None]},
        "field": {"enum": [*FIELDS, None]},
        "work_mode": {"enum": [*WORK_MODES, None]},
        "salary": {"type": ["string", "null"]},
        "requirements": {"type": "array", "items": {"type": "string"}},
        "summary": {"type": ["string", "null"]},
    },
    "required": [
        "role", "company", "location", "level", "field", "work_mode", "salary", "requirements",
        "summary",
    ],
}

PROMPT = """Extract details from this job posting. The text was read from a screenshot with OCR, \
so it may contain menus, footers, and small errors like 'Al' for 'AI'; ignore those. \
Use null for anything not stated. Do not guess.
role: the job title exactly as written in the posting.
level: from the title and the experience asked for (e.g. "Senior" in the title, or 5+ years).
field: the closest match for the day-to-day work, judged by the title first. "Frontend" is user
interfaces (React, CSS); "Backend" is servers, APIs, and databases; "Full-stack" is both;
"ML / AI" covers building with models, LLMs, or agents; "Data science" is analysis and
statistics; "Data engineering" is data pipelines.
requirements: the 5-8 most important qualifications, each under 15 words.
summary: one sentence on what the role does.

POSTING:
"""


def merge_details(found, entered):
    """LLM's details with any field the user entered taking its place."""
    return {**found, **{key: value for key, value in entered.items() if value}}


class DetailsError(Exception):
    """The details couldn't be extracted"""


def extract_details(text):
    """role, company, location, work mode, salary, requirements, and a summary from a posting's text."""
    body = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "format": SCHEMA,
        "options": {"temperature": 0, "num_ctx": CONTEXT_TOKENS},
        "messages": [{"role": "user", "content": PROMPT + text[:MAX_TEXT_CHARS]}],
    }
    request = urllib.request.Request(
        f"{OLLAMA_URL}/api/chat",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            reply = json.load(response)
        return json.loads(reply["message"]["content"])
    except (urllib.error.URLError, TimeoutError) as e:
        raise DetailsError(f"couldn't reach Ollama at {OLLAMA_URL}: {e}") from e
    except (KeyError, ValueError) as e:
        raise DetailsError(f"Ollama gave an unexpected reply: {e}") from e
