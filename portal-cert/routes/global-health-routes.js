'use strict';

const { createGlobalHealthChecker } = require('../lib/global-health');

function createGlobalHealthRoutes({ CFG, logger } = {}) {
  const router = require('express').Router();
  const checker = createGlobalHealthChecker(CFG);

  router.get('/health/global', async (_req, res) => {
    try {
      res.json(await checker.getGlobalHealth());
    } catch (e) {
      logger?.error?.('health/global:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  const aliases = {
    opensearch: 'opensearch',
    helk: 'helk',
    velociraptor: 'velociraptor',
    timesketch: 'timesketch',
    grafana: 'grafana',
    cti: 'opencti',
    opencti: 'opencti',
    misp: 'misp',
    thehive: 'thehive',
    cortex: 'cortex',
    nginx: 'nginx',
    portal: 'portal',
  };

  Object.entries(aliases).forEach(([path, id]) => {
    router.get(`/${path}/health`, async (_req, res) => {
      try {
        res.json(await checker.getServiceHealth(id));
      } catch (e) {
        logger?.error?.(`${path}/health:`, e.message);
        res.status(500).json({ error: e.message });
      }
    });
  });

  return router;
}

module.exports = { createGlobalHealthRoutes };
