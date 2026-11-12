// Outlook intégré : Outlook Web dans une webview gérée par Rust (session gardée), posée sur le cadre #owa-frame,
// avec des actions qui lisent le mail affiché (créer la fiche, analyser avec Orbiz).
(function () {
  const URLS = {
    pro: { url: 'https://outlook.cloud.microsoft/mail/', l: 'Compte du festival / Microsoft 365' },
    perso: { url: 'https://outlook.live.com/mail/', l: 'Compte perso (outlook.com, hotmail…)' },
  };
  let built = false;
  let on = false;
  const inv = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
  const frame = () => document.getElementById('owa-frame');
  // la webview Outlook passe au-dessus de tout : on la cache quand une fenêtre de l'app (modale, fiche) est ouverte
  const covered = () => document.getElementById('modal-root').children.length > 0 || document.getElementById('drawer').classList.contains('on');
  const rect = () => { const r = frame().getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  function place() {
    if (!built) return;
    if (!on || covered()) return inv('owa_hide');
    const r = rect();
    if (r.w < 2 || r.h < 2) return;
    inv('owa_show', { url: homeUrl(), ...r });
  }
  // l'ancienne adresse office.com renvoie parfois vers la page d'accueil Microsoft
  const homeUrl = () => (settings().owaUrl || URLS.pro.url).replace('outlook.office.com/mail/', 'outlook.cloud.microsoft/mail/');

  function build() {
    if (built) return;
    built = true;
    const pane = document.getElementById('owa-pane');
    pane.innerHTML = `
      <div class="owa-bar">
        <b style="font-size:16px">Mails</b><span class="muted" style="font-size:12.5px">Outlook intégré</span>
        <button class="btn sm ghost icon" data-act="owa-back" title="Précédent">${ic('reply')}</button>
        <button class="btn sm ghost icon" data-act="owa-reload" title="Recharger">${ic('refresh')}</button>
        <button class="btn sm ghost" data-act="owa-home">${ic('inbox')}Boîte de réception</button>
        <div style="flex:1"></div>
        <span class="muted" style="font-size:12.5px">Mail affiché :</span>
        <button class="btn sm" data-act="owa-create">${ic('plus')}Créer la fiche artiste</button>
        <button class="btn sm" data-act="owa-note">${ic('link')}Ajouter à une fiche</button>
        <button class="btn sm primary" data-act="owa-analyze">${ic('sparkle')}Analyser avec Orbiz</button>
      </div>
      <div class="owa-frame" id="owa-frame"><span class="muted" style="margin:auto">Chargement d'Outlook…</span></div>`;
    new ResizeObserver(() => requestAnimationFrame(place)).observe(frame());
    addEventListener('resize', () => requestAnimationFrame(place));
    const mo = new MutationObserver(() => requestAnimationFrame(place));
    mo.observe(document.getElementById('modal-root'), { childList: true });
    mo.observe(document.getElementById('drawer'), { attributes: true, attributeFilter: ['class'] });
  }

  function show(v) {
    const pane = document.getElementById('owa-pane');
    if (v) build();
    on = !!v;
    pane.classList.toggle('off', !on);
    requestAnimationFrame(place);
  }
  // ouvre une adresse dans Outlook
  function open(url) {
    if (!built) build();
    inv('owa_nav', { action: 'go', url });
  }

  // Lit le mail ouvert dans Outlook Web (au mieux : le texte sélectionné, sinon le volet de lecture).
  const READ_JS = `(() => {
    const sel = String(getSelection() || '').trim();
    const q = (s) => document.querySelector(s);
    const pane = q('[aria-label="Volet de lecture"]') || q('[aria-label="Reading Pane"]') || q('#ReadingPaneContainerId') || q('[data-app-section="ConversationContainer"]') || q('div[role="main"]');
    if (!pane && !sel) return null;
    const raw = pane ? pane.innerText : '';
    const bodyEl = pane && (pane.querySelector('[aria-label="Corps du message"]') || pane.querySelector('[aria-label="Message body"]') || pane.querySelector('div[role="document"]'));
    const h = pane && (pane.querySelector('[role="heading"][aria-level="2"]') || pane.querySelector('[role="heading"]'));
    const titled = pane ? [...pane.querySelectorAll('[title*="@"], [aria-label*="@"]')].map((e) => e.getAttribute('title') || e.getAttribute('aria-label')) : [];
    return { selection: sel, subject: h ? h.innerText.trim() : '', body: bodyEl ? bodyEl.innerText : '', raw: raw.slice(0, 30000), titled: titled.slice(0, 10) };
  })()`;

  async function readCurrent() {
    if (!built) return { error: "Outlook n'est pas ouvert." };
    const res = await inv('owa_read', { js: READ_JS });
    if (res.error) return { error: res.error };
    const r = res.value;
    if (!r) return { error: 'Ouvre d’abord un mail dans Outlook (ou sélectionne son texte).' };
    const me = (settings().owaMe || '').toLowerCase();
    const emails = [...new Set([...(r.titled || []).join(' ').matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g), ...(r.raw || '').matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0].toLowerCase()))].filter((e) => e !== me);
    const named = (r.raw || '').match(/([^\n<>]{2,60}?)\s*<([\w.+-]+@[\w-]+(?:\.[\w-]+)+)>/);
    const text = (r.selection || r.body || r.raw || '').replace(/\n{3,}/g, '\n\n').trim();
    return {
      subject: r.subject || '', from_email: named ? named[2].toLowerCase() : emails[0] || '', from_name: named ? named[1].trim() : '',
      emails, text: text.slice(0, 15000), from_selection: !!r.selection,
    };
  }

  const ACT = {
    'owa-back': () => inv('owa_nav', { action: 'back' }),
    'owa-reload': () => inv('owa_nav', { action: 'reload' }),
    'owa-home': () => inv('owa_nav', { action: 'go', url: homeUrl() }),
    'owa-create': async () => {
      const m = await readCurrent();
      if (m.error) return toast(m.error, { error: true });
      const subj = m.subject.replace(/^((re|tr|fwd?|fw)\s*:\s*)+/i, '');
      const mm = subj.match(/(?:booking|proposition|offre|offer|avails?|candidature|application)\s*[:\-–|]\s*([^\-–|:,(]{2,40})/i) || subj.match(/^([^\-–|:,(]{2,40})\s*[\-–|:]\s*(?:booking|proposition|offre|offer|avails?|tour|EPK)/i);
      const name = mm ? mm[1].trim() : (m.from_name && !/booking|agency|agence|management|prod|records|music|live|team|info|contact/i.test(m.from_name) ? m.from_name : '');
      newArtist({ name, contact: { name: m.from_name, email: m.from_email, agency: '', phone: '' }, source: `Mail${m.from_name || m.from_email ? ' de ' + (m.from_name || m.from_email) : ''} (${fmtDate(new Date())})`,
        notes: `Mail reçu${m.subject ? ` : « ${m.subject} »` : ''}\n\n${m.text.slice(0, 1200)}${m.text.length > 1200 ? '…' : ''}` });
      toast('Complète la fiche puis clique sur « Créer la fiche »');
    },
    'owa-note': async () => {
      const m = await readCurrent();
      if (m.error) return toast(m.error, { error: true });
      const sug = artists().find((a) => (a.contact.email && m.emails.includes(a.contact.email.toLowerCase())) || (a.name.length >= 4 && norm(m.subject + ' ' + m.text.slice(0, 3000)).includes(norm(a.name))));
      const draw = (q = '') => artists().filter((a) => !q || norm(a.name).includes(norm(q))).sort((a, b) => (b === sug) - (a === sug)).slice(0, 60)
        .map((a) => `<div class="it" data-pick="${a.id}">${avatar(a, 'sm')}<div class="tx"><b>${esc(a.name)}</b><span>${esc(a.styles.join(', '))}</span></div>${a === sug ? '<span class="pill st-contacte">Suggéré</span>' : ''}</div>`).join('') || '<p class="muted">Aucun artiste.</p>';
      modal({ title: 'Ajouter ce mail à une fiche', body: `<p class="muted" style="margin:0 0 10px">Le résumé du mail « ${esc(m.subject || 'sans objet')} » sera ajouté à l’historique de la fiche.</p><div class="search" style="margin-bottom:10px">${ic('search')}<input id="on-q" style="width:100%" placeholder="Chercher un artiste…"></div><div class="mini-list" id="on-list" style="max-height:50vh;overflow:auto">${draw()}</div>`,
        onMount: (w, close) => {
          const q = $('#on-q', w); q.focus(); q.oninput = () => ($('#on-list', w).innerHTML = draw(q.value));
          $('#on-list', w).onclick = (e) => {
            const it = e.target.closest('[data-pick]'); if (!it) return;
            const a = byId(it.dataset.pick);
            touch(a, `Mail${m.from_name || m.from_email ? ' de ' + (m.from_name || m.from_email) : ''} : « ${m.subject || 'sans objet'} »`);
            if (!a.contact.email && m.from_email) a.contact.email = m.from_email;
            a.notes = (a.notes ? a.notes + '\n\n' : '') + `[${fmtDate(new Date())}] ${m.subject || 'Mail'} :\n${m.text.slice(0, 800)}${m.text.length > 800 ? '…' : ''}`;
            touch(a); close(); toast(`Ajouté à la fiche de ${a.name}`, { action: 'Voir', onAction: () => openArtist(a.id) });
          };
        } });
    },
    'owa-analyze': async () => {
      const m = await readCurrent();
      if (m.error) return toast(m.error, { error: true });
      const r = await window.bv.ask(`Analyse ce mail reçu par la programmation du festival ${settings().edition || ''}.\nObjet : ${m.subject || '?'}\nDe : ${m.from_name} <${m.from_email}>\n\n${m.text.slice(0, 8000)}\n\n---\nRésume-le en quelques lignes (qui écrit, quel artiste, style, origine, dates, cachet et conditions, ce qu'on attend de nous). Si c'est une proposition d'artiste : vérifie avec irisprog__list_artists s'il existe déjà, sinon propose de créer la fiche avec irisprog__add_artist. Termine par la réponse que tu me conseilles.`, true);
      if (r && r.error) toast(r.error, { error: true });
    },
    'owa-choose': (el) => {
      const st = settings();
      st.mailMode = 'web'; st.owaUrl = URLS[el.dataset.k].url; save();
      if (built) inv('owa_nav', { action: 'go', url: st.owaUrl });
      $$('.modal-wrap').forEach((x) => x.remove());
      go('mail');
    },
    'owa-leave': async () => {
      if (!(await confirmBox('Revenir à la connexion avancée (IMAP) ? Ta session Outlook intégrée reste ouverte pour plus tard.', 'Continuer', false))) return;
      settings().mailMode = 'imap'; save(); go('mail');
    },
    'owa-logout': async () => {
      if (!(await confirmBox('Se déconnecter d’Outlook dans l’app ?', 'Se déconnecter'))) return;
      await inv('owa_clear', { home: homeUrl() });
      toast('Déconnecté d’Outlook');
    },
  };

  const chooser = () => `<div class="card panel" style="margin-bottom:16px;border-color:var(--accent)">
      <h2>${ic('mail')}Le plus simple : Outlook intégré</h2>
      <p style="margin:0 0 14px;line-height:1.55">Outlook s'ouvre directement dans le logiciel et tu te connectes normalement, avec ton mot de passe. Tu restes connecté d'une fois à l'autre. Des boutons permettent de créer une fiche artiste ou d'analyser avec Orbiz le mail que tu as sous les yeux.</p>
      <div class="row-actions">${Object.entries(URLS).map(([k, v]) => `<button class="btn ${k === 'pro' ? 'primary' : ''}" data-act="owa-choose" data-k="${k}">${esc(v.l)}</button>`).join('')}</div></div>`;

  window.Owa = { ACT, show, open, readCurrent, chooser, URLS, active: () => settings().mailMode === 'web' };
})();
