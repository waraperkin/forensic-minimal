#!/usr/bin/env bash
# Valide la syntaxe nginx de forensic.conf (resolver + proxy_pass variables).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF="$ROOT/config/nginx/conf.d/forensic.conf"

fail=0

if ! grep -q 'resolver 127.0.0.11' "$CONF"; then
  echo "FAIL: resolver Docker DNS absent dans forensic.conf" >&2
  fail=1
fi

if ! grep -q 'set \$helk_kibana_upstream' "$CONF"; then
  echo "FAIL: upstream HELK dynamique absent" >&2
  fail=1
fi

if ! grep -q 'set \$velociraptor_upstream' "$CONF"; then
  echo "FAIL: upstream Velociraptor dynamique absent" >&2
  fail=1
fi

if grep -q 'default "https://10.78.0.9"' "$CONF"; then
  echo "FAIL: CORS Grafana encore figé sur 10.78.0.9" >&2
  fail=1
fi

if ! grep -q 'set \$vr_bridge_upstream' "$CONF"; then
  echo "FAIL: upstream Velociraptor bridge dynamique absent" >&2
  fail=1
fi

if ! grep -q 'location = /helk {' "$CONF"; then
  echo "FAIL: redirect /helk → /helk/kibana/ absent" >&2
  fail=1
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker run --rm \
    -v "$ROOT/config/nginx/conf.d/forensic.conf:/etc/nginx/conf.d/default.conf:ro" \
    -v "$ROOT/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
    nginx:1.25-alpine nginx -t >/dev/null 2>&1 \
    && echo "PASS: docker nginx -t" \
    || { echo "FAIL: docker nginx -t" >&2; fail=1; }
else
  echo "SKIP: docker nginx -t (Docker indisponible)"
fi

[ "$fail" -eq 0 ] && echo "PASS: forensic.conf structure OK"
exit "$fail"
