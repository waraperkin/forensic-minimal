'use strict';

const express = require('express');
const cache = require('../utils/cache');
const { fetchIoc, fetchIocById } = require('../utils/fetch');
const { publicStatus } = require('../utils/auth');
const osUtil = require('../utils/opensearch');
const tsUtil = require('../utils/timesketch');

const router = express.Router();

async function loadIoc(req) {
  const force = req.query.refresh === '1' || req.query.nocache === '1';
  if (!force) {
    const cached = cache.get('ioc');
    if (cached) return { ...cached, cached: true };
  }
  const limit = parseInt(req.query.limit || '500', 10);
  const payload = await fetchIoc({ limit });
  const osResult = await osUtil.indexIoc(payload.items);
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
  cache.set('ioc', result);
  return result;
}

router.get('/', async (req, res) => {
  try {
    const data = await loadIoc(req);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message, items: [], count: 0 });
  }
});

router.post('/:id/timesketch', async (req, res) => {
  try {
    const found = await fetchIocById(req.params.id);
    const ioc = found.item || (await loadIoc(req)).items.find((x) => String(x.id) === String(req.params.id));
    if (!ioc) return res.status(404).json({ error: 'IOC not found', id: req.params.id });
    const ts = await tsUtil.exportIOCToTimesketch(ioc);
    res.json({ ok: !!ts.ok, timesketch: ts, ioc_id: ioc.id, sketch_url: ts.sketch_url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
