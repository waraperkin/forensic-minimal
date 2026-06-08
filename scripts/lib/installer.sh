#!/bin/bash
# ==============================================================
#  installer.sh — Module installateur + orchestrateur FP
# ==============================================================
# Sourcé par forensic.sh — fournit :
#   - fp_log_init / fp_log
#   - pre_install (PHASE 1)
#   - cleanup_processes / cleanup_ports (PHASE 2)
#   - status_full (PHASE 4)
#   - fp_start_tests (PHASE 6)
#
# Idempotent — réexécutable sans erreur ni régression.
# Ne tue jamais le script (return au lieu de exit).

# Hérite des couleurs et helpers de forensic.sh (info/ok/warn/err/step).
# Si appelé en standalone, on fournit des fallbacks.
if ! command -v info >/dev/null 2>&1; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BLUE='\033[0;34m'; NC='\033[0m'
  info(){ echo -e "${CYAN}[INFO]${NC} $*"; }
  ok()  { echo -e "${GREEN}[ OK ]${NC} $*"; }
  warn(){ echo -e "${YELLOW}[WARN]${NC} $*"; }
  err() { echo -e "${RED}[ERR ]${NC} $*"; }
  step(){ echo -e "\n${BLUE}━━━ $* ━━━${NC}"; }
fi

FP_LOG_DIR="${FP_LOG_DIR:-$DIR/logs}"
FP_LOG_START="${FP_LOG_DIR}/forensic_start.log"
FP_LOG_INSTALL="${FP_LOG_DIR}/forensic_install.log"
FP_LOG_NETWORK="${FP_LOG_DIR}/forensic_network.log"

# ──────────────────────────────────────────────────────────────
#  PHASE 5 — LOGGING
# ──────────────────────────────────────────────────────────────
fp_log_init() {
  mkdir -p "$FP_LOG_DIR" 2>/dev/null || true
  : > /dev/null 2>&1 # no-op safety
  for f in "$FP_LOG_START" "$FP_LOG_INSTALL" "$FP_LOG_NETWORK"; do
    touch "$f" 2>/dev/null || true
  done
}

fp_log() {
  # $1=channel(start|install|network) $2..=message
  local ch="$1"; shift || true
  local target
  case "$ch" in
    install) target="$FP_LOG_INSTALL" ;;
    network) target="$FP_LOG_NETWORK" ;;
    *)       target="$FP_LOG_START" ;;
  esac
  local ts
  ts=$(date '+%Y-%m-%dT%H:%M:%S%z' 2>/dev/null || date)
  echo "[$ts] $*" >> "$target" 2>/dev/null || true
}

# Wrapper sudo non-interactif : passe en silencieux si pas de sudo NOPASSWD
_fp_sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return $?
  fi
  if command -v sudo >/dev/null 2>&1; then
    if sudo -n true 2>/dev/null; then
      sudo -n "$@"
      return $?
    fi
    fp_log install "sudo non-interactif indisponible pour: $*"
    return 1
  fi
  fp_log install "sudo absent — impossible: $*"
  return 1
}

# ──────────────────────────────────────────────────────────────
#  WRAPPER DOCKER — accès robuste (user / sudo / démarrage daemon)
# ──────────────────────────────────────────────────────────────
# FP_DOCKER et FP_COMPOSE sont définis par fp_ensure_docker().
FP_DOCKER="${FP_DOCKER:-docker}"
FP_COMPOSE="${FP_COMPOSE:-docker compose}"

_fp_docker() { ${FP_DOCKER} "$@"; }
_fp_compose() { ${FP_COMPOSE} "$@"; }

_fp_docker_ok() {
  _fp_docker ps >/dev/null 2>&1
}

# Vérifie que docker ps répond. Ne touche PAS à systemd ni au daemon.
# Retourne 0 si OK, 1 sinon (message clair pour l'utilisateur).
fp_ensure_docker() {
  local _had_e=0
  case $- in *e*) _had_e=1;; esac
  set +e
  fp_log_init

  if ! command -v docker >/dev/null 2>&1; then
    err "Binaire docker introuvable dans PATH"
    err "  (installation Docker hors scope de forensic.sh — vérifier l'hôte)"
    fp_log install "docker binary missing"
    [ "$_had_e" -eq 1 ] && set -e
    return 1
  fi

  if docker ps >/dev/null 2>&1; then
    FP_DOCKER="docker"
    FP_COMPOSE="docker compose"
    ok "Docker accessible (docker ps OK)"
    fp_log install "docker OK"
    [ "$_had_e" -eq 1 ] && set -e
    return 0
  fi

  # Fallback lecture seule via sudo -n (sans systemctl, sans modifier /etc)
  if _fp_sudo docker ps >/dev/null 2>&1; then
    FP_DOCKER="sudo -n docker"
    FP_COMPOSE="sudo -n docker compose"
    warn "Docker accessible via sudo -n (groupe docker : newgrp docker ou nouveau terminal)"
    fp_log install "docker OK (sudo -n)"
    [ "$_had_e" -eq 1 ] && set -e
    return 0
  fi

  err "Docker inaccessible — docker ps échoue"
  err "  Vérifier que dockerd répond sur cet hôte, puis : docker ps"
  err "  Si groupe docker : newgrp docker  (ou rouvrir le terminal)"
  fp_log install "docker INACCESSIBLE (docker ps failed)"
  [ "$_had_e" -eq 1 ] && set -e
  return 1
}

# Rebind UP/DOWN forensic.sh si fp_ensure_docker a basculé sur sudo
fp_bind_compose_cmds() {
  if [ "${FP_DOCKER:-docker}" != "docker" ]; then
    UP="${FP_COMPOSE} up -d"
    DOWN="${FP_COMPOSE} down --remove-orphans"
  fi
}

# ──────────────────────────────────────────────────────────────
#  PHASE 1 — PRE-INSTALLATION (packages + groupe docker + sysctl)
# ──────────────────────────────────────────────────────────────
# Mapping commande → package apt
_fp_pkg_for() {
  case "$1" in
    docker)      echo "docker.io" ;;
    python3)     echo "python3" ;;
    pip3)        echo "python3-pip" ;;
    jq)          echo "jq" ;;
    curl)        echo "curl" ;;
    sysctl)      echo "procps" ;;
    openssl)     echo "openssl" ;;
    ifconfig)    echo "net-tools" ;;
    netstat)     echo "net-tools" ;;
    lsof)        echo "lsof" ;;
    *)           echo "$1" ;;
  esac
}

_fp_check_cmd() {
  command -v "$1" >/dev/null 2>&1
}

