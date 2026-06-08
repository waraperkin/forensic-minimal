/* global i18n */
'use strict';

/**
 * VigilSOC — intégration transverse portail CERT/IT (additif, sans modifier les IDs existants).
 */
(function () {
  const API = '/api/vigil';
  let _bundle = null;
  let _bundleTs = 0;
  const CACHE_MS = 90000;

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function t(key, vars) {
    return typeof i18n !== 'undefined' && i18n.t ? i18n.t(key, vars) : key;
  }

  async function api(path, opts) {
    const url = `${API}${path.startsWith('/') ? path : `/${path}`}`;
    const r = await fetch(url, { credentials: 'include', ...(opts || {}) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  }

  async function fetchBundle(force) {
    if (!force && _bundle && (Date.now() - _bundleTs) < CACHE_MS) return _bundle;
    const [health, alerts, ioc, assets] = await Promise.all([
      api('/health').catch(() => ({ status: 'down' })),
      api('/alerts').catch(() => ({ count: 0, items: [] })),
      api('/ioc').catch(() => ({ count: 0, items: [] })),
      api('/assets').catch(() => ({ count: 0, items: [] })),
    ]);
    _bundle = { health, alerts, ioc, assets, ts: Date.now() };
    _bundleTs = _bundle.ts;
    return _bundle;
  }

  function isVigilEvent(e) {
    const svc = String(e.service || '').toLowerCase();
    const ctx = e.context || {};
    return svc.includes('vigil') || ctx.source === 'vigil' || ctx.vigil === true
      || String(e.message || '').toLowerCase().includes('vigil');
  }

  function enrichAuditContext(e, bundle) {
    const ctx = { ...(e.context || {}) };
    if (!isVigilEvent(e) && !ctx.vigil_enriched) return ctx;
    ctx.source = ctx.source || 'vigil';
    ctx.vigil = true;
    if (bundle) {
      ctx.vigil_enriched = {
        mode: bundle.health?.vigil?.mode || 'demo',
        alerts: bundle.alerts?.count || 0,
        ioc: bundle.ioc?.count || 0,
        assets: bundle.assets?.count || 0,
        connector_status: bundle.health?.status || 'unknown',
        opensearch: bundle.health?.opensearch?.status || '—',
        latency_hint_ms: bundle.health?.latency_ms,
        indexed: {
          alerts: bundle.alerts?.opensearch?.indexed,
          ioc: bundle.ioc?.opensearch?.indexed,
          assets: bundle.assets?.opensearch?.indexed,
        },
      };
    }
    return ctx;
  }

  function openInVigil() {
    if (typeof window.tab === 'function') window.tab('threat-intel');
    setTimeout(() => {
      const p = document.getElementById('vigil-cti-panel');
      if (p) p.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 600);
  }

  async function forceScan() {
    _bundle = null;
    await Promise.all([
      fetch(`${API}/alerts?refresh=1`, { credentials: 'include' }),
      fetch(`${API}/ioc?refresh=1`, { credentials: 'include' }),
      fetch(`${API}/assets?refresh=1`, { credentials: 'include' }),
    ]);
    _bundle = null;
    return fetchBundle(true);
  }

  function vigilTagHtml() {
    return '<span class="fp-tag fp-tag-active cc-vigil-tag">VigilSOC</span>';
  }

  async function runE2eIncident() {
    const r = await api('/e2e/incident', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    _bundle = null;
    return r;
  }

  async function exportAlertTimesketch(alertId) {
    return api(`/alerts/${alertId}/timesketch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  }

  function actionsHtml(compact, extra) {
    const e2eBtn = extra !== false
      ? `<button type="button" class="fp-btn fp-btn-ghost fp-btn-sm" data-vigil-act="e2e">${t('vigil.e2e_run')}</button>`
      : '';
    return `<span class="cc-vigil-actions${compact ? ' cc-vigil-actions--compact' : ''}">
      <button type="button" class="fp-btn fp-btn-ghost fp-btn-sm" data-vigil-act="open">${t('vigil.open')}</button>
      <button type="button" class="fp-btn fp-btn-primary fp-btn-sm" data-vigil-act="scan">${t('vigil.force_scan')}</button>
      ${e2eBtn}
    </span>`;
  }

  function bindVigilActions(root) {
    if (!root) return;
    root.querySelectorAll('[data-vigil-act="open"]').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.preventDefault(); openInVigil(); });
    });
    root.querySelectorAll('[data-vigil-act="scan"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = t('ui.loading');
        try {
          await forceScan();
          if (window.ForensicUI) ForensicUI.toast(t('vigil.scan_ok'), 'success');
          if (typeof window.tab === 'function') {
            const cur = document.querySelector('.fp-panel.active')?.id?.replace('tab-', '');
            if (cur === 'threat-intel' && window.PortalHub) PortalHub.loadThreatIntelHub();
            if (cur === 'overview' || cur === 'overview-cert') window.PortalOverview?.loadOverviewCert();
            if (cur === 'health' || cur === 'overview-health') window.PortalOverview?.loadOverviewHealth();
          }
        } catch (err) {
          if (window.ForensicUI) ForensicUI.toast(err.message, 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = old;
        }
      });
    });
    root.querySelectorAll('[data-vigil-act="e2e"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        await handleE2eRun(btn);
      });
    });
  }

  async function handleE2eRun(btn) {
    const old = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = t('vigil.e2e_running');
    }
    try {
      const r = await runE2eIncident();
      if (!r.ok) throw new Error(r.error || 'E2E failed');
      if (window.ForensicUI) ForensicUI.toast(`${t('vigil.e2e_ok')} — ${r.case_id}`, 'success');
      if (window.PortalOverview?.loadOverviewCert) await window.PortalOverview.loadOverviewCert();
      if (typeof window.tab === 'function') window.tab('cases');
    } catch (err) {
      if (window.ForensicUI) ForensicUI.toast(err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = old;
      }
    }
  }

  function bindOverviewE2e(root) {
    if (!root) return;
    root.querySelectorAll('[data-vigil-e2e-run]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await handleE2eRun(btn);
      });
    });
  }

  function computeIncidentVigilStatus(incident, alerts) {
    const items = alerts?.items || [];
    if (!items.length) return '—';
    const title = String(incident.title || incident.id || '').toLowerCase();
    const hostMatch = items.find((a) => title && (String(a.host || '').toLowerCase().includes(title.slice(0, 8))
      || title.includes(String(a.host || '').split('.')[0].toLowerCase())));
    if (hostMatch) return hostMatch.severity || hostMatch.status || 'linked';
    const open = items.filter((a) => /open|investigat/i.test(a.status || ''));
    if (open.length) return `${open.length} alerte(s)`;
    return 'monitoring';
  }

  async function mountCtiPanel(root) {
    if (!root) return;
    if (root.querySelector('#vigil-cti-panel')) return;
    const b = await fetchBundle();
    const panel = document.createElement('section');
    panel.id = 'vigil-cti-panel';
    panel.className = 'cc-vigil-panel fp-card fp-card-premium fp-section-spaced';
    const mode = b.health?.vigil?.mode || 'demo';
    const alerts = (b.alerts?.items || []).slice(0, 5);
    const iocs = (b.ioc?.items || []).slice(0, 5);
    const assets = (b.assets?.items || []).slice(0, 5);
    panel.innerHTML = `
      <div class="cc-vigil-panel-head">
        <h3 class="fp-section-sub">${t('vigil.panel_title')}</h3>
        <div class="cc-vigil-panel-meta">
          ${vigilTagHtml()} <span class="fp-muted">${t('vigil.mode')}: <strong>${esc(mode)}</strong></span>
          ${actionsHtml(true)}
        </div>
      </div>
      <div class="cc-hub-kpi-row cc-vigil-kpi-row">
        <div class="cc-hub-kpi-tile"><div class="cc-hub-kpi-label">${t('vigil.kpi_alerts')}</div><div class="cc-hub-kpi-value">${b.alerts?.count ?? 0}</div></div>
        <div class="cc-hub-kpi-tile"><div class="cc-hub-kpi-label">${t('vigil.kpi_ioc')}</div><div class="cc-hub-kpi-value">${b.ioc?.count ?? 0}</div></div>
        <div class="cc-hub-kpi-tile"><div class="cc-hub-kpi-label">${t('vigil.kpi_assets')}</div><div class="cc-hub-kpi-value">${b.assets?.count ?? 0}</div></div>
        <div class="cc-hub-kpi-tile"><div class="cc-hub-kpi-label">${t('vigil.connector')}</div><div class="cc-hub-kpi-value">${b.health?.status === 'ok' ? 'UP' : '—'}</div></div>
      </div>
      <div class="cc-vigil-triple-grid">
        <div><h4 class="fp-section-sub">${t('vigil.kpi_alerts')}</h4>
          <div class="fp-table-wrap cc-hub-mini-table"><table class="fp-table"><thead><tr><th>Titre</th><th>Sév.</th><th>Host</th></tr></thead><tbody>
            ${alerts.length ? alerts.map((a) => `<tr><td>${esc((a.title || '').slice(0, 40))}</td><td><span class="fp-tag">${esc(a.severity)}</span></td><td>${esc(a.host || '—')}</td></tr>`).join('') : `<tr><td colspan="3" class="fp-table-empty">${t('ui.entry_empty')}</td></tr>`}
          </tbody></table></div>
        </div>
        <div><h4 class="fp-section-sub">${t('vigil.kpi_ioc')}</h4>
          <div class="fp-table-wrap cc-hub-mini-table"><table class="fp-table"><thead><tr><th>Type</th><th>Valeur</th></tr></thead><tbody>
            ${iocs.length ? iocs.map((x) => `<tr><td>${esc(x.type)}</td><td><code>${esc((x.value || '').slice(0, 36))}</code></td></tr>`).join('') : `<tr><td colspan="2" class="fp-table-empty">${t('ui.entry_empty')}</td></tr>`}
          </tbody></table></div>
        </div>
        <div><h4 class="fp-section-sub">${t('vigil.kpi_assets')}</h4>
          <div class="fp-table-wrap cc-hub-mini-table"><table class="fp-table"><thead><tr><th>Host</th><th>Agent</th></tr></thead><tbody>
            ${assets.length ? assets.map((x) => `<tr><td>${esc(x.hostname || '—')}</td><td><span class="fp-tag fp-tag-${x.agent_status === 'online' ? 'active' : ''}">${esc(x.agent_status || '—')}</span></td></tr>`).join('') : `<tr><td colspan="2" class="fp-table-empty">${t('ui.entry_empty')}</td></tr>`}
          </tbody></table></div>
        </div>
      </div>`;
    root.appendChild(panel);
    bindVigilActions(panel);
  }

  async function renderHealthBlock(container) {
    if (!container || container.querySelector('#vigil-health-block')) return;
    let h;
    try { h = await api('/health'); } catch (e) { h = { status: 'down', error: e.message }; }
    const block = document.createElement('div');
    block.id = 'vigil-health-block';
    block.className = 'cc-vigil-health-block fp-section-spaced';
    const lat = h.latency_ms != null ? `${h.latency_ms} ms` : '—';
    block.innerHTML = `
      <h3 class="fp-section-sub">${t('vigil.health_title')}</h3>
      <div class="fp-ds-grid fp-ds-grid-3">
        <div class="fp-ds-card ${h.status === 'ok' ? 'fp-ds-card--up' : 'fp-ds-card--down'}">
          <div class="fp-ds-card-label">${t('vigil.connector')}</div>
          <div class="fp-ds-card-value">${h.status === 'ok' ? 'UP' : 'DOWN'}</div>
          <div class="fp-ds-card-meta">${t('vigil.api_status')}: ${esc(h.vigil?.mode || h.status || '—')}</div>
        </div>
        <div class="fp-ds-card fp-ds-card--up">
          <div class="fp-ds-card-label">${t('vigil.latency')}</div>
          <div class="fp-ds-card-value">${esc(lat)}</div>
          <div class="fp-ds-card-meta">OpenSearch: ${esc(h.opensearch?.status || '—')}</div>
        </div>
        <div class="fp-ds-card ${h.timesketch?.ok ? 'fp-ds-card--up' : 'fp-ds-card--warn'}">
          <div class="fp-ds-card-label">Timesketch</div>
          <div class="fp-ds-card-value">${h.timesketch?.ok ? 'UP' : '—'}</div>
          <div class="fp-ds-card-meta">${h.error ? esc(h.error) : t('vigil.no_errors')}</div>
        </div>
        <a class="fp-ds-card fp-ds-card--up" href="/vigilsoc/" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
          <div class="fp-ds-card-label">${t('vigil.ui_console')}</div>
          <div class="fp-ds-card-value">UP</div>
          <div class="fp-ds-card-meta"><code>/vigilsoc/</code> →</div>
        </a>
      </div>
      ${actionsHtml(false)}`;
    container.appendChild(block);
    bindVigilActions(block);
  }

  async function buildOverviewKpiHtml() {
    const b = await fetchBundle();
    return `
      <button type="button" class="fp-ds-card fp-ds-card-interactive fp-premium-card cc-card-click cc-vigil-kpi" data-goto-tab="threat-intel">
        <div class="fp-ds-card-label">${t('vigil.kpi_alerts')}</div>
        <div class="fp-ds-card-value">${b.alerts?.count ?? 0}</div>
        <div class="fp-ds-card-meta">${vigilTagHtml()} VigilSOC →</div>
      </button>
      <button type="button" class="fp-ds-card fp-ds-card-interactive fp-premium-card cc-card-click cc-vigil-kpi" data-goto-tab="threat-intel">
        <div class="fp-ds-card-label">${t('vigil.kpi_ioc')}</div>
        <div class="fp-ds-card-value">${b.ioc?.count ?? 0}</div>
        <div class="fp-ds-card-meta">IOC VigilSOC →</div>
      </button>
      <button type="button" class="fp-ds-card fp-ds-card-interactive fp-premium-card cc-card-click cc-vigil-kpi" data-goto-tab="threat-intel">
        <div class="fp-ds-card-label">${t('vigil.kpi_assets')}</div>
        <div class="fp-ds-card-value">${b.assets?.count ?? 0}</div>
        <div class="fp-ds-card-meta">Assets VigilSOC →</div>
      </button>`;
  }

  async function buildCertOpsVigilHtml(alerts) {
    const b = alerts ? { alerts } : await fetchBundle();
    const items = b.alerts?.items || [];
    const rows = items.slice(0, 8).map((a) => ({
      id: a.id,
      title: (a.title || '').slice(0, 42),
      severity: a.severity,
      host: a.host || '—',
      status: a.status,
    }));
    const table = rows.length
      ? `<div class="fp-table-wrap"><table class="fp-table"><thead><tr><th>ID</th><th>Alerte</th><th>Sév.</th><th>Host</th><th>Statut</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td><code>${esc(r.id)}</code></td><td>${esc(r.title)}</td><td>${esc(r.severity)}</td><td>${esc(r.host)}</td><td>${esc(r.status)}</td></tr>`).join('')}
        </tbody></table></div>`
      : `<p class="fp-muted">${t('ui.entry_empty')}</p>`;
    return `
      <div class="cc-vigil-ops-block">
        ${vigilTagHtml()} <span class="fp-muted">${items.length} alerte(s) VigilSOC</span>
        ${actionsHtml(true)}
        ${table}
      </div>`;
  }

  async function buildItOpsVigilHtml() {
    const b = await fetchBundle();
    const assets = (b.assets?.items || []).slice(0, 10);
    const online = assets.filter((a) => a.agent_status === 'online').length;
    const table = assets.length
      ? `<div class="fp-table-wrap"><table class="fp-table"><thead><tr><th>Hostname</th><th>OS</th><th>Agent VigilSOC</th><th>Criticité</th></tr></thead><tbody>
        ${assets.map((a) => `<tr><td>${esc(a.hostname)}</td><td>${esc(a.os || '—')}</td><td><span class="fp-tag fp-tag-${a.agent_status === 'online' ? 'active' : ''}">${esc(a.agent_status || '—')}</span></td><td>${esc(a.criticality || '—')}</td></tr>`).join('')}
        </tbody></table></div>`
      : `<p class="fp-muted">${t('ui.entry_empty')}</p>`;
    return `
      <div class="cc-vigil-ops-block">
        <p class="fp-muted">${t('vigil.agents_summary', { online, total: assets.length })}</p>
        ${actionsHtml(true)}
        ${table}
      </div>`;
  }

  function enhanceUploadTab() {
    const tab = document.getElementById('tab-upload');
    if (!tab || tab.querySelector('#vigil-upload-hint')) return;
    const hint = document.createElement('div');
    hint.id = 'vigil-upload-hint';
    hint.className = 'fp-alert fp-alert-warn cc-vigil-hint fp-section-spaced';
    hint.innerHTML = `${vigilTagHtml()} ${t('vigil.upload_hint')} ${actionsHtml(true)}`;
    const card = tab.querySelector('.fp-card') || tab.firstElementChild;
    if (card) card.insertAdjacentElement('afterbegin', hint);
    else tab.prepend(hint);
    bindVigilActions(hint);
  }

  function enhanceTokensTab() {
    const tab = document.getElementById('tab-tokens');
    if (!tab || tab.querySelector('#vigil-tokens-hint')) return;
    const hint = document.createElement('div');
    hint.id = 'vigil-tokens-hint';
    hint.className = 'cc-vigil-hint fp-section-spaced';
    hint.innerHTML = `<p class="fp-muted">${vigilTagHtml()} ${t('vigil.tokens_hint')} ${actionsHtml(true)}</p>`;
    const list = document.getElementById('tok-list');
    if (list) list.insertAdjacentElement('beforebegin', hint);
    else tab.prepend(hint);
    bindVigilActions(hint);
  }

  function enhanceToolsTab() {
    const roots = [document.getElementById('soc-tools-root'), document.getElementById('access-center-root')];
    roots.forEach((root) => {
      if (!root || root.querySelector('#vigil-tools-block')) return;
      const block = document.createElement('div');
      block.id = 'vigil-tools-block';
      block.className = 'cc-vigil-tools-block fp-section-spaced';
      block.innerHTML = `
        <h3 class="fp-section-sub">${t('vigil.tools_title')}</h3>
        <div class="fp-table-wrap"><table class="fp-table"><thead><tr><th>Endpoint</th><th>Description</th><th></th></tr></thead><tbody>
          <tr><td><code>GET /api/vigil/health</code></td><td>${t('vigil.tools_health')}</td><td><button type="button" class="fp-btn fp-btn-sm fp-btn-ghost" data-vigil-open-api="/api/vigil/health">${t('ui.open')}</button></td></tr>
          <tr><td><code>GET /api/vigil/alerts</code></td><td>${t('vigil.tools_alerts')}</td><td><button type="button" class="fp-btn fp-btn-sm fp-btn-ghost" data-vigil-open-api="/api/vigil/alerts">${t('ui.open')}</button></td></tr>
          <tr><td><code>GET /api/vigil/ioc</code></td><td>${t('vigil.tools_ioc')}</td><td><button type="button" class="fp-btn fp-btn-sm fp-btn-ghost" data-vigil-open-api="/api/vigil/ioc">${t('ui.open')}</button></td></tr>
          <tr><td><code>GET /api/vigil/assets</code></td><td>${t('vigil.tools_assets')}</td><td><button type="button" class="fp-btn fp-btn-sm fp-btn-ghost" data-vigil-open-api="/api/vigil/assets">${t('ui.open')}</button></td></tr>
          <tr><td><code>POST /api/vigil/alerts/:id/timesketch</code></td><td>${t('vigil.tools_timesketch')}</td><td><button type="button" class="fp-btn fp-btn-sm fp-btn-primary" data-vigil-act="ts-export">${t('vigil.export_timesketch')}</button></td></tr>
          <tr><td><code>POST /api/vigil/e2e/incident</code></td><td>${t('vigil.tools_e2e')}</td><td><button type="button" class="fp-btn fp-btn-sm fp-btn-primary" data-vigil-act="e2e">${t('vigil.e2e_run')}</button></td></tr>
        </tbody></table></div>
        ${actionsHtml(false)}`;
      root.appendChild(block);
      block.querySelectorAll('[data-vigil-open-api]').forEach((btn) => {
        btn.addEventListener('click', () => window.open(btn.dataset.vigilOpenApi, '_blank', 'noopener'));
      });
      block.querySelectorAll('[data-vigil-act="ts-export"]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          btn.disabled = true;
          try {
            const b = await fetchBundle(true);
            const id = b.alerts?.items?.[0]?.id;
            if (!id) throw new Error('No alert');
            const r = await exportAlertTimesketch(id);
            if (window.ForensicUI) ForensicUI.toast(`${t('vigil.export_timesketch')} — ${r.sketch_url || r.sketch_id || 'ok'}`, 'success');
            if (r.sketch_url) window.open(r.sketch_url, '_blank', 'noopener');
          } catch (err) {
            if (window.ForensicUI) ForensicUI.toast(err.message, 'error');
          } finally {
            btn.disabled = false;
          }
        });
      });
      bindVigilActions(block);
    });
  }

  window.VigilIntegration = {
    api,
    fetchBundle,
    isVigilEvent,
    enrichAuditContext,
    openInVigil,
    forceScan,
    runE2eIncident,
    exportAlertTimesketch,
    mountCtiPanel,
    renderHealthBlock,
    buildOverviewKpiHtml,
    buildCertOpsVigilHtml,
    buildItOpsVigilHtml,
    computeIncidentVigilStatus,
    enhanceUploadTab,
    enhanceTokensTab,
    enhanceToolsTab,
    bindVigilActions,
    bindOverviewE2e,
    vigilTagHtml,
    actionsHtml,
  };
})();
