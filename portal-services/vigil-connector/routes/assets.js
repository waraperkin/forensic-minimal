'use strict';

const express = require('express');
const cache = require('../utils/cache');
const { fetchAssets, fetchAssetById } = require('../utils/fetch');
const { publicStatus } = require('../utils/auth');
const osUtil = require('../utils/opensearch');
const tsUtil = require('../utils/timesketch');

const router = express.Router();

async function loadAssets(req) {
  const force = req.query.refresh === '1' || req.query.nocache === '1';
  if (!force) {
    const cached = cache.get('assets');
    if (cached) return { ...cached, cached: true };
  }
  const limit = parseInt(req.query.limit || '500', 10);
  const payload = await fetchAssets({ limit });
  const osResult = await osUtil.indexAssets(payload.items);
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
  cache.set('assets', result);
  return result;
}

router.get('/', async (req, res) => {
  try {
    const data = await loadAssets(req);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message, items: [], count: 0 });
  }
});

router.post('/:id/timesketch', async (req, res) => {
  try {
    const found = await fetchAssetById(req.params.id);
    const asset = found.item || (await loadAssets(req)).items.find((x) => String(x.id) === String(req.params.id));
    if (!asset) return res.status(404).json({ error: 'Asset not found', id: req.params.id });
    const ts = await tsUtil.exportAssetToTimesketch(asset);
    res.json({ ok: !!ts.ok, timesketch: ts, asset_id: asset.id, sketch_url: ts.sketch_url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
