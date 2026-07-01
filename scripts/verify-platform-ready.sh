#!/usr/bin/env bash
# Vérification complète portail + outils (HTTPS via nginx). Code sortie 0 = prêt production lab.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f "$ROOT/scripts/lib/host-ip.sh" ]; then
  # shellcheck source=/dev/null
  . "$ROOT/scripts/lib/host-ip.sh"
  fp_load_env_public_host 2>/dev/null || true
fi

BASE="${BASE_URL:-${FP_BASE_URL:-${FP_ORCH_BASE_URL:-}}}"
if [ -z "$BASE" ]; then
  HOST=$(fp_cert_identity 2>/dev/null || fp_resolve_public_host 2>/dev/null || echo "127.0.0.1")
  BASE="https://${HOST}"
fi
BASE="${BASE%/}"

check() {
  local name="$1" path="$2" expect="${3:-200}"
  local code
  code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 25 "${BASE}${path}" 2>/dev/null || echo "000")
  if echo "$code" | grep -qE "$expect"; then
    echo "PASS: $name"
    return 0
  fi
  echo "FAIL: $name (${BASE}${path}) → HTTP $code (attendu $expect)" >&2
  return 1
}

fail=0

echo "=== Vérification plateforme — $BASE ==="
echo ""

echo "--- Portail ---"
check "Nginx health" "/nginx-health" "200" || fail=1
check "Portail CERT" "/" "200|302" || fail=1
check "Portail CERT /api/health" "/api/health" "200" || fail=1
check "Portail CERT /api/health/global" "/api/health/global" "200" || fail=1
check "Portail IT /it/api/health" "/it/api/health" "200" || fail=1

echo ""
echo "--- SOC / SIEM / Observabilité ---"
check "OpenSearch Dashboards" "/dashboards/" "200|302" || fail=1
check "Grafana" "/grafana/api/health" "200" || fail=1
check "Timesketch" "/timesketch/" "200|302" || fail=1

echo ""
echo "--- Threat Intel / IR ---"
check "OpenCTI" "/cti/" "200|302" || fail=1
check "MISP login" "/misp/users/login" "200|302" || fail=1
check "TheHive" "/thehive/" "200|302" || fail=1
check "Cortex" "/cortex/" "200|302" || fail=1

echo ""
echo "--- DFIR / Hunting ---"
check "HELK Kibana" "/helk/kibana/" "200|302" || fail=1
check "HELK API" "/helk/api/" "200" || fail=1
check "Velociraptor GUI" "/velociraptor/" "200|302" || fail=1
check "Velociraptor API" "/velociraptor/api/health" "200" || fail=1

echo ""
echo "--- Stockage ---"
check "MinIO console" "/minio/" "200|302" || fail=1

echo ""
if [ "$fail" -eq 0 ]; then
  echo "✅ Plateforme prête — portail + 11 services accessibles via $BASE"
  exit 0
fi

echo "❌ Échecs détectés — relancer ./forensic.sh -full-start (voir logs/forensic_start.log)" >&2
exit 1
