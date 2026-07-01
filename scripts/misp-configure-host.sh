#!/usr/bin/env bash
# Configure MISP.baseurl depuis l'hôte (après démarrage du conteneur).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER="${MISP_CONTAINER:-forensic-misp}"

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/.env"
  set +a
fi

if [ -f "$ROOT/scripts/lib/host-ip.sh" ]; then
  # shellcheck source=/dev/null
  . "$ROOT/scripts/lib/host-ip.sh"
  fp_load_env_public_host 2>/dev/null || true
fi

HOST="${PUBLIC_HOSTNAME:-${PUBLIC_HOST:-$(fp_resolve_public_host 2>/dev/null || echo "localhost")}}"
export MISP_PUBLIC_BASE_URL="${MISP_PUBLIC_BASE_URL:-https://${HOST}/misp}"

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER}$"; then
  echo "[misp-configure-host] Container $CONTAINER absent"
  exit 1
fi

echo "[misp-configure-host] MISP_PUBLIC_BASE_URL=${MISP_PUBLIC_BASE_URL}"
docker exec -e "MISP_PUBLIC_BASE_URL=${MISP_PUBLIC_BASE_URL}" "$CONTAINER" \
  /scripts/misp-configure-public-url.sh
echo "[misp-configure-host] Terminé"
