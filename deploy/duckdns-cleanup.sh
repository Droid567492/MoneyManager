#!/bin/bash
set -euo pipefail
SUBDOMAIN="${DUCKDNS_SUBDOMAIN:-your-domain}"
TOKEN="${DUCKDNS_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$HOME/duckdns/duck.sh" ]; then
  TOKEN=$(sed -n 's/.*token=\([^&"]*\).*/\1/p' "$HOME/duckdns/duck.sh" | head -n 1)
fi
if [ -z "$TOKEN" ]; then
  exit 0
fi
curl -fsS "https://www.duckdns.org/update?domains=${SUBDOMAIN}&token=${TOKEN}&txt=${CERTBOT_VALIDATION}&clear=true" >/dev/null || true