pre_install() {
  local _had_e=0
  case $- in *e*) _had_e=1;; esac
  set +e
  step "PHASE 1/6 — Pré-installation (packages + permissions + sysctl)"
  fp_log_init
  fp_log install "=== pre_install start ==="

  local required=(python3 pip3 jq curl sysctl openssl ifconfig lsof)
  local missing=()
  local found=()
  for cmd in "${required[@]}"; do
    if _fp_check_cmd "$cmd"; then
      found+=("$cmd")
    else
      missing+=("$cmd")
    fi
  done

  if [ "${#found[@]}" -gt 0 ]; then
    ok "Présents: ${found[*]}"
    fp_log install "présents: ${found[*]}"
  fi

  # docker compose v2 (sous-commande, pas binaire isolé)
  if _fp_check_cmd docker; then
    if _fp_docker compose version >/dev/null 2>&1 || docker compose version >/dev/null 2>&1; then
      ok "docker compose v2 OK"
      fp_log install "docker compose v2 OK"
    else
      warn "docker compose v2 absent — package docker-compose-plugin recommandé"
      missing+=("docker-compose-plugin")
    fi
  fi

  # Installation auto si packages manquants
  if [ "${#missing[@]}" -gt 0 ]; then
    warn "Manquants: ${missing[*]} — installation auto"
    fp_log install "manquants: ${missing[*]}"

    local pkgs=()
    for cmd in "${missing[@]}"; do
      pkgs+=("$(_fp_pkg_for "$cmd")")
    done
    # dédoublonnage
    local pkgs_uniq
    pkgs_uniq=$(printf '%s\n' "${pkgs[@]}" | awk '!s[$0]++')

    if command -v apt-get >/dev/null 2>&1; then
      info "apt-get install: $pkgs_uniq"
      if _fp_sudo env DEBIAN_FRONTEND=noninteractive apt-get update -y >> "$FP_LOG_INSTALL" 2>&1; then
        fp_log install "apt-get update OK"
      else
        warn "apt-get update échoué — voir $FP_LOG_INSTALL"
        fp_log install "apt-get update ÉCHEC"
      fi
      # shellcheck disable=SC2086
      if _fp_sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y $pkgs_uniq >> "$FP_LOG_INSTALL" 2>&1; then
        ok "Packages installés"
        fp_log install "install OK"
      else
        warn "Installation partielle — détail: $FP_LOG_INSTALL"
        fp_log install "install ÉCHEC"
      fi
    elif command -v dnf >/dev/null 2>&1; then
      # shellcheck disable=SC2086
      _fp_sudo dnf install -y $pkgs_uniq >> "$FP_LOG_INSTALL" 2>&1 || \
        warn "dnf install échoué — voir $FP_LOG_INSTALL"
    elif command -v yum >/dev/null 2>&1; then
      # shellcheck disable=SC2086
      _fp_sudo yum install -y $pkgs_uniq >> "$FP_LOG_INSTALL" 2>&1 || \
        warn "yum install échoué — voir $FP_LOG_INSTALL"
    else
      warn "Aucun gestionnaire de packages connu (apt/dnf/yum) — installer manuellement: $pkgs_uniq"
      fp_log install "no package manager found"
    fi
  else
    ok "Tous les packages requis sont présents"
  fi

  # Docker : contrôle léger ici ; fp_ensure_docker() est appelé dans start()
  if _fp_check_cmd docker; then
    if docker ps >/dev/null 2>&1; then
      ok "Docker accessible"
      fp_log install "docker accessible (user)"
    elif _fp_sudo docker ps >/dev/null 2>&1; then
      ok "Docker accessible via sudo"
      fp_log install "docker accessible (sudo)"
    else
      info "Docker sera vérifié/démarré automatiquement à la phase suivante"
      fp_log install "docker check deferred to start()"
    fi
  fi

  # sysctl vm.max_map_count (déjà géré par pre_start mais on couvre standalone)
  local mc
  mc=$(cat /proc/sys/vm/max_map_count 2>/dev/null || echo 0)
  if [ "$mc" -lt 262144 ]; then
    info "vm.max_map_count=$mc → tentative 262144"
    if sysctl -w vm.max_map_count=262144 >/dev/null 2>&1; then
      ok "vm.max_map_count=262144"
      fp_log install "sysctl vm.max_map_count=262144 OK"
    elif _fp_sudo sysctl -w vm.max_map_count=262144 >/dev/null 2>&1; then
      ok "vm.max_map_count=262144 (sudo)"
      fp_log install "sysctl sudo OK"
    else
      warn "sysctl impossible — exécuter manuellement: sudo sysctl -w vm.max_map_count=262144"
      fp_log install "sysctl ÉCHEC"
    fi
  else
    ok "vm.max_map_count=$mc ✓"
  fi

  # ulimit nofile (utile pour OpenSearch)
  local nof
  nof=$(ulimit -n 2>/dev/null || echo 0)
  if [ "$nof" -lt 65536 ]; then
    info "ulimit -n=$nof — recommandé 65536 (configurable dans /etc/security/limits.conf)"
    fp_log install "ulimit -n=$nof (low)"
  fi

  fp_log install "=== pre_install end ==="
  [ "$_had_e" -eq 1 ] && set -e
  return 0
}

# ──────────────────────────────────────────────────────────────
#  PHASE 2 — NETTOYAGE AVANT START
# ──────────────────────────────────────────────────────────────
cleanup_processes() {
  local _had_e=0
  case $- in *e*) _had_e=1;; esac
  set +e
  step "PHASE 2/6 — Nettoyage anciens processus FP"
  fp_log start "=== cleanup_processes start ==="

  # docker compose down silencieux (n'arrête pas les containers d'autres projets)
  # NOTE: désactivé par défaut pour préserver l'état — activable via FP_CLEAN_DOWN=1
  if [ "${FP_CLEAN_DOWN:-0}" = "1" ]; then
    info "docker compose down (FP_CLEAN_DOWN=1)"
    docker compose down --remove-orphans >> "$FP_LOG_START" 2>&1 || true
    fp_log start "docker compose down exécuté"
  else
    info "docker compose down sauté (FP_CLEAN_DOWN=0) — préserve l'état"
  fi

  # Tuer les containers en état "Restarting" ou "Created" qui bloquent les ports
  local stuck
  stuck=$(_fp_docker ps -a --filter "name=forensic" --filter "status=restarting" --format '{{.Names}}' 2>/dev/null || true)
  if [ -n "$stuck" ]; then
    warn "Containers en restart-loop: $stuck — kill"
    while IFS= read -r c; do
      [ -z "$c" ] && continue
      _fp_docker kill "$c" >/dev/null 2>&1 || true
      fp_log start "kill stuck container: $c"
    done <<< "$stuck"
  fi

  fp_log start "=== cleanup_processes end ==="
  [ "$_had_e" -eq 1 ] && set -e
  return 0
}

cleanup_ports() {
  local _had_e=0
  case $- in *e*) _had_e=1;; esac
  set +e
  step "PHASE 2/6 — Vérification ports critiques FP"
  fp_log start "=== cleanup_ports start ==="

  # Ports FP critiques + plage portails
  local ports=(9200 5601 3000 3001 3002 5432 6379 9042 15672 5000 5044 5045 5140 8080 8090 9000 9001 9002 9003 9700)

  local occupied=()
  for p in "${ports[@]}"; do
    if _fp_port_owned_by_fp_container "$p"; then
      continue
    fi
    if _fp_port_in_use "$p"; then
      occupied+=("$p")
    fi
  done

  if [ "${#occupied[@]}" -eq 0 ]; then
    ok "Ports critiques libres ou détenus par containers FP"
    fp_log start "ports OK"
    [ "$_had_e" -eq 1 ] && set -e
    return 0
  fi

  warn "Ports occupés par des processus non-FP: ${occupied[*]}"
  fp_log start "ports occupés: ${occupied[*]}"

  if [ "${FP_KILL_PORTS:-0}" != "1" ]; then
    warn "Pour libérer auto : FP_KILL_PORTS=1 ./forensic.sh start"
    [ "$_had_e" -eq 1 ] && set -e
    return 0
  fi

  for p in "${occupied[@]}"; do
    local pids
    pids=$(lsof -ti ":${p}" -sTCP:LISTEN 2>/dev/null || true)
    if [ -z "$pids" ] && command -v fuser >/dev/null 2>&1; then
      pids=$(fuser "${p}/tcp" 2>/dev/null || true)
    fi
    if [ -n "$pids" ]; then
      warn "Kill PID(s) $pids sur port $p"
      # shellcheck disable=SC2086
      kill -TERM $pids 2>/dev/null || _fp_sudo kill -TERM $pids 2>/dev/null || true
      sleep 1
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || _fp_sudo kill -9 $pids 2>/dev/null || true
      fp_log start "killed PID(s) $pids on port $p"
    fi
  done
  [ "$_had_e" -eq 1 ] && set -e
  return 0
}

