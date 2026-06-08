#!/usr/bin/env bash
# Provisionne le tooling de la télémétrie Sekoia on-demand :
#   1. Template d'index forensic-sekoia-telemetry sur OpenSearch
#   2. Index pattern + visualisations + dashboard sur OpenSearch Dashboards
# Idempotent — peut être relancé sans effet de bord.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OS="${OS_URL:-http://localhost:9200}"
OSD="${OSD_URL:-http://localhost:5601/dashboards}"
OSD_NGINX="${OSD_NGINX_URL:-https://localhost/dashboards}"
TPL="${ROOT}/config/opensearch/index-templates/forensic-sekoia-telemetry.json"
NDJSON="${ROOT}/dashboards/opensearch/fp_sekoia_telemetry.ndjson"

echo "[sek-tel] 1/3 — template d'index OpenSearch"
curl -sk -X PUT "${OS}/_index_template/forensic-sekoia-telemetry" \
  -H "Content-Type: application/json" --data-binary "@${TPL}" \
  && echo "  ✓ template forensic-sekoia-telemetry" || echo "  ✗ template KO"
echo

echo "[sek-tel] 2/3 — génération des saved objects"
python3 "${ROOT}/scripts/build_sekoia_telemetry_dashboard.py"

echo "[sek-tel] 3/3 — import dans OpenSearch Dashboards"
IMPORT_BASE=""
for base in "$OSD" "$OSD_NGINX"; do
  CODE=$(curl -sk -o /dev/null -w '%{http_code}' "${base}/api/status" 2>/dev/null || echo "000")
  if [ "$CODE" = "200" ]; then IMPORT_BASE="$base"; break; fi
done
if [ -z "$IMPORT_BASE" ]; then echo "  ✗ OpenSearch Dashboards inaccessible"; exit 1; fi

for i in 1 2 3 4 5; do
  RESP=$(curl -sk -X POST "${IMPORT_BASE}/api/saved_objects/_import?overwrite=true" \
    -H "osd-xsrf: true" -H "securitytenant: global" \
    --form file=@"${NDJSON}" 2>/dev/null)
  read -r OK ERR < <(echo "$RESP" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('0 999'); sys.exit(0)
errs=d.get('errors',[]) or []
print(d.get('successCount',0), len(errs))
for e in errs[:20]: sys.stderr.write('  KO %s/%s -> %s\n'%(e.get('type'),e.get('id'),e.get('error',{})))
")
  echo "  tentative $i : success=$OK errors=$ERR"
  [ "${ERR:-1}" = "0" ] && break
  sleep 3
done

echo "[sek-tel] rafraîchissement des champs de l'index pattern"
python3 "${ROOT}/scripts/opensearch_refresh_index_pattern.py" fp-sekoia-telemetry 2>/dev/null || true

echo
echo "✓ Dashboard : ${IMPORT_BASE}/app/dashboards#/view/fp-sekoia-telemetry-dashboard"
echo "✓ Discover  : ${IMPORT_BASE}/app/discover#/?_a=(index:'fp-sekoia-telemetry')"
