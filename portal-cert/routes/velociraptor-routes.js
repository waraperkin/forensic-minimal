'use strict';

const axios = require('axios');
const { velociraptorHealth } = require('../lib/velociraptor-connector');

const BRIDGE_URL = (process.env.VR_BRIDGE_URL || 'http://velociraptor-bridge:8097').replace(/\/$/, '');

function createVelociraptorRoutes({ logger, os } = {}) {
  const router = require('express').Router();

  router.get('/velociraptor/status', async (_req, res) => {
    const health = await velociraptorHealth();
    res.json({
      velociraptor: health,
      ui_url: '/velociraptor/',
      opensearch_indices: ['velociraptor-windows-*', 'velociraptor-linux-*', 'velociraptor-network-*', 'velociraptor-endpoint-*'],
      grafana_dashboards: [
        '/grafana/d/vraptor-windows/velociraptor-windows',
        '/grafana/d/vraptor-linux/velociraptor-linux',
        '/grafana/d/vraptor-endpoint/velociraptor-endpoint',
        '/grafana/d/vraptor-windows-full/velociraptor-windows-full',
        '/grafana/d/vraptor-linux-full/velociraptor-linux-full',
        '/grafana/d/vraptor-network-full/velociraptor-network-full',
        '/grafana/d/vraptor-endpoint-full/velociraptor-endpoint-full',
      ],
      lab_mode: 'offline',
      playbooks: [
        'windows-triage-full',
        'linux-triage-full',
        'memory-forensics',
        'ioc-sweeping',
        'network-forensics',
        'persistence-hunting',
      ],
    });
  });

  router.post('/velociraptor/export/full', async (req, res) => {
    try {
      const r = await axios.post(`${BRIDGE_URL}/export/full`, req.body || {}, { timeout: 300000 });
      res.json(r.data);
    } catch (e) {
      logger?.warn?.('velociraptor/export/full:', e.message);
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  router.post('/velociraptor/export/timesketch', async (req, res) => {
    try {
      const r = await axios.post(`${BRIDGE_URL}/export/timesketch`, req.body || {}, { timeout: 300000 });
      res.json(r.data);
    } catch (e) {
      logger?.warn?.('velociraptor/export/timesketch:', e.message);
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  router.get('/velociraptor/clients', async (_req, res) => {
    try {
      const r = await axios.get(`${BRIDGE_URL}/clients`, { timeout: 30000 });
      res.json(r.data);
    } catch (e) {
      logger?.warn?.('velociraptor/clients:', e.message);
      res.status(502).json({ ok: false, clients: [], error: e.message });
    }
  });

  router.post('/velociraptor/collect', async (req, res) => {
    try {
      const r = await axios.post(`${BRIDGE_URL}/collect`, req.body || {}, { timeout: 300000 });
      res.json(r.data);
    } catch (e) {
      logger?.warn?.('velociraptor/collect:', e.message);
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  router.get('/velociraptor/lab/artifacts', async (_req, res) => {
    try {
      const r = await axios.get(`${BRIDGE_URL}/lab/artifacts`, { timeout: 30000 });
      res.json(r.data);
    } catch (e) {
      logger?.warn?.('velociraptor/lab/artifacts:', e.message);
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  router.post('/velociraptor/lab/collect-full', async (req, res) => {
    try {
      const r = await axios.post(`${BRIDGE_URL}/lab/collect-full`, req.body || {}, { timeout: 300000 });
      res.json(r.data);
    } catch (e) {
      logger?.warn?.('velociraptor/lab/collect-full:', e.message);
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  router.post('/velociraptor/lab/collect', async (req, res) => {
    try {
      const r = await axios.post(`${BRIDGE_URL}/lab/collect`, req.body || {}, { timeout: 300000 });
      res.json(r.data);
    } catch (e) {
      logger?.warn?.('velociraptor/lab/collect:', e.message);
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  router.get('/velociraptor/uploads', async (_req, res) => {
    if (!os) return res.json([]);
    try {
      const r = await os.search({
        index: 'forensic-uploads*',
        body: {
          size: 100,
          sort: [{ '@timestamp': { order: 'desc' } }],
          query: { term: { 'tags.keyword': 'velociraptor' } },
        },
      });
      res.json(r.body.hits.hits.map((h) => ({ id: h._id, ...h._source })));
    } catch (e) {
      logger?.warn?.('velociraptor/uploads:', e.message);
      res.json([]);
    }
  });

  return router;
}

module.exports = { createVelociraptorRoutes };
