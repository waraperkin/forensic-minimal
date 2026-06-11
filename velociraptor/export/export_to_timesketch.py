"""Export Velociraptor → Timesketch timeline."""
from __future__ import annotations

import csv
import io
import re
import time
from typing import Any

import requests

from common import TIMESKETCH_PASSWORD, TIMESKETCH_URL, TIMESKETCH_USER, normalize_events, now_iso


def _login(session: requests.Session) -> bool:
    r = session.get(f"{TIMESKETCH_URL}/login/", timeout=20)
    m = re.search(r'csrf-token" content="([^"]+)"', r.text)
    if not m:
        return False
    session.post(
        f"{TIMESKETCH_URL}/login/",
        data={"username": TIMESKETCH_USER, "password": TIMESKETCH_PASSWORD},
        headers={"Referer": f"{TIMESKETCH_URL}/login/"},
        timeout=25,
    )
    return True


def export_to_timesketch(payload: dict[str, Any]) -> dict[str, Any]:
    events = normalize_events(payload)
    if not events:
        return {"ok": False, "error": "no_events"}

    case_id = payload.get("case_id") or "VR-EXPORT"
    session = requests.Session()
    if not _login(session):
        return {"ok": False, "error": "login_failed"}

    sketch_name = f"Velociraptor-{case_id}-{int(time.time())}"
    cr = session.post(
        f"{TIMESKETCH_URL}/api/v1/sketches/",
        json={"sketch": {"name": sketch_name, "description": "Timeline Velociraptor"}},
        timeout=30,
    )
    if cr.status_code >= 400:
        return {"ok": False, "error": f"sketch_create:{cr.status_code}"}
    try:
        sketch_id = cr.json().get("objects", [{}])[0].get("id")
    except Exception as exc:
        return {"ok": False, "error": f"sketch_parse:{exc}"}
    if not sketch_id:
        return {"ok": False, "error": "sketch_id_missing"}

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["message", "datetime", "timestamp_desc", "timestamp", "data_type", "source_short", "source_long", "extra", "tag"])
    for ev in events:
        writer.writerow([
            ev.get("message", ""),
            ev.get("@timestamp", ""),
            "Velociraptor event",
            ev.get("@timestamp", ""),
            payload.get("artifact") or "velociraptor",
            "velociraptor",
            ev.get("host", "unknown"),
            f"case={case_id}",
            "velociraptor",
        ])

    up = session.post(
        f"{TIMESKETCH_URL}/api/v1/sketches/{sketch_id}/upload/",
        files={"file": ("velociraptor.csv", buf.getvalue(), "text/csv")},
        timeout=120,
    )
    return {"ok": up.status_code < 400, "sketch_id": sketch_id, "sketch_name": sketch_name, "events": len(events), "status": up.status_code}
