#!/usr/bin/env python3
"""E2E MISP : login UI (email .env) + création event + IOC."""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request

try:
    import requests
except ImportError:
    requests = None  # type: ignore

MISP_URL = os.environ.get("MISP_URL", "http://localhost:8090").rstrip("/")
API_KEY = os.environ.get("MISP_ADMIN_API_KEY", "a1b2c3d4e5f6789012345678901234567890abcd")
ADMIN_EMAIL = os.environ.get("MISP_ADMIN_EMAIL", "admin@forensic.local")
ADMIN_PASSWORD = os.environ.get("MISP_ADMIN_PASSWORD", "F0r3ns1c_MISP_2024!")
EVENT_INFO = os.environ.get("MISP_E2E_INFO", "FP Deep Test — Wara simulation")


def req(method: str, path: str, body: dict | None = None) -> dict:
    url = f"{MISP_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": API_KEY,
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(r, timeout=30) as resp:
        return json.loads(resp.read().decode())


def verify_ui_login() -> None:
    if requests is None:
        raise RuntimeError("requests requis pour le test login UI")
    s = requests.Session()
    r = s.get(f"{MISP_URL}/users/login", timeout=25)
    if r.status_code != 200 or "password" not in r.text:
        raise RuntimeError(f"page login invalide HTTP {r.status_code}")
    key = re.search(r'name="data\[_Token\]\[key\]"[^>]*value="([^"]+)"', r.text)
    fields = re.search(r'name="data\[_Token\]\[fields\]"[^>]*value="([^"]*)"', r.text)
    if not key:
        raise RuntimeError("CSRF token MISP introuvable")
    data = {
        "_method": "POST",
        "data[_Token][key]": key.group(1),
        "data[_Token][fields]": fields.group(1) if fields else "",
        "data[_Token][unlocked]": "",
        "data[User][email]": ADMIN_EMAIL,
        "data[User][password]": ADMIN_PASSWORD,
    }
    r2 = s.post(f"{MISP_URL}/users/login", data=data, allow_redirects=False, timeout=30)
    if r2.status_code not in (302, 303):
        raise RuntimeError(f"login UI refusé HTTP {r2.status_code}")
    r3 = s.get(f"{MISP_URL}/events/index", allow_redirects=True, timeout=30)
    if r3.status_code != 200 or "login" in r3.url:
        raise RuntimeError("session UI non établie après login")


def main() -> int:
    verify_ui_login()
    print(f"[misp-e2e] OK login UI ({ADMIN_EMAIL})")

    event = {
        "info": EVENT_INFO,
        "threat_level_id": 2,
        "analysis": 0,
        "distribution": 0,
        "Attribute": [
            {
                "type": "ip-dst",
                "value": "203.0.113.50",
                "category": "Network activity",
                "to_ids": True,
            },
            {
                "type": "domain",
                "value": "evil-wara-test.example",
                "category": "Network activity",
                "to_ids": True,
            },
            {
                "type": "md5",
                "value": "d41d8cd98f00b204e9800998ecf8427e",
                "category": "Payload delivery",
                "to_ids": True,
            },
        ],
    }
    created = req("POST", "/events/add", event)
    ev = created.get("Event") or created
    eid = ev.get("id")
    uuid = ev.get("uuid")
    if not eid:
        print(f"[misp-e2e] FAIL: pas d'id event: {created}", file=sys.stderr)
        return 1

    fetched = req("GET", f"/events/view/{eid}")
    fev = fetched.get("Event") or fetched
    attrs = fev.get("Attribute") or []
    if len(attrs) < 3:
        print(f"[misp-e2e] FAIL: attributs={len(attrs)}", file=sys.stderr)
        return 1

    print(f"[misp-e2e] OK event_id={eid} uuid={uuid} attributes={len(attrs)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
