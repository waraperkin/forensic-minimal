#!/usr/bin/env bash
# Tests unitaires — détection IP publique (sans Docker).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
. "$ROOT/scripts/lib/host-ip.sh"

pass=0
fail=0

assert_eq() {
  local label="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    echo "PASS: $label"
    pass=$((pass + 1))
  else
    echo "FAIL: $label (got='$got' want='$want')" >&2
    fail=$((fail + 1))
  fi
}

assert_ipv4() {
  local label="$1" got="$2"
  if _fp_is_ipv4 "$got"; then
    echo "PASS: $label"
    pass=$((pass + 1))
  else
    echo "FAIL: $label (not ipv4: '$got')" >&2
    fail=$((fail + 1))
  fi
}

# Override explicite
PUBLIC_HOST=203.0.113.10 FP_PUBLIC_HOST= out="$(fp_detect_public_host)"
assert_eq "PUBLIC_HOST explicite" "$out" "203.0.113.10"

# Placeholder ignoré → FP_PUBLIC_HOST
PUBLIC_HOST=10.78.0.9 FP_PUBLIC_HOST=198.51.100.7 out="$(fp_detect_public_host)"
assert_eq "FP_PUBLIC_HOST quand placeholder" "$out" "198.51.100.7"

# Routable depuis hostname -I (mock via fonction interne)
out="$(_fp_pick_routable_ipv4_from_hostname || true)"
if [ -n "$out" ]; then
  assert_ipv4 "hostname -I routable" "$out"
else
  echo "SKIP: hostname -I routable (aucune IP non-docker)"
fi

# Détection finale retourne une IPv4
PUBLIC_HOST= FP_PUBLIC_HOST= out="$(fp_detect_public_host || true)"
assert_ipv4 "fp_detect_public_host" "$out"

echo ""
echo "Résultat: $pass pass, $fail fail"
[ "$fail" -eq 0 ]
