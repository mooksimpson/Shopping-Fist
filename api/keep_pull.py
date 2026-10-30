"""Keep bridge: lets another one of your apps (Fo-odyssey) read a Keep list through
this app, so only Shopping-Fist ever holds the Google token.

  GET  /api/keep_pull?list=food%20list
       -> {"ok": true, "items": [{"id": "...", "text": "...", "edited": 1700000000000}]}
       Reads the unchecked items. Does NOT delete anything.

  POST /api/keep_pull   body: {"list": "food list", "ids": ["...", "..."]}
       -> {"ok": true, "removed": 2}
       Deletes those items from Keep. The caller does this only AFTER it has
       safely stored them, so nothing is lost if something fails half way.

Auth: header x-bridge-code (or ?key=) must equal KEEP_BRIDGE_CODE. If that
variable isn't set, the bridge is off. Only lists named in KEEP_BRIDGE_LISTS
(default "food list,nutrition list") can be read, so a leaked code can't be
used to empty your shopping list.
"""
import hmac
import json
import os
import urllib.request
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

import gkeepapi

REDIS_URL = (os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL") or "").rstrip("/")
REDIS_TOKEN = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN") or ""
EMAIL = os.environ.get("GOOGLE_EMAIL", "")
MASTER_TOKEN = os.environ.get("GOOGLE_MASTER_TOKEN", "").strip()
DEVICE_ID = os.environ.get("GOOGLE_DEVICE_ID", "").strip() or None
BRIDGE_CODE = os.environ.get("KEEP_BRIDGE_CODE", "").strip()
ALLOWED_LISTS = [t.strip().lower() for t in os.environ.get("KEEP_BRIDGE_LISTS", "food list,nutrition list").split(",") if t.strip()]
STATE_MAX_BYTES = 900_000


def redis(*args):
    req = urllib.request.Request(
        REDIS_URL,
        data=json.dumps(list(args)).encode(),
        headers={"Authorization": f"Bearer {REDIS_TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        out = json.loads(r.read())
    if "error" in out:
        raise RuntimeError(out["error"])
    return out.get("result")


def connect():
    """Log in to Keep, reusing the cached sync state the shopping sync also keeps."""
    state = None
    try:
        cached = redis("GET", "keep_state")
        state = json.loads(cached) if cached else None
    except Exception:
        state = None
    keep = gkeepapi.Keep()
    try:
        keep.authenticate(EMAIL, MASTER_TOKEN, state=state, device_id=DEVICE_ID)
    except Exception:
        if state is None:
            raise
        keep = gkeepapi.Keep()
        keep.authenticate(EMAIL, MASTER_TOKEN, device_id=DEVICE_ID)
    return keep


def save_state(keep):
    try:
        dumped = json.dumps(keep.dump())
        if len(dumped) < STATE_MAX_BYTES:
            redis("SET", "keep_state", dumped)
    except Exception:
        pass


def find_list(keep, title):
    title = (title or "").strip().lower()
    for node in keep.all():
        if isinstance(node, gkeepapi.node.List) and not node.trashed and not node.archived:
            if (node.title or "").strip().lower() == title:
                return node
    return None


def check_list(title):
    t = (title or "").strip().lower()
    if t not in ALLOWED_LISTS:
        raise PermissionError(f'List "{title}" is not allowed through the bridge')
    return t


def edited_ms(item):
    try:
        return int(item.timestamps.updated.timestamp() * 1000)
    except Exception:
        return None


def pull(title):
    title = check_list(title)
    keep = connect()
    lst = find_list(keep, title)
    if lst is None:
        return {"ok": False, "error": f'No Keep list titled "{title}"'}
    items = [
        {"id": i.id, "text": i.text.strip(), "edited": edited_ms(i)}
        for i in lst.unchecked
        if (i.text or "").strip()
    ]
    save_state(keep)
    return {"ok": True, "items": items}


def ack(title, ids):
    title = check_list(title)
    ids = {str(i) for i in (ids or [])}
    if not ids:
        return {"ok": True, "removed": 0}
    keep = connect()
    lst = find_list(keep, title)
    if lst is None:
        return {"ok": False, "error": f'No Keep list titled "{title}"'}
    removed = 0
    for i in list(lst.unchecked):
        if i.id in ids:
            i.delete()
            removed += 1
    if removed:
        keep.sync()
    save_state(keep)
    return {"ok": True, "removed": removed}


class handler(BaseHTTPRequestHandler):
    def _respond(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _authed(self, qs):
        given = (self.headers.get("x-bridge-code") or (qs.get("key") or [""])[0]).strip()
        return bool(BRIDGE_CODE) and hmac.compare_digest(given.encode(), BRIDGE_CODE.encode())

    def _guard(self, qs):
        if not BRIDGE_CODE:
            self._respond(503, {"ok": False, "error": "Keep bridge is off (KEEP_BRIDGE_CODE not set)"})
            return False
        if not self._authed(qs):
            self._respond(401, {"ok": False, "error": "Wrong bridge code"})
            return False
        if not (EMAIL and MASTER_TOKEN):
            self._respond(500, {"ok": False, "error": "GOOGLE_EMAIL / GOOGLE_MASTER_TOKEN not set"})
            return False
        return True

    def _run(self, fn):
        try:
            self._respond(200, fn())
        except PermissionError as e:
            self._respond(403, {"ok": False, "error": str(e)})
        except Exception as e:  # report, don't crash
            self._respond(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})

    def do_GET(self):
        qs = parse_qs(urlparse(self.path).query)
        if self._guard(qs):
            self._run(lambda: pull((qs.get("list") or [""])[0]))

    def do_POST(self):
        qs = parse_qs(urlparse(self.path).query)
        if not self._guard(qs):
            return
        try:
            length = int(self.headers.get("content-length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._respond(400, {"ok": False, "error": "Bad JSON body"})
        self._run(lambda: ack(body.get("list"), body.get("ids")))
