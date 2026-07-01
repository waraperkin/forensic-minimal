#!/usr/bin/env bash
# Alignement post-démarrage : MISP baseurl, sidecars, nginx (idempotent).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f "$ROOT/scripts/lib/host-ip.sh" ]; then
  # shellcheck source=/dev/null
  . "$ROOT/scripts/lib/host-ip.sh"
  fp_load_env_public_host 2>/dev/null || true
fi

HOST=$(fp_cert_identity 2>/dev/null || fp_resolve_public_host 2>/dev/null || echo "localhost")
export PUBLIC_HOST="${PUBLIC_HOST:-$HOST}"

log() { echo "[post-start] $*"; }

log "Hôte public : $HOST"

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
      && log "MISP.baseurl aligné" \
      || log "WARN misp-configure-host"
    bash "$ROOT/scripts/misp-init.sh" >> "${FP_LOG_START:-$ROOT/logs/misp-init.log}" 2>&1 \
      && log "MISP admin OK" \
      || log "WARN misp-init partiel"
  fi
else
  log "WARN forensic-misp absent"
fi

# Sidecars HELK / VR si pas déjà faits
if [ "${FP_SKIP_SIDECARS:-0}" != "1" ] && [ -x "$ROOT/scripts/setup-sidecars.sh" ]; then
  bash "$ROOT/scripts/setup-sidecars.sh" >> "${FP_LOG_START:-$ROOT/logs/forensic_start.log}" 2>&1 \
    && log "Sidecars HELK/VR OK" \
    || log "WARN setup-sidecars partiel"
fi

# Recréer nginx pour prendre en compte sidecars + configs
docker compose up -d helk-bridge velociraptor-bridge nginx cert-portal it-portal 2>/dev/null \
  && docker exec forensic-nginx nginx -s reload 2>/dev/null \
  && log "Nginx rechargé" \
  || log "WARN reload nginx"

log "Alignement post-démarrage terminé"