_fp_port_in_use() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -lnt 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}\$"
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -i ":${p}" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -lnt 2>/dev/null | grep -qE "[:.]${p} "
    return $?
  fi
  return 1
}

_fp_port_owned_by_fp_container() {
  local p="$1"
  # Cherche le port simple (:p->) ou dans une plage (:a-b->) où a <= p <= b
  local ports
  ports=$(docker ps --filter "name=forensic" --format '{{.Ports}}' 2>/dev/null) || return 1
  [ -z "$ports" ] && return 1
  # Match direct
  echo "$ports" | grep -qE "[:.]${p}->|^${p}->| ${p}/tcp" && return 0
  # Match plage (ex: 5044-5046->)
  local hit
  hit=$(echo "$ports" | grep -oE '[0-9]+-[0-9]+->' | sed 's/->$//' || true)
  if [ -n "$hit" ]; then
    local range a b
    while IFS= read -r range; do
      a="${range%-*}"
      b="${range#*-}"
      if [ "$p" -ge "$a" ] 2>/dev/null && [ "$p" -le "$b" ] 2>/dev/null; then
        return 0
      fi
    done <<< "$hit"
  fi
  return 1
}

# Wrapper qui appelle aussi cleanup_network existant si défini ailleurs.
fp_cleanup_all() {
  cleanup_processes
  cleanup_ports
  if command -v cleanup_network >/dev/null 2>&1; then
    cleanup_network 2>&1 | tee -a "$FP_LOG_NETWORK" >/dev/null
  fi
}

# ──────────────────────────────────────────────────────────────
#  PHASE 2bis — RÉPARATION RÉSEAU DOCKER FP (Address already in use)
# ──────────────────────────────────────────────────────────────
# Objectif :
#   - garantir que `fp-final2_forensic-net` existe avec le bon subnet
#     AVANT `docker compose up`, sans collision avec d'autres réseaux.
#   - le subnet par défaut est 172.25.0.0/16 (déclaré dans docker-compose.yml,
#     38+ containers en IP statique). On essaie d'abord de le libérer.
#   - fallback automatique : si 172.25.0.0/16 reste indisponible,
#     migration vers 172.26 / 172.27 / 172.28 avec patch sed du
#     docker-compose.yml (backup .bak.<ts> + rollback documenté).
# Variables :
#   FP_NET_NAME              (def: fp-final2_forensic-net)
#   FP_NET_DEFAULT_SUBNET    (def: 172.25.0.0/16)
#   FP_NET_FALLBACKS         (def: "172.26.0.0/16 172.27.0.0/16 172.28.0.0/16")
#   FP_NET_FORCE_MIGRATE=1   désactive le maintien sur 172.25
#   FP_NET_NO_PATCH=1        interdit la modification du docker-compose.yml

FP_NET_NAME="${FP_NET_NAME:-}"
FP_NET_LOGICAL_NAME="${FP_NET_LOGICAL_NAME:-forensic-net}"

_fp_detect_compose_project() {
  if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
    echo "$COMPOSE_PROJECT_NAME"
  else
    basename "${DIR:-.}"
  fi
}

_fp_init_net_names() {
  local proj
  proj="${FP_COMPOSE_PROJECT:-$(_fp_detect_compose_project)}"
  FP_COMPOSE_PROJECT="$proj"
  if [ -z "$FP_NET_NAME" ]; then
    FP_NET_NAME="${proj}_${FP_NET_LOGICAL_NAME}"
  fi
}
FP_NET_DEFAULT_SUBNET="${FP_NET_DEFAULT_SUBNET:-172.25.0.0/16}"
FP_NET_FALLBACKS="${FP_NET_FALLBACKS:-172.26.0.0/16 172.27.0.0/16 172.28.0.0/16}"

_fp_net_log() { fp_log network "$*"; }

