#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE="auto"
BUILD_LOCAL=0
for arg in "$@"; do
  case "$arg" in
    --docker) MODE="docker" ;;
    --build) MODE="docker"; BUILD_LOCAL=1 ;;
    --systemd) MODE="systemd" ;;
    --bare) MODE="bare" ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: $0 [--docker|--build|--systemd|--bare]" >&2
      exit 1
      ;;
  esac
done

echo "==> Installing MoneyManager in $ROOT_DIR"

if [ ! -f "$ROOT_DIR/.env" ]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  echo "Created .env from .env.example (edit .env if needed)."
fi

mkdir -p "$ROOT_DIR/data/receipts" "$ROOT_DIR/data/backups"

detect_compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return 0
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return 0
  fi
  return 1
}

if [ "$MODE" = "auto" ]; then
  if detect_compose >/dev/null 2>&1; then
    MODE="docker"
  elif command -v node >/dev/null 2>&1; then
    MODE="bare"
  else
    echo "Neither Docker Compose nor Node.js >=24 was found." >&2
    echo "Install Docker (recommended) or Node.js v24+, then re-run this script." >&2
    exit 1
  fi
fi

if [ "$MODE" = "docker" ]; then
  COMPOSE_CMD=$(detect_compose) || {
    echo "Docker Compose is required for --docker mode." >&2
    exit 1
  }
  if [ "$BUILD_LOCAL" -eq 1 ]; then
    echo "==> Building and starting MoneyManager locally via Docker Compose ($COMPOSE_CMD)..."
    $COMPOSE_CMD up -d --build
  else
    echo "==> Pulling release image and starting MoneyManager via Docker Compose ($COMPOSE_CMD)..."
    $COMPOSE_CMD pull
    $COMPOSE_CMD up -d
  fi
  echo "==> MoneyManager container is up. Check status with: $COMPOSE_CMD ps"
elif [ "$MODE" = "systemd" ]; then
  NODE_BIN="$(command -v node || true)"
  if [ -z "$NODE_BIN" ]; then
    echo "Node.js v24+ is required for --systemd mode." >&2
    exit 1
  fi
  SERVICE_PATH="/etc/systemd/system/moneymanager.service"
  APP_USER="$(id -un)"
  APP_GROUP="$(id -gn)"
  echo "==> Writing systemd service ($SERVICE_PATH) for user $APP_USER..."
  sudo tee "$SERVICE_PATH" >/dev/null <<EOF
[Unit]
Description=MoneyManager Self-Hosted Finance PWA
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${ROOT_DIR}
ExecStart=${NODE_BIN} ${ROOT_DIR}/src/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=0.0.0.0

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now moneymanager
  echo "==> Service status:"
  sudo systemctl is-active moneymanager
else
  NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
  if [ "$NODE_MAJOR" -lt 24 ]; then
    echo "Node.js v24 or newer is required (detected: $(node -v 2>/dev/null || echo none))." >&2
    exit 1
  fi
  echo "==> Environment ready. Start MoneyManager with: npm start"
fi

PORT_VAL=$(sed -n 's/^PORT=\(.*\)$/\1/p' "$ROOT_DIR/.env" | tail -n 1 | tr -d '\r')
PORT_VAL="${PORT_VAL:-3000}"
echo "==> Done! Open http://localhost:${PORT_VAL} in your browser (or your HTTPS reverse-proxy URL)."
