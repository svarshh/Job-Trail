import io

from flask import Flask, jsonify, request, send_file

from resume_repo import commit_resume, current_commit, resume_at
from storage import STATUSES, get_page, list_pages, save_page, snapshot_paths, update_status
from utils import FetchError, fetch_page

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024 # max upload size (10 MB)  

# flask end points

class BadRequest(Exception):
    """The request's input is invalid; the message is shown to the user."""

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
    meta = save_page(url, page, resume_commit, company=company, notes=notes, status=status)
    return jsonify(**meta, text=page["text"]), 201

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
