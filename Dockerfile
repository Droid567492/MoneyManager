FROM node:24-bookworm-slim

LABEL org.opencontainers.image.title="MoneyManager" \
      org.opencontainers.image.description="Self-hosted multi-currency personal finance PWA with receipt OCR and scheduled backups" \
      org.opencontainers.image.source="https://github.com/Droid567492/MoneyManager" \
      org.opencontainers.image.licenses="MIT"

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl openssh-client smbclient ca-certificates tzdata \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_PATH=/app/data/moneymanager.db \
    RECEIPTS_DIR=/app/data/receipts

COPY package.json ./
COPY src/ ./src/
COPY public/ ./public/

RUN mkdir -p /app/data/receipts /app/data/backups \
  && chown -R node:node /app

USER node

VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/auth/status').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
