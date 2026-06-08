#!/bin/sh
# Aligne MISP.baseurl sur l'URL publique HTTPS (proxy Nginx /misp/).
set -eu

PUBLIC_BASE="${MISP_PUBLIC_BASE_URL:-https://10.78.0.9/misp}"
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
