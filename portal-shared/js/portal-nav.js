'use strict';

/**
 * Liens navigation VigilSOC — menu latéral CERT/IT + barre outils externes.
 */
(function (global) {
  const VIGILSOC_HREF = '/vigilsoc/';
  const VIGILSOC_LABEL = () => (global.i18n?.t?.('vigil.ui_nav') || 'VigilSOC');

  function makeCertNavItem() {
    const li = document.createElement('li');
    li.className = 'cc-nav-external-vigilsoc';
    li.innerHTML = `<a class="cc-nav-btn cc-nav-link cc-nav-external" href="${VIGILSOC_HREF}" target="_blank" rel="noopener" data-cc-icon="ti"><span>${VIGILSOC_LABEL()}</span></a>`;
    return li;
  }

  function injectCertSidebar() {
    const sidebar = document.querySelector('#fp-sidebar .cc-sidebar-nav');
    if (!sidebar || sidebar.querySelector('.cc-nav-external-vigilsoc')) return;
    const section = document.createElement('div');
    section.className = 'cc-nav-section cc-nav-section-vigilsoc';
    section.innerHTML = `<p class="cc-nav-section-title">${global.i18n?.t?.('vigil.ui_section') || 'VigilSOC'}</p>`;
    const ul = document.createElement('ul');
    ul.className = 'fp-sidebar-nav';
    ul.appendChild(makeCertNavItem());
    section.appendChild(ul);
    const toolsSection = [...sidebar.querySelectorAll('.cc-nav-section')].find((s) => {
      const t = s.querySelector('.cc-nav-section-title');
      return t && /cert|outil/i.test(t.textContent || '');
    });
    if (toolsSection?.parentNode) {
      toolsSection.parentNode.insertBefore(section, toolsSection.nextSibling);
    } else {
      sidebar.appendChild(section);
    }
  }

  function injectCertHeader() {
    const nav = document.querySelector('.fp-nav-links');
    if (!nav || nav.querySelector('[data-vigilsoc-nav]')) return;
    const a = document.createElement('a');
    a.href = VIGILSOC_HREF;
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('data-vigilsoc-nav', '1');
    a.innerHTML = `🛡 <span>${VIGILSOC_LABEL()}</span>`;
    nav.appendChild(a);
  }

  function injectItSidebar() {
    const ul = document.querySelector('#fp-sidebar-it .fp-sidebar-nav');
    const socSection = document.querySelector('#fp-sidebar-it .cc-nav-section:nth-of-type(3) .fp-sidebar-nav');
    const target = socSection || ul;
    if (!target || target.querySelector('.cc-nav-external-vigilsoc')) return;
    const li = document.createElement('li');
    li.className = 'cc-nav-external-vigilsoc';
    li.innerHTML = `<a class="cc-nav-btn cc-nav-link" href="${VIGILSOC_HREF}" target="_blank" rel="noopener" data-cc-icon="ti"><span>${VIGILSOC_LABEL()}</span></a>`;
    target.appendChild(li);
  }

  function init() {
    injectCertSidebar();
    injectCertHeader();
    injectItSidebar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  global.PortalNav = { init, VIGILSOC_HREF };
})(window);
