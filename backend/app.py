import io
import threading

from flask import Flask, jsonify, request, send_file

from details import FIELDS, LEVELS, USER_FIELDS, WORK_MODES, DetailsError, extract_details
from insights import InsightsError, build_insights
from resume_repo import commit_resume, current_commit, resume_at
from storage import (
    STATUSES,
    delete_page,
    fail_unfinished_details,
    get_page,
    list_pages,
    save_page,
    set_details,
    snapshot_paths,
    update_status,
) 
from utils import FetchError, fetch_page

app = Flask(__name__)
fail_unfinished_details()  # background readings don't survive a restart
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024 # max upload size (10 MB)  

# flask end points

class BadRequest(Exception):
    """The request's input is invalid"""

# error handling

@app.errorhandler(BadRequest)
def bad_request(e):
    return jsonify(error=str(e)), 400


def optional_text(value):
    """extract optional form field's text, or None if it was left blank"""
    value = (value or "").strip()
    return value or None


def valid_status(value):
    if value not in STATUSES:
        raise BadRequest(f"status must be one of: {', '.join(STATUSES)}")
    return value


def entered_details():
    """location, level, field, and work mode extracted from the form. blank fields are left for the LLM to classify"""
    details = {}
    for name, choices in USER_FIELDS.items():
        value = optional_text(request.form.get(name))
        if value and choices and value not in choices:
            raise BadRequest(f"{name} must be one of: {', '.join(choices)}")
        if value:
            details[name] = value
    return details


def read_details_in_background(page_id, text):
    """LLM reads the posting without making the user wait"""
    set_details(page_id, "pending")

    def run():
        try:
            set_details(page_id, "done", extract_details(text))
        except DetailsError as e:
            app.logger.warning("couldn't read details for %s: %s", page_id, e)
            set_details(page_id, "failed")

    threading.Thread(target=run, daemon=True).start()


def uploaded_resume():
    """The PDF bytes from the request's 'resume' file field, or None if none was sent."""
    file = request.files.get("resume")
    if file is None or not file.filename:
        return None
    pdf_bytes = file.read()
    if not pdf_bytes.startswith(b"%PDF-"):
        raise BadRequest("resume must be a PDF")
    return pdf_bytes

# application link api

@app.post('/api/link')
def link():
    """save a job application: a posting link (required), plus optional company, notes,
    status (defaults to submitted), and resume.

    Takes a multipart form, so resume PDF can come along with the other fields and handled here.
    """
    url = optional_text(request.form.get("url"))
    if not url:
        raise BadRequest("'url' is required")
    company = optional_text(request.form.get("company"))
    notes = optional_text(request.form.get("notes"))
    status = valid_status(optional_text(request.form.get("status")) or "submitted")
    details = entered_details()
    resume_pdf = uploaded_resume()  # Checked before the slow page fetch

    try:
        page = fetch_page(url)
    except ValueError as e:
        raise BadRequest(str(e)) from e
    except FetchError as e:
        return jsonify(error=f"couldn't fetch the page: {e}"), 502

    # A resume sent with the application becomes the current one. Either way, record which
    # version was current, so this application can show the resume that was sent.
    resume_commit = commit_resume(resume_pdf)[0] if resume_pdf else current_commit()
    meta = save_page(
        url, page, resume_commit, company=company, notes=notes, status=status, entered=details
    )
    read_details_in_background(meta["id"], page["text"])
    return jsonify(get_page(meta["id"])), 201

# history side bar endpoints - see previously stored runs
@app.get('/api/history')
def history():
    return jsonify(pages=list_pages())


@app.get('/api/history/<page_id>')
def history_page(page_id):
    page = get_page(page_id)
    if page is None:
        return jsonify(error="page not found"), 404
    return jsonify(page)


@app.patch('/api/history/<page_id>')
def update_history_page(page_id):
    """Update an application (only status right now)."""
    payload = request.get_json(silent=True) or {}
    if not update_status(page_id, valid_status(payload.get("status"))):
        return jsonify(error="page not found"), 404
    return jsonify(get_page(page_id))


@app.delete('/api/history/<page_id>')
def delete_history_page(page_id):
    """Delete an application, along with its snapshots."""
    if not delete_page(page_id):
        return jsonify(error="page not found"), 404
    return "", 204


@app.post('/api/history/<page_id>/details')
def retry_details(page_id):
    """Have the LLM read a saved posting again, e.g. after Ollama wasn't running."""
    page = get_page(page_id)
    if page is None:
        return jsonify(error="page not found"), 404
    # What the user entered is kept; only the LLM's answer is redone.
    read_details_in_background(page_id, page["text"] or "")
    return jsonify(get_page(page_id)), 202


@app.get('/api/insights')
def insights():
    """Chart data for the Insights view. ?range=7|30|90|all, ?tz=<IANA zone, e.g. America/New_York>."""
    try:
        return jsonify(build_insights(request.args.get("range", "30"), request.args.get("tz", "UTC")))
    except InsightsError as e:
        raise BadRequest(str(e)) from e


@app.get('/api/options')
def options():
    """The choices the form offers for each classified field."""
    return jsonify(statuses=list(STATUSES), levels=LEVELS, fields=FIELDS, work_modes=WORK_MODES)


@app.get('/api/history/<page_id>/snapshot/<int:number>')
def history_snapshot(page_id, number):
    """One snapshot chunk, numbered from 1 top to bottom"""
    paths = snapshot_paths(page_id) if get_page(page_id) else []
    if not 1 <= number <= len(paths):
        return jsonify(error="no such snapshot for this page"), 404
    return send_file(paths[number - 1], mimetype="image/png")


# resume get end point
@app.get('/api/resume/<commit>')
def resume_version(commit):
    """The resume PDF as it was at a commit, shown in the browser directly"""
    pdf_bytes = resume_at(commit)
    if pdf_bytes is None:
        return jsonify(error="no resume at that commit"), 404
    return send_file(io.BytesIO(pdf_bytes), mimetype="application/pdf", download_name="resume.pdf")


if __name__ == '__main__':
    app.run(debug=True, port=5001)
