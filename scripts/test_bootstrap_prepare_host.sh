#!/usr/bin/env bash
# Vérifie que le bootstrap prépare IP + fichiers nginx sans Docker.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export DIR="$ROOT"
export FP_LOG_INSTALL="$ROOT/logs/test-prepare-host.log"
mkdir -p "$ROOT/logs"

# shellcheck source=/dev/null
. "$ROOT/scripts/lib/host-ip.sh"
# shellcheck source=/dev/null
. "$ROOT/scripts/lib/platform-host.sh"

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
cp "$ROOT/.env.example" "$WORKDIR/.env"
export DIR="$ROOT"
# Simule bootstrap .env avec IP test
TEST_IP="203.0.113.99"
sed -i "s/^PUBLIC_HOST=.*/PUBLIC_HOST=${TEST_IP}/" "$WORKDIR/.env" 2>/dev/null || echo "PUBLIC_HOST=${TEST_IP}" >> "$WORKDIR/.env"
cp "$WORKDIR/.env" "$ROOT/.env.bak-prepare-test" 2>/dev/null || true
cp "$WORKDIR/.env" "$ROOT/.env"

PUBLIC_HOST="$TEST_IP" fp_prepare_platform_host

fail=0
for f in config/nginx/static/robots.txt config/nginx/static/site-info.html config/nginx/static/.well-known/security.txt; do
  if [ -f "$ROOT/$f" ]; then
    echo "PASS: $f existe"
  else
    echo "FAIL: $f absent" >&2
    fail=1
  fi
done

if grep -q "$TEST_IP" "$ROOT/config/nginx/static/site-info.html" 2>/dev/null; then
  echo "PASS: site-info.html contient IP test"
else
  echo "FAIL: site-info.html sans IP test" >&2
  fail=1
fi

if [ -f "$ROOT/.env.bak-prepare-test" ]; then
  mv "$ROOT/.env.bak-prepare-test" "$ROOT/.env"
else
  rm -f "$ROOT/.env"
fi

[ "$fail" -eq 0 ] && echo "Bootstrap prepare host OK" || exit 1