# Renvoie le subnet déclaré dans docker-compose.yml pour le réseau forensic-net
_fp_net_compose_subnet() {
  local f="$DIR/docker-compose.yml"
  [ -f "$f" ] || { echo ""; return 1; }
  # Extraction robuste : extrait directement l'IP/mask par regex,
  # peu importe la décoration YAML autour (- subnet: "x.y.z.w/n" → x.y.z.w/n)
  awk '
    /^networks:/                  { in_nets=1; next }
    in_nets && /^[^ ]/            { in_nets=0 }
    in_nets && /^  forensic-net:/ { in_fn=1; next }
    in_fn && /^  [a-zA-Z]/        { in_fn=0 }
    in_fn && /subnet:/ {
      if (match($0, /[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\/[0-9]+/)) {
        print substr($0, RSTART, RLENGTH); exit
      }
    }
  ' "$f"
}

# Inspecte le subnet d'un réseau Docker (vide si réseau absent)
_fp_net_get_subnet() {
  local net="$1"
  _fp_docker network inspect "$net" \
    --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null || true
}

# Liste les réseaux Docker (autres que ceux passés en argument) qui occupent
# un subnet donné. Affiche "<name>|<containers_count>" par ligne.
_fp_net_holders_of_subnet() {
  local subnet="$1" exclude="${2:-}"
  local names
  names=$(_fp_docker network ls --format '{{.Name}}' 2>/dev/null) || return 0
  local n sn cnt
  while IFS= read -r n; do
    [ -z "$n" ] && continue
    [ "$n" = "$exclude" ] && continue
    sn=$(_fp_net_get_subnet "$n")
    if [ "$sn" = "$subnet" ]; then
      cnt=$(_fp_docker network inspect "$n" \
        --format '{{len .Containers}}' 2>/dev/null || echo 0)
      echo "$n|$cnt"
    fi
  done <<< "$names"
}

# Vérifie qu'un subnet est disponible (= aucun autre réseau Docker ne l'utilise).
# Si occupé par un réseau VIDE et hors-FP → on essaie de le supprimer.
# Retour : 0 = disponible / 1 = occupé (réseau non vidable).
_fp_net_subnet_free() {
  local subnet="$1" exclude="${2:-}"
  local holders
  holders=$(_fp_net_holders_of_subnet "$subnet" "$exclude")
  if [ -z "$holders" ]; then
    return 0
  fi
  local line name cnt
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    name="${line%|*}"
    cnt="${line#*|}"
    if [ "$cnt" = "0" ]; then
      _fp_net_log "subnet $subnet occupé par réseau vide '$name' → suppression"
      if _fp_docker network rm "$name" >/dev/null 2>&1; then
        info "Réseau orphelin '$name' supprimé (subnet $subnet libéré)"
      else
        warn "Impossible de supprimer '$name' (subnet $subnet)"
        _fp_net_log "rm $name ÉCHEC"
        return 1
      fi
    else
      warn "Subnet $subnet occupé par '$name' ($cnt container(s) actifs)"
      _fp_net_log "subnet $subnet bloqué par $name ($cnt containers)"
      return 1
    fi
  done <<< "$holders"
  return 0
}

# Patche docker-compose.yml : remplace 172.<old_a>.X.Y → 172.<new_a>.X.Y
# Ne touche pas aux autres champs. Backup .bak.<ts> conservé.
_fp_net_patch_compose() {
  local from_subnet="$1" to_subnet="$2"
  local f="$DIR/docker-compose.yml"
  [ -f "$f" ] || return 1
  if [ "${FP_NET_NO_PATCH:-0}" = "1" ]; then
    warn "FP_NET_NO_PATCH=1 — refus de patcher docker-compose.yml"
    return 1
  fi
  local from_oct to_oct
  from_oct=$(echo "$from_subnet" | awk -F. '{print $1"."$2}')
  to_oct=$(echo "$to_subnet" | awk -F. '{print $1"."$2}')
  if [ -z "$from_oct" ] || [ -z "$to_oct" ]; then
    return 1
  fi
  local ts bak
  ts=$(date +%Y%m%d_%H%M%S)
  bak="${f}.bak.netmig.${ts}"
  cp "$f" "$bak" || return 1
  _fp_net_log "patch compose : $from_oct.* → $to_oct.* (backup: $bak)"
  # Remplacement strict : seulement les occurrences du préfixe + un point (.)
  # → évite de toucher à d'autres IPs (10.x, 192.x, etc.)
  sed -i "s|\\b${from_oct}\\.|${to_oct}.|g" "$f"
  if grep -qE "\\b${to_oct}\\." "$f"; then
    ok "docker-compose.yml patché : $from_oct.* → $to_oct.*  (rollback: cp $bak $f)"
    return 0
  fi
  warn "Patch sed inopérant — restauration"
  cp "$bak" "$f" 2>/dev/null || true
  return 1
}

# Trouve le premier subnet de la liste FP_NET_FALLBACKS qui est libre.
_fp_net_pick_fallback() {
  local exclude="${1:-}"
  local s
  for s in $FP_NET_FALLBACKS; do
    if _fp_net_subnet_free "$s" "$exclude"; then
      echo "$s"
      return 0
    fi
  done
  return 1
}

# Fonction principale demandée par le brief
fp_network_repair() {
  local _had_e=0
  case $- in *e*) _had_e=1;; esac
  set +e

  step "PHASE 2bis — Réparation réseau Docker FP ($FP_NET_NAME)"
  fp_log_init
  _fp_init_net_names
  _fp_net_log "=== fp_network_repair start (project=$FP_COMPOSE_PROJECT net=$FP_NET_NAME) ==="

  if ! command -v docker >/dev/null 2>&1; then
    err "docker introuvable — impossible de réparer le réseau"
    [ "$_had_e" -eq 1 ] && set -e
    return 1
  fi

  # Docker DOIT être accessible avant toute opération réseau
  if ! fp_ensure_docker; then
    err "Docker inaccessible — réparation réseau impossible (pas de migration subnet)"
    _fp_net_log "ÉCHEC : docker inaccessible"
    [ "$_had_e" -eq 1 ] && set -e
    return 1
  fi
  fp_bind_compose_cmds 2>/dev/null || true

  # 1) Subnet déclaré dans docker-compose.yml (source de vérité)
  local compose_subnet target_subnet existing_subnet
  compose_subnet=$(_fp_net_compose_subnet)
  if [ -n "$compose_subnet" ]; then
    info "Subnet docker-compose.yml : $compose_subnet"
    _fp_net_log "compose subnet = $compose_subnet"
    target_subnet="$compose_subnet"
  else
    warn "Subnet absent du compose — fallback à FP_NET_DEFAULT_SUBNET=$FP_NET_DEFAULT_SUBNET"
    target_subnet="$FP_NET_DEFAULT_SUBNET"
  fi

  # 2) Inspecter le réseau existant
  existing_subnet=$(_fp_net_get_subnet "$FP_NET_NAME")
  local existing_label=""
  local expected_label="${FP_NET_LOGICAL_NAME:-forensic-net}"
  if [ -n "$existing_subnet" ]; then
    existing_label=$(_fp_net_get_compose_label "$FP_NET_NAME")
    info "Réseau '$FP_NET_NAME' présent — subnet : $existing_subnet · label : '${existing_label:-<absent>}'"
    _fp_net_log "réseau existant subnet=$existing_subnet label='${existing_label}'"
    # Détection du label Compose incorrect ou absent → recréation forcée
    if [ "$existing_label" != "$expected_label" ]; then
      warn "Label Compose incorrect ou absent (attendu : '$expected_label')"
      warn "  → cause typique de l'erreur : 'network found but has incorrect label com.docker.compose.network'"
      _fp_net_log "label INCORRECT (got='$existing_label' want='$expected_label') → suppression+recréation"
      _fp_net_force_remove "$FP_NET_NAME"
      existing_subnet=""
    fi
  else
    info "Réseau '$FP_NET_NAME' absent — sera créé"
    _fp_net_log "réseau absent"
  fi

  # 3) Si forçage migration → on saute direct à la phase fallback
  if [ "${FP_NET_FORCE_MIGRATE:-0}" = "1" ]; then
    warn "FP_NET_FORCE_MIGRATE=1 — migration forcée vers fallback subnet"
    _fp_net_force_remove "$FP_NET_NAME"
    _fp_net_try_fallback "$target_subnet"
    [ "$_had_e" -eq 1 ] && set -e
    return $?
  fi

  # 4) Vérifier si le subnet cible est libre (hors réseau FP existant)
  if ! _fp_net_subnet_free "$target_subnet" "$FP_NET_NAME"; then
    warn "Subnet $target_subnet bloqué par un autre réseau Docker"
    _fp_net_log "conflit subnet $target_subnet — tentative fallback"
    _fp_net_force_remove "$FP_NET_NAME"
    _fp_net_try_fallback "$target_subnet"
    [ "$_had_e" -eq 1 ] && set -e
    return $?
  fi

  # 5) Le subnet cible est libre. Si le réseau existe avec un mauvais subnet → recréer.
  if [ -n "$existing_subnet" ] && [ "$existing_subnet" != "$target_subnet" ]; then
    warn "Réseau '$FP_NET_NAME' a un subnet incompatible ($existing_subnet ≠ $target_subnet) — recréation"
    _fp_net_log "subnet incohérent → suppression"
    _fp_net_force_remove "$FP_NET_NAME"
    existing_subnet=""
  fi

  # 6) Recréer si nécessaire
  if [ -z "$existing_subnet" ]; then
    local create_rc=0
    _fp_net_create "$FP_NET_NAME" "$target_subnet" || create_rc=$?
    if [ "$create_rc" -eq 0 ]; then
      ok "Réseau '$FP_NET_NAME' créé ($target_subnet)"
      _fp_net_log "réseau créé subnet=$target_subnet"
    elif [ "$create_rc" -eq 2 ]; then
      err "Docker inaccessible lors de la création réseau — pas de fallback subnet"
      _fp_net_log "create abort: docker down (rc=2)"
      [ "$_had_e" -eq 1 ] && set -e
      return 1
    elif [ "$create_rc" -eq 3 ]; then
      warn "Subnet $target_subnet en conflit — fallback automatique"
      _fp_net_log "subnet conflict → fallback"
      _fp_net_force_remove "$FP_NET_NAME"
      _fp_net_try_fallback "$target_subnet" || { [ "$_had_e" -eq 1 ] && set -e; return 1; }
    else
      warn "Création directe échouée (rc=$create_rc) — 2e tentative"
      _fp_net_force_remove "$FP_NET_NAME"
      create_rc=0
      _fp_net_create "$FP_NET_NAME" "$target_subnet" || create_rc=$?
      if [ "$create_rc" -eq 0 ]; then
        ok "Réseau '$FP_NET_NAME' créé ($target_subnet)"
        _fp_net_log "réseau créé (2e tentative) subnet=$target_subnet"
      elif [ "$create_rc" -eq 2 ]; then
        err "Docker inaccessible — pas de fallback subnet"
        [ "$_had_e" -eq 1 ] && set -e
        return 1
      else
        warn "2e tentative échouée — essai création via docker compose"
        if _fp_net_create_via_compose; then
          ok "Réseau '$FP_NET_NAME' créé via docker compose"
          _fp_net_log "réseau créé via compose"
        else
          warn "Compose fallback échoué — fallback subnet alternatif"
          _fp_net_try_fallback "$target_subnet" || { [ "$_had_e" -eq 1 ] && set -e; return 1; }
        fi
      fi
    fi
  else
    ok "Réseau '$FP_NET_NAME' OK ($existing_subnet)"
    _fp_net_log "réseau OK (idempotent)"
  fi

  # 7) Test bloquant final : le réseau DOIT exister avec le bon subnet ET le bon label
  local final_subnet final_label
  final_subnet=$(_fp_net_get_subnet "$FP_NET_NAME")
  final_label=$(_fp_net_get_compose_label "$FP_NET_NAME")
  if [ -z "$final_subnet" ]; then
    err "Réseau '$FP_NET_NAME' introuvable après réparation"
    _fp_net_log "ÉCHEC FINAL : réseau introuvable"
    [ "$_had_e" -eq 1 ] && set -e
    return 1
  fi
  if [ "$final_label" != "$expected_label" ]; then
    err "Réseau présent mais label Compose toujours incorrect ('$final_label' ≠ '$expected_label')"
    _fp_net_log "ÉCHEC FINAL : label incorrect"
    [ "$_had_e" -eq 1 ] && set -e
    return 1
  fi
  ok "Réseau prêt : $FP_NET_NAME ($final_subnet · label='$final_label')"

  # Purge des containers qui pointent encore vers l'ancien NetworkID (évite
  # l'erreur "network <id> not found" au prochain compose up).
  _fp_net_purge_stale_containers "$FP_NET_NAME"

  _fp_net_log "=== fp_network_repair end : $FP_NET_NAME ($final_subnet, label=$final_label) ==="

  [ "$_had_e" -eq 1 ] && set -e
  return 0
}

