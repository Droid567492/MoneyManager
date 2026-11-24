# MoneyManager PWA

Self-hosted personal finance Progressive Web App built with zero external runtime dependencies (Node.js v24 built-in `node:sqlite`, `node:crypto`, `node:zlib`, `node:http`).

## Features
- **Universal & Multi-Currency**: Manage custom bank accounts, pockets (`HUF`, `EUR`, `USD`, `GBP`), categories (Incoming, Outgoing, Transfers), and saved recipients/origins with smart fuzzy pairing.
- **Deterministic Running Balances**: Every transaction stores before/after balances for both the pocket and parent bank account. Backdated edits and deletions automatically recalculate subsequent balances.
- **Interactive Analytics & Ledger Sync**: Configurable KPI cards and SVG charts can mirror your exact checked rows or active ledger filters (`Synced with Ledger`), or toggle back to full-period totals at any time.
- **Fast Transaction Entry**: Flip Origin and Destination sides with one click, duplicate existing transactions in one tap, or hide historical entries from live balances via the `is_historical` flag.
- **Receipt Vision Scanner**: Scan receipts or banking screenshots via Google Gemini API (with image zoom/pan/rotate viewer, skip-scan attach, itemization, store address capture, and merge/expand note options).
- **Bank Notification Auto-Logger**: Receive mobile banking notifications over an authenticated webhook (MacroDroid / Tasker / iOS Shortcuts) with filtering against 2FA codes, price alerts, and security notices, plus native PWA Web Push notifications.
- **Lossless Native Backup & Scheduled Sync**: Export your complete state (`GET /api/export/json` or gzip `.json.gz`) including accounts, pockets, categories, counterparties, settings, layout, transactions, and embedded receipt images, or configure the built-in scheduler for automatic local and remote backups (FTP, FTPS, SFTP, SMB) with independent count/size/age retention policies.
- **Security Hardening**: `scrypt` password hashing, expiring `HttpOnly` session cookies with configurable inactivity auto-logout, HSTS, strict CSP, and multi-layer rate limiting.

---

## Quick Start with Docker (Pre-Built Multi-Arch Release)

No cloning or local building is required. Pre-built images (`linux/amd64` and `linux/arm64` for x86_64 servers and Raspberry Pi) are published on GitHub Container Registry:

`ghcr.io/droid567492/moneymanager:latest`

### 1. Create a `compose.yaml` (works with Docker Compose, Arcane, Portainer, or Dockge)

```yaml
services:
  moneymanager:
    image: ghcr.io/droid567492/moneymanager:latest
    container_name: moneymanager
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - TZ=UTC # Optional: e.g. Europe/Budapest or America/New_York
      - PORT=3000
      - HOST=0.0.0.0
      - DB_PATH=/app/data/moneymanager.db
      - RECEIPTS_DIR=/app/data/receipts
      - TRUST_PROXY=false # Set to "true" behind HTTPS reverse proxy
      - GEMINI_API_KEY= # Optional: or configure inside Settings UI
      - GEMINI_MODEL=gemini-4-hydrogen
    volumes:
      - ./data:/app/data
```

### 2. Start MoneyManager
```bash
docker compose up -d
```

Open `http://localhost:3000` (or your HTTPS reverse proxy URL) and create your login account on first launch. All data (`moneymanager.db`, `receipts/`, and `backups/`) persists inside `./data/`.

> Pin a specific release tag (for example `ghcr.io/droid567492/moneymanager:v1.0.0`) instead of `:latest` if you prefer explicit version bumps.

---

## Updating a Packaged Docker Release

Production containers never need a local dev checkout to update:

```bash
docker compose pull
docker compose up -d
```

Or click **Pull & Redeploy** / **Update** inside **Arcane** (or Portainer / Watchtower).

---

## Running from Source (Development or Bare-Metal)

### Prerequisites
- Node.js **v24.0.0 or newer** (required for built-in `node:sqlite`)

### Local Development & Testing
Keeping a separate source checkout lets you test freely on a dev port and database without touching your production Docker container:

