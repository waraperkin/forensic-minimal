#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f "$ROOT/scripts/lib/host-ip.sh" ]; then
  # shellcheck source=/dev/null
  . "$ROOT/scripts/lib/host-ip.sh"
  fp_load_env_public_host 2>/dev/null || true
fi

IDENTITY="${1:-}"
if [ -z "$IDENTITY" ]; then
  IDENTITY=$(fp_cert_identity 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
fi
if [ -z "$IDENTITY" ]; then
  echo "Erreur: identité TLS requise (argument, PUBLIC_HOSTNAME ou fp_cert_identity)" >&2
  exit 1
fi

EXTRA_IP=""
if _fp_is_hostname "$IDENTITY" 2>/dev/null; then
  EXTRA_IP=$(fp_detect_public_host 2>/dev/null || true)
  _fp_is_ipv4 "$EXTRA_IP" || EXTRA_IP=""
fi

mkdir -p nginx/certs/server

openssl genrsa -out nginx/certs/server/server.key 4096

cat > nginx/certs/server/server.csr.cnf <<EOF
[req]
default_bits = 4096
prompt = no
default_md = sha256
distinguished_name = dn

[dn]
C=FR
ST=IDF
L=Paris
O=Forensic Platform SOC
OU=DFIR Lab
CN=${IDENTITY}
EOF

if _fp_is_hostname "$IDENTITY" 2>/dev/null; then
  cat > nginx/certs/server/server.ext <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${IDENTITY}
EOF
  if [ -n "$EXTRA_IP" ]; then
    echo "IP.1 = ${EXTRA_IP}" >> nginx/certs/server/server.ext
  fi
else
  cat > nginx/certs/server/server.ext <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
IP.1 = ${IDENTITY}
DNS.1 = localhost
EOF
fi

openssl req -new -key nginx/certs/server/server.key \
  -out nginx/certs/server/server.csr \
  -config nginx/certs/server/server.csr.cnf

openssl x509 -req \
  -in nginx/certs/server/server.csr \
  -CA nginx/certs/ca/ca.crt \
  -CAkey nginx/certs/ca/ca.key \
  -CAcreateserial \
  -out nginx/certs/server/server.crt \
  -days 825 \
  -sha256 \
  -extfile nginx/certs/server/server.ext

echo "Certificat serveur généré : nginx/certs/server/server.crt (CN/SAN=${IDENTITY})"