# Supprime un réseau Docker proprement :
#  - déconnecte les containers running (préserve leur état)
#  - supprime (`docker rm -f`) les containers en état Created/Exited attachés au
#    réseau, car ils gardent une référence à l'ancien NetworkID. Sans ça,
#    docker compose lèvera : "failed to set up container networking: network
#    <old_id> not found" au prochain `up`. Les containers seront recréés
#    proprement par `docker compose up`.
_fp_net_force_remove() {
  local net="$1"
  _fp_docker network inspect "$net" >/dev/null 2>&1 || return 0
  local net_id
  net_id=$(_fp_docker network inspect "$net" --format '{{.Id}}' 2>/dev/null || true)
  _fp_net_log "force_remove $net (id=$net_id)"

  local running_cids stopped_cids
  running_cids=$(_fp_docker network inspect "$net" \
    --format '{{range $k,$v := .Containers}}{{$k}} {{end}}' 2>/dev/null || true)
  stopped_cids=$(_fp_docker ps -a --filter "network=${net}" \
    --filter "status=exited" --filter "status=created" \
    --format '{{.ID}}' 2>/dev/null || true)

  if [ -n "$running_cids" ]; then
    local c
    for c in $running_cids; do
      _fp_docker network disconnect -f "$net" "$c" >/dev/null 2>&1 || true
      _fp_net_log "disconnect $c de $net"
    done
  fi

  if [ -n "$stopped_cids" ]; then
    local c name
    for c in $stopped_cids; do
      name=$(_fp_docker inspect --format '{{.Name}}' "$c" 2>/dev/null | sed 's|^/||')
      case "$name" in
        forensic-*)
          _fp_docker rm -f "$c" >/dev/null 2>&1 && _fp_net_log "rm stopped container $name ($c)"
          ;;
      esac
    done
  fi

  if _fp_docker network rm "$net" >/dev/null 2>&1; then
    info "Réseau '$net' supprimé"
    _fp_net_log "rm $net OK"
    return 0
  fi
  warn "Échec suppression '$net' — tentative prune"
  _fp_docker network prune -f >/dev/null 2>&1 || true
  if _fp_docker network inspect "$net" >/dev/null 2>&1; then
    _fp_net_log "rm $net ÉCHEC après prune"
    return 1
  fi
  _fp_net_log "rm $net OK (via prune)"
  return 0
}

# Nettoyage défensif des containers FP qui référencent un réseau Docker
# inexistant (cas après suppression du réseau, ou crash docker). Appelable
# avant tout `docker compose up`. Touche uniquement les containers en état
# Created/Exited, jamais les containers running.
_fp_net_purge_stale_containers() {
  local net_name="${1:-$FP_NET_NAME}"
  # ID du réseau courant (si présent)
  local current_id
  current_id=$(_fp_docker network inspect "$net_name" --format '{{.Id}}' 2>/dev/null || true)

  local cs
  cs=$(_fp_docker ps -a --filter "name=forensic" --filter "status=exited" \
       --format '{{.ID}}' 2>/dev/null || true)
  cs="$cs $(_fp_docker ps -a --filter "name=forensic" --filter "status=created" \
       --format '{{.ID}}' 2>/dev/null || true)"

  local c name nets stale=0
  for c in $cs; do
    [ -z "$c" ] && continue
    name=$(_fp_docker inspect --format '{{.Name}}' "$c" 2>/dev/null | sed 's|^/||')
    [ -z "$name" ] && continue
    nets=$(_fp_docker inspect --format \
      '{{range $k,$v := .NetworkSettings.Networks}}{{$v.NetworkID}}|{{$k}} {{end}}' \
      "$c" 2>/dev/null || true)
    local entry net_id net_alias
    for entry in $nets; do
      [ -z "$entry" ] && continue
      net_id="${entry%%|*}"
      net_alias="${entry##*|}"
      if [ "$net_alias" = "$net_name" ] && [ -n "$current_id" ] && [ "$net_id" != "$current_id" ]; then
        info "Container stale détecté : $name (référence ancien NetworkID)"
        _fp_docker rm -f "$c" >/dev/null 2>&1 && \
          _fp_net_log "purge stale $name (old_id=$net_id != current=$current_id)"
        stale=$((stale+1))
      fi
    done
  done
  if [ "$stale" -gt 0 ]; then
    info "$stale container(s) stale purgé(s) — seront recréés par compose"
  fi
  return 0
}

# Crée un réseau Docker avec un subnet précis ET les labels Compose corrects.
# Sans ces labels, docker compose émet :
#   "network <name> was found but has incorrect label com.docker.compose.network"
# et refuse de l'utiliser.
# Fallback : laisser Compose créer le réseau (labels natifs, sans warning)
_fp_net_create_via_compose() {
  _fp_net_log "create via compose up --no-start postgres"
  _fp_compose up --no-start --no-recreate postgres >> "$FP_LOG_NETWORK" 2>&1
  local sn
  sn=$(_fp_net_get_subnet "$FP_NET_NAME")
  [ -n "$sn" ]
}

# Retour : 0=OK  2=docker inaccessible  3=conflit subnet  1=autre erreur
_fp_net_create() {
  local net="$1" subnet="$2"
  local compose_logical="${FP_NET_LOGICAL_NAME:-forensic-net}"
  local project="${FP_COMPOSE_PROJECT:-fp-final2}"
  local err_out rc=0 ver

  ver=$(_fp_compose version --short 2>/dev/null || echo unknown)

  rc=0
  err_out=$(_fp_docker network create \
      --driver bridge \
      --subnet "$subnet" \
      --label "com.docker.compose.network=${compose_logical}" \
      --label "com.docker.compose.project=${project}" \
      --label "com.docker.compose.version=${ver}" \
      "$net" 2>&1) || rc=$?
  if [ "${rc:-0}" -eq 0 ]; then
    return 0
  fi
  _fp_net_log "create(v1) rc=${rc}: $err_out"

  rc=0
  err_out=$(_fp_docker network create \
    --driver bridge \
    --subnet "$subnet" \
    --label "com.docker.compose.network=${compose_logical}" \
    --label "com.docker.compose.project=${project}" \
    "$net" 2>&1) || rc=$?
  if [ "${rc:-0}" -eq 0 ]; then
    return 0
  fi
  _fp_net_log "create(v2) rc=${rc}: $err_out"

  if echo "$err_out" | grep -qiE "permission denied|cannot connect|Is the docker daemon|connection refused|Got permission denied"; then
    return 2
  fi
  if echo "$err_out" | grep -qiE "already exists| overlaps |Pool overlaps|cannot allocate|address already in use"; then
    return 3
  fi
  return 1
}

