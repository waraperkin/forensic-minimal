FROM node:20-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY portal-cert/package.json ./
RUN npm install --only=production --no-fund --no-audit
COPY portal-cert/server.js ./
COPY lib/ingest-queue.js ./lib/ingest-queue.js
COPY lib/helk-connector.js ./lib/helk-connector.js
COPY lib/velociraptor-connector.js ./lib/velociraptor-connector.js
COPY lib/global-health.js ./lib/global-health.js
COPY lib/ui-error-log.js ./lib/ui-error-log.js
COPY lib/upload-limits.js ./lib/upload-limits.js
COPY portal-cert/lib/master-routes.js ./lib/master-routes.js
COPY portal-cert/routes/master-intakes.js ./routes/master-intakes.js
COPY portal-cert/routes/master-ingest-errors.js ./routes/master-ingest-errors.js
COPY portal-cert/routes/master-ingest-meta.js ./routes/master-ingest-meta.js
COPY portal-cert/routes/helk-routes.js ./routes/helk-routes.js
COPY portal-cert/routes/velociraptor-routes.js ./routes/velociraptor-routes.js
COPY portal-cert/routes/global-health-routes.js ./routes/global-health-routes.js
COPY portal-cert/lib/auth-store.js ./lib/auth-store.js
COPY portal-cert/lib/auth-session.js ./lib/auth-session.js
COPY portal-cert/lib/auth-routes.js ./lib/auth-routes.js
COPY portal-cert/lib/auth-mount.js ./lib/auth-mount.js
COPY portal-cert/lib/platform-overview.js ./lib/platform-overview.js
COPY portal-cert/lib/audit-log.js ./lib/audit-log.js
COPY portal-cert/lib/threat-platforms-routes.js ./lib/threat-platforms-routes.js
COPY portal-cert/lib/threat-v2-proxy.js ./lib/threat-v2-proxy.js
COPY portal-shared/ ./public/shared/
COPY scripts/minify-portal-assets.sh /tmp/minify-portal-assets.sh
RUN sh /tmp/minify-portal-assets.sh 2>/dev/null || true
COPY portal-cert/public/ ./public/
RUN mkdir -p /tmp/uploads /shared-uploads /app/ssl
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -sf http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
