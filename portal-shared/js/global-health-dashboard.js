/* global ForensicUtils, GlobalHealthService */
'use strict';

const GlobalHealthDashboard = (() => {
  const ORDER = [
    'opensearch',
    'helk',
    'velociraptor',
    'timesketch',
    'grafana',
    'opencti',
    'misp',
    'thehive',
    'cortex',
    'nginx',
    'portal',
  ];

  function statusClass(status) {
    if (status === 'OK') return 'gh-card--ok';
    if (status === 'DEGRADED') return 'gh-card--degraded';
    return 'gh-card--down';
  }

  function badgeClass(status) {
    if (status === 'OK') return 'gh-badge--ok';
    if (status === 'DEGRADED') return 'gh-badge--degraded';
    return 'gh-badge--down';
  }

  function esc(v) {
    return ForensicUtils?.escapeHtml ? ForensicUtils.escapeHtml(String(v ?? '')) : String(v ?? '');
  }

  function renderCard(s) {
    const latency = s.latency_ms != null ? `${s.latency_ms} ms` : '—';
    const version = s.version ? ` · v${esc(s.version)}` : '';
    const msg = s.message ? `<div class="gh-card-meta">${esc(s.message)}</div>` : '';
    return `
      <div class="gh-card ${statusClass(s.status)}" data-gh-service="${esc(s.service)}">
        <div class="gh-card-title">${esc(s.name || s.service)}</div>
        <span class="gh-badge ${badgeClass(s.status)}">${esc(s.status)}</span>
        <div class="gh-card-meta">${latency}${version}</div>
        ${msg}
      </div>`;
  }

  function render(data, { compact = false } = {}) {
    if (!data?.services) {
      return '<p class="fp-muted">Aucune donnée de santé</p>';
    }
    const services = ORDER.map((id) => data.services[id]).filter(Boolean);
    const sum = data.summary || { ok: 0, degraded: 0, down: 0, total: services.length };
    const gridClass = compact ? 'gh-grid gh-grid--compact' : 'gh-grid';
    return `
      <div class="gh-dashboard" data-gh-dashboard>
        <div class="gh-toolbar">
          <div class="gh-summary">
            <span><strong class="gh-badge gh-badge--ok">${sum.ok}</strong> OK</span>
            <span><strong class="gh-badge gh-badge--degraded">${sum.degraded}</strong> DEGRADED</span>
            <span><strong class="gh-badge gh-badge--down">${sum.down}</strong> DOWN</span>
          </div>
          <button type="button" class="fp-btn fp-btn-ghost fp-btn-sm" data-gh-refresh>Rafraîchir</button>
        </div>
        <div class="${gridClass}" data-gh-grid>
          ${services.map(renderCard).join('')}
        </div>
        <p class="fp-muted" style="margin-top:0.75rem;font-size:0.78rem">Maj : ${esc(data.ts || '—')}</p>
      </div>`;
  }

  function bind(container) {
    container.querySelector('[data-gh-refresh]')?.addEventListener('click', async () => {
      const btn = container.querySelector('[data-gh-refresh]');
      if (btn) btn.disabled = true;
      try {
        await GlobalHealthService.refresh();
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  function paint(container, data, opts) {
    if (!container) return;
    container.innerHTML = render(data, opts);
    bind(container);
  }

  function mount(container, opts = {}) {
    if (!container) return () => {};
    container.innerHTML = '<p class="fp-muted">Chargement santé plateforme…</p>';
    const unsub = GlobalHealthService.subscribe((data) => {
      if (!data) return;
      paint(container, data, opts);
    });
    GlobalHealthService.startPolling();
    GlobalHealthService.refresh().catch((e) => {
      container.innerHTML = `<p class="fp-alert fp-alert-err">${esc(e.message)}</p>`;
    });
    return unsub;
  }

  return { mount, render, paint };
})();

window.GlobalHealthDashboard = GlobalHealthDashboard;
