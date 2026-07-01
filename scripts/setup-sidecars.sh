#!/usr/bin/env bash
# Démarre HELK + Velociraptor sidecars et régénère la config VR pour PUBLIC_HOST.
# Appelé avant nginx sur chaque full-start (pas seulement -full-start orchestrateur).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f "$ROOT/scripts/lib/host-ip.sh" ]; then
  # shellcheck source=/dev/null
  . "$ROOT/scripts/lib/host-ip.sh"
  fp_load_env_public_host 2>/dev/null || true
fi
PUBLIC_HOST="${PUBLIC_HOST:-$(fp_url_identity 2>/dev/null || fp_resolve_public_host 2>/dev/null || echo "localhost")}"
PUBLIC_HOST=$(fp_normalize_host "$PUBLIC_HOST" 2>/dev/null || echo "$PUBLIC_HOST")
export PUBLIC_HOST
export HELK_KIBANA_PUBLIC_URL="https://${PUBLIC_HOST}/helk/kibana"
export FP_VR_NGINX_ONLY="${FP_VR_NGINX_ONLY:-1}"

step() { echo -e "\n\033[0;34m━━━ $* ━━━\033[0m"; }
ok() { echo -e "\033[0;32m[ OK ]\033[0m $*"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $*"; }

ensure_network() {
  local name=$1 cidr=$2
  if ! docker network inspect "$name" >/dev/null 2>&1; then
    docker network create --driver bridge --subnet "$cidr" "$name" \
      && ok "Réseau $name ($cidr)" || warn "Réseau $name — création échouée"
  fi
}

step "Réseaux sidecar HELK / Velociraptor"
ensure_network helk_net 172.30.0.0/24
ensure_network velociraptor_net 172.31.0.0/24

step "Configuration Velociraptor (PUBLIC_HOST=$PUBLIC_HOST)"
if [ -x "$ROOT/velociraptor/scripts/generate-config.sh" ]; then
  FP_VR_NGINX_ONLY=1 PUBLIC_HOST="$PUBLIC_HOST" bash "$ROOT/velociraptor/scripts/generate-config.sh" \
    >> "${FP_LOG_START:-$ROOT/logs/forensic_start.log}" 2>&1 \
    && ok "Velociraptor config régénérée" \
    || warn "Velociraptor generate-config — voir logs"
else
  warn "velociraptor/scripts/generate-config.sh absent"
fi

step "Stack HELK sidecar (ES + Kibana + Logstash)"
cd "$ROOT/helk"
HELK_KIBANA_PUBLIC_URL="$HELK_KIBANA_PUBLIC_URL" \
  docker compose -f docker-compose.helk.yml -f docker-compose.external-net.yml up -d \
  helk-elasticsearch helk-kibana helk-logstash 2>&1 \
  | tee -a "${FP_LOG_START:-$ROOT/logs/forensic_start.log}" \
  || warn "HELK sidecar partiel (Kafka non requis pour Kibana)"

for i in $(seq 1 40); do
  curl -sf http://127.0.0.1:19200/_cluster/health >/dev/null 2>&1 && break
  sleep 3
done
if curl -sf http://127.0.0.1:19200/_cluster/health >/dev/null 2>&1; then
  ok "HELK Elasticsearch (19200)"
else
  warn "HELK ES pas prêt — /helk/kibana/ peut être indisponible"
fi

step "Stack Velociraptor sidecar"
cd "$ROOT/velociraptor"
docker compose -f docker-compose.velociraptor.yml -f docker-compose.external-net.yml up -d --build --force-recreate 2>&1 \
  | tee -a "${FP_LOG_START:-$ROOT/logs/forensic_start.log}" \
  || warn "Velociraptor sidecar partiel"

for i in $(seq 1 30); do
  curl -skf https://127.0.0.1:8000/ >/dev/null 2>&1 && break
  sleep 3
done
curl -skf https://127.0.0.1:8000/ >/dev/null 2>&1 && ok "Velociraptor server (8000)" || warn "Velociraptor GUI pas prête"

step "Bridges plateforme"
cd "$ROOT"
docker compose up -d helk-bridge velociraptor-bridge 2>&1 \
  | tee -a "${FP_LOG_START:-$ROOT/logs/forensic_start.log}" \
  || warn "Bridges partiels"

ok "Sidecars HELK/Velociraptor — PUBLIC_HOST=$PUBLIC_HOST"
echo "  HELK   : https://${PUBLIC_HOST}/helk/kibana/"
echo "  VR     : https://${PUBLIC_HOST}/velociraptor/"
echo "  MISP   : https://${PUBLIC_HOST}/misp/"
