from flask import Flask, jsonify, request

app = Flask(__name__)

# flask end points

@app.post('/api/link')
def link():
    payload = request.get_json(silent=True) or {}
    url = payload.get("url")
    if not url:
        return jsonify(error="'url' is required"), 400

    # TODO: wire the html extraction pipeline
    return jsonify(url=url, status="received"), 201



@app.post('/api/query')
def query():
    payload = request.get_json(silent=True) or {}
    url = payload.get("url")
    if not url:
        return jsonify(error="'url' is required"), 400

    # TODO
    return jsonify(url=url, status="received"), 201


@app.post('/api/resume')
def resume():
    file = request.files.get("resume")
    if file is None or not file.filename:
        return jsonify(error="'resume' file is required"), 400
    if not file.filename.lower().endswith(".pdf") or file.mimetype != "application/pdf":
        return jsonify(error="resume must be a PDF"), 400

    # TODO: store the functioanality to effectively store resume version.
    return jsonify(filename=file.filename, status="received"), 201


if __name__ == '__main__':
    app.run(debug=True, port=5001)
