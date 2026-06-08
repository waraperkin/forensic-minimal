'use strict';

const express = require('express');
const { requireAuth } = require('./auth-routes');

function createOverviewRouter({ os, getServicesCheck, CFG }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/health', async (req, res) => {
    try {
      const services = await getServicesCheck();
      const up = services.filter((s) => s.status === 'up').length;
      const down = services.length - up;
      let cluster = 'unknown';
      try {
        const h = await os.cluster.health();
        cluster = h.body.status || 'unknown';
      } catch (_) { /* ignore */ }
      res.json({
        cluster,
        services,
        summary: { up, down, total: services.length },
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/ingest', async (req, res) => {
    try {
      const r = await os.search({
        index: 'forensic-uploads*',
        body: {
          size: 0,
          aggs: {
            by_portal: { terms: { field: 'portal', size: 5 } },
            by_day: { date_histogram: { field: '@timestamp', calendar_interval: 'day' } },
            total: { value_count: { field: 'upload_id' } },
          },
        },
      });
      const ag = r.body.aggregations || {};
      res.json({
        total: ag.total?.value || 0,
        byPortal: (ag.by_portal?.buckets || []).map((b) => ({ portal: b.key, count: b.doc_count })),
        byDay: (ag.by_day?.buckets || []).map((b) => ({ day: b.key_as_string, count: b.doc_count })),
      });
    } catch (e) {
      res.json({ total: 0, byPortal: [], byDay: [], error: e.message });
    }
  });

  router.get('/ti', async (req, res) => {
    try {
      const [ti, opencti, misp] = await Promise.all([
        os.count({ index: 'forensic-ti-*' }),
        os.count({ index: 'forensic-ti-opencti-*' }),
        os.count({ index: 'forensic-ti-misp-*' }),
      ]);
      res.json({
        iocTotal: ti.body.count || 0,
        opencti: opencti.body.count || 0,
        misp: misp.body.count || 0,
        connectorsNote: 'Voir OpenCTI / MISP pour connecteurs actifs',
      });
    } catch (e) {
      res.json({ iocTotal: 0, opencti: 0, misp: 0, error: e.message });
    }
  });

  router.get('/siem', async (req, res) => {
    try {
      const indices = [
        'forensic-linux-*',
        'forensic-windows-*',
        'forensic-web-*',
        'fp-platform-logs*',
      ];
      const counts = await Promise.all(
        indices.map(async (idx) => {
          try {
            const c = await os.count({ index: idx });
            return { index: idx, count: c.body.count || 0 };
          } catch {
            return { index: idx, count: 0 };
          }
        }),
      );
      const events = counts.reduce((s, x) => s + x.count, 0);
      res.json({ events, indices: counts });
    } catch (e) {
      res.json({ events: 0, indices: [], error: e.message });
    }
  });

  router.get('/vigil/e2e', async (req, res) => {
    try {
      const axios = require('axios');
      const vigilUrl = (process.env.VIGIL_CONNECTOR_URL || 'http://forensic-vigil-connector:8083').replace(/\/$/, '');
      const r = await axios.get(`${vigilUrl}/e2e/incident`, { timeout: 10000, validateStatus: () => true });
      res.status(r.status).json(r.data);
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  router.get('/vigil', async (req, res) => {
    try {
      const vigilUrl = (process.env.VIGIL_CONNECTOR_URL || 'http://forensic-vigil-connector:8083').replace(/\/$/, '');
      const axios = require('axios');
      const [health, alerts, ioc, assets] = await Promise.all([
        axios.get(`${vigilUrl}/health`, { timeout: 8000, validateStatus: () => true }).catch(() => ({ data: {} })),
        axios.get(`${vigilUrl}/alerts`, { timeout: 12000, validateStatus: () => true }).catch(() => ({ data: { count: 0 } })),
        axios.get(`${vigilUrl}/ioc`, { timeout: 12000, validateStatus: () => true }).catch(() => ({ data: { count: 0 } })),
        axios.get(`${vigilUrl}/assets`, { timeout: 12000, validateStatus: () => true }).catch(() => ({ data: { count: 0 } })),
      ]);
      res.json({
        status: health.data?.status || 'unknown',
        mode: health.data?.vigil?.mode || 'demo',
        alerts: alerts.data?.count ?? (alerts.data?.items || []).length,
        ioc: ioc.data?.count ?? (ioc.data?.items || []).length,
        assets: assets.data?.count ?? (assets.data?.items || []).length,
        latency_ms: health.data?.latency_ms,
        opensearch: health.data?.opensearch?.status,
      });
    } catch (e) {
      res.json({ status: 'down', alerts: 0, ioc: 0, assets: 0, error: e.message });
    }
  });

  router.get('/summary', async (req, res) => {
    try {
      const health = await getServicesCheck();
      const up = health.filter((s) => s.status === 'up').length;
      let cluster = 'unknown';
      try {
        const h = await os.cluster.health();
        cluster = h.body.status || 'unknown';
      } catch (_) { /* ignore */ }
      let incidents = 0;
      try {
        const inc = await os.count({ index: 'forensic-portal-incidents' });
        incidents = inc.body.count || 0;
      } catch (_) { /* ignore */ }
      res.json({
        cluster,
        servicesUp: up,
        servicesTotal: health.length,
        incidents,
        itPortalUrl: CFG.itUrl,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/ioc-list', async (req, res) => {
    try {
      const r = await os.search({
        index: 'forensic-ti-*,forensic-ti-opencti-*,forensic-ti-misp-*',
        body: { size: 50, sort: [{ '@timestamp': 'desc' }], query: { match_all: {} } },
      });
      const items = (r.body.hits?.hits || []).map((h) => {
        const s = h._source || {};
        return {
          id: h._id,
          timestamp: s['@timestamp'],
          source: h._index.includes('misp') ? 'MISP' : h._index.includes('opencti') ? 'OpenCTI' : 'TI',
          value: s.value || s.indicator?.value || s.name || '—',
          type: s.type || s.indicator?.type || 'unknown',
        };
      });
      res.json({ items });
    } catch (e) {
      res.json({ items: [], error: e.message });
    }
  });

  return router;
}

module.exports = { createOverviewRouter };