_fp_net_get_compose_label() {
  local net="$1"
  _fp_docker network inspect "$net" \
    --format '{{ index .Labels "com.docker.compose.network" }}' 2>/dev/null || true
}

# Restaure docker-compose.yml depuis le backup .bak.netmig le plus récent
_fp_net_rollback_compose() {
  local latest
  latest=$(ls -t "$DIR"/docker-compose.yml.bak.netmig.* 2>/dev/null | head -1)
  if [ -n "$latest" ] && [ -f "$latest" ]; then
    cp "$latest" "$DIR/docker-compose.yml"
    warn "Rollback docker-compose.yml ← $latest"
    _fp_net_log "rollback compose from $latest"
    return 0
  fi
  return 1
}

# Fallback : tester 172.26/27/28 et patcher le compose si nécessaire
_fp_net_try_fallback() {
  local from_subnet="$1"
  local pick patched=0
  pick=$(_fp_net_pick_fallback "$FP_NET_NAME")
  if [ -z "$pick" ]; then
    err "Aucun subnet fallback disponible parmi : $FP_NET_FALLBACKS"
    _fp_net_log "aucun fallback disponible"
    return 1
  fi
  warn "Migration subnet : $from_subnet → $pick"
  _fp_net_log "migration $from_subnet → $pick"
  if [ "$from_subnet" != "$pick" ]; then
    if ! _fp_net_patch_compose "$from_subnet" "$pick"; then
      err "Patch docker-compose.yml impossible — abandon migration"
      _fp_net_log "patch compose ÉCHEC"
      return 1
    fi
    patched=1
  fi
  _fp_net_subnet_free "$pick" "$FP_NET_NAME" || true
  local create_rc=0
  _fp_net_create "$FP_NET_NAME" "$pick" || create_rc=$?
  if [ "$create_rc" -eq 0 ]; then
    ok "Réseau recréé avec subnet fallback : $pick"
    _fp_net_log "réseau créé ($pick)"
    return 0
  fi
  err "Création du réseau avec subnet $pick ÉCHEC (rc=$create_rc)"
  _fp_net_log "création réseau ($pick) ÉCHEC rc=$create_rc"
  if [ "$patched" -eq 1 ]; then
    _fp_net_rollback_compose || warn "Rollback compose manuel : cp docker-compose.yml.bak.netmig.* docker-compose.yml"
  fi
  return 1
}

# ──────────────────────────────────────────────────────────────
#  PHASE 4 — STATUS GLOBAL ENRICHI
# ──────────────────────────────────────────────────────────────
status_full() {
  # Neutralise set -e/pipefail localement pour éviter de couper l'affichage
  # sur le moindre curl/docker en échec.
  local _had_e=0 _had_p=0
  case $- in *e*) _had_e=1;; esac
  set +e
  if shopt -qo pipefail 2>/dev/null; then
    _had_p=1
    set +o pipefail
  fi
  step "STATUS GLOBAL — Plateforme Forensic"
  fp_log_init

  echo ""
  echo -e "${CYAN}── Containers Docker (filter: forensic-*) ──${NC}"
  if command -v docker >/dev/null 2>&1; then
    local total up dps
    total=$(docker ps -a --filter "name=forensic" -q 2>/dev/null | wc -l | tr -d ' ')
    up=$(docker ps --filter "name=forensic" --filter "status=running" -q 2>/dev/null | wc -l | tr -d ' ')
    echo "  Total: $total · Running: $up"
    # Capture en variable pour éviter SIGPIPE sous set -o pipefail
    dps=$(docker ps -a --filter "name=forensic" \
      --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true)
    if [ -n "$dps" ]; then
      echo "$dps" | head -n 60 | sed 's/^/  /' || true
    fi
  else
    warn "docker absent"
  fi

  echo ""
  echo -e "${CYAN}── Endpoints critiques ──${NC}"
  _fp_status_endpoint "OpenSearch cluster"       "http://localhost:9200/_cluster/health"
  _fp_status_endpoint "OpenSearch Dashboards"    "http://localhost:5601/dashboards/api/status"
  _fp_status_endpoint "Grafana"                  "http://localhost:3001/api/health"
  _fp_status_endpoint "Timesketch /login"        "http://localhost:5000/login"
  _fp_status_endpoint "Portail CERT direct"      "http://localhost:3000/api/health"
  _fp_status_endpoint "Portail IT direct"        "http://localhost:3002/api/health"
  _fp_status_endpoint "Nginx HTTPS"              "https://localhost/" "k"

  echo ""
  echo -e "${CYAN}── Cluster OpenSearch ──${NC}"
  local osh=""
  osh=$(curl -sf --max-time 5 "http://localhost:9200/_cluster/health" 2>/dev/null || true)
  if [ -n "$osh" ]; then
    local stat docs nodes
    stat=$(echo "$osh" | grep -oE '"status":"[^"]*"' | head -1 | sed 's/.*:"\([^"]*\)".*/\1/')
    nodes=$(echo "$osh" | grep -oE '"number_of_nodes":[0-9]*' | head -1 | sed 's/.*:\([0-9]*\)/\1/')
    docs=$(echo "$osh" | grep -oE '"active_shards":[0-9]*' | head -1 | sed 's/.*:\([0-9]*\)/\1/')
    case "$stat" in
      green)  echo -e "  ${GREEN}● $stat${NC} · nodes=$nodes shards=$docs" ;;
      yellow) echo -e "  ${YELLOW}● $stat${NC} · nodes=$nodes shards=$docs" ;;
      *)      echo -e "  ${RED}● $stat${NC} · nodes=$nodes shards=$docs" ;;
    esac
  else
    echo -e "  ${RED}● injoignable${NC}"
  fi

  echo ""
  echo -e "${CYAN}── Réseaux Docker FP ──${NC}"
  if command -v docker >/dev/null 2>&1; then
    local nls
    nls=$(docker network ls --filter "name=forensic" \
      --format 'table {{.Name}}\t{{.Driver}}\t{{.Scope}}' 2>/dev/null || true)
    [ -n "$nls" ] && echo "$nls" | sed 's/^/  /'
    local nets
    nets=$(docker network ls --filter "name=forensic" --format '{{.Name}}' 2>/dev/null)
    if [ -n "$nets" ]; then
      while IFS= read -r net; do
        [ -z "$net" ] && continue
        local sn
        sn=$(docker network inspect "$net" \
          --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null || true)
        [ -n "$sn" ] && echo "  └─ $net : $sn"
      done <<< "$nets"
    fi
  fi

  echo ""
  echo -e "${CYAN}── Ports critiques (LISTEN) ──${NC}"
  local p
  for p in 9200 5601 3000 3001 3002 5000 5432 6379 9042 15672 8080 8090 9000 9001 9002 9003 443 80; do
    if _fp_port_in_use "$p"; then
      local owner
      if _fp_port_owned_by_fp_container "$p"; then
        owner="forensic-*"
        echo -e "  ${GREEN}✓${NC} ${p} (${owner})"
      else
        owner="autre processus"
        echo -e "  ${YELLOW}?${NC} ${p} (${owner})"
      fi
    fi
  done

  echo ""
  echo -e "${CYAN}── Logs récents ──${NC}"
  for log in "$FP_LOG_START" "$FP_LOG_INSTALL" "$FP_LOG_NETWORK"; do
    if [ -s "$log" ]; then
      echo "  $log : $(wc -l < "$log" 2>/dev/null | tr -d ' ') lignes"
    fi
  done
  echo ""
  # Rétablir les flags shell tels qu'ils étaient
  [ "$_had_p" -eq 1 ] && set -o pipefail
  [ "$_had_e" -eq 1 ] && set -e
  return 0
}

