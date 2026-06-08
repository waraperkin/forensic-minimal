'use strict';

const { fetchAlerts, fetchIoc, fetchAssets } = require('./fetch');
const { publicStatus } = require('./auth');
const osUtil = require('./opensearch');
const tsUtil = require('./timesketch');
const portalIndex = require('./portal-index');

let _lastRun = null;
let _e2eRunning = false;
let _e2eLastAt = 0;
const E2E_COOLDOWN_MS = parseInt(process.env.VIGIL_E2E_COOLDOWN_MS || '45000', 10);

function pickAlert(items) {
  const order = ['critical', 'high', 'medium', 'low'];
  for (const sev of order) {
    const found = items.find((a) => String(a.severity).toLowerCase() === sev && a.status !== 'closed');
    if (found) return found;
  }
  return items[0] || null;
}

function relatedIoc(allIoc, alert, limit) {
  const n = limit || parseInt(process.env.VIGIL_E2E_IOC_LIMIT || '5', 10);
  const tagged = allIoc.filter((i) => (i.tags || []).some((t) => /c2|phish|ransom|exfil/i.test(t)));
  return (tagged.length ? tagged : allIoc).slice(0, n);
}

function relatedAssets(allAssets, alert, limit) {
  const n = limit || parseInt(process.env.VIGIL_E2E_ASSET_LIMIT || '3', 10);
  const host = (alert?.host || '').toLowerCase();
  if (host) {
    const matched = allAssets.filter((a) => String(a.hostname || '').toLowerCase().includes(host.split('.')[0]));
    if (matched.length) return matched.slice(0, n);
  }
  return allAssets.slice(0, n);
}

async function runE2eIncident(opts) {
  if (_e2eRunning) {
    return { ok: false, skipped: true, error: 'E2E already running', retry_after_ms: 8000 };
  }
  const since = Date.now() - _e2eLastAt;
  if (_e2eLastAt && since < E2E_COOLDOWN_MS) {
    return {
      ok: false,
      skipped: true,
      error: 'E2E cooldown active',
      retry_after_ms: E2E_COOLDOWN_MS - since,
      last: _lastRun?.case_id || null,
    };
  }
  _e2eRunning = true;
  try {
  const started = Date.now();
  const runId = `vigil-e2e-${Date.now()}`;
  const caseId = opts?.case_id || `VIGIL-E2E-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Date.now()).slice(-4)}`;

  const [alertsPayload, iocPayload, assetsPayload] = await Promise.all([
    fetchAlerts({ limit: 100 }),
    fetchIoc({ limit: 100 }),
    fetchAssets({ limit: 100 }),
  ]);

  const alert = pickAlert(alertsPayload.items);
  if (!alert) {
    const err = { ok: false, error: 'No alert available for E2E', run_id: runId };
    _lastRun = err;
    _e2eRunning = false;
    _e2eLastAt = Date.now();
    return err;
  }

  const iocs = relatedIoc(iocPayload.items, alert);
  const assets = relatedAssets(assetsPayload.items, alert);

  const [osAlerts, osIoc, osAssets] = await Promise.all([
    osUtil.indexAlerts([alert]),
    osUtil.indexIoc(iocs),
    osUtil.indexAssets(assets),
  ]);

  const timesketch = await tsUtil.exportIncidentToTimesketch({ alert, iocs, assets, caseId });

  const incident = {
    id: `fp-${runId}`,
    title: `[Vigil E2E] ${alert.title}`,
    severity: alert.severity || 'high',
    status: 'investigating',
    assignee: 'cert-analyst',
    case_id: caseId,
    portal: 'cert',
    incident_source: 'vigil-e2e',
    vigil_alert_id: alert.id,
    vigil_mode: publicStatus().mode,
    timesketch_sketch_id: timesketch.sketch_id,
    timesketch_url: timesketch.sketch_url,
    created_at: new Date().toISOString(),
  };

  const ticket = {
    id: `fp-tix-${runId}`,
    title: `[IT] Collecte logs — ${alert.host || caseId}`,
    type: 'request',
    status: 'open',
    requester: 'it-ops',
    case_id: caseId,
    portal: 'it',
    linked_incident: incident.id,
    vigil_alert_id: alert.id,
    description: `Demande IT liée à l'incident VigilSOC E2E ${caseId}`,
    created_at: new Date().toISOString(),
  };

  let certCase = { ok: false };
  let itTicket = { ok: false };
  try {
    [certCase, itTicket] = await Promise.all([
      portalIndex.createCertIncident(incident),
      portalIndex.createItTicket(ticket),
    ]);
  } catch (e) {
    certCase = { ok: false, error: e.message };
    itTicket = { ok: false, error: e.message };
  }

  const result = {
    ok: true,
    run_id: runId,
    case_id: caseId,
    mode: publicStatus().mode,
    alert: { id: alert.id, title: alert.title, severity: alert.severity, host: alert.host },
    ioc_count: iocs.length,
    asset_count: assets.length,
    opensearch: { alerts: osAlerts, ioc: osIoc, assets: osAssets },
    timesketch,
    cert_incident: certCase,
    it_ticket: itTicket,
    links: {
      overview: '/?tab=overview',
      cases: '/?tab=cases',
      cert_ops: '/?tab=cert-ops',
      it_ops: '/?tab=it-ops',
      cti: '/?tab=threat-intel',
      activity_log: '/?tab=hist',
      timesketch: timesketch.sketch_url,
      vigilsoc_ui: '/vigilsoc/',
    },
    duration_ms: Date.now() - started,
    timestamp: new Date().toISOString(),
    vigil: publicStatus({ source: alertsPayload.source }),
  };

  _lastRun = result;
  await portalIndex.saveE2eRun(result).catch(() => {});
  _e2eLastAt = Date.now();
  return result;
  } catch (e) {
    const err = { ok: false, error: e.message, run_id: `vigil-e2e-${Date.now()}` };
    _lastRun = err;
    _e2eLastAt = Date.now();
    return err;
  } finally {
    _e2eRunning = false;
  }
}

async function getE2eStatus() {
  const stored = await portalIndex.getLastE2eRun();
  return stored || _lastRun || { ok: false, message: 'No E2E run yet' };
}

module.exports = { runE2eIncident, getE2eStatus, pickAlert, relatedIoc, relatedAssets };
