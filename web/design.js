/* Attendly design helpers. No libraries. Include after the HTML.
   - Theme: dark/light, remembered, button with id="themeBtn" toggles it.
   - Dock: the moving navy blob follows the link with aria-current="page".
   - toast(message, isError), openModal(html) / closeModal(). */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

  function applyTheme(t) {
    document.documentElement.dataset.theme = t; set('theme', t);
    const m = $('meta[name="theme-color"]'); if (m) m.content = t === 'dark' ? '#1A2B3C' : '#F7FAFC';
    const b = $('#themeBtn'); if (b) b.textContent = t === 'dark' ? '☀' : '☾';
  }
  applyTheme(get('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const tb = $('#themeBtn'); if (tb) tb.onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

  function moveDock() {
    const a = $('.dock a[aria-current="page"]'), wrap = $('.dock-liquid'); if (!a || !wrap) return;
    const base = wrap.getBoundingClientRect(), r = a.getBoundingClientRect(), x = r.left - base.left;
    ['lead', 'trail'].forEach((c) => { const el = $('.' + c, wrap); el.style.width = r.width + 'px'; el.style.transform = `translateX(${x}px)`; });
  }
  document.querySelectorAll('.dock a').forEach((a) => a.addEventListener('click', () => {
    document.querySelectorAll('.dock a').forEach((o) => o.removeAttribute('aria-current')); a.setAttribute('aria-current', 'page'); moveDock();
  }));
  addEventListener('resize', moveDock); addEventListener('load', moveDock);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveDock);

  window.toast = (msg, isErr) => {
    let box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const el = document.createElement('div'); el.className = 'toast' + (isErr ? ' err' : ''); el.textContent = msg; box.appendChild(el);
    setTimeout(() => el.remove(), isErr ? 5000 : 2800);
  };
  window.openModal = (html) => {
    closeModal();
    const s = document.createElement('div'); s.className = 'scrim'; s.id = 'scrim';
    s.innerHTML = `<div class="glass modal" role="dialog" aria-modal="true">${html}</div>`;
    s.addEventListener('click', (e) => { if (e.target === s || e.target.closest('[data-cancel]')) closeModal(); });
    document.body.appendChild(s);
  };
  window.closeModal = () => { const s = $('#scrim'); if (s) s.remove(); };
})();