_fp_status_endpoint() {
  local name="$1" url="$2" insecure="${3:-}"
  # On retire -f pour capturer proprement le %{http_code} même sur 4xx/5xx
  local opts="-s -o /dev/null --max-time 6"
  [ "$insecure" = "k" ] && opts="-sk -o /dev/null --max-time 6"
  local code
  # set -e safe : on neutralise l'exit de curl (timeout / connect refused)
  # shellcheck disable=SC2086
  code=$(curl $opts -w '%{http_code}' "$url" 2>/dev/null || echo "")
  [ -z "$code" ] && code="000"
  if [ "$code" = "200" ] || [ "$code" = "301" ] || [ "$code" = "302" ] || [ "$code" = "307" ] || [ "$code" = "308" ]; then
    echo -e "  ${GREEN}✓${NC} $name  ($code)"
  elif [ "$code" = "401" ] || [ "$code" = "403" ]; then
    echo -e "  ${YELLOW}~${NC} $name  ($code · auth requise mais service UP)"
  else
    echo -e "  ${RED}✗${NC} $name  ($code · $url)"
  fi
}

# ──────────────────────────────────────────────────────────────
#  PHASE 6 — TESTS AUTOMATIQUES (après start)
# ──────────────────────────────────────────────────────────────
# ──────────────────────────────────────────────────────────────
#  PHASE 5bis — DIAGNOSTIC LOGS CONTAINERS
# ──────────────────────────────────────────────────────────────
# Scanne les logs des containers critiques et détecte les patterns d'erreur
# connus pour proposer une action corrective dans la boucle auto-repair.
# Affiche un rapport synthétique et alimente $FP_DIAG_HINT (variable globale)
# avec un mot-clé indiquant la nature du problème détecté :
#   - "network_label" → label Compose incorrect / Address already in use
#   - "network_subnet" → conflit subnet
#   - "opensearch_red" → cluster OS rouge ou max_map_count
#   - "container_restart" → boucle de redémarrage
#   - "port_conflict" → port déjà bind
#   - ""                → aucun problème spécifique détecté
FP_DIAG_HINT=""

fp_diagnose_logs() {
  local _had_e=0
  case $- in *e*) _had_e=1;; esac
  set +e
  step "DIAGNOSTIC — Scan logs containers critiques"
  fp_log_init
  fp_log start "=== fp_diagnose_logs start ==="
  FP_DIAG_HINT=""

  if ! command -v docker >/dev/null 2>&1; then
    warn "docker absent — diagnostic impossible"
    [ "$_had_e" -eq 1 ] && set -e
    return 0
  fi

  # Patterns critiques par container
  local containers=(
    "forensic-opensearch-1"
    "forensic-opensearch-2"
    "forensic-opensearch-dashboards"
    "forensic-timesketch-web"
    "forensic-grafana"
    "forensic-cert-portal"
    "forensic-postgres"
    "forensic-rabbitmq"
  )

  local c logs hits=0
  for c in "${containers[@]}"; do
    docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$c" || continue
    logs=$(docker logs --tail 100 "$c" 2>&1 || true)

    # 1) Erreurs réseau (label, address in use)
    if echo "$logs" | grep -qiE "incorrect label|com\.docker\.compose\.network|network .* was found but"; then
      warn "[$c] erreur 'incorrect label' détectée"
      fp_log start "diag: $c → network_label"
      FP_DIAG_HINT="network_label"
      hits=$((hits+1))
    fi
    if echo "$logs" | grep -qiE "address already in use|bind: address already"; then
      warn "[$c] 'Address already in use' détecté"
      fp_log start "diag: $c → port_or_network conflict"
      [ -z "$FP_DIAG_HINT" ] && FP_DIAG_HINT="network_subnet"
      hits=$((hits+1))
    fi
    # 2) OpenSearch RED + max_map_count
    if [ "$c" = "forensic-opensearch-1" ] || [ "$c" = "forensic-opensearch-2" ]; then
      if echo "$logs" | grep -qiE "max virtual memory|max_map_count.*too low|bootstrap checks failed"; then
        warn "[$c] vm.max_map_count insuffisant"
        fp_log start "diag: $c → max_map_count"
        FP_DIAG_HINT="opensearch_sysctl"
        hits=$((hits+1))
      fi
      if echo "$logs" | grep -qiE "Could not assign|CodecCorruption|fatal error in thread"; then
        warn "[$c] erreur OpenSearch fatale détectée"
        fp_log start "diag: $c → opensearch_red"
        FP_DIAG_HINT="opensearch_red"
        hits=$((hits+1))
      fi
    fi
  done

  # 3) Containers en restart-loop
  local stuck
  stuck=$(docker ps -a --filter "name=forensic" --filter "status=restarting" \
    --format '{{.Names}}' 2>/dev/null || true)
  if [ -n "$stuck" ]; then
    warn "Containers en restart-loop détectés :"
    while IFS= read -r c; do
      [ -z "$c" ] && continue
      echo "  • $c"
      fp_log start "diag: restart-loop $c"
    done <<< "$stuck"
    [ -z "$FP_DIAG_HINT" ] && FP_DIAG_HINT="container_restart"
    hits=$((hits+1))
  fi

  if [ "$hits" -eq 0 ]; then
    ok "Aucun pattern d'erreur connu détecté dans les logs critiques"
    fp_log start "diag: clean"
  else
    info "Diagnostic : $hits indice(s) — hint='$FP_DIAG_HINT'"
  fi
  fp_log start "=== fp_diagnose_logs end (hits=$hits hint='$FP_DIAG_HINT') ==="

  [ "$_had_e" -eq 1 ] && set -e
  return 0
}

# ──────────────────────────────────────────────────────────────
#  PHASE 6bis — BOUCLE AUTO-RÉPARATION (3 tentatives max)
# ──────────────────────────────────────────────────────────────
# Appelée en fin de start() pour valider l'état final et tenter une
# auto-réparation si des KO sont détectés. Limitée à FP_RETRY_MAX=3 itérations
# (configurable) pour éviter les boucles infinies.
#
# Variables :
#   FP_RETRY_MAX     (def: 3)
#   FP_RETRY_SLEEP   (def: 15s entre 2 tentatives)
#
# Stratégie : pour chaque hint détecté, applique le correctif minimal
# adapté avant de relancer fp_start_tests :
#   network_label / network_subnet → fp_network_repair + restart services
#   opensearch_sysctl              → ré-applique sysctl + restart opensearch
#   opensearch_red                 → restart opensearch + wait
#   container_restart              → cleanup_processes + compose up -d
#   port_conflict                  → cleanup_ports (FP_KILL_PORTS=1) + restart

