/* global ForensicAPI, ForensicUI, ForensicUtils */
'use strict';

const MASTER_TABS = new Set([
  'dashboard-cert', 'dashboard-it', 'incidents', 'tickets', 'kb', 'assets',
  'vulnerabilities', 'notifications', 'integrations', 'users', 'workflows', 'purge',
]);

const DASHBOARD_STAT_NAV = {
  uploads_cert: { tab: 'cert', label: 'Uploads CERT' },
  active_tokens: { tab: 'tokens', label: 'Tokens actifs' },
  incidents: { tab: 'incidents', label: 'Incidents' },
  tickets: { tab: 'tickets', label: 'Tickets' },
  assets: { tab: 'assets', label: 'Assets' },
  vulnerabilities: { tab: 'vulnerabilities', label: i18n.t('hubs.it_vulns.title') },
  uploads_it: { tab: 'it', label: 'Uploads IT' },
  tokens_total: { tab: 'tokens', label: 'Tokens' },
  open_tickets: { tab: 'tickets', label: i18n.t('msg.tickets_ouverts') },
};

function esc(s) {
  if (s !== null && typeof s === 'object') return esc(JSON.stringify(s));
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function discoverUrl(query, index = 'fp-events') {
  const q = String(query || '*').replace(/'/g, "\\'");
  return (
    `/dashboards/app/discover#/?_a=(columns:!(),filters:!(),index:'${index}',`
    + `interval:auto,query:(language:kuery,query:'${q}'),sort:!())`
  );
}

function closeModal() {
  const m = document.getElementById('fp-master-modal');
  if (m) m.hidden = true;
}

function openModal(title, bodyHtml) {
  let m = document.getElementById('fp-master-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'fp-master-modal';
    m.className = 'fp-modal-overlay';
    m.innerHTML = `
      <div class="fp-modal" role="dialog" aria-modal="true">
        <div class="fp-modal-header">
          <h3 class="fp-modal-title"></h3>
          <button type="button" class="fp-btn fp-btn-ghost fp-btn-sm fp-modal-close" aria-label="${i18n.t('ui.close')}">✕</button>
        </div>
        <div class="fp-modal-body"></div>
      </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => {
      if (e.target === m || e.target.closest('.fp-modal-close')) closeModal();
    });
  }
  m.querySelector('.fp-modal-title').textContent = title;
  m.querySelector('.fp-modal-body').innerHTML = bodyHtml;
  m.hidden = false;
}

function zoneLead(tab) {
  return (window.PortalPanelGuide && PortalPanelGuide.leadHtml(tab)) || '';
}

function zoneEmpty(tab) {
  return (window.PortalPanelGuide && PortalPanelGuide.emptyHtml(tab))
    || `<p class="fp-muted">${i18n.t('empty.no_entry')}</p>`;
}

function renderTable(el, rows, cols, opts = {}, introTab) {
  const lead = introTab ? zoneLead(introTab) : '';
  if (!rows.length) {
    el.innerHTML = lead + zoneEmpty(introTab || '');
    return;
  }
  const head = cols.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const body = rows.map((r, i) => {
    const attrs = opts.rowClickable
      ? ` class="fp-row-clickable" data-row-id="${esc(r.id)}" data-row-idx="${i}" tabindex="0" role="button"`
      : '';
    return `<tr${attrs}>${cols.map((c) => `<td>${esc(r[c.key])}</td>`).join('')}</tr>`;
  }).join('');
  el.innerHTML = `${lead}<table class="fp-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  if (opts.onRowClick) {
    el.querySelectorAll('.fp-row-clickable').forEach((tr) => {
      const handler = () => opts.onRowClick(rows[Number(tr.dataset.rowIdx)], tr.dataset.rowId);
      tr.addEventListener('click', handler);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handler();
        }
      });
    });
  }
}

