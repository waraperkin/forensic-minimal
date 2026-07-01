#!/usr/bin/env bash
# Génère server.config.yaml + client.config.yaml pour le déploiement Docker forensic-minimal.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${VR_BIN:-/tmp/velociraptor}"
if [ -f "$ROOT/scripts/lib/host-ip.sh" ]; then
  # shellcheck source=/dev/null
  . "$ROOT/scripts/lib/host-ip.sh"
  fp_load_env_public_host 2>/dev/null || true
fi
PUBLIC_HOST="${PUBLIC_HOSTNAME:-${PUBLIC_HOST:-$(fp_url_identity 2>/dev/null || fp_resolve_public_host 2>/dev/null || echo "localhost")}}"
PUBLIC_HOST=$(fp_normalize_host "$PUBLIC_HOST" 2>/dev/null || echo "$PUBLIC_HOST")
DATA_DIR="/data"

if [[ ! -x "$BIN" ]]; then
  echo "Téléchargement du binaire Velociraptor…"
  VR_TAG="${VR_VERSION:-v0.76.6}"
  curl -sL "https://github.com/Velocidex/velociraptor/releases/download/${VR_TAG}/velociraptor-${VR_TAG}-linux-amd64" \
    -o "$BIN"
  chmod +x "$BIN"
fi

mkdir -p "$ROOT/config" "$ROOT/clients" "$ROOT/data"

"$BIN" config generate > "$ROOT/config/server.config.yaml"

python3 - "$ROOT/config/server.config.yaml" "$PUBLIC_HOST" "$DATA_DIR" <<'PY'
import sys
import yaml

path, host, data_dir = sys.argv[1:4]
with open(path, encoding="utf-8") as f:
    cfg = yaml.safe_load(f)

cfg.setdefault("Client", {})["server_urls"] = [
    f"https://{host}/velociraptor/",
]
# Port 8001 direct (agents) — optionnel ; désactivé par défaut derrière nginx seul (AWS)
if __import__("os").environ.get("FP_VR_DIRECT_FRONTEND", "").lower() in ("1", "true", "yes"):
    cfg["Client"]["server_urls"].insert(0, f"https://{host}:8001/")
cfg["GUI"]["bind_address"] = "0.0.0.0"
cfg["GUI"]["bind_port"] = 8000
cfg["Frontend"]["bind_address"] = "0.0.0.0"
cfg["Frontend"]["bind_port"] = 8001
cfg["Frontend"]["hostname"] = host
cfg["API"]["bind_address"] = "0.0.0.0"
cfg["API"]["bind_port"] = 8002
cfg.setdefault("GUI", {})["public_url"] = f"https://{host}/velociraptor/app/index.html"
cfg.setdefault("GUI", {})["base_path"] = "/velociraptor"
cfg.setdefault("Frontend", {})["base_path"] = "/velociraptor"
cfg.setdefault("Datastore", {})
cfg["Datastore"]["location"] = data_dir
cfg["Datastore"]["filestore_directory"] = data_dir

with open(path, "w", encoding="utf-8") as f:
    yaml.dump(cfg, f, default_flow_style=False, sort_keys=False)

print(f"Config écrite: {path}")
PY

"$BIN" --config "$ROOT/config/server.config.yaml" config client > "$ROOT/clients/client.config.yaml"
echo "api.config.yaml: générer via scripts/helk_velociraptor_master_setup.sh après démarrage du serveur"

echo "Configuration Velociraptor prête dans $ROOT/config/"
