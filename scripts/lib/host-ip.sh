#!/bin/bash
# Détection de l'hôte public pour TLS, .env et portails.
# Priorité : PUBLIC_HOST explicite → AWS IMDS public-ipv4 → IP routable locale → AWS local-ipv4 → hostname -I

_fp_is_ipv4() {
  [[ "${1:-}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]
}

_fp_is_placeholder_host() {
  case "${1:-}" in
    ""|10.78.0.9|127.0.0.1|localhost) return 0 ;;
    *) return 1 ;;
  esac
}

_fp_aws_imds_token() {
  curl -sf --max-time 2 -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || true
}

_fp_aws_metadata() {
  local path="$1" token="${2:-}"
  if [ -n "$token" ]; then
    curl -sf --max-time 2 -H "X-aws-ec2-metadata-token: $token" \
      "http://169.254.169.254/latest/meta-data/${path}" 2>/dev/null || true
  else
    curl -sf --max-time 2 "http://169.254.169.254/latest/meta-data/${path}" 2>/dev/null || true
  fi
}

_fp_aws_public_ipv4() {
  local token
  token=$(_fp_aws_imds_token)
  _fp_aws_metadata "public-ipv4" "$token"
}

_fp_aws_public_hostname() {
  local token
  token=$(_fp_aws_imds_token)
  _fp_aws_metadata "public-hostname" "$token"
}

_fp_aws_local_ipv4() {
  local token
  token=$(_fp_aws_imds_token)
  _fp_aws_metadata "local-ipv4" "$token"
}

_fp_is_docker_or_link_local() {
  case "${1:-}" in
    127.*|169.254.*|172.17.*|172.18.*|172.19.*|172.20.*|172.21.*|172.22.*|172.23.*|172.24.*|172.25.*|172.26.*|172.27.*|172.28.*|172.29.*|172.30.*|172.31.*)
      return 0
      ;;
  esac
  return 1
}

_fp_pick_routable_ipv4_from_hostname() {
  local ip
  for ip in $(hostname -I 2>/dev/null); do
    _fp_is_ipv4 "$ip" || continue
    _fp_is_docker_or_link_local "$ip" && continue
    echo "$ip"
    return 0
  done
  for ip in $(hostname -I 2>/dev/null); do
    _fp_is_ipv4 "$ip" || continue
    case "$ip" in 127.*) continue ;; esac
    echo "$ip"
    return 0
  done
  return 1
}

# Point d'entrée — imprime l'IP à utiliser pour HTTPS / soc_base_url / certs.
fp_detect_public_host() {
  local ip="" aws_pub="" aws_local="" routed="" first=""

  if [ -n "${PUBLIC_HOST:-}" ] && ! _fp_is_placeholder_host "$PUBLIC_HOST"; then
    echo "$PUBLIC_HOST"
    return 0
  fi
  if [ -n "${FP_PUBLIC_HOST:-}" ] && ! _fp_is_placeholder_host "$FP_PUBLIC_HOST"; then
    echo "$FP_PUBLIC_HOST"
    return 0
  fi

  aws_pub=$(_fp_aws_public_ipv4)
  if _fp_is_ipv4 "$aws_pub"; then
    echo "$aws_pub"
    return 0
  fi

  routed=$(_fp_pick_routable_ipv4_from_hostname || true)
  if _fp_is_ipv4 "$routed"; then
    echo "$routed"
    return 0
  fi

  aws_local=$(_fp_aws_local_ipv4)
  if _fp_is_ipv4 "$aws_local"; then
    echo "$aws_local"
    return 0
  fi

  first=$(hostname -I 2>/dev/null | awk '{print $1}')
  if _fp_is_ipv4 "$first"; then
    echo "$first"
    return 0
  fi

  echo "127.0.0.1"
  return 1
}

_fp_cert_san_contains_ip() {
  local cert="$1" want_ip="$2"
  [ -f "$cert" ] || return 1
  openssl x509 -in "$cert" -noout -text 2>/dev/null \
    | grep -E "IP Address:|DNS:" \
    | grep -Fq "$want_ip"
}

_fp_patch_nginx_grafana_maps() {
  local conf="$1" ip="$2"
  [ -f "$conf" ] || return 0
  # Rétrocompat : remplace les maps Grafana figées sur l'IP lab si encore présentes.
  sed -i \
    -e "s/default \"https:\/\/10\.78\.0\.9\";/default \"https:\/\/${ip}\";/g" \
    -e "s/\"~\\^https?://(10\\.78\\.0\\.9|localhost|127\\.0\\.0\\.1)/\"~^https?:\\/\\/(10\\.78\\.0\\.9|${ip}|localhost|127\\.0\\.0\\.1)/g" \
    "$conf" 2>/dev/null || true
}

