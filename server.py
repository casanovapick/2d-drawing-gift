#!/usr/bin/env python3
"""Local Web & Thai TTS Caching Server for Kawaii Gift Gachapon (Port 8080)."""

import hashlib
import os
import ssl
import sys
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8080"))
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(ROOT_DIR, ".tts_cache")
os.makedirs(CACHE_DIR, exist_ok=True)


def split_thai_chunks(text: str, max_len: int = 170):
    text = " ".join(text.strip().split())
    if len(text) <= max_len:
        return [text] if text else []

    parts = []
    current = ""
    for token in text.replace(",", " , ").split(" "):
        token = token.strip()
        if not token:
            continue
        candidate = f"{current} {token}".strip() if current else token
        if len(candidate) <= max_len:
            current = candidate
        else:
            if current:
                parts.append(current)
            current = token[:max_len]
    if current:
        parts.append(current)
    return parts


def download_google_thai_tts(text: str) -> bytes:
    chunks = split_thai_chunks(text)
    if not chunks:
        raise ValueError("Empty TTS text")

    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    audio_bytes = bytearray()
    for chunk in chunks:
        params = urllib.parse.urlencode(
            {
                "ie": "UTF-8",
                "client": "tw-ob",
                "tl": "th",
                "q": chunk,
            }
        )
        url = f"https://translate.google.com/translate_tts?{params}"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
                ),
                "Referer": "https://translate.google.com/",
            },
        )
        with urllib.request.urlopen(req, timeout=8, context=ssl_ctx) as resp:
            data = resp.read()
            if not data or len(data) < 256:
                raise RuntimeError("Received empty TTS response")
            audio_bytes.extend(data)

    return bytes(audio_bytes)


class GameRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def log_message(self, fmt, *args):
        sys.stdout.write(
            "%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args)
        )
        sys.stdout.flush()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/tts":
            self.handle_tts(parsed.query)
            return
        super().do_GET()

    def handle_tts(self, query_string: str):
        qs = urllib.parse.parse_qs(query_string)
        raw_text = (qs.get("text", [""])[0] or "").strip()
        if not raw_text:
            self.send_error(400, "Missing text parameter")
            return

        text = raw_text[:320]
        cache_key = hashlib.sha256(f"th_v2:{text}".encode("utf-8")).hexdigest()[:28]
        cache_file = os.path.join(CACHE_DIR, f"{cache_key}.mp3")

        try:
            if os.path.isfile(cache_file) and os.path.getsize(cache_file) > 256:
                with open(cache_file, "rb") as f:
                    mp3_data = f.read()
            else:
                mp3_data = download_google_thai_tts(text)
                with open(cache_file, "wb") as f:
                    f.write(mp3_data)

            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(mp3_data)))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.send_header("X-Chibi-Pitched", "0")
            self.end_headers()
            self.wfile.write(mp3_data)
        except Exception as exc:
            sys.stderr.write(f"[TTS Error] {exc}\n")
            sys.stderr.flush()
            self.send_error(502, f"TTS generation failed: {exc}")


def main():
    server = ThreadingHTTPServer(("", PORT), GameRequestHandler)
    print(f"🎁 Kawaii Gift Gachapon + Thai TTS server running on http://localhost:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
