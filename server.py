#!/usr/bin/env python3
"""Stacks & Flicks local server.

Serves the app from this folder, and relays public Letterboxd RSS feeds for Flicks' taste twins
(browsers can't fetch those feeds themselves: they send no CORS header).

    python server.py          # http://localhost:5178
    python server.py 8000     # another port

Only one upstream URL shape is ever fetched, https://letterboxd.com/<username>/rss/, with a
descriptive User-Agent, at most one request every 1.5 seconds, and each feed cached for 6 hours.
Standard library only.
"""
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
USER_AGENT = 'Flicks/1.0 (personal film recommendations; local helper)'
USERNAME = re.compile(r'^[A-Za-z0-9_]{2,30}$')
CACHE_SECONDS = 6 * 3600
MIN_GAP_SECONDS = 1.5

_cache = {}  # username -> (fetched_at, status, body)
_upstream = threading.Lock()
_last_request = [0.0]


def fetch_feed(user):
    """(status, body) for a member's RSS feed, from cache when fresh."""
    hit = _cache.get(user)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1], hit[2]
    with _upstream:  # one upstream request at a time, spaced out
        wait = _last_request[0] + MIN_GAP_SECONDS - time.time()
        if wait > 0:
            time.sleep(wait)
        _last_request[0] = time.time()
        req = urllib.request.Request(
            f'https://letterboxd.com/{user}/rss/',
            headers={'User-Agent': USER_AGENT, 'Accept': 'application/rss+xml, application/xml'},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                status, body = res.status, res.read()
        except urllib.error.HTTPError as e:
            status, body = e.code, b''
        except (urllib.error.URLError, TimeoutError):
            return 502, b''
    if status in (200, 404):
        _cache[user] = (time.time(), status, body)
    return status, body


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.webmanifest': 'application/manifest+json', '.js': 'text/javascript'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # App files always revalidate, so an edit shows up on a normal reload.
        if not self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/api/health':
            return self.send_json(200, {'ok': True, 'letterboxdRss': True})
        m = re.fullmatch(r'/api/letterboxd/rss/([^/]+)/?', path)
        if m:
            user = m.group(1)
            if not USERNAME.match(user):
                return self.send_json(400, {'error': 'That is not a Letterboxd username.'})
            status, body = fetch_feed(user.lower())
            if status == 404:
                return self.send_json(404, {'error': f'No Letterboxd member called {user}.'})
            if status != 200:
                return self.send_json(502, {'error': f'Letterboxd answered {status}.'})
            self.send_response(200)
            self.send_header('Content-Type', 'application/rss+xml; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return None
        return super().do_GET()

    def send_json(self, status, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return None


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5178
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'Stacks & Flicks on http://localhost:{port}  (Ctrl+C to stop)', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
