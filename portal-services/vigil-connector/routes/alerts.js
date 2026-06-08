'use strict';

const express = require('express');
const cache = require('../utils/cache');
const { fetchAlerts, fetchAlertById } = require('../utils/fetch');
const { publicStatus } = require('../utils/auth');
const osUtil = require('../utils/opensearch');
const tsUtil = require('../utils/timesketch');

const router = express.Router();

async function loadAlerts(req) {
  const force = req.query.refresh === '1' || req.query.nocache === '1';
  if (!force) {
    const cached = cache.get('alerts');
    if (cached) return { ...cached, cached: true };
  }
  const limit = parseInt(req.query.limit || '500', 10);
  const payload = await fetchAlerts({ limit, status: req.query.status });
  const osResult = await osUtil.indexAlerts(payload.items);
  const result = {
    configured: payload.configured,
    source: payload.source,
    count: payload.items.length,
    items: payload.items,
    opensearch: osResult,
    vigil: publicStatus(),
    error: payload.error || null,
    cached: false,
  };
  cache.set('alerts', result);
  return result;
}

router.get('/', async (req, res) => {
  try {
    const data = await loadAlerts(req);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message, items: [], count: 0 });
  }
});

router.post('/:id/timesketch', async (req, res) => {
  try {
    const found = await fetchAlertById(req.params.id);
    const alert = found.item || (await loadAlerts(req)).items.find((a) => String(a.id) === String(req.params.id));
    if (!alert) return res.status(404).json({ error: 'Alert not found', id: req.params.id });
    const ts = await tsUtil.exportAlertToTimesketch(alert);
    res.json({ ok: !!ts.ok, timesketch: ts, alert_id: alert.id, sketch_url: ts.sketch_url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
