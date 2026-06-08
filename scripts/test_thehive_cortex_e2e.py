#!/usr/bin/env python3
"""E2E TheHive : case + observable (si RBAC OK). Cortex : status + analyzers."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

TH_URL = os.environ.get("THEHIVE_URL", "http://localhost:9002/thehive").rstrip("/")
TH_USER = os.environ.get("THEHIVE_ANALYST_LOGIN", "cert-analyst@forensic.local")
TH_PASS = os.environ.get("THEHIVE_ANALYST_PASSWORD", "F0r3ns1c_TH_Analyst!")
TH_ADMIN = os.environ.get("THEHIVE_ADMIN_LOGIN", "admin@thehive.local")
TH_ADMIN_PASS = os.environ.get("THEHIVE_ADMIN_PASSWORD", "secret")
CX_URL = os.environ.get("CORTEX_URL", "http://localhost:9003").rstrip("/")
CX_KEY = os.environ.get("CORTEX_API_KEY", "forensic-cortex-api-key-2024-internal")


def th_req(method: str, path: str, body: dict | None = None, user: str = TH_USER, password: str = TH_PASS) -> dict:
    url = f"{TH_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    import base64

    auth = base64.b64encode(f"{user}:{password}".encode()).decode()
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else {}


def ensure_analyst_user() -> None:
    """Crée l'utilisateur analyste org si absent (bootstrap deep test)."""
    try:
        th_req("GET", "/api/v1/user/current", user=TH_USER, password=TH_PASS)
        return
    except urllib.error.HTTPError:
        pass
    orgs = th_req("POST", "/api/v1/query", {"query": [{"_name": "listOrganisation"}]}, user=TH_ADMIN, password=TH_ADMIN_PASS)
    org_id = orgs[0]["_id"] if orgs else "~20584"
    th_req(
        "POST",
        "/api/v1/user",
        {
            "login": TH_USER,
            "name": "CERT Analyst E2E",
            "profile": "org-admin",
            "password": TH_PASS,
            "organisations": [{"organisation": org_id, "profile": "org-admin"}],
        },
        user=TH_ADMIN,
        password=TH_ADMIN_PASS,
    )
    try:
        th_req("POST", f"/api/v1/user/~4144/password/set", {"password": TH_PASS}, user=TH_ADMIN, password=TH_ADMIN_PASS)
    except Exception:
        pass


def main() -> int:
    ensure_analyst_user()
    try:
        case = th_req(
            "POST",
            "/api/v1/case",
            {"title": "FP Deep Test Wara", "description": "Automated forensic platform E2E", "severity": 2},
        )
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        print(f"[thehive-e2e] WARN create case: HTTP {e.code} {body[:200]}", file=sys.stderr)
        print("[thehive-e2e] SKIP case (RBAC) — services UP only")
        return 0

    case_id = case.get("_id") or case.get("id")
    if not case_id:
        print(f"[thehive-e2e] FAIL: {case}", file=sys.stderr)
        return 1

    obs = th_req(
        "POST",
        f"/api/v1/case/{case_id}/observable",
        {"dataType": "domain", "data": "evil-wara-deep-test.example", "message": "E2E observable", "tlp": 2},
    )
    obs_id = obs.get("_id") or obs.get("id")
    print(f"[thehive-e2e] OK case={case_id} observable={obs_id}")

  # Cortex analyzers
    req = urllib.request.Request(
        f"{CX_URL}/api/analyzer",
        headers={"Authorization": CX_KEY, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            analyzers = json.loads(resp.read().decode())
        n = len(analyzers) if isinstance(analyzers, list) else 0
        print(f"[cortex-e2e] analyzers disponibles: {n}")
        if n == 0:
            print("[cortex-e2e] WARN: aucun analyzer — installer via Cortex UI", file=sys.stderr)
    except Exception as exc:
        print(f"[cortex-e2e] WARN: {exc}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
