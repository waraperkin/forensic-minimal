'use strict';

const axios = require('axios');
const { helkHealth } = require('./helk-connector');
const { velociraptorHealth } = require('./velociraptor-connector');

const PUBLIC_HOST = process.env.PUBLIC_HOST || process.env.GRAFANA_DOMAIN || '10.78.0.9';

function normalizeStatus(raw) {
  const s = String(raw || '').toUpperCase();
  if (s === 'OK' || s === 'UP' || s === 'GREEN') return 'OK';
  if (s === 'DEGRADED' || s === 'YELLOW' || s === 'WARN') return 'DEGRADED';
  return 'DOWN';
}

function buildResult(service, name, { status, latency_ms, version, message, extra } = {}) {
  return {
    service,
    name,
    status: normalizeStatus(status),
    latency_ms: latency_ms ?? null,
    version: version || null,
    message: message || '',
    ...(extra || {}),
  };
}

async function timedPing(url, options = {}) {
  const t0 = Date.now();
  const okStatuses = options.okStatuses || [200];
  const degradedStatuses = options.degradedStatuses || [];
  try {
    const r = await axios.get(url, {
      timeout: options.timeout || 10000,
      maxRedirects: 3,
      validateStatus: () => true,
      ...(options.axios || {}),
    });
    const latency_ms = Date.now() - t0;
    let status = 'DOWN';
    if (okStatuses.includes(r.status)) status = 'OK';
    else if (degradedStatuses.includes(r.status)) status = 'DEGRADED';
    return { ok: status !== 'DOWN', status, latency_ms, data: r.data, http: r.status };
  } catch (e) {
    return { ok: false, status: 'DOWN', latency_ms: Date.now() - t0, error: e.code || e.message };
  }
}

