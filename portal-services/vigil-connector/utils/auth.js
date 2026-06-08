'use strict';

/**
 * Authentification VigilSOC — en-têtes API, orgId, validation configuration live.
 */
function getConfig() {
  const baseUrl = (process.env.VIGIL_API_URL || '').replace(/\/$/, '');
  const apiKey = process.env.VIGIL_API_KEY || '';
  const orgId = process.env.VIGIL_ORG_ID || '';
  const apiPrefix = (process.env.VIGIL_API_PREFIX || '/api/v1').replace(/\/$/, '');
  const authScheme = (process.env.VIGIL_AUTH_SCHEME || 'Bearer').trim();
  return { baseUrl, apiKey, orgId, apiPrefix, authScheme };
}

function isConfigured() {
  const { baseUrl, apiKey } = getConfig();
  return !!(baseUrl && apiKey);
}

function authHeaders(extra) {
  const { apiKey, orgId, authScheme } = getConfig();
  const h = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: authScheme === 'ApiKey' ? `ApiKey ${apiKey}` : `Bearer ${apiKey}`,
    'X-API-Key': apiKey,
    'X-Vigil-Token': apiKey,
  };
  if (orgId) {
    h['X-Org-Id'] = orgId;
    h['X-Vigil-Org-Id'] = orgId;
    h['X-Organization-Id'] = orgId;
  }
  return { ...h, ...(extra || {}) };
}

function orgQuery() {
  const { orgId } = getConfig();
  return orgId ? { org_id: orgId, organization_id: orgId } : {};
}

function apiUrl(path) {
  const { baseUrl, apiPrefix } = getConfig();
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${apiPrefix}${p}`;
}

function publicStatus(extra) {
  const { baseUrl, orgId } = getConfig();
  return {
    configured: isConfigured(),
    base_url: baseUrl || null,
    org_id: orgId || null,
    mode: isConfigured() ? 'live' : 'demo',
    ...(extra || {}),
  };
}

module.exports = {
  getConfig, isConfigured, authHeaders, orgQuery, apiUrl, publicStatus,
};