function renderClickableDashboard(el, data, introTab) {
  const entries = Object.entries(data).filter(([k]) => !['portal', 'label'].includes(k));
  const lead = introTab ? zoneLead(introTab) : '';
  el.innerHTML = `${lead}<div class="fp-grid-3 fp-stats-row">${entries.map(([k, v]) => {
    const nav = DASHBOARD_STAT_NAV[k];
    const clickable = nav ? ' fp-stat-clickable' : '';
    const attrs = nav ? ` data-stat-key="${esc(k)}" data-stat-tab="${nav.tab}" title="Voir ${esc(nav.label)}"` : '';
    return `<div class="fp-stat${clickable}"${attrs}><div class="fp-stat-value">${esc(v)}</div><div class="fp-stat-label">${esc(k.replace(/_/g, ' '))}</div></div>`;
  }).join('')}</div><p class="fp-hint">${esc(data.label || '')}</p>`;
  el.querySelectorAll('.fp-stat-clickable').forEach((card) => {
    card.addEventListener('click', () => {
      const t = card.dataset.statTab;
      if (t && typeof window.tab === 'function') window.tab(t);
    });
  });
}

async function showIncidentDetail(api, id) {
  openModal(i18n.t('msg.incident_detail'), `<p class="fp-muted">${i18n.t('ui.loading')}</p>`);
  try {
    const detail = await api.get(`/api/master/incidents/${encodeURIComponent(id)}`);
    const rel = await api.get(`/api/master/incidents/${encodeURIComponent(id)}/events`);
    const inc = detail.incident || detail;
    const events = rel.events || [];
    const dUrl = rel.discover_url || discoverUrl(`case.id:"${inc.case_id || inc.id}"`);
  const eventsHtml = events.length
      ? `<div class="fp-table-wrap"><table class="fp-table"><thead><tr><th>Date</th><th>Source</th><th>Message</th></tr></thead><tbody>`
        + events.slice(0, 20).map((e) => `<tr><td>${esc(e['@timestamp'] || '—')}</td><td>${esc(e['source.ip'] || e.host?.name || '—')}</td><td>${esc(String(e.message || e.event?.action || '—').slice(0, 120))}</td></tr>`).join('')
        + `</tbody></table></div>`
      : `<p class="fp-muted">${i18n.t('empty.no_events')}</p>`;
    openModal(
      inc.title || inc.id,
      `<div class="fp-detail-grid">
        <p><strong>ID:</strong> <code>${esc(inc.id)}</code></p>
        <p><strong>Case:</strong> <code>${esc(inc.case_id || '—')}</code></p>
        <p><strong>Sévérité:</strong> ${esc(inc.severity || '—')}</p>
        <p><strong>Statut:</strong> ${esc(inc.status || '—')}</p>
        <p><strong>Assigné:</strong> ${esc(inc.assignee || '—')}</p>
      </div>
      <div class="fp-detail-actions">
        <a class="fp-btn fp-btn-ghost fp-btn-sm" href="${esc(dUrl)}" target="_blank" rel="noopener">📊 Events liés (Discover)</a>
        <a class="fp-btn fp-btn-ghost fp-btn-sm" href="${esc(PortalConfig.socUrl('/timesketch/'))}" target="_blank" rel="noopener">⏱ Timesketch</a>
        <a class="fp-btn fp-btn-ghost fp-btn-sm" href="${esc(PortalConfig.socUrl('/thehive/'))}" target="_blank" rel="noopener">🐝 TheHive</a>
      </div>
      <h4 class="fp-section-title fp-section-spaced">Events associés (${events.length})</h4>
      ${eventsHtml}`,
    );
  } catch (e) {
    openModal('Incident', `<p class="fp-alert fp-alert-err">${esc(e.message)}</p>`);
  }
}