fp_auto_repair_loop() {
  local _had_e=0
  case $- in *e*) _had_e=1;; esac
  set +e
  step "AUTO-RÉPARATION — Boucle de validation (max ${FP_RETRY_MAX:-3} tentatives)"
  fp_log start "=== fp_auto_repair_loop start ==="

  local max="${FP_RETRY_MAX:-3}"
  local sleep_s="${FP_RETRY_SLEEP:-15}"
  local attempt=1
  local last_ok=0
  local last_fail=0

  while [ "$attempt" -le "$max" ]; do
    info "Tentative $attempt/$max — exécution des tests"
    fp_log start "auto_repair attempt=$attempt"

    # Exécute les tests synchrones
    if _fp_run_tests_silent; then
      ok "Validation OK à la tentative $attempt/$max"
      fp_log start "auto_repair attempt=$attempt → ALL OK"
      [ "$_had_e" -eq 1 ] && set -e
      return 0
    fi

    # KO → diagnostic des logs
    warn "Échecs détectés — analyse des logs containers"
    fp_diagnose_logs

    if [ "$attempt" -ge "$max" ]; then
      err "Nombre max de tentatives atteint ($max)"
      _fp_print_final_diagnostic
      fp_log start "auto_repair ÉCHEC FINAL après $max tentatives"
      [ "$_had_e" -eq 1 ] && set -e
      return 1
    fi

    # Application du correctif selon le hint
    case "$FP_DIAG_HINT" in
      network_label|network_subnet)
        warn "Application correctif : réparation réseau Docker"
        fp_log start "auto_repair: fp_network_repair"
        fp_network_repair || true
        # Restart des containers attachés au réseau
        info "Redémarrage des services impactés"
        docker compose up -d 2>&1 | tee -a "$FP_LOG_START" >/dev/null || true
        ;;
      opensearch_sysctl)
        warn "Application correctif : sysctl vm.max_map_count"
        sysctl -w vm.max_map_count=262144 >/dev/null 2>&1 || \
          _fp_sudo sysctl -w vm.max_map_count=262144 >/dev/null 2>&1 || \
          warn "sysctl impossible sans sudo NOPASSWD"
        docker restart forensic-opensearch-1 forensic-opensearch-2 >/dev/null 2>&1 || true
        ;;
      opensearch_red)
        warn "Application correctif : redémarrage OpenSearch"
        docker restart forensic-opensearch-1 forensic-opensearch-2 >/dev/null 2>&1 || true
        ;;
      container_restart)
        warn "Application correctif : kill restart-loops + relance compose"
        cleanup_processes || true
        docker compose up -d 2>&1 | tee -a "$FP_LOG_START" >/dev/null || true
        ;;
      port_conflict)
        warn "Application correctif : libération ports (FP_KILL_PORTS=1)"
        FP_KILL_PORTS=1 cleanup_ports || true
        docker compose up -d 2>&1 | tee -a "$FP_LOG_START" >/dev/null || true
        ;;
      *)
        warn "Aucun hint actionnable — simple retry après ${sleep_s}s"
        ;;
    esac

    info "Attente ${sleep_s}s pour stabilisation"
    sleep "$sleep_s"
    attempt=$((attempt+1))
  done

  [ "$_had_e" -eq 1 ] && set -e
  return 1
}

# Exécute les tests fp_start_tests en mode silencieux (capture stdout)
# et retourne 0 si TOUT est OK, sinon 1. Évite de polluer la sortie en cas
# de boucle.
_fp_run_tests_silent() {
  local out fails
  out=$(fp_start_tests 2>&1)
  echo "$out"
  fails=$(echo "$out" | grep -cE "→ [0-9]+ \(attendu" || true)
  if [ "$fails" -eq 0 ] && echo "$out" | grep -q "0 KO"; then
    return 0
  fi
  return 1
}

# Affiche un diagnostic final clair quand l'auto-repair a échoué
_fp_print_final_diagnostic() {
  echo ""
  echo -e "${RED}━━━ DIAGNOSTIC FINAL (auto-repair épuisé) ━━━${NC}"
  echo "  Containers en restart-loop :"
  docker ps -a --filter "name=forensic" --filter "status=restarting" \
    --format '    • {{.Names}}  ({{.Status}})' 2>/dev/null || true
  echo ""
  echo "  Containers exited récemment :"
  docker ps -a --filter "name=forensic" --filter "status=exited" \
    --format '    • {{.Names}}  ({{.Status}})' 2>/dev/null | head -10
  echo ""
  echo "  Logs disponibles :"
  echo "    tail -50 logs/forensic_start.log"
  echo "    tail -50 logs/forensic_network.log"
  echo "    tail -50 logs/forensic_install.log"
  echo "    docker logs forensic-opensearch-1 --tail 30"
  echo "    docker logs forensic-timesketch-web --tail 30"
  echo ""
}

fp_start_tests() {
  local _had_e=0
  case $- in *e*) _had_e=1;; esac
  set +e
  step "PHASE 6/6 — Tests automatiques (santé + réseaux + ports)"
  fp_log start "=== fp_start_tests start ==="

  local ok_count=0 fail_count=0
  # Format : "nom|url|codes_acceptés (csv)|opts"
  # codes_acceptés = liste de codes considérés OK (200, 30x redirects, 401/403
  # signifient "service UP mais auth requise" → considéré UP)
  local checks=(
    "OpenSearch cluster|http://localhost:9200/_cluster/health|200|"
    "OpenSearch Dashboards|http://localhost:5601/dashboards/api/status|200,302|"
    "Grafana|http://localhost:3001/api/health|200|"
    "Timesketch login|http://localhost:5000/login|200,301,302,308|"
    "Portail CERT|http://localhost:3000/api/health|200|"
  )
  local entry
  for entry in "${checks[@]}"; do
    local name url expects insecure
    IFS='|' read -r name url expects insecure <<< "$entry"
    # On ne suit pas les redirects ici (-L) : on veut savoir quel code le
    # service répond directement, pour différencier "UP" vs "down/forwarded".
    local opts="-s --max-time 8"
    [ "$insecure" = "k" ] && opts="-sk --max-time 8"
    local code=""
    # shellcheck disable=SC2086
    code=$(curl $opts -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo "")
    [ -z "$code" ] && code="000"
    # Match code dans la liste CSV
    if echo ",$expects," | grep -q ",$code,"; then
      ok "$name → $code"
      fp_log start "test $name OK ($code)"
      ok_count=$((ok_count+1))
    else
      warn "$name → $code (attendu ∈ {$expects})"
      fp_log start "test $name FAIL ($code, expected $expects)"
      fail_count=$((fail_count+1))
    fi
  done

  # Cluster OpenSearch = GREEN ou YELLOW (red = fail). On distingue "red"
  # de "injoignable" pour un diagnostic plus précis.
  local osh=""
  osh=$(curl -sf --max-time 5 "http://localhost:9200/_cluster/health" 2>/dev/null || true)
  if [ -z "$osh" ]; then
    warn "Cluster OpenSearch injoignable (curl échec)"
    fp_log start "cluster injoignable"
    fail_count=$((fail_count+1))
  elif echo "$osh" | grep -qE '"status":"(green|yellow)"'; then
    local st
    st=$(echo "$osh" | grep -oE '"status":"[^"]*"' | head -1 | sed 's/.*:"\([^"]*\)".*/\1/')
    ok "Cluster OpenSearch healthy (status=$st)"
    fp_log start "cluster $st"
    ok_count=$((ok_count+1))
  else
    local st
    st=$(echo "$osh" | grep -oE '"status":"[^"]*"' | head -1 | sed 's/.*:"\([^"]*\)".*/\1/')
    warn "Cluster OpenSearch status=$st (attendu green|yellow)"
    fp_log start "cluster $st (FAIL)"
    fail_count=$((fail_count+1))
  fi

  echo ""
  info "Bilan tests: ${ok_count} OK · ${fail_count} KO"
  fp_log start "bilan tests: OK=$ok_count FAIL=$fail_count"

  [ "$_had_e" -eq 1 ] && set -e
  return 0
}
