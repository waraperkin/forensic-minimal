#!/usr/bin/env python3
"""
Forensic Platform — Ingest Worker
MinIO → Parse (EVTX/CSV/text) → OpenSearch → Timesketch (pipeline unifié)
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any

import boto3
import redis
from opensearchpy import OpenSearch, helpers

from parsers.evtx_parser import parse_evtx
from parsers.text_parser import detect_index, parse_text_content
from ti_enrichment import enrich_events
from timesketch_pipeline import import_to_timesketch

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [ingest-worker] %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("ingest-worker")

REDIS_URL = os.environ.get("REDIS_URL", "redis://:F0r3ns1c_Redis_2024!@redis:6379")
QUEUE_KEY = os.environ.get("INGEST_QUEUE_KEY", "fp:ingest:queue")
MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "minio:9000")
MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "forensicadmin")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "F0r3ns1c_Minio_2024!")
OS_URL = os.environ.get("OPENSEARCH_URL", "http://opensearch-node1:9200")
LOGSTASH_HOST = os.environ.get("LOGSTASH_HOST", "logstash")
LOGSTASH_PORT = int(os.environ.get("LOGSTASH_PORT", "5045"))
BULK_CHUNK = int(os.environ.get("INGEST_BULK_CHUNK", "500"))
MAX_EV_TX = int(os.environ.get("INGEST_MAX_EVTX_EVENTS", "200000"))

TS_EXTENSIONS = {"evtx", "evt", "plaso", "dump", "csv", "jsonl", "db"}


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=f"http://{MINIO_ENDPOINT}",
        aws_access_key_id=MINIO_ACCESS_KEY,
        aws_secret_access_key=MINIO_SECRET_KEY,
        region_name="us-east-1",
    )


def os_client() -> OpenSearch:
    return OpenSearch(
        hosts=[OS_URL],
        use_ssl=False,
        verify_certs=False,
        timeout=120,
    )


def download_object(bucket: str, key: str) -> bytes:
    s3 = s3_client()
    resp = s3.get_object(Bucket=bucket, Key=key)
    return resp["Body"].read()


def event_base(job: dict) -> dict[str, Any]:
    return {
        "upload_id": job.get("upload_id"),
        "case_id": job.get("case_id"),
        "analyst": job.get("analyst", "unknown"),
        "os_type": job.get("os_type", "unknown"),
        "portal": job.get("portal", "unknown"),
        "source_file": job.get("filename"),
        "tags": ["file-content", "ingest-worker", job.get("portal", "unknown")],
        "event": {"module": "file-upload", "category": "file", "action": "parsed"},
    }


def parse_file(data: bytes, job: dict) -> tuple[list[dict], str]:
    filename = job.get("filename", "unknown")
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
    os_type = job.get("os_type", "unknown")
    base = event_base(job)
    index_prefix = detect_index(filename, os_type)
    events: list[dict] = []

    if ext in ("evtx", "evt"):
        for ev in parse_evtx(data, base, max_events=MAX_EV_TX):
            events.append(ev)
        index_prefix = "forensic-windows"
    else:
        try:
            content = data.decode("utf-8", errors="replace")
        except Exception:
            content = ""
        for ev in parse_text_content(content, filename, base):
            events.append(ev)

    return events, index_prefix


def bulk_index(client: OpenSearch, index_prefix: str, events: list[dict]) -> int:
    if not events:
        return 0
    events = enrich_events(events, client)
    date_suffix = datetime.now(timezone.utc).strftime("%Y.%m.%d")
    index_name = f"{index_prefix}-{date_suffix}"
    use_pipeline = not index_prefix.startswith("forensic-ti")

    def gen():
        for ev in events:
            action: dict = {"_index": index_name, "_source": ev}
            if use_pipeline:
                action["pipeline"] = "fp-ti-match"
            yield action

    ok, errors = helpers.bulk(client, gen(), chunk_size=BULK_CHUNK, raise_on_error=False)
    if errors:
        log.warning("Bulk had %d errors", len(errors))
    return ok


def send_to_logstash(events: list[dict], index_prefix: str) -> None:
    import socket

    tag = index_prefix.replace("forensic-", "")
    for ev in events[:2000]:
        payload = {
            **ev,
            "tags": list(set((ev.get("tags") or []) + ["json", tag])),
            "[@metadata][pipeline]": tag,
        }
        try:
            with socket.create_connection((LOGSTASH_HOST, LOGSTASH_PORT), timeout=5) as sock:
                sock.sendall((json.dumps(payload, default=str) + "\n").encode())
        except OSError:
            break


def update_upload_doc(client: OpenSearch, job: dict, status: str, extra: dict) -> None:
    upload_id = job.get("upload_id")
    if not upload_id:
        return
    body = {
        "doc": {
            "ingest_status": status,
            "ingest_completed_at": datetime.now(timezone.utc).isoformat(),
            **extra,
        }
    }
    try:
        client.update(index="forensic-uploads", id=upload_id, body=body, refresh=True)
    except Exception:
        try:
            client.update_by_query(
                index="forensic-uploads*",
                body={
                    "script": {
                        "source": "ctx._source.ingest_status=params.status",
                        "lang": "painless",
                        "params": {"status": status},
                    },
                    "query": {"term": {"upload_id": upload_id}},
                },
            )
        except Exception as e:
            log.warning("Could not update upload doc %s: %s", upload_id, e)


def process_job(job: dict) -> None:
    upload_id = job.get("upload_id", "?")
    filename = job.get("filename", "?")
    log.info("Processing %s (%s)", filename, upload_id)

    client = os_client()
    update_upload_doc(client, job, "processing", {})

    try:
        data = download_object(job["bucket"], job["key"])
        log.info("Downloaded %s bytes from s3://%s/%s", len(data), job["bucket"], job["key"])

        events, index_prefix = parse_file(data, job)
        log.info("Parsed %d events → index %s", len(events), index_prefix)

        indexed = bulk_index(client, index_prefix, events)
        log.info("Indexed %d events to %s", indexed, index_prefix)

        if events:
            send_to_logstash(events, index_prefix)

        ts_result = None
        ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
        if ext in TS_EXTENSIONS or job.get("os_type") in ("windows", "linux") or events:
            ts_result = import_to_timesketch(events, job, raw_data=data)
            log.info("Timesketch: %s", ts_result)

        update_upload_doc(
            client,
            job,
            "completed",
            {
                "content_indexed": {
                    "events_parsed": len(events),
                    "events_indexed": indexed,
                    "index": index_prefix,
                },
                "timesketch": ts_result,
            },
        )
        log.info("✓ Completed %s", filename)

    except Exception as e:
        log.exception("Failed job %s: %s", upload_id, e)
        update_upload_doc(client, job, "failed", {"ingest_error": str(e)})


def main() -> None:
    log.info("Ingest worker starting — queue=%s", QUEUE_KEY)
    r = redis.from_url(REDIS_URL, decode_responses=True)
    while True:
        try:
            item = r.brpop(QUEUE_KEY, timeout=5)
            if not item:
                continue
            _, raw = item
            job = json.loads(raw)
            process_job(job)
        except redis.ConnectionError as e:
            log.error("Redis connection error: %s — retry in 5s", e)
            time.sleep(5)
        except json.JSONDecodeError as e:
            log.error("Invalid job JSON: %s", e)
        except KeyboardInterrupt:
            log.info("Shutting down")
            break
        except Exception as e:
            log.exception("Loop error: %s", e)
            time.sleep(2)


if __name__ == "__main__":
    main()
