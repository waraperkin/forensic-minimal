'use strict';

/**
 * Proxy VigilSOC connector — /api/vigil/* → vigil-connector:8083
 * Ajout non-breaking : aucune route existante modifiée.
 */
function createVigilRoutes({ axios, logger, recordEvent }) {
  const express = require('express');
  const router = express.Router();

  const VIGIL_URL = (process.env.VIGIL_CONNECTOR_URL
    || 'http://forensic-vigil-connector:8083').replace(/\/$/, '');

  const graceful = (res, path) => res.status(200).json({
    configured: false,
    items: [],
    count: 0,
    error: `Vigil connector unavailable (${path})`,
    service: 'vigil-connector',
  });

  router.all('/*', async (req, res) => {
    const sub = req.path === '/' ? '' : req.path;
    const url = `${VIGIL_URL}${sub}`;
    const t0 = Date.now();
    try {
      const r = await axios.request({
        method: req.method,
        url,
        params: req.query,
        data: req.body,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        timeout: parseInt(process.env.VIGIL_PROXY_TIMEOUT || '30000', 10),
        validateStatus: () => true,
      });
      const latency_ms = Date.now() - t0;
      if (recordEvent && r.status < 400 && ['GET', 'POST'].includes(req.method)) {
        recordEvent({
          type: 'system',
          action: req.method === 'POST' ? 'vigil_export' : 'vigil_api',
          service: 'vigil-connector',
          message: `VigilSOC ${req.method} ${sub || '/'} — ${r.status}`,
          context: { source: 'vigil', path: sub, latency_ms, status: r.status, method: req.method },
        }, req).catch(() => {});
      }
      if (typeof r.data === 'object' && sub === '/health') {
        r.data.latency_ms = latency_ms;
      }
      res.status(r.status);
      if (typeof r.data === 'object') return res.json(r.data);
      return res.send(r.data);
    } catch (e) {
      logger.warn(`Vigil proxy ${req.method} ${sub}: ${e.message}`);
      if (recordEvent) {
        recordEvent({
          type: 'system',
          action: 'vigil_error',
          service: 'vigil-connector',
          message: `VigilSOC erreur ${sub}: ${e.message}`,
          context: { source: 'vigil', path: sub, error: e.message },
        }, req).catch(() => {});
      }
      return graceful(res, sub || '/');
    }
  });

  return router;
}

module.exports = { createVigilRoutes };
