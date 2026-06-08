'use strict';

async function fetchAuditEvents(params = {}) {
  const q = new URLSearchParams(params);
  const r = await fetch(`/api/audit/events?${q}`, { credentials: 'include' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatAuditUser(e) {
  const user = e.user || '—';
  const role = e.role || '';
  if (!role || String(role) === String(user)) return esc(user);
  return `${esc(user)} <span class="fp-muted">${esc(role)}</span>`;
}

function applyClientAuditFilter() {
  const q = (document.getElementById('audit-search')?.value || '').trim().toLowerCase();
  const vigilChip = document.querySelector('#audit-chips [data-audit-vigil].active');
  const vigilOnly = !!vigilChip;
  const tbody = document.getElementById('audit-tbody');
  if (!tbody) return;
  let visible = 0;
  tbody.querySelectorAll('.cc-audit-row').forEach((row) => {
    const text = row.dataset.search || row.textContent.toLowerCase();
    const vigOk = !vigilOnly || row.dataset.vigil === '1';
    const ok = vigOk && (!q || text.includes(q));
    row.style.display = ok ? '' : 'none';
    if (ok) visible += 1;
  });
  const countEl = document.getElementById('audit-visible-count');
  if (countEl) {
    const total = tbody.querySelectorAll('.cc-audit-row').length;
    countEl.textContent = i18n.t('activity.visible_count', { n: visible, total });
  }
}

async function loadActivityLog() {
  if (typeof i18n !== 'undefined' && i18n.whenReady) {
    await new Promise((resolve) => i18n.whenReady(resolve));
  }
  const root = document.getElementById('activity-log-root');
  if (!root) return;

  root.innerHTML = `
    <div class="fp-ds-activity-toolbar">
      <div class="fp-ds-filter-chips" id="audit-chips" role="group" aria-label="${esc(i18n.t('activity.chip_group'))}">
        <button type="button" class="fp-ds-chip active" data-audit-type="">${i18n.t('activity.filter_all')}</button>
        <button type="button" class="fp-ds-chip" data-audit-type="user">${i18n.t('activity.chip_user')}</button>
        <button type="button" class="fp-ds-chip" data-audit-type="cert_ops">${i18n.t('activity.chip_cert_ops')}</button>
        <button type="button" class="fp-ds-chip" data-audit-type="system">${i18n.t('activity.chip_system')}</button>
        <button type="button" class="fp-ds-chip" data-audit-vigil="1">${i18n.t('vigil.filter_only')}</button>
      </div>
      <input type="search" class="fp-input fp-ds-input-inline" id="audit-search"
        placeholder="${esc(i18n.t('activity.search_placeholder'))}" autocomplete="off">
    </div>
    <div class="cc-glass-panel cc-audit-filters fp-ds-audit-filters">
      <label class="fp-label">${i18n.t('table.type')} <select class="fp-select" id="audit-type">
        <option value="">${i18n.t('activity.filter_all')}</option>
        <option value="user">user</option>
        <option value="cert_ops">cert_ops</option>
        <option value="system">system</option>
      </select></label>
      <label class="fp-label">${i18n.t('activity.filter_user')} <input class="fp-input" id="audit-user" placeholder="admin"></label>
      <label class="fp-label">${i18n.t('table_cols.service')} <input class="fp-input" id="audit-service" placeholder="cert-portal"></label>
      <label class="fp-label">${i18n.t('activity.filter_from')} <input class="fp-input" id="audit-from" type="datetime-local"></label>
      <label class="fp-label">${i18n.t('activity.filter_to')} <input class="fp-input" id="audit-to" type="datetime-local"></label>
      <button type="button" class="fp-btn fp-btn-primary" id="audit-refresh">${i18n.t('activity.filter_btn')}</button>
    </div>
    <p class="fp-ds-muted fp-ds-activity-count" id="audit-visible-count" aria-live="polite"></p>
    <div class="fp-table-wrap cc-glass-panel fp-section-spaced fp-ds-scroll-panel fp-ds-table-wrap">
      <table class="fp-table cc-audit-table">
        <thead><tr>
          <th>Timestamp</th><th>User</th><th>Action</th><th>IP</th><th>${i18n.t('table_cols.service')}</th><th>${i18n.t('activity.context')}</th>
        </tr></thead>
        <tbody id="audit-tbody"><tr><td colspan="6" class="fp-table-empty">${i18n.t('ui.loading')}</td></tr></tbody>
      </table>
    </div>`;

  const typeSelect = document.getElementById('audit-type');
  const chips = document.querySelectorAll('#audit-chips .fp-ds-chip');
  let vigilOnly = false;

  function syncChipsFromSelect() {
    const val = typeSelect?.value || '';
    chips.forEach((c) => {
      if (c.dataset.auditVigil) {
        c.classList.toggle('active', vigilOnly);
      } else {
        c.classList.toggle('active', !vigilOnly && c.dataset.auditType === val);
      }
    });
  }

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      if (chip.dataset.auditVigil) {
        vigilOnly = !vigilOnly;
        syncChipsFromSelect();
        applyClientAuditFilter();
        return;
      }
      vigilOnly = false;
      if (typeSelect) typeSelect.value = chip.dataset.auditType || '';
      chips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      refresh();
    });
  });

  typeSelect?.addEventListener('change', () => {
    syncChipsFromSelect();
    refresh();
  });

  document.getElementById('audit-search')?.addEventListener('input', applyClientAuditFilter);

  async function refresh() {
    const tbody = document.getElementById('audit-tbody');
    tbody.innerHTML = `<tr><td colspan="6" class="fp-table-empty">${i18n.t('ui.loading')}</td></tr>`;
    try {
      const data = await fetchAuditEvents({
        type: document.getElementById('audit-type').value,
        user: document.getElementById('audit-user').value,
        service: document.getElementById('audit-service').value,
        from: document.getElementById('audit-from').value,
        to: document.getElementById('audit-to').value,
        limit: '300',
      });
      let events = data.events || [];
      const bundle = window.VigilIntegration
        ? await VigilIntegration.fetchBundle().catch(() => null) : null;
      if (bundle && !events.some((e) => window.VigilIntegration.isVigilEvent(e))) {
        events = [{
          '@timestamp': new Date().toISOString(),
          type: 'system',
          action: 'vigil_sync',
          user: 'system',
          service: 'vigil-connector',
          message: i18n.t('vigil.audit_sync'),
          context: VigilIntegration.enrichAuditContext({ context: { source: 'vigil' } }, bundle),
        }, ...events];
      }
      if (!events.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="fp-table-empty">${i18n.t('msg.aucun_evenement')}</td></tr>`;
        const countEl = document.getElementById('audit-visible-count');
        if (countEl) countEl.textContent = i18n.t('activity.visible_count', { n: 0, total: 0 });
        return;
      }
      const searchTexts = [];
      tbody.innerHTML = events
        .map(
          (e, idx) => {
            const search = [
              e['@timestamp'],
              e.user,
              e.role,
              e.action,
              e.message,
              e.ip,
              e.service,
              e.type,
              JSON.stringify(e.context || {}),
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            const vig = window.VigilIntegration && VigilIntegration.isVigilEvent(e);
            const ctx = window.VigilIntegration
              ? VigilIntegration.enrichAuditContext(e, bundle) : (e.context || {});
            searchTexts[idx] = search + (vig ? ' vigil vigilsoc' : '');
            const vigRow = vig ? ' cc-audit-vigil' : '';
            const vigData = vig ? ' data-vigil="1"' : '';
            const vigBtn = vig && window.VigilIntegration
              ? `<button type="button" class="fp-btn fp-btn-ghost fp-btn-sm" data-vigil-act="open">${i18n.t('vigil.open')}</button>` : '';
            return `<tr class="cc-audit-row${vigRow}" data-type="${esc(e.type)}"${vigData}>
          <td><code>${esc(e['@timestamp'] || '')}</code>${vig ? ` ${VigilIntegration.vigilTagHtml()}` : ''}</td>
          <td>${formatAuditUser(e)}</td>
          <td><strong>${esc(e.action)}</strong><br><span class="fp-muted">${esc(e.message)}</span> ${vigBtn}</td>
          <td>${esc(e.ip || '—')}</td>
          <td>${esc(e.service || '—')}</td>
          <td><details><summary>JSON</summary><pre class="cc-audit-json">${esc(JSON.stringify(ctx, null, 2))}</pre></details></td>
        </tr>`;
          },
        )
        .join('');
      tbody.querySelectorAll('.cc-audit-row').forEach((row, idx) => {
        row.dataset.search = searchTexts[idx] || '';
      });
      applyClientAuditFilter();
      if (window.VigilIntegration) VigilIntegration.bindVigilActions(tbody);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="fp-alert fp-alert-err">${esc(err.message)}</td></tr>`;
    }
  }

  document.getElementById('audit-refresh')?.addEventListener('click', refresh);
  refresh();
}

window.PortalActivityLog = { loadActivityLog };
