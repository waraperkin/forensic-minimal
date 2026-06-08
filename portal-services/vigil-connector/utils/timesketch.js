'use strict';

const axios = require('axios');
const FormData = require('form-data');

const TS_URL = (process.env.TIMESKETCH_URL || 'http://timesketch-web:5000').replace(/\/$/, '');
const TS_USER = process.env.TIMESKETCH_USER || 'admin';
const TS_PASS = process.env.TIMESKETCH_PASSWORD || 'F0r3ns1c_TS_2024!';

let _session = null;

function mergeCookies(...sets) {
  const m = {};
  sets.flat().filter(Boolean).forEach((c) => {
    const kv = c.split(';')[0];
    m[kv.split('=')[0]] = kv;
  });
  return Object.values(m).join('; ');
}

async function getSession() {
  if (_session && (Date.now() - _session.ts) < 3500000) return _session;
  const pg = await axios.get(`${TS_URL}/login/`, { timeout: 10000, validateStatus: () => true });
  const html = pg.data.toString();
  const csrf = (html.match(/csrf-token" content="([^"]+)"/)
    || html.match(/name="csrf_token"[^>]*value="([^"]+)"/)
    || html.match(/value="([^"]+)"[^>]*name="csrf_token"/))?.[1];
  if (!csrf) return null;
  const initCk = pg.headers['set-cookie'] || [];
  const lr = await axios.post(
    `${TS_URL}/login/`,
    new URLSearchParams({ username: TS_USER, password: TS_PASS, csrf_token: csrf }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: mergeCookies(initCk),
        Referer: `${TS_URL}/login/`,
      },
      maxRedirects: 0,
      timeout: 15000,
      validateStatus: () => true,
    },
  );
  const cookie = mergeCookies(initCk, lr.headers['set-cookie'] || []);
  _session = { cookie, csrf, ts: Date.now() };
  return _session;
}

async function ensureSketch(caseName) {
  const s = await getSession();
  if (!s) return null;
  const sl = await axios.get(`${TS_URL}/api/v1/sketches/`, {
    headers: { Cookie: s.cookie, 'X-CSRFToken': s.csrf },
    timeout: 8000,
    validateStatus: () => true,
  });
  const existing = (sl.data.objects || []).find((x) => x.name === caseName);
  if (existing) return existing.id;
  const cr = await axios.post(
    `${TS_URL}/api/v1/sketches/`,
    { name: caseName, description: 'VigilSOC connector export' },
    {
      headers: { Cookie: s.cookie, 'X-CSRFToken': s.csrf, 'Content-Type': 'application/json' },
      timeout: 10000,
      validateStatus: () => true,
    },
  );
  return cr.data.sketch?.id || cr.data.objects?.[0]?.id || null;
}

function toCsv(rows, headers) {
  const esc = (v) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  rows.forEach((r) => lines.push(headers.map((h) => esc(r[h])).join(',')));
  return lines.join('\n');
}

async function uploadCsv(csv, filename, sketchId) {
  const s = await getSession();
  if (!s || !sketchId) return { ok: false, error: 'timesketch session unavailable' };
  const buf = Buffer.from(csv, 'utf8');
  const fd = new FormData();
  fd.append('file', buf, { filename, contentType: 'text/csv' });
  fd.append('name', filename.replace(/\.csv$/i, ''));
  fd.append('sketch_id', String(sketchId));
  fd.append('total_file_size', String(buf.length));
  fd.append('delimiter', ',');
  const r = await axios.post(`${TS_URL}/api/v1/upload/`, fd, {
    headers: { Cookie: s.cookie, 'X-CSRFToken': s.csrf, ...fd.getHeaders() },
    timeout: 120000,
    validateStatus: () => true,
  });
  return {
    ok: r.status < 300 || (r.status === 400 && r.data?.meta),
    sketch_id: sketchId,
    status: r.status,
    timeline_id: r.data?.objects?.[0]?.id,
  };
}

function alertRow(alert) {
  return {
    datetime: alert.timestamp || new Date().toISOString(),
    message: alert.title || alert.message || 'Vigil alert',
    severity: alert.severity || 'unknown',
    host: alert.host || '',
    rule: alert.rule || '',
    status: alert.status || '',
    source: 'vigil',
    alert_id: alert.id || '',
  };
}

function iocRow(ioc) {
  return {
    datetime: ioc.last_seen || ioc.first_seen || new Date().toISOString(),
    message: `IOC ${ioc.type}: ${ioc.value}`,
    ioc_type: ioc.type || '',
    ioc_value: ioc.value || '',
    confidence: ioc.confidence || '',
    tags: (ioc.tags || []).join('|'),
    source: 'vigil',
    ioc_id: ioc.id || '',
  };
}

function assetRow(asset) {
  return {
    datetime: asset.last_seen || new Date().toISOString(),
    message: `Asset ${asset.hostname}`,
    hostname: asset.hostname || '',
    os: asset.os || '',
    criticality: asset.criticality || '',
    agent_status: asset.agent_status || '',
    tags: (asset.tags || []).join('|'),
    source: 'vigil',
    asset_id: asset.id || '',
  };
}

