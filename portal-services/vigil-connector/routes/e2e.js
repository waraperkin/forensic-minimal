'use strict';

const express = require('express');
const { runE2eIncident, getE2eStatus } = require('../utils/e2e-incident');

const router = express.Router();

router.get('/incident', async (_req, res) => {
  try {
    const status = await getE2eStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/incident', async (req, res) => {
  try {
    const result = await runE2eIncident(req.body || {});
    const status = result.ok || result.skipped ? 200 : 422;
    res.status(status).json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
