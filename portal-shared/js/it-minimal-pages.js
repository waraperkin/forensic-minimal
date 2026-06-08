/* global ForensicAPI, ForensicUtils, i18n */
'use strict';

const ItMinimalPages = (() => {
  const api = new ForensicAPI({ base: '' });

  function statusBadge(ok) {
    const cls = ok ? 'fp-badge-ok' : 'fp-badge-err';
    const label = ok ? 'OK' : 'KO';
    return `<span class="fp-badge ${cls}">${label}</span>`;
  }

  async function renderHealth() {
    const root = document.getElementById('it-health-root');
    if (!root) return;
    try {
      const [local, platform] = await Promise.all([
        api.get('api/health'),
        api.get('api/platform-health').catch(() => null),
      ]);
      const rows = [
        { name: 'Portail IT', ok: local?.status === 'ok' },
        { name: 'Redis', ok: !!local?.redis },
      ];
      if (platform?.services) {
        platform.services.forEach((s) => rows.push({ name: s.name, ok: !!s.ok }));
      }
      root.innerHTML = `<div class="fp-ds-scroll-list">${rows.map((r) => `
        <div class="fp-ds-list-row">
          <span>${ForensicUtils.escapeHtml(r.name)}</span>
          ${statusBadge(r.ok)}
        </div>`).join('')}</div>`;
    } catch (_) {
      root.innerHTML = '<p class="fp-muted">Erreur de chargement</p>';
    }
  }

  async function renderAgents() {
    const root = document.getElementById('it-agents-root');
    if (!root) return;
    try {
      const data = await api.get('api/agents');
      const agents = data?.agents || [];
      if (!agents.length) {
        root.innerHTML = `<p class="fp-muted">${i18n.t('it.agents_empty')}</p>`;
        return;
      }
      root.innerHTML = `<div class="fp-ds-scroll-list">${agents.map((a) => `
        <div class="fp-ds-list-row">
          <div>
            <strong>${ForensicUtils.escapeHtml(a.name)}</strong>
            <p class="fp-ds-muted">${ForensicUtils.escapeHtml(a.role || '')}</p>
          </div>
          ${statusBadge(a.ok)}
        </div>`).join('')}</div>`;
    } catch (_) {
      root.innerHTML = '<p class="fp-muted">Erreur de chargement</p>';
    }
  }

  function renderDocumentation() {
    const root = document.getElementById('it-doc-root');
    if (!root) return;
    root.innerHTML = `
      <ul class="fp-ds-doc-list">
        <li><a href="/" target="_blank" rel="noopener">Portail CERT</a></li>
        <li><a href="/dashboards/" target="_blank" rel="noopener">OpenSearch Dashboards</a></li>
        <li><a href="/timesketch/" target="_blank" rel="noopener">Timesketch</a></li>
        <li><a href="/cti/" target="_blank" rel="noopener">OpenCTI</a></li>
        <li><a href="/vigilsoc/" target="_blank" rel="noopener">VigilSOC</a></li>
      </ul>
      <p class="fp-ds-muted" style="margin-top:1rem">${i18n.t('it.doc_hint')}</p>`;
  }

  async function renderAdmin() {
    const root = document.getElementById('it-admin-root');
    if (!root) return;
    try {
      const cfg = await api.get('api/config');
      root.innerHTML = `
        <div class="fp-ds-kv">
          <div><span class="fp-ds-muted">${i18n.t('it.kpi_limits')}</span><strong>${cfg.maxFiles} / ${ForensicUtils.sz(cfg.maxSizeBytes)}</strong></div>
          <div><span class="fp-ds-muted">Portal</span><strong>${ForensicUtils.escapeHtml(cfg.portal || 'it')}</strong></div>
        </div>
        <p class="fp-ds-muted" style="margin-top:1rem">${i18n.t('it.admin_hint')}</p>`;
    } catch (_) {
      root.innerHTML = '<p class="fp-muted">Erreur de chargement</p>';
    }
  }

  function init() {
    renderHealth();
    renderAgents();
    renderDocumentation();
    renderAdmin();
  }

  return { init, renderHealth, renderAgents };
})();

window.ItMinimalPages = ItMinimalPages;
