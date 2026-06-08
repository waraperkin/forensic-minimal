#!/usr/bin/env python3
"""Génère les saved objects OpenSearch Dashboards pour la télémétrie Sekoia
on-demand (index forensic-sekoia-telemetry-on-demand).

Sortie : dashboards/opensearch/fp_sekoia_telemetry.ndjson
Objets : 1 index-pattern + 4 visualisations + 1 dashboard.
Idempotent (ids fixes) — importable via /api/saved_objects/_import?overwrite=true.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dashboards", "opensearch", "fp_sekoia_telemetry.ndjson")

IDX_ID = "fp-sekoia-telemetry"
IDX_TITLE = "forensic-sekoia-telemetry-on-demand*"
IDX_REF = {
    "name": "kibanaSavedObjectMeta.searchSourceJSON.index",
    "type": "index-pattern",
    "id": IDX_ID,
}
SEARCH_SOURCE = json.dumps({
    "query": {"language": "kuery", "query": ""},
    "filter": [],
    "indexRefName": "kibanaSavedObjectMeta.searchSourceJSON.index",
})


def viz(vid, title, vis_state):
    return {
        "id": vid,
        "type": "visualization",
        "attributes": {
            "title": title,
            "visState": json.dumps(vis_state),
            "uiStateJSON": "{}",
            "description": "",
            "version": 1,
            "kibanaSavedObjectMeta": {"searchSourceJSON": SEARCH_SOURCE},
        },
        "references": [IDX_REF],
        "migrationVersion": {"visualization": "7.10.0"},
    }


index_pattern = {
    "id": IDX_ID,
    "type": "index-pattern",
    "attributes": {
        "title": IDX_TITLE,
        "timeFieldName": "@timestamp",
        "fields": "[]",
        "fieldFormatMap": "{}",
    },
    "references": [],
    "migrationVersion": {"index-pattern": "7.6.0"},
}

v_count = viz("fp-sek-tel-count", "Sekoia télémétrie — total events", {
    "title": "Sekoia télémétrie — total events",
    "type": "metric",
    "aggs": [{"id": "1", "enabled": True, "type": "count", "schema": "metric", "params": {}}],
    "params": {"metric": {"percentageMode": False, "useRanges": False,
                          "colorSchema": "Green to Red", "metricColorMode": "None",
                          "labels": {"show": True}, "style": {"fontSize": 48}}},
})

v_collection = viz("fp-sek-tel-collection", "Sekoia télémétrie — par collecte", {
    "title": "Sekoia télémétrie — par collecte",
    "type": "pie",
    "aggs": [
        {"id": "1", "enabled": True, "type": "count", "schema": "metric", "params": {}},
        {"id": "2", "enabled": True, "type": "terms", "schema": "segment",
         "params": {"field": "_collection", "size": 10, "order": "desc", "orderBy": "1",
                    "otherBucket": False, "missingBucket": False}},
    ],
    "params": {"type": "pie", "addTooltip": True, "addLegend": True,
               "legendPosition": "right", "isDonut": True, "labels": {"show": True, "values": True}},
})

v_hosts = viz("fp-sek-tel-hosts", "Sekoia télémétrie — top hôtes", {
    "title": "Sekoia télémétrie — top hôtes",
    "type": "table",
    "aggs": [
        {"id": "1", "enabled": True, "type": "count", "schema": "metric", "params": {}},
        {"id": "2", "enabled": True, "type": "terms", "schema": "bucket",
         "params": {"field": "log.hostname", "size": 25, "order": "desc", "orderBy": "1",
                    "otherBucket": True, "otherBucketLabel": "Autres", "missingBucket": False}},
    ],
    "params": {"perPage": 10, "showPartialRows": False, "showMetricsAtAllLevels": False,
               "showTotal": True, "totalFunc": "sum"},
})

v_timeline = viz("fp-sek-tel-timeline", "Sekoia télémétrie — chronologie", {
    "title": "Sekoia télémétrie — chronologie",
    "type": "histogram",
    "aggs": [
        {"id": "1", "enabled": True, "type": "count", "schema": "metric", "params": {}},
        {"id": "2", "enabled": True, "type": "date_histogram", "schema": "segment",
         "params": {"field": "@timestamp", "useNormalizedOpenSearchInterval": True,
                    "interval": "auto", "drop_partials": False, "min_doc_count": 1}},
    ],
    "params": {"type": "histogram", "grid": {"categoryLines": False},
               "categoryAxes": [{"id": "CategoryAxis-1", "type": "category", "position": "bottom",
                                 "show": True, "scale": {"type": "linear"}, "labels": {"show": True}}],
               "valueAxes": [{"id": "ValueAxis-1", "name": "LeftAxis-1", "type": "value",
                              "position": "left", "show": True, "scale": {"type": "linear"},
                              "labels": {"show": True}}],
               "seriesParams": [{"show": True, "type": "histogram", "mode": "stacked",
                                 "data": {"label": "Count", "id": "1"}, "valueAxis": "ValueAxis-1"}],
               "addTooltip": True, "addLegend": True, "legendPosition": "right"},
})

PANELS = [
    ("fp-sek-tel-count", 0, 0, 12, 8),
    ("fp-sek-tel-collection", 12, 0, 12, 8),
    ("fp-sek-tel-timeline", 24, 0, 24, 8),
    ("fp-sek-tel-hosts", 0, 8, 24, 12),
]
panels_json = []
references = []
for i, (vid, x, y, w, h) in enumerate(PANELS, start=1):
    ref_name = "panel_%d" % i
    panels_json.append({
        "version": "2.12.0",
        "gridData": {"x": x, "y": y, "w": w, "h": h, "i": str(i)},
        "panelIndex": str(i),
        "embeddableConfig": {},
        "panelRefName": ref_name,
    })
    references.append({"name": ref_name, "type": "visualization", "id": vid})

dashboard = {
    "id": "fp-sekoia-telemetry-dashboard",
    "type": "dashboard",
    "attributes": {
        "title": "Sekoia.IO — Télémétrie on-demand",
        "description": "Events collectés à la demande depuis Sekoia.IO (CERT CYBERCORP).",
        "hits": 0,
        "optionsJSON": json.dumps({"hidePanelTitles": False, "useMargins": True}),
        "panelsJSON": json.dumps(panels_json),
        "version": 1,
        "timeRestore": True,
        "timeTo": "now",
        "timeFrom": "now-30d",
        "refreshInterval": {"pause": True, "value": 0},
        "kibanaSavedObjectMeta": {"searchSourceJSON": json.dumps({"query": {"language": "kuery", "query": ""}, "filter": []})},
    },
    "references": references,
    "migrationVersion": {"dashboard": "7.9.3"},
}

OBJECTS = [index_pattern, v_count, v_collection, v_hosts, v_timeline, dashboard]

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    for o in OBJECTS:
        f.write(json.dumps(o, ensure_ascii=False) + "\n")
print("wrote %d objects -> %s" % (len(OBJECTS), OUT))
