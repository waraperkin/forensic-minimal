#!/usr/bin/env python3
"""Rafraîchit les champs d'un index-pattern OSD depuis OpenSearch field_caps."""
from __future__ import annotations

import json
import os
import sys

import requests

OS = os.environ.get("OS_URL", "http://localhost:9200").rstrip("/")
OSD = os.environ.get("OSD_URL", "http://localhost:5601/dashboards").rstrip("/")

PATTERNS = {
    "fp-platform-health": "forensic-platform-health",
    "fp-ti": "forensic-ti-opencti-*,forensic-ti-misp-*",
    "fp-ti-opencti": "forensic-ti-opencti-*",
    "fp-ti-misp": "forensic-ti-misp-*",
    "fp-events": "forensic-windows-*,forensic-linux-*,forensic-web-*,forensic-network-*,forensic-cloud-*,forensic-endpoint-*,forensic-macos-*,forensic-firewall-*",
    "fp-logs": "forensic-uploads*,fp-platform-logs*,forensic-alerts*",
    "fp-obs-logs": "fp-platform-logs*,forensic-uploads*",
    "fp-timesketch": "forensic-timesketch*,forensic-tokens-*",
    "fp-mitre": "fp-mitre-*",
    "fp-fusion": "forensic-fusion-*",
    "fp-ti-enriched": "forensic-ti-enriched*",
}


def field_caps_to_osd_fields(pattern: str) -> list[dict]:
    """Fusionne field_caps de tous les motifs (séparés par virgule)."""
    merged: dict[str, dict] = {}
    for part in [p.strip() for p in pattern.split(",") if p.strip()]:
        r = requests.get(f"{OS}/_field_caps", params={"index": part, "fields": "*"}, timeout=60)
        if r.status_code == 404:
            continue
        r.raise_for_status()
        for name, types in r.json().get("fields", {}).items():
            if name not in merged:
                merged[name] = types
    fields_out: list[dict] = []
    for name, types in merged.items():
        if name.startswith("_"):
            continue
        es_type = next(iter(types.keys()))
        osd_type = "date" if es_type == "date" else "number" if es_type in ("long", "integer", "float", "double") else "string"
        aggregatable = es_type in ("keyword", "date", "long", "integer", "boolean", "ip", "float", "double")
        fields_out.append(
            {
                "count": 0,
                "name": name,
                "type": osd_type,
                "esTypes": [es_type],
                "scripted": False,
                "searchable": True,
                "aggregatable": aggregatable,
                "readFromDocValues": True,
            }
        )
    fields_out.sort(key=lambda x: x["name"])
    return fields_out


def refresh_one(sess: requests.Session, pattern_id: str, es_pattern: str) -> bool:
    ir = sess.get(f"{OSD}/api/saved_objects/index-pattern/{pattern_id}", timeout=20)
    if ir.status_code != 200:
        print(f"[refresh-ip] KO {pattern_id} HTTP {ir.status_code}")
        return False
    attrs = ir.json().get("attributes", {})
    title = attrs.get("title") or es_pattern
    # Normaliser le titre si vide de match
    if pattern_id == "fp-ti" and "forensic-ti" not in title:
        title = es_pattern

    fields = field_caps_to_osd_fields(attrs.get("title") or es_pattern)
    attrs["fields"] = json.dumps(fields)
    attrs["title"] = title if pattern_id != "fp-ti" else "forensic-ti-*"

    ur = sess.put(
        f"{OSD}/api/saved_objects/index-pattern/{pattern_id}",
        headers={"osd-xsrf": "true", "securitytenant": "global"},
        json={"attributes": attrs},
        timeout=30,
    )
    if ur.status_code in (200, 201):
        print(f"[refresh-ip] OK {pattern_id} — {len(fields)} champs (title={attrs['title']})")
        return True
    print(f"[refresh-ip] KO {pattern_id} PUT HTTP {ur.status_code} {ur.text[:200]}")
    return False


def main() -> int:
    targets = sys.argv[1:] if len(sys.argv) > 1 else list(PATTERNS.keys())
    sess = requests.Session()
    sess.verify = False
    fails = 0
    for pid in targets:
        es_pat = PATTERNS.get(pid, pid)
        if not refresh_one(sess, pid, es_pat):
            fails += 1
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