function createGlobalHealthChecker(CFG = {}) {
  const cfg = {
    os: { url: CFG.os?.url || process.env.OPENSEARCH_URL || 'http://opensearch-node1:9200' },
    ts: { url: CFG.ts?.url || process.env.TIMESKETCH_URL || 'http://timesketch-web:5000' },
    opencti: { url: CFG.opencti?.url || process.env.OPENCTI_URL || 'http://opencti:8080' },
    thehive: { url: CFG.thehive?.url || process.env.THEHIVE_URL || 'http://thehive:9000/thehive' },
    misp: { url: CFG.misp?.url || process.env.MISP_URL || 'http://misp:80' },
    grafana: CFG.grafana || 'http://grafana:3000',
    nginx: CFG.nginx || 'http://nginx/nginx-health',
    certSelf: CFG.certSelf || 'http://127.0.0.1:3000/api/health',
    helkBridge: (process.env.HELK_BRIDGE_URL || 'http://helk-bridge:8095').replace(/\/$/, ''),
    vrBridge: (process.env.VR_BRIDGE_URL || 'http://velociraptor-bridge:8097').replace(/\/$/, ''),
  };

  async function checkOpenSearch() {
    const r = await timedPing(`${cfg.os.url}/_cluster/health`);
    if (!r.ok) {
      return buildResult('opensearch', 'OpenSearch', {
        status: 'DOWN',
        latency_ms: r.latency_ms,
        message: r.error || `HTTP ${r.http}`,
      });
    }
    const cluster = r.data?.status || 'unknown';
    const st = cluster === 'red' ? 'DOWN' : cluster === 'yellow' ? 'DEGRADED' : 'OK';
    return buildResult('opensearch', 'OpenSearch', {
      status: st,
      latency_ms: r.latency_ms,
      version: r.data?.number_of_nodes != null ? `nodes:${r.data.number_of_nodes}` : null,
      message: `cluster ${cluster}`,
      extra: { cluster },
    });
  }

  async function checkHelk() {
    const t0 = Date.now();
    const [health, bridge] = await Promise.all([
      helkHealth(),
      timedPing(`${cfg.helkBridge}/health`),
    ]);
    const latency_ms = Date.now() - t0;
    let status = 'DOWN';
    if (health.ok && bridge.status === 'OK') status = 'OK';
    else if (health.ok || bridge.status === 'OK') status = 'DEGRADED';
    return buildResult('helk', 'HELK', {
      status,
      latency_ms,
      version: health.cluster || null,
      message: health.ok ? 'ES + bridge' : (health.error || 'indisponible'),
      extra: { bridge: bridge.status, enabled: health.enabled !== false },
    });
  }

  async function checkVelociraptor() {
    const t0 = Date.now();
    const health = await velociraptorHealth();
    const bridge = await timedPing(`${cfg.vrBridge}/health`);
    const latency_ms = Date.now() - t0;
    let status = 'DOWN';
    if (health.ok && bridge.status === 'OK') status = 'OK';
    else if (health.ok || bridge.status === 'OK') status = 'DEGRADED';
    return buildResult('velociraptor', 'Velociraptor', {
      status,
      latency_ms,
      message: health.ok ? 'bridge + GUI' : (health.error || 'indisponible'),
      extra: { bridge: bridge.status, enabled: health.enabled !== false },
    });
  }

  async function checkTimesketch() {
    const r = await timedPing(`${cfg.ts.url}/login`, { okStatuses: [200, 302], degradedStatuses: [401, 403] });
    return buildResult('timesketch', 'Timesketch', {
      status: r.status,
      latency_ms: r.latency_ms,
      message: r.ok ? 'UI accessible' : (r.error || `HTTP ${r.http}`),
    });
  }

  async function checkGrafana() {
    const r = await timedPing(`${cfg.grafana}/api/health`);
    return buildResult('grafana', 'Grafana', {
      status: r.status,
      latency_ms: r.latency_ms,
      version: r.data?.version || null,
      message: r.ok ? 'API health OK' : (r.error || `HTTP ${r.http}`),
    });
  }

  async function checkOpenCTI() {
    // /cti/health renvoie 401 sans session — preuve que le service répond (aligné /api/services).
    const r = await timedPing(`${cfg.opencti.url}/cti/health`, { okStatuses: [200, 401, 302] });
    const msg = r.http === 401
      ? 'API active (auth requise)'
      : r.ok
        ? 'health OK'
        : (r.error || `HTTP ${r.http}`);
    return buildResult('opencti', 'OpenCTI', {
      status: r.status,
      latency_ms: r.latency_ms,
      message: msg,
    });
  }

  async function checkMisp() {
    const r = await timedPing(`${cfg.misp.url}/users/login`, { okStatuses: [200, 302, 403], degradedStatuses: [401] });
    return buildResult('misp', 'MISP', {
      status: r.status,
      latency_ms: r.latency_ms,
      message: r.ok || r.status === 'DEGRADED' ? 'UI login' : (r.error || `HTTP ${r.http}`),
    });
  }

  async function checkTheHive() {
    const r = await timedPing(`${cfg.thehive.url}/api/status`);
    return buildResult('thehive', 'TheHive', {
      status: r.status,
      latency_ms: r.latency_ms,
      version: r.data?.versions?.TheHive || null,
      message: r.ok ? 'API status OK' : (r.error || `HTTP ${r.http}`),
    });
  }

  async function checkCortex() {
    const r = await timedPing('http://cortex:9001/api/status');
    return buildResult('cortex', 'Cortex', {
      status: r.status,
      latency_ms: r.latency_ms,
      version: r.data?.version || null,
      message: r.ok ? 'API status OK' : (r.error || `HTTP ${r.http}`),
    });
  }

  async function checkNginx() {
    const r = await timedPing(cfg.nginx, { okStatuses: [200] });
    return buildResult('nginx', 'Nginx', {
      status: r.status,
      latency_ms: r.latency_ms,
      message: r.ok ? 'reverse proxy OK' : (r.error || `HTTP ${r.http}`),
      extra: { public_url: `https://${PUBLIC_HOST}/` },
    });
  }

  async function checkPortal() {
    const r = await timedPing(cfg.certSelf);
    return buildResult('portal', 'Portail CERT', {
      status: r.status,
      latency_ms: r.latency_ms,
      message: r.ok ? 'CERT API OK' : (r.error || `HTTP ${r.http}`),
    });
  }

  const CHECKERS = {
    opensearch: checkOpenSearch,
    helk: checkHelk,
    velociraptor: checkVelociraptor,
    timesketch: checkTimesketch,
    grafana: checkGrafana,
    opencti: checkOpenCTI,
    misp: checkMisp,
    thehive: checkTheHive,
    cortex: checkCortex,
    nginx: checkNginx,
    portal: checkPortal,
  };

  async function getServiceHealth(id) {
    const fn = CHECKERS[id];
    if (!fn) return buildResult(id, id, { status: 'DOWN', message: 'service inconnu' });
    return fn();
  }

  async function getGlobalHealth() {
    const ids = Object.keys(CHECKERS);
    const entries = await Promise.all(ids.map(async (id) => [id, await getServiceHealth(id)]));
    const services = Object.fromEntries(entries);
    const summary = { ok: 0, degraded: 0, down: 0, total: ids.length };
    Object.values(services).forEach((s) => {
      if (s.status === 'OK') summary.ok += 1;
      else if (s.status === 'DEGRADED') summary.degraded += 1;
      else summary.down += 1;
    });
    return { ts: new Date().toISOString(), summary, services };
  }

  return {
    getGlobalHealth,
    getServiceHealth,
    CHECKERS,
  };
}

module.exports = { createGlobalHealthChecker, normalizeStatus, buildResult };
