// Pont entre l'interface et le moteur Rust (remplace le preload Electron) : même API window.bv qu'avant,
// + exécution des outils d'Orbiz (iris-link) dans la page, touches F5/F11/F12, liens externes.
(() => {
  const T = window.__TAURI__;
  const invoke = T.core.invoke;

  window.bv = {
    load: () => invoke('data_load'),
    save: (data) => invoke('data_save', { data }),
    migration: () => invoke('migration_info'),
    ask: (text, send = true) => invoke('assistant_ask', { text, send }),
    openExternal: (url) => invoke('open_url', { url }),
    openDataFolder: () => invoke('open_datafolder'),
    clearOutlook: () => invoke('owa_clear', { home: null }),
    // exécute un script dans Outlook intégré et renvoie { value } ou { error }
    owaEval: (js) => invoke('owa_read', { js }),
    exportPdf: (html, name) => invoke('export_pdf', { html, name }),
    exportText: (text, name, ext) => invoke('export_text', { text, name, ext }),
    importText: (exts) => invoke('import_text', { exts }),
    lookupArtist: (q) => invoke('lookup_artist', { q }),
    lookupImage: (url) => invoke('lookup_image', { url }),
    keys: {
      status: () => invoke('keys_status'),
      get: () => invoke('keys_get'),
      save: (patch) => invoke('keys_save', { patch }),
      testSpotify: () => invoke('keys_test_spotify'),
    },
    enrich: {
      start: (list) => invoke('enrich_start', { list }),
      stop: () => invoke('enrich_stop'),
      on: (cb) => { ['enrich:progress', 'enrich:patch', 'enrich:done'].forEach((ch) => T.event.listen(ch, (e) => cb(ch, e.payload))); },
    },
    mail: {
      presets: () => invoke('mail_presets'),
      account: () => invoke('mail_account'),
      saveAccount: (cfg) => invoke('mail_save_account', { cfg }),
      removeAccount: () => invoke('mail_remove_account'),
      test: (cfg) => invoke('mail_test', { cfg }),
      msLogin: (o) => invoke('mail_ms_login', { o: o || {} }),
      folders: () => invoke('mail_folders'),
      cached: (folder) => invoke('mail_cached', { folder: folder || null }),
      sync: (folder) => invoke('mail_sync', { folder: folder || null }),
      prefetch: (folder) => invoke('mail_prefetch', { folder: folder || null }),
      get: (folder, uid, opts) => invoke('mail_get', { folder, uid, opts: opts || null }),
      body: (folder, uid) => invoke('mail_body', { folder, uid }),
      flag: (folder, uid, flag, value) => invoke('mail_flag', { folder, uid, flag, value }),
      trash: (folder, uid) => invoke('mail_trash', { folder, uid }),
      send: (m) => invoke('mail_send', { m }),
      attachment: (folder, uid, index, mode) => invoke('mail_attachment', { folder, uid, index, mode: mode || null }),
      pickFiles: () => invoke('mail_pick_files'),
    },
  };

  // ---------------------------------------------------------------- outils génériques d'Orbiz (comme iris-link/app-host.js)
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  let items = [];
  const UI = {
    list() {
      items = [...document.querySelectorAll('a[href],button,input,textarea,select,summary,[role=button],[onclick],[tabindex]:not([tabindex="-1"])')].filter(visible);
      return items.map((el, i) => ({ i, tag: el.tagName.toLowerCase(), type: el.type || undefined, text: label(el), id: el.id || undefined,
        pressed: el.getAttribute('aria-pressed') || undefined, disabled: el.disabled || undefined }));
    },
    find({ index, selector, text }) {
      if (index != null) { if (!items.length) this.list(); return items[index]; }
      if (selector) return document.querySelector(selector);
      if (text) { const t = text.toLowerCase(); this.list();
        return items.find((el) => label(el).toLowerCase() === t) || items.find((el) => label(el).toLowerCase().includes(t)); }
    },
  };
  const TOOLS = {
    get_screen: (a) => ({ title: document.title, text: document.body.innerText.replace(/\n{3,}/g, '\n\n').slice(0, Number(a.max_chars) || 8000) }),
    list_elements: () => UI.list(),
    click: (a) => { const el = UI.find(a); if (!el) return { error: 'Élément introuvable' };
      el.scrollIntoView({ block: 'center' }); el.click(); return { ok: true, clicked: label(el) }; },
    type_text: (a) => { const el = UI.find(a); if (!el) return { error: 'Champ introuvable' };
      el.focus(); el.value = (a.clear !== false ? '' : el.value) + (a.text || ''); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      if (a.submit) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return { ok: true }; },
    press_key: (a) => {
      const key = a.key || 'Enter', target = document.activeElement || document.body;
      for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
      return { ok: true };
    },
    scroll: (a) => { const d = a.direction || 'down';
      const y = d === 'top' ? 0 : d === 'bottom' ? document.body.scrollHeight : scrollY + (d === 'up' ? -1 : 1) * innerHeight * 0.8;
      scrollTo({ top: y }); return { scrollY: Math.round(scrollY) }; },
    execute_javascript: async (a) => (0, eval)(a.code || 'undefined'),
  };

  T.event.listen('agent-call', async (e) => {
    const { id, kind, tool, args } = e.payload;
    let result;
    try {
      if (kind === 'page') {
        // l'interface peut être encore en train de démarrer
        for (let i = 0; i < 100 && !window.irisAgent; i++) await new Promise((r) => setTimeout(r, 100));
        result = await window.irisAgent[tool](args || {});
      } else result = await TOOLS[tool](args || {});
      try { result = JSON.parse(JSON.stringify(result ?? null)); } catch { result = String(result); }
    } catch (err) { result = { error: String(err?.message || err) }; }
    invoke('agent_reply', { id, result });
  });

  // touches de la fenêtre
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5') { e.preventDefault(); location.reload(); }
    else if (e.key === 'F11') { e.preventDefault(); invoke('win_action', { action: 'fullscreen' }); }
    else if (e.key === 'F12') { e.preventDefault(); invoke('win_action', { action: 'devtools' }); }
  }, true);
  // liens externes dans le navigateur par défaut
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (a && /^(https?|mailto|tel):/i.test(a.getAttribute('href'))) { e.preventDefault(); window.bv.openExternal(a.href); }
  });
})();