function renderUsersZone(el, api) {
  el.innerHTML = `
    <div class="fp-card-toolbar">
      <p class="fp-hint" style="margin:0;flex:1">Gestion des comptes portail (OpenSearch forensic-portal-users).</p>
      <button type="button" class="fp-btn fp-btn-primary fp-btn-sm" id="fp-user-add">+ Add user</button>
    </div>
    <div id="fp-users-table-wrap"><p class="fp-muted">${i18n.t('ui.loading')}</p></div>`;

  async function refresh() {
    const wrap = document.getElementById('fp-users-table-wrap');
    const rows = await api.get('/api/master/users');
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      wrap.innerHTML = `<p class="fp-muted">${i18n.t('empty.no_users')}</p>`;
      return;
    }
    wrap.innerHTML = `<table class="fp-table"><thead><tr>
      <th>Login</th><th>Rôle</th><th>Portail</th><th>Actif</th><th>Actions</th>
    </tr></thead><tbody>${list.map((u) => `<tr>
      <td><code>${esc(u.login)}</code></td>
      <td>${esc(u.role)}</td>
      <td>${esc(u.portal)}</td>
      <td>${esc(u.active)}</td>
      <td>
        <button type="button" class="fp-btn fp-btn-ghost fp-btn-sm fp-user-edit" data-id="${esc(u.id)}">Edit</button>
        <button type="button" class="fp-btn fp-btn-ghost fp-btn-sm fp-user-del" data-id="${esc(u.id)}">Delete</button>
      </td>
    </tr>`).join('')}</tbody></table>`;
    wrap.querySelectorAll('.fp-user-edit').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const u = list.find((x) => x.id === btn.dataset.id);
        if (!u) return;
        const login = prompt('Login', u.login || '');
        if (login === null) return;
        const role = prompt(i18n.t('msg.role_analyst_manager_it_upload'), u.role || 'analyst');
        if (role === null) return;
        const portal = prompt(i18n.t('msg.portail_cert_it'), u.portal || 'cert');
        if (portal === null) return;
        await api.put(`/api/master/users/${encodeURIComponent(u.id)}`, {
          login, role, portal, active: u.active !== false,
        });
        ForensicUI.toast(i18n.t('toast.user_updated'), 'success');
        refresh();
      });
    });
    wrap.querySelectorAll('.fp-user-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(i18n.t('confirm.delete_user'))) return;
        await api.delete(`/api/master/users/${encodeURIComponent(btn.dataset.id)}`);
        ForensicUI.toast(i18n.t('toast.user_deleted'), 'success');
        refresh();
      });
    });
  }

  document.getElementById('fp-user-add')?.addEventListener('click', async () => {
    const login = prompt('Login');
    if (!login) return;
    const role = prompt(i18n.t('msg.role_analyst_manager_it_upload'), 'analyst') || 'analyst';
    const portal = prompt(i18n.t('msg.portail_cert_it'), 'cert') || 'cert';
    await api.post('/api/master/users', { login, role, portal, active: true });
    ForensicUI.toast(i18n.t('toast.user_created'), 'success');
    refresh();
  });

  refresh().catch((e) => {
    el.innerHTML = `<p class="fp-alert fp-alert-err">${esc(e.message)}</p>`;
  });
}

function renderPurgeZone(el, api) {
  el.innerHTML = `
    <p class="fp-hint">${i18n.t('master.purge_hint')}</p>
    <div class="fp-grid-2">
      <label class="fp-label"><input type="checkbox" id="purge-logs" checked> Logs forensics (forensic-windows*, linux*, web*, …)</label>
      <label class="fp-label"><input type="checkbox" id="purge-tokens"> Tokens IT</label>
      <label class="fp-label"><input type="checkbox" id="purge-uploads"> Métadonnées uploads (forensic-uploads*)</label>
    </div>
    <label class="fp-label">Périmètre
      <select class="fp-select" id="purge-scope">
        <option value="all">Tout</option>
        <option value="period">Par période</option>
        <option value="source">Par source (portal cert/it — uploads)</option>
      </select>
    </label>
    <div class="fp-grid-2" id="purge-period-fields" hidden>
      <label class="fp-label">Du <input type="datetime-local" class="fp-input" id="purge-from"></label>
      <label class="fp-label">Au <input type="datetime-local" class="fp-input" id="purge-to"></label>
    </div>
    <label class="fp-label" id="purge-source-field" hidden>Source portal
      <select class="fp-select" id="purge-portal"><option value="cert">cert</option><option value="it">it</option></select>
    </label>
    <label class="fp-label">Analyste (audit) <input class="fp-input" id="purge-analyst" value="cert-analyst"></label>
    <div class="fp-actions-row">
      <button type="button" class="fp-btn fp-btn-ghost" id="purge-preview">Aperçu (dry-run)</button>
      <button type="button" class="fp-btn fp-btn-primary" id="purge-run">🗑 Exécuter la purge</button>
    </div>
    <pre class="fp-console" id="purge-result" style="margin-top:1rem;min-height:4rem">—</pre>`;

  const scopeEl = document.getElementById('purge-scope');
  scopeEl?.addEventListener('change', () => {
    const v = scopeEl.value;
    document.getElementById('purge-period-fields').hidden = v !== 'period';
    document.getElementById('purge-source-field').hidden = v !== 'source';
  });

  async function runPurge(dryRun) {
    const types = [];
    if (document.getElementById('purge-logs')?.checked) types.push('logs');
    if (document.getElementById('purge-tokens')?.checked) types.push('tokens');
    if (document.getElementById('purge-uploads')?.checked) types.push('uploads');
    if (!types.length) {
      ForensicUI.toast(i18n.t('toast.select_one_type'), 'warn');
      return;
    }
    const scope = scopeEl?.value || 'all';
    const body = {
      types,
      scope,
      analyst: document.getElementById('purge-analyst')?.value || 'cert-analyst',
      dry_run: dryRun,
      confirm: !dryRun,
    };
    if (scope === 'period') {
      body.from = document.getElementById('purge-from')?.value;
      body.to = document.getElementById('purge-to')?.value;
    }
    if (scope === 'source') body.portal = document.getElementById('purge-portal')?.value;
    if (!dryRun && !confirm(i18n.t('master.confirm_purge', { types: types.join(', '), scope }))) return;

    const out = document.getElementById('purge-result');
    out.textContent = i18n.t('msg.execution');
    try {
      const r = await api.post('/api/purge', body);
      out.textContent = JSON.stringify(r, null, 2);
      ForensicUI.toast(dryRun ? i18n.t('msg.apercu_termine') : i18n.t('msg.purge_executee'), dryRun ? 'info' : 'success');
      if (!dryRun && typeof window.loadStats === 'function') window.loadStats();
    } catch (e) {
      out.textContent = e.message;
      ForensicUI.toast(e.message, 'error');
    }
  }

  document.getElementById('purge-preview')?.addEventListener('click', () => runPurge(true));
  document.getElementById('purge-run')?.addEventListener('click', () => runPurge(false));
}

