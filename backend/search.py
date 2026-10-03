import re

from storage import SUMMARY_COLUMNS, connect, row_to_page

MAX_TERMS = 10  # longer queries are trimmed
MAX_SNIPPETS = 3  # per application
SNIPPET_RADIUS = 60  # characters of context on each side of a match
MAX_RESULTS = 100


class SearchError(ValueError):
    """Bad query; the message is shown to the user."""


def search(query):
    """Applications whose posting text, title, or company contains every word in the query.

    Most matches first. Each result carries a few snippets of the posting text around its matches.
    """
    terms = list(dict.fromkeys(query.lower().split()))[:MAX_TERMS]
    if not terms:
        raise SearchError("enter something to search for")

    # Every word must appear somewhere, wildcards matched literally
    searched = "lower(coalesce(text, '') || ' ' || coalesce(title, '') || ' ' || coalesce(company, ''))"
    where = " AND ".join(f"{searched} LIKE ? ESCAPE '\\'" for _ in terms)
    params = [f"%{escape_like(term)}%" for term in terms]
    with connect() as conn:
        rows = conn.execute(
            f"SELECT {SUMMARY_COLUMNS}, text FROM pages WHERE {where} ORDER BY saved_at DESC",
            params,
        ).fetchall()
    conn.close()

    results = []
    for row in rows:
        page = row_to_page(row)
        text = page.pop("text") or ""
        page["matches"] = sum(text.lower().count(term) for term in terms)
        page["snippets"] = snippets(text, terms)
        results.append(page)
    results.sort(key=lambda page: page["matches"], reverse=True) 
    return {"query": query, "terms": terms, "results": results[:MAX_RESULTS]}


def escape_like(term):
    """Makes %, _, and \\ in a search word match themselves instead of acting as wildcards."""
    return re.sub(r"([\\%_])", r"\\\1", term)


def snippets(text, terms):
    """Up to MAX_SNIPPETS stretches of text around matches, with overlapping ones merged.

    Each is [before, match, after], so the page can highlight the match without parsing HTML.
    """
    pattern = re.compile("|".join(re.escape(term) for term in terms), re.IGNORECASE)
    found = []
    last_end = -1
    for match in pattern.finditer(text):
        if match.start() < last_end:  
            continue
        start = max(0, match.start() - SNIPPET_RADIUS)
        end = min(len(text), match.end() + SNIPPET_RADIUS)
        found.append([
            ("…" if start > 0 else "") + flatten(text[start:match.start()]),
            match.group(),
            flatten(text[match.end():end]) + ("…" if end < len(text) else ""),
        ])
        last_end = end
        if len(found) == MAX_SNIPPETS:
            break
    return found


def flatten(text):
    """OCR text has a line break per line on screen; snippets read better on one line."""
    return re.sub(r"\s+", " ", text)
