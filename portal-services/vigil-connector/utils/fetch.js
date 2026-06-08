'use strict';

const axios = require('axios');
const { isConfigured, authHeaders, orgQuery, apiUrl, publicStatus } = require('./auth');

const TIMEOUT = parseInt(process.env.VIGIL_HTTP_TIMEOUT || '25000', 10);

function demoAlerts() {
  const now = Date.now();
  return [
    { id: 'vig-al-001', title: 'Brute force RDP détecté', severity: 'high', status: 'open', source: 'vigil', host: 'srv-dc01.corp.local', rule: 'AUTH-RDP-BF-01', timestamp: new Date(now - 3600000).toISOString(), ioc_count: 2 },
    { id: 'vig-al-002', title: 'Exfiltration DNS suspecte', severity: 'critical', status: 'investigating', source: 'vigil', host: 'wkst-042.corp.local', rule: 'NET-DNS-EXFIL-03', timestamp: new Date(now - 7200000).toISOString(), ioc_count: 5 },
    { id: 'vig-al-003', title: 'PowerShell encodé — LOLBin', severity: 'medium', status: 'open', source: 'vigil', host: 'wkst-117.corp.local', rule: 'EXEC-PS-ENC-07', timestamp: new Date(now - 10800000).toISOString(), ioc_count: 1 },
    { id: 'vig-al-004', title: 'Compte admin verrouillé anormal', severity: 'low', status: 'closed', source: 'vigil', host: 'srv-iam01.corp.local', rule: 'IAM-LOCK-02', timestamp: new Date(now - 86400000).toISOString(), ioc_count: 0 },
  ];
}

function demoIoc() {
  const now = Date.now();
  return [
    { id: 'vig-ioc-001', type: 'ipv4', value: '203.0.113.45', confidence: 85, tags: ['c2', 'emotet'], first_seen: new Date(now - 172800000).toISOString(), last_seen: new Date(now - 3600000).toISOString(), source: 'vigil' },
    { id: 'vig-ioc-002', type: 'domain', value: 'malware-drop.evil-dns.net', confidence: 92, tags: ['phishing'], first_seen: new Date(now - 259200000).toISOString(), last_seen: new Date(now - 7200000).toISOString(), source: 'vigil' },
    { id: 'vig-ioc-003', type: 'sha256', value: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', confidence: 78, tags: ['ransomware'], first_seen: new Date(now - 432000000).toISOString(), last_seen: new Date(now - 10800000).toISOString(), source: 'vigil' },
    { id: 'vig-ioc-004', type: 'url', value: 'https://phish-bank.example/login', confidence: 95, tags: ['credential-theft'], first_seen: new Date(now - 86400000).toISOString(), last_seen: new Date(now - 1800000).toISOString(), source: 'vigil' },
  ];
}

function demoAssets() {
  const now = Date.now();
  return [
    { id: 'vig-ast-001', hostname: 'srv-dc01.corp.local', os: 'Windows Server 2022', criticality: 'critical', agent_status: 'online', last_seen: new Date(now - 300000).toISOString(), source: 'vigil', tags: ['dc', 'ad'] },
    { id: 'vig-ast-002', hostname: 'wkst-042.corp.local', os: 'Windows 11', criticality: 'medium', agent_status: 'online', last_seen: new Date(now - 600000).toISOString(), source: 'vigil', tags: ['endpoint'] },
    { id: 'vig-ast-003', hostname: 'srv-db01.corp.local', os: 'RHEL 9', criticality: 'high', agent_status: 'offline', last_seen: new Date(now - 86400000).toISOString(), source: 'vigil', tags: ['database'] },
    { id: 'vig-ast-004', hostname: 'fw-edge01.corp.local', os: 'FortiOS', criticality: 'high', agent_status: 'online', last_seen: new Date(now - 120000).toISOString(), source: 'vigil', tags: ['firewall', 'perimeter'] },
  ];
}

function normalizeList(data, fallback) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.alerts)) return data.alerts;
  return fallback;
}

function normalizeOne(data) {
  if (!data) return null;
  if (data.item) return data.item;
  if (data.data && !Array.isArray(data.data)) return data.data;
  return data;
}