_fp_patch_nginx_server_name() {
  local conf="$1" ip="$2"
  [ -f "$conf" ] || return 0
  if grep -q 'server_name _;' "$conf" 2>/dev/null; then
    return 0
  fi
  sed -i "s/server_name .*/server_name _;/" "$conf" 2>/dev/null || true
  sed -i "s/^[[:space:]]*# server_name .*/# server_name ${ip};/" "$conf" 2>/dev/null || true
}

# Charge PUBLIC_HOST depuis .env si présent (sans écraser l'environnement courant).
fp_load_env_public_host() {
  local root="${DIR:-.}" line key val
  [ -f "$root/.env" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in "#"*|"") continue ;; esac
    if [[ "$line" =~ ^PUBLIC_HOST=(.*)$ ]]; then
      val="${BASH_REMATCH[1]}"
      val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
      if [ -n "$val" ] && ! _fp_is_placeholder_host "$val"; then
        export PUBLIC_HOST="$val"
        return 0
      fi
    fi
  done < "$root/.env"
  return 1
}

# IP effective pour toute la plateforme (env explicite > détection > fallback).
fp_resolve_public_host() {
  fp_load_env_public_host 2>/dev/null || true
  fp_detect_public_host 2>/dev/null || echo "127.0.0.1"
}

_fp_is_hostname() {
  _fp_is_ipv4 "${1:-}" && return 1
  [[ "${1:-}" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]]
}

# Retire schéma / slash parasite (évite https://https://… dans MISP / VR).
fp_normalize_host() {
  local h="${1:-}"
  h="${h#https://}"
  h="${h#http://}"
  h="${h%%/*}"
  h="${h%/}"
  echo "$h"
}

# URL publique MISP sans slash final (convention CakePHP MISP.baseurl).
fp_misp_public_base_url() {
  local host
  host=$(fp_url_identity 2>/dev/null || echo "localhost")
  host=$(fp_normalize_host "$host")
  echo "https://${host}/misp"
}

# IP publique AWS (certificat SAN) — indépendant du hostname navigateur.
fp_detect_public_ip() {
  local aws_pub="" routed="" aws_local="" first=""
  aws_pub=$(_fp_aws_public_ipv4)
  if _fp_is_ipv4 "$aws_pub"; then
    echo "$aws_pub"
    return 0
  fi
  fp_load_env_public_host 2>/dev/null || true
  if [ -n "${PUBLIC_HOST:-}" ] && _fp_is_ipv4 "$PUBLIC_HOST"; then
    echo "$PUBLIC_HOST"
    return 0
  fi
  routed=$(_fp_pick_routable_ipv4_from_hostname || true)
  if _fp_is_ipv4 "$routed"; then
    echo "$routed"
    return 0
  fi
  aws_local=$(_fp_aws_local_ipv4)
  if _fp_is_ipv4 "$aws_local"; then
    echo "$aws_local"
    return 0
  fi
  first=$(hostname -I 2>/dev/null | awk '{print $1}')
  if _fp_is_ipv4 "$first"; then
    echo "$first"
    return 0
  fi
  echo "127.0.0.1"
  return 1
}

# Hôte utilisé dans les URLs navigateur (TLS, MISP, VR, Kibana).
# AWS : préfère le DNS public EC2 (ec2-…compute.amazonaws.com) à l'IP nue.
fp_url_identity() {
  local aws_host="" env_host=""
  if [ -n "${PUBLIC_HOSTNAME:-}" ] && ! _fp_is_placeholder_host "$PUBLIC_HOSTNAME"; then
    fp_normalize_host "$PUBLIC_HOSTNAME"
    return 0
  fi
  fp_load_env_public_host 2>/dev/null || true
  if [ -n "${PUBLIC_HOST:-}" ] && ! _fp_is_placeholder_host "$PUBLIC_HOST"; then
    env_host=$(fp_normalize_host "$PUBLIC_HOST")
    if _fp_is_hostname "$env_host"; then
      echo "$env_host"
      return 0
    fi
  fi
  aws_host=$(_fp_aws_public_hostname)
  aws_host=$(fp_normalize_host "$aws_host")
  if [ -n "$aws_host" ] && _fp_is_hostname "$aws_host"; then
    echo "$aws_host"
    return 0
  fi
  fp_detect_public_host 2>/dev/null || echo "127.0.0.1"
}

# Identité TLS/URL : alias de fp_url_identity.
fp_cert_identity() {
  fp_url_identity 2>/dev/null || echo "127.0.0.1"
}

_fp_cert_san_contains_identity() {
  local cert="$1" identity="$2"
  _fp_cert_san_contains_ip "$cert" "$identity"
}