function renderIntegrations(el, data) {
  const rows = (data.integrations || []).map((i) => ({
    name: i.name,
    status: i.status,
    url: i.url || '—',
  }));
  renderTable(el, rows, [
    { key: 'name', label: 'Service' },
    { key: 'status', label: 'Statut' },
    { key: 'url', label: 'URL' },
  ]);
}

async function loadMasterZone(api, tab) {
  const el = document.getElementById(`zone-${tab}`);
  if (!el) return;
  el.innerHTML = `<p class="fp-muted">${i18n.t('ui.loading')}</p>`;
  try {
    if (tab === 'purge') {
      renderPurgeZone(el, api);
      return;
    }
    if (tab === 'users') {
      renderUsersZone(el, api);
      return;
    }
    if (tab === 'dashboard-cert') {
      renderClickableDashboard(el, await api.get('/api/master/dashboard/cert'), 'dashboard-cert');
      return;
    }
    if (tab === 'dashboard-it') {
      renderClickableDashboard(el, await api.get('/api/master/dashboard/it'), 'dashboard-it');
      return;
    }
    if (tab === 'integrations') {
      const data = await api.get('/api/master/integrations');
      el.innerHTML = zoneLead('integrations');
      const wrap = document.createElement('div');
      el.appendChild(wrap);
      renderIntegrations(wrap, data);
      return;
    }
    const path = tab === 'kb' ? 'kb' : tab;
    const rows = await api.get(`/api/master/${path}`);
    const list = Array.isArray(rows) ? rows : [];
    const cols = list[0]
      ? Object.keys(list[0])
        .filter((k) => !['tags', '@timestamp', 'seeded_at', 'host', 'log', 'event', 'fp', 'ti_match'].includes(k))
        .filter((k) => typeof list[0][k] !== 'object')
        .slice(0, 6)
        .map((k) => ({ key: k, label: k }))
      : [{ key: 'title', label: 'title' }];
    const incidentClick = tab === 'incidents'
      ? (row) => showIncidentDetail(api, row.id)
      : null;
    renderTable(el, list, cols.length ? cols : [{ key: 'id', label: 'id' }], {
      rowClickable: !!incidentClick,
      onRowClick: incidentClick,
    }, tab);
  } catch (e) {
    el.innerHTML = `<p class="fp-alert fp-alert-err">${esc(e.message)}</p>`;
  }
}

window.PortalMasterZones = {
  MASTER_TABS,
  loadMasterZone,
  discoverUrl,
  showIncidentDetail,
};