```bash
git clone https://github.com/Droid567492/MoneyManager.git
cd MoneyManager
cp .env.example .env
# Optional: set PORT=3005 in .env so dev runs alongside a production container on 3000
npm test
npm start
```

### Installer & Updater Scripts (Git Checkout)
```bash
# Start Docker using the published GHCR release image:
./scripts/install.sh --docker

# Or build locally from source instead:
./scripts/install.sh --build

# Or install natively with systemd:
./scripts/install.sh --systemd

# Update from release (or pass --build to rebuild from local source):
./scripts/update.sh
```

---

## Release & CI Workflow (Maintainers)
- **CI (`.github/workflows/ci.yml`)**: Every push or PR to `main` runs syntax checks and `npm test` without touching or publishing production images.
- **Release (`.github/workflows/release.yml`)**: Creating a GitHub Release or pushing a `v*.*.*` tag runs the full test suite and builds/pushes multi-arch (`linux/amd64`, `linux/arm64`) images to `ghcr.io/droid567492/moneymanager`.

---

## Migrating Data Between Machines (Lossless Import / Export)

MoneyManager includes a self-contained lossless backup format (`.json` / `.json.gz`) that bundles:
- Bank accounts & pockets (including initial balances, anchors, currencies, colors, archived flags)
- Categories & saved recipients/origins (`counterparties`)
- All transactions (historical/live, items JSON, store addresses, notes, flags, recorded checkpoints)
- Attached receipt images (base64-embedded so images move with your ledger)
- UI settings (palette, layout, currency rates, base currency, timeout, preferred model)

> API keys, login passwords, sessions, and push subscriptions are excluded from exports for security.

### Steps to Migrate
1. **Old instance**: Open **⚙️ Settings -> App Settings -> Security & Backup -> Export JSON Backup**. Save the `.json` file.
2. **New instance**: Deploy MoneyManager, create your login account on first visit, then open **⚙️ Settings -> App Settings -> Security & Backup -> 📥 Import Sheet / Data**.
3. Select your `.json` backup file, choose **Full Restore** (replaces starter bank/data with your exact backup) or **Merge**, and click **Restore Backup**.

### Built-In Scheduled Backups (Local & Remote)

Open **⚙️ Settings -> 💾 Scheduled Backups** to enable automatic daily, weekly, or hourly backups with optional gzip compression (`.json.gz`) and receipt embedding:
- **Local Backups**: Saved to `./data/backups` (or a custom directory) with independent limits for max count, max total size (MB), and max age (days).
- **Remote Backups (`FTP`, `FTPS`, `SFTP`, `SMB`)**: Encrypted credentials stored locally (`aes-256-gcm`), supporting password or SSH private key auth for SFTP, explicit/implicit TLS for FTPS, and SMB/CIFS shares (requires `smbclient`, included in Docker and installable on Debian/Raspberry Pi OS via `sudo apt install smbclient`), with independent remote retention limits separate from local retention.

---

## Companion Services & Setup Notes

1. **HTTPS Reverse Proxy (Recommended / Required for PWA Push & Mobile Camera)**
   - Modern browsers require HTTPS for service workers, Web Push alerts, and camera receipt capture on non-localhost hosts.
   - Put Caddy, Nginx, Apache (see `deploy/apache-moneymanager.conf`), or Cloudflare Tunnel in front of port `3000`, and keep `TRUST_PROXY=true` in `.env` / compose environment so HSTS and rate-limiting client IPs work accurately.
   - For DuckDNS + Let's Encrypt DNS-01 certificates, see the template scripts in `deploy/duckdns-auth.sh` and `deploy/duckdns-cleanup.sh`.
2. **Google Gemini API Key (Optional, for Receipt & Screenshot OCR)**
   - Create an API key in Google AI Studio and save it in **Settings -> App Settings -> Gemini Receipt Vision API** (or `GEMINI_API_KEY` in environment).
3. **Android / iOS Notification Forwarder (Optional, for Auto-Logging)**
   - Install MacroDroid, Tasker, or an equivalent forwarder on your phone and copy the tokenized webhook URL and JSON body from **Settings -> App Settings -> Bank App Notification Auto-Logger**.
