import io
from urllib.parse import urlparse

import pytesseract
from PIL import Image
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

VIEWPORT = {"width": 1280, "height": 800}  # browser window size
LOAD_TIMEOUT_MS = 20_000  # max page load time
SETTLE_TIMEOUT_MS = 5_000  # max wait for late content

MAX_SNAPSHOT_HEIGHT = 4_000  # split longer pages
CUT_SEARCH_HEIGHT = 400  # look this far up for a blank row to split on


class FetchError(Exception):
    """This page could not be loaded"""


def fetch_page(url):
    """Take job posting link, return its title, snapshots of the entire page, and the text read from them.

    Short pages get one snapshot. longer pages are split into chunks top to bottom so text is large enough for OCR.
    """
    if urlparse(url).scheme not in ("http", "https"):
        raise ValueError("url must start with http:// or https://")

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                page = browser.new_page(viewport=VIEWPORT)
                response = page.goto(url, wait_until="load", timeout=LOAD_TIMEOUT_MS)
                if response is not None and response.status >= 400:
                    raise FetchError(f"the site returned {response.status}")
                try:
                    page.wait_for_load_state("networkidle", timeout=SETTLE_TIMEOUT_MS)
                except PlaywrightError:
                    pass  # Still take snapshot as the page

                final_url = page.url
                title = page.title() or None
                snapshot = page.screenshot(full_page=True, type="png")
            finally:
                browser.close()
    except PlaywrightError as e:
        raise FetchError(str(e).splitlines()[0]) from e

    chunks = split_snapshot(snapshot)
    text = "\n".join(part for part in map(ocr_text, chunks) if part)
    return {
        "final_url": final_url,
        "title": title,
        "text": text,
        "snapshots": [png_bytes(chunk) for chunk in chunks],
    }


def split_snapshot(snapshot):
    """The snapshot as one image, or as chunks of at most MAX_SNAPSHOT_HEIGHT if it's taller."""
    Image.MAX_IMAGE_PIXELS = None  
    image = Image.open(io.BytesIO(snapshot))
    grey = image.convert("L")

    chunks = []
    top = 0
    while top < image.height:
        bottom = min(top + MAX_SNAPSHOT_HEIGHT, image.height)
        if bottom < image.height:
            bottom = blank_row_above(grey, bottom)
        chunks.append(image.crop((0, top, image.width, bottom)))
        top = bottom
    return chunks


def ocr_text(image):
    """text in a snapshot chunk read with Tesseract."""
    return pytesseract.image_to_string(image.convert("L")).strip()


def png_bytes(image):
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def blank_row_above(image, row):
    """nearest row at or above row that is a single solid colour, or row if none is close so no text lines are split between two chunks"""
    for y in range(row, max(row - CUT_SEARCH_HEIGHT, 1), -1):
        darkest, lightest = image.crop((0, y - 1, image.width, y)).getextrema()
        if darkest == lightest:
            return y
    return row
