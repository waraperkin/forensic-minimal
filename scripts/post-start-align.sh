#!/usr/bin/env bash
# Alignement post-démarrage — appelé automatiquement par ./forensic.sh -full-start (ne pas lancer manuellement).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f "$ROOT/scripts/lib/host-ip.sh" ]; then
  # shellcheck source=/dev/null
  . "$ROOT/scripts/lib/host-ip.sh"
  fp_load_env_public_host 2>/dev/null || true
  fp_align_env_public_ip 2>/dev/null || true
fi

HOST=$(fp_url_identity 2>/dev/null || fp_detect_public_ip 2>/dev/null || echo "localhost")
HOST=$(fp_normalize_host "$HOST" 2>/dev/null || echo "$HOST")
export PUBLIC_HOST="${PUBLIC_HOST:-$HOST}"
export HELK_KIBANA_PUBLIC_URL="https://${HOST}/helk/kibana"
export MISP_PUBLIC_BASE_URL="$(fp_misp_public_base_url 2>/dev/null || echo "https://${HOST}/misp")"

log() { echo "[post-start] $*"; }

log "Mode accès IP — hôte : $HOST"

if [ "${FP_SKIP_PREPARE:-0}" != "1" ]; then
  bash "$ROOT/scripts/setup-site-identity.sh" 2>/dev/null && log "Identité site OK" || log "WARN setup-site-identity"
  bash "$ROOT/scripts/generate-nginx-access-snippet.sh" 2>/dev/null && log "Redirect DNS EC2 → IP OK" || log "WARN generate-nginx-access-snippet"
fi

# MISP — attendre HTTP puis aligner baseurl + credentials
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^forensic-misp$'; then
  log "Attente MISP..."
  n=0
  until docker exec forensic-misp curl -sf --max-time 5 http://127.0.0.1/users/login >/dev/null 2>&1; do
    n=$((n + 1))
    [ "$n" -ge 72 ] && { log "WARN MISP timeout"; break; }
    sleep 5
  done
  if [ "$n" -lt 72 ]; then
    bash "$ROOT/scripts/misp-configure-host.sh" >> "${FP_LOG_START:-$ROOT/logs/misp-init.log}" 2>&1 \
      && log "MISP.baseurl aligné (IP)" \
      || log "WARN misp-configure-host"
    bash "$ROOT/scripts/misp-init.sh" >> "${FP_LOG_START:-$ROOT/logs/misp-init.log}" 2>&1 \
      && log "MISP admin OK" \
      || log "WARN misp-init partiel"
  fi
else
  log "WARN forensic-misp absent"
fi

# Sidecars HELK / VR (recrée config VR + Kibana PUBLICBASEURL)
if [ "${FP_SKIP_SIDECARS:-0}" != "1" ] && [ -x "$ROOT/scripts/setup-sidecars.sh" ]; then
  bash "$ROOT/scripts/setup-sidecars.sh" >> "${FP_LOG_START:-$ROOT/logs/forensic_start.log}" 2>&1 \
    && log "Sidecars HELK/VR OK" \
    || log "WARN setup-sidecars partiel"
fi

docker compose up -d --force-recreate helk-bridge velociraptor-bridge nginx 2>/dev/null \
  || docker compose up -d helk-bridge velociraptor-bridge nginx 2>/dev/null \
  || true
docker exec forensic-nginx nginx -s reload 2>/dev/null && log "Nginx rechargé" || log "WARN reload nginx"

log "Finalisation terminée — https://${HOST}/"
