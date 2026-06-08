#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IP="${1:-}"
if [ -z "$IP" ]; then
  IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
fi
if [ -z "$IP" ]; then
  echo "Erreur: IP requise (argument ou hostname -I)" >&2
  exit 1
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
O=CyberCorp
OU=SOC
CN=$IP
EOF

cat > nginx/certs/server/server.ext <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
IP.1 = $IP
EOF

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

echo "Certificat serveur généré : nginx/certs/server/server.crt (SAN IP=$IP)"
