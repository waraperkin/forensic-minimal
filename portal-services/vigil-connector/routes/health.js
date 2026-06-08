'use strict';

const express = require('express');
const { publicStatus } = require('../utils/auth');
const { verifyLiveConnection } = require('../utils/fetch');
const osUtil = require('../utils/opensearch');
const tsUtil = require('../utils/timesketch');
const cache = require('../utils/cache');
const { getE2eStatus } = require('../utils/e2e-incident');

const router = express.Router();

router.get('/', async (_req, res) => {
  const [os, ts, live, e2e] = await Promise.all([
    osUtil.clusterHealth(),
    tsUtil.ping(),
    verifyLiveConnection(),
    getE2eStatus().catch(() => null),
  ]);
  res.json({
    service: 'vigil-connector',
    status: 'ok',
    version: '1.1.0',
    uptime_s: Math.floor(process.uptime()),
    vigil: publicStatus({ api_reachable: live.ok, api_check: live }),
    e2e_last: e2e?.ok ? { case_id: e2e.case_id, run_id: e2e.run_id, timestamp: e2e.timestamp } : null,
    opensearch: os,
    timesketch: ts,
    cache: cache.stats(),
    indices: {
      alerts: osUtil.ALERTS_INDEX,
      ioc: osUtil.IOC_INDEX,
      assets: osUtil.ASSETS_INDEX,
    },
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
