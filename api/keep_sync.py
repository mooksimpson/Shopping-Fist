"""Keep inbox: moves new items from your Google Keep list into the app.

"Hey Google, add milk to the shopping list" -> Keep -> this -> Redis inbox
-> the app files it into an aisle next time anyone opens it.

Items are pushed to the inbox BEFORE being removed from Keep, so nothing is
lost if something fails half way (the app ignores duplicates).
"""
import json
import os
import time
import urllib.request
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

import gkeepapi

REDIS_URL = (os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL") or "").rstrip("/")
REDIS_TOKEN = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN") or ""
EMAIL = os.environ.get("GOOGLE_EMAIL", "")
MASTER_TOKEN = os.environ.get("GOOGLE_MASTER_TOKEN", "").strip()
DEVICE_ID = os.environ.get("GOOGLE_DEVICE_ID", "").strip() or None  # the android_id the token was made with
LIST_TITLE = os.environ.get("KEEP_LIST_TITLE", "shopping list").strip().lower()
FAMILY_CODE = os.environ.get("FAMILY_CODE", "")
MIN_GAP_SECONDS = 25          # don't hammer Google if three phones open at once
STATE_MAX_BYTES = 900_000     # cache Keep's sync state if it's small enough


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


def find_list(keep):
    for node in keep.all():
        if isinstance(node, gkeepapi.node.List) and not node.trashed and not node.archived:
            if (node.title or "").strip().lower() == LIST_TITLE:
                return node
    return None


def sync(force=False):
    if not (EMAIL and MASTER_TOKEN):
        return {"ok": False, "error": "GOOGLE_EMAIL / GOOGLE_MASTER_TOKEN not set"}

    # Simple lock so overlapping calls skip instead of double-syncing
    if not force:
        got = redis("SET", "keep_lock", "1", "NX", "EX", MIN_GAP_SECONDS)
        if not got:
            return {"ok": True, "skipped": "synced moments ago"}

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
        # Stale cache: start fresh
        keep = gkeepapi.Keep()
        keep.authenticate(EMAIL, MASTER_TOKEN, device_id=DEVICE_ID)

    lst = find_list(keep)
    if lst is None:
        return {"ok": False, "error": f'No Keep list titled "{LIST_TITLE}"'}

    items = [i for i in lst.unchecked if (i.text or "").strip()]
    moved = []
    if items:
        now = int(time.time() * 1000)
        payload = [json.dumps({"text": i.text.strip(), "by": "Voice", "at": now}) for i in items]
        redis("RPUSH", "inbox", *payload)   # safe in the inbox first...
        for i in items:
            moved.append(i.text.strip())
            i.delete()                      # ...then tidy Keep
        keep.sync()

    try:
        dumped = json.dumps(keep.dump())
        if len(dumped) < STATE_MAX_BYTES:
            redis("SET", "keep_state", dumped)
    except Exception:
        pass

    redis("SET", "keep_last", str(int(time.time())))
    return {"ok": True, "moved": moved}


class handler(BaseHTTPRequestHandler):
    def _respond(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _handle(self):
        qs = parse_qs(urlparse(self.path).query)
        given = self.headers.get("x-family-code") or (qs.get("key") or [""])[0]
        if FAMILY_CODE and given != FAMILY_CODE:
            return self._respond(401, {"ok": False, "error": "Wrong family code"})
        try:
            force = (qs.get("force") or ["0"])[0] == "1"
            self._respond(200, sync(force=force))
        except Exception as e:  # report, don't crash the app
            self._respond(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})

    def do_GET(self):
        self._handle()

    def do_POST(self):
        self._handle()