async function exportAlertToTimesketch(alert) {
  const sketchId = await ensureSketch('[Vigil] Alerts');
  const headers = ['datetime', 'message', 'severity', 'host', 'rule', 'status', 'source', 'alert_id'];
  const csv = toCsv([alertRow(alert)], headers);
  const up = await uploadCsv(csv, `vigil-alert-${alert.id || 'export'}.csv`, sketchId);
  return { ...up, type: 'alert', id: alert.id, sketch_url: sketchUrl(sketchId) };
}

async function exportIOCToTimesketch(ioc) {
  const sketchId = await ensureSketch('[Vigil] IOC');
  const headers = ['datetime', 'message', 'ioc_type', 'ioc_value', 'confidence', 'tags', 'source', 'ioc_id'];
  const csv = toCsv([iocRow(ioc)], headers);
  const up = await uploadCsv(csv, `vigil-ioc-${ioc.id || 'export'}.csv`, sketchId);
  return { ...up, type: 'ioc', id: ioc.id, sketch_url: sketchUrl(sketchId) };
}

async function exportAssetToTimesketch(asset) {
  const sketchId = await ensureSketch('[Vigil] Assets');
  const headers = ['datetime', 'message', 'hostname', 'os', 'criticality', 'agent_status', 'tags', 'source', 'asset_id'];
  const csv = toCsv([assetRow(asset)], headers);
  const up = await uploadCsv(csv, `vigil-asset-${asset.id || 'export'}.csv`, sketchId);
  return { ...up, type: 'asset', id: asset.id, sketch_url: sketchUrl(sketchId) };
}

const INCIDENT_HEADERS = [
  'datetime', 'message', 'event_type', 'severity', 'host', 'rule', 'status',
  'ioc_type', 'ioc_value', 'hostname', 'os', 'criticality', 'agent_status',
  'tags', 'source', 'entity_id', 'case_id',
];

function incidentTimelineRow(kind, item, caseId) {
  if (kind === 'alert') {
    const r = alertRow(item);
    return {
      datetime: r.datetime,
      message: r.message,
      event_type: 'alert',
      severity: r.severity,
      host: r.host,
      rule: r.rule,
      status: r.status,
      ioc_type: '',
      ioc_value: '',
      hostname: r.host,
      os: '',
      criticality: '',
      agent_status: '',
      tags: '',
      source: 'vigil',
      entity_id: r.alert_id,
      case_id: caseId,
    };
  }
  if (kind === 'ioc') {
    const r = iocRow(item);
    return {
      datetime: r.datetime,
      message: r.message,
      event_type: 'ioc',
      severity: '',
      host: '',
      rule: '',
      status: '',
      ioc_type: r.ioc_type,
      ioc_value: r.ioc_value,
      hostname: '',
      os: '',
      criticality: '',
      agent_status: '',
      tags: r.tags,
      source: 'vigil',
      entity_id: r.ioc_id,
      case_id: caseId,
    };
  }
  const r = assetRow(item);
  return {
    datetime: r.datetime,
    message: r.message,
    event_type: 'asset',
    severity: '',
    host: r.hostname,
    rule: '',
    status: '',
    ioc_type: '',
    ioc_value: '',
    hostname: r.hostname,
    os: r.os,
    criticality: r.criticality,
    agent_status: r.agent_status,
    tags: r.tags,
    source: 'vigil',
    entity_id: r.asset_id,
    case_id: caseId,
  };
}

function sketchUrl(sketchId) {
  if (!sketchId) return null;
  const ext = (process.env.TIMESKETCH_EXTERNAL_URL || '').replace(/\/$/, '');
  if (ext) return `${ext}/sketch/${sketchId}/`;
  return `/timesketch/sketch/${sketchId}/`;
}

async function exportIncidentToTimesketch({ alert, iocs, assets, caseId }) {
  const sketchName = `[Vigil E2E] ${caseId}`;
  const sketchId = await ensureSketch(sketchName);
  const rows = [
    incidentTimelineRow('alert', alert, caseId),
    ...(iocs || []).map((i) => incidentTimelineRow('ioc', i, caseId)),
    ...(assets || []).map((a) => incidentTimelineRow('asset', a, caseId)),
  ];
  const csv = toCsv(rows, INCIDENT_HEADERS);
  const up = await uploadCsv(csv, `vigil-e2e-${caseId}.csv`, sketchId);
  return {
    ...up,
    type: 'incident',
    case_id: caseId,
    sketch_name: sketchName,
    sketch_url: sketchUrl(sketchId),
    rows: rows.length,
  };
}

async function ping() {
  try {
    const r = await axios.get(`${TS_URL}/login/`, { timeout: 5000, validateStatus: () => true });
    return { ok: [200, 302].includes(r.status), status: r.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  exportAlertToTimesketch,
  exportIOCToTimesketch,
  exportAssetToTimesketch,
  exportIncidentToTimesketch,
  sketchUrl,
  ping,
  getSession,
  ensureSketch,
};
