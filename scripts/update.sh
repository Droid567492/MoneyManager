#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SKIP_PULL=0
SKIP_TESTS=0
BUILD_LOCAL=0
for arg in "$@"; do
  case "$arg" in
    --no-pull) SKIP_PULL=1 ;;
    --no-test) SKIP_TESTS=1 ;;
    --build) BUILD_LOCAL=1 ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: $0 [--no-pull] [--no-test] [--build]" >&2
      exit 1
      ;;
  esac
done

mkdir -p "$ROOT_DIR/data/backups"
TS=$(date +"%Y%m%d-%H%M%S")

if [ -f "$ROOT_DIR/data/moneymanager.db" ]; then
  BACKUP_FILE="$ROOT_DIR/data/backups/moneymanager-preupdate-${TS}.db"
  cp "$ROOT_DIR/data/moneymanager.db" "$BACKUP_FILE"
  echo "==> Created pre-update SQLite backup: $BACKUP_FILE"
fi

if [ "$SKIP_PULL" -eq 0 ] && [ -d "$ROOT_DIR/.git" ]; then
  if git remote get-url origin >/dev/null 2>&1; then
    echo "==> Pulling latest changes from origin..."
    git pull --ff-only
  else
    echo "==> No git 'origin' remote configured yet; skipping git pull."
  fi
fi

if command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx 'moneymanager'; then
  COMPOSE_CMD="docker compose"
  if ! docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
  fi
  if [ "$BUILD_LOCAL" -eq 1 ]; then
    echo "==> Building and restarting Docker container from local source..."
    $COMPOSE_CMD up -d --build
  else
    echo "==> Pulling latest release image and updating Docker container..."
    $COMPOSE_CMD pull
    $COMPOSE_CMD up -d
  fi
  echo "==> Docker update complete."
elif command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^moneymanager\.service'; then
  if [ "$SKIP_TESTS" -eq 0 ] && command -v node >/dev/null 2>&1; then
    echo "==> Running verification tests..."
    npm test
  fi
  echo "==> Restarting systemd service..."
  sudo systemctl restart moneymanager
  echo "==> Service status: $(systemctl is-active moneymanager)"
else
  if [ "$SKIP_TESTS" -eq 0 ] && command -v node >/dev/null 2>&1; then
    echo "==> Running verification tests..."
    npm test
  fi
  echo "==> Code updated. Restart your Node process to apply changes."
fi