async function vigilRequest(method, path, opts) {
  const url = apiUrl(path);
  const r = await axios.request({
    method,
    url,
    headers: authHeaders(opts?.headers),
    params: { ...orgQuery(), ...(opts?.params || {}) },
    data: opts?.data,
    timeout: opts?.timeout || TIMEOUT,
    validateStatus: () => true,
  });
  if (r.status >= 400) {
    const err = new Error(`Vigil API ${r.status}: ${typeof r.data === 'string' ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  return r.data;
}

async function verifyLiveConnection() {
  if (!isConfigured()) return { ok: false, reason: 'not_configured' };
  try {
    await vigilRequest('GET', '/health', { timeout: 8000 });
    return { ok: true };
  } catch (_) {
    try {
      await vigilRequest('GET', '/alerts', { params: { limit: 1 }, timeout: 8000 });
      return { ok: true, via: 'alerts' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

async function fetchAlerts(opts) {
  if (!isConfigured()) {
    return { items: demoAlerts(), configured: false, source: 'demo' };
  }
  try {
    const raw = await vigilRequest('GET', '/alerts', { params: { limit: opts?.limit || 500, status: opts?.status } });
    return { items: normalizeList(raw, []), configured: true, source: 'live' };
  } catch (e) {
    return { items: demoAlerts(), configured: true, source: 'fallback', error: e.message };
  }
}

async function fetchIoc(opts) {
  if (!isConfigured()) {
    return { items: demoIoc(), configured: false, source: 'demo' };
  }
  try {
    const raw = await vigilRequest('GET', '/ioc', { params: { limit: opts?.limit || 500 } });
    return { items: normalizeList(raw, []), configured: true, source: 'live' };
  } catch (e) {
    return { items: demoIoc(), configured: true, source: 'fallback', error: e.message };
  }
}

async function fetchAssets(opts) {
  if (!isConfigured()) {
    return { items: demoAssets(), configured: false, source: 'demo' };
  }
  try {
    const raw = await vigilRequest('GET', '/assets', { params: { limit: opts?.limit || 500 } });
    return { items: normalizeList(raw, []), configured: true, source: 'live' };
  } catch (e) {
    return { items: demoAssets(), configured: true, source: 'fallback', error: e.message };
  }
}

async function fetchAlertById(id) {
  const all = await fetchAlerts({ limit: 500 });
  let item = all.items.find((a) => String(a.id) === String(id));
  if (item) return { item, ...all };
  if (isConfigured()) {
    try {
      const raw = await vigilRequest('GET', `/alerts/${id}`);
      item = normalizeOne(raw);
      if (item) return { item, configured: true, source: 'live' };
    } catch (_) { /* fallback list */ }
  }
  return { item: null, error: 'Alert not found', id };
}

async function fetchIocById(id) {
  const all = await fetchIoc({ limit: 500 });
  let item = all.items.find((x) => String(x.id) === String(id));
  if (item) return { item, ...all };
  if (isConfigured()) {
    try {
      const raw = await vigilRequest('GET', `/ioc/${id}`);
      item = normalizeOne(raw);
      if (item) return { item, configured: true, source: 'live' };
    } catch (_) { /* noop */ }
  }
  return { item: null, error: 'IOC not found', id };
}

async function fetchAssetById(id) {
  const all = await fetchAssets({ limit: 500 });
  let item = all.items.find((x) => String(x.id) === String(id));
  if (item) return { item, ...all };
  if (isConfigured()) {
    try {
      const raw = await vigilRequest('GET', `/assets/${id}`);
      item = normalizeOne(raw);
      if (item) return { item, configured: true, source: 'live' };
    } catch (_) { /* noop */ }
  }
  return { item: null, error: 'Asset not found', id };
}

module.exports = {
  fetchAlerts, fetchIoc, fetchAssets,
  fetchAlertById, fetchIocById, fetchAssetById,
  verifyLiveConnection,
  demoAlerts, demoIoc, demoAssets,
  vigilRequest, normalizeList,
  TIMEOUT,
};
