'use strict';

const express = require('express');
const winston = require('winston');
const alertsRouter = require('./routes/alerts');
const iocRouter = require('./routes/ioc');
const assetsRouter = require('./routes/assets');
const healthRouter = require('./routes/health');
const e2eRouter = require('./routes/e2e');
const osUtil = require('./utils/opensearch');

const PORT = parseInt(process.env.VIGIL_CONNECTOR_PORT || '8083', 10);
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.printf(
    (i) => `${i.timestamp} [vigil-connector] ${i.level}: ${i.message}`,
  )),
  transports: [new winston.transports.Console()],
});

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

app.use('/alerts', alertsRouter);
app.use('/ioc', iocRouter);
app.use('/assets', assetsRouter);
app.use('/health', healthRouter);
app.use('/e2e', e2eRouter);

app.get('/', (_req, res) => {
  res.json({
    service: 'vigil-connector',
    endpoints: ['/health', '/alerts', '/ioc', '/assets', '/e2e/incident'],
    portal_paths: [
      '/api/vigil/health', '/api/vigil/alerts', '/api/vigil/ioc', '/api/vigil/assets',
      '/api/vigil/e2e/incident',
      'POST /api/vigil/alerts/:id/timesketch',
      'POST /api/vigil/ioc/:id/timesketch',
      'POST /api/vigil/assets/:id/timesketch',
    ],
  });
});

app.use((err, _req, res, _next) => {
  logger.error(err.message);
  res.status(500).json({ error: err.message });
});

async function boot() {
  try {
    const idx = await osUtil.ensureIndices();
    logger.info(`OpenSearch indices: ${JSON.stringify(idx)}`);
  } catch (e) {
    logger.warn(`OpenSearch init: ${e.message}`);
  }
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`VigilSOC connector listening on :${PORT}`);
  });
}

boot();
