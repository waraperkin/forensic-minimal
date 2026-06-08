FROM node:20-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js ./
COPY routes ./routes
COPY utils ./utils

ENV NODE_ENV=production \
    VIGIL_CONNECTOR_PORT=8083

EXPOSE 8083
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8083/health || exit 1

CMD ["node", "server.js"]
