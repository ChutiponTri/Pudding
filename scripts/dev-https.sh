#!/usr/bin/env bash
# Local dev with the PRODUCTION Clerk instance (the pk_live_ keys in .env).
#
# Clerk's production Frontend API (clerk.www.pudding-p.com) only answers pages served from
# https://<pudding-p.com or a subdomain> on the default port: localhost, http, or any
# ":3000" is refused with "origin_invalid", so sign-in never loads. This serves the dev
# server as https://dev.pudding-p.com (pointed at this machine), which Clerk accepts:
# same users, same sessions and teacher ids as production.
#
# One-time setup (needs sudo, printed below when missing):
#   - /etc/hosts:  127.0.0.1 dev.pudding-p.com
#   - let node listen on 443 without root (net.ipv4.ip_unprivileged_port_start=443)
# Certificates are made here on first run (accept the browser warning, or trust .certs/ca.pem).
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${DEV_HOST:-dev.pudding-p.com}"
CERT_DIR=".certs"
CA="$CERT_DIR/ca.pem"
KEY="$CERT_DIR/$HOST-key.pem"
CERT="$CERT_DIR/$HOST.pem"

missing=0
if ! grep -qE "^[^#]*[[:space:]]$HOST([[:space:]]|$)" /etc/hosts; then
  echo "✗ $HOST does not point to this machine. Run once:"
  echo "    echo '127.0.0.1 $HOST' | sudo tee -a /etc/hosts"
  missing=1
fi
if [ "$(cat /proc/sys/net/ipv4/ip_unprivileged_port_start 2>/dev/null || echo 1024)" -gt 443 ]; then
  echo "✗ Port 443 needs root. Run once (and keep it after reboots):"
  echo "    echo 'net.ipv4.ip_unprivileged_port_start=443' | sudo tee /etc/sysctl.d/99-pudding-dev.conf && sudo sysctl --system"
  missing=1
fi
[ "$missing" = 0 ] || exit 1

if [ ! -f "$CA" ] || [ ! -f "$KEY" ] || [ ! -f "$CERT" ]; then
  # A small local CA signs the site certificate: Node refuses a certificate that signs
  # itself, and the dev server calls itself over HTTPS (so it also covers localhost).
  mkdir -p "$CERT_DIR"
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout "$CERT_DIR/ca-key.pem" -out "$CA" \
    -subj "/CN=Pudding local dev CA" -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1
  openssl req -newkey rsa:2048 -nodes -keyout "$KEY" -out "$CERT_DIR/$HOST.csr" -subj "/CN=$HOST" >/dev/null 2>&1
  printf 'subjectAltName=DNS:%s,DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$HOST" > "$CERT_DIR/ext.cnf"
  openssl x509 -req -in "$CERT_DIR/$HOST.csr" -CA "$CA" -CAkey "$CERT_DIR/ca-key.pem" -CAcreateserial \
    -days 825 -extfile "$CERT_DIR/ext.cnf" -out "$CERT" >/dev/null 2>&1
  echo "Made certificates in $CERT_DIR/. To skip the browser warning, import $CERT_DIR/ca.pem as a trusted"
  echo "authority (Chrome: Settings › Privacy and security › Security › Manage certificates › Authorities)."
fi

echo "→ Open https://$HOST"
# Node (the dev server calling itself) trusts the local CA too.
export NODE_EXTRA_CA_CERTS="$PWD/$CA"
exec npx next dev -H "$HOST" -p 443 --experimental-https --experimental-https-key "$KEY" --experimental-https-cert "$CERT" "$@"
