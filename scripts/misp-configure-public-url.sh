#!/bin/sh
# Aligne MISP.baseurl sur l'URL publique HTTPS (proxy Nginx /misp/).
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$ROOT/scripts/lib/host-ip.sh" ]; then
  # shellcheck source=/dev/null
  . "$ROOT/scripts/lib/host-ip.sh"
fi
if [ -f "$ROOT/.env" ]; then
  while IFS= read -r _line || [ -n "$_line" ]; do
    case "$_line" in "#"*|"") continue ;; esac
    if echo "$_line" | grep -q '^MISP_PUBLIC_BASE_URL='; then
      _v="${_line#MISP_PUBLIC_BASE_URL=}"
      _v="${_v%\"}"; _v="${_v#\"}"; _v="${_v%\'}"; _v="${_v#\'}"
      [ -n "$_v" ] && export MISP_PUBLIC_BASE_URL="$_v"
    fi
  done < "$ROOT/.env"
fi

PUBLIC_BASE="${MISP_PUBLIC_BASE_URL:-}"
if [ -z "$PUBLIC_BASE" ] || echo "$PUBLIC_BASE" | grep -q '10\.78\.0\.9'; then
  _ip=$(fp_resolve_public_host 2>/dev/null || echo "localhost")
  PUBLIC_BASE="https://${_ip}/misp"
fi
# MISP attend une URL sans slash final dans la config interne
PUBLIC_BASE="${PUBLIC_BASE%/}"

CAKE="/var/www/MISP/app/Console/cake"
if [ ! -x "$CAKE" ] && [ -f "$CAKE" ]; then
  chmod +x "$CAKE" 2>/dev/null || true
fi

echo "[misp-configure-public-url] MISP.baseurl → ${PUBLIC_BASE}"
sudo -u www-data "$CAKE" Admin setSetting "MISP.baseurl" "${PUBLIC_BASE}" 2>/dev/null \
  || "$CAKE" Admin setSetting "MISP.baseurl" "${PUBLIC_BASE}"

# Évite que CakePHP réécrive App.base (CSRF login derrière proxy /misp/)
sudo -u www-data "$CAKE" Admin setSetting "MISP.disable_baseurl_coercion" true --force 2>/dev/null \
  || "$CAKE" Admin setSetting "MISP.disable_baseurl_coercion" true --force

sudo -u www-data "$CAKE" Admin getSetting "MISP.baseurl" 2>/dev/null \
  || "$CAKE" Admin getSetting "MISP.baseurl"

echo "[misp-configure-public-url] Terminé"
