// Boîte mail intégrée : configuration, liste, lecture, rédaction, liens avec les fiches artistes.
(function () {
  const M = {
    acc: null, presets: {}, folders: [], folder: 'INBOX', lists: {}, filter: 'all', q: '',
    sel: null, msg: null, loadingMsg: false, syncing: false, err: null, lastSync: null,
  };
  const api = window.bv.mail;

  const CATS = [
    { k: 'booking', l: 'Booking', re: /\b(booking|book|proposition|propos|offre|offer|avails?|availability|disponib|routing|tourn[ée]e|tour\b|on tour|cachet|fee|guarantee|festival slot|plateau|line-?up|EPK|press kit|headline|support act|date (?:libre|available))/i },
    { k: 'candidature', l: 'Candidature', re: /\b(candidature|postul|application|apply|d[ée]mo\b|demo\b|notre groupe|our band|jouer (?:à|au|chez)|play at|jeune groupe|artiste émergent|soundcloud\.com|bandcamp\.com)/i },
    { k: 'admin', l: 'Admin / Contrat', re: /\b(facture|invoice|contrat|contract|rider|fiche technique|tech(?:nical)? rider|paiement|payment|devis|quote|assurance|SUISA|TVA|VAT|accr[ée]ditation)/i },
    { k: 'presse', l: 'Presse / Partenaires', re: /\b(presse|press|journaliste|interview|m[ée]dia|sponsor|partenariat|partnership|communiqu[ée])/i },
  ];
  const CAT_L = Object.fromEntries([...CATS.map((c) => [c.k, c.l]), ['autre', 'Autre']]);

  function category(m) {
    if (m._cat) return m._cat;
    const t = `${m.subject || ''} ${m.snippet || ''}`;
    const c = CATS.find((x) => x.re.test(m.subject || '')) || CATS.find((x) => x.re.test(t));
    return (m._cat = c ? c.k : 'autre');
  }

  // ---------- correspondances mails ↔ artistes ----------
  const reCache = new Map();
  function nameRe(name) {
    if (!reCache.has(name)) {
      const n = norm(name);
      reCache.set(name, n.length >= 4 ? new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`) : null);
    }
    return reCache.get(name);
  }
  function matches(m, a, folder) {
    if (a.mailLinks.some((l) => l.uid === m.uid && (l.folder || 'INBOX') === folder)) return 'manual';
    const em = (a.contact.email || '').toLowerCase().trim();
    const me = M.acc && M.acc.email.toLowerCase();
    if (em && em !== me) {
      if (m.from && m.from.address === em) return 'email';
      if ((m.to || []).some((t) => t && t.address === em)) return 'email';
    }
    const re = nameRe(a.name);
    if (re && re.test(norm(`${m.subject} ${m.snippet || ''}`))) return 'name';
    return null;
  }
  const artistsFor = (m, folder = M.folder) => artists().filter((a) => matches(m, a, folder));
  function mailsForArtist(a) {
    const out = [];
    Object.entries(M.lists).forEach(([folder, l]) => (l.messages || []).forEach((m) => { const k = matches(m, a, folder); if (k) out.push({ ...m, folder, manual: k === 'manual' }); }));
    // liens manuels vers des mails qui ne sont plus dans le cache
    a.mailLinks.forEach((l) => { if (!out.some((m) => m.uid === l.uid && m.folder === (l.folder || 'INBOX'))) out.push({ ...l, folder: l.folder || 'INBOX', manual: true }); });
    return out.sort((x, y) => new Date(y.date) - new Date(x.date));
  }

  const inbox = () => (M.lists.INBOX && M.lists.INBOX.messages) || [];
  const cur = () => (M.lists[M.folder] && M.lists[M.folder].messages) || [];
  const unreadCount = () => inbox().filter((m) => !m.seen).length;
  const sentFolder = () => (M.folders.find((f) => f.specialUse === '\\Sent') || {}).path;

  function visible() {
    const q = norm(M.q);
    return cur().filter((m) => {
      if (M.filter === 'unread' && m.seen) return false;
      if (M.filter === 'flagged' && !m.flagged) return false;
      if (M.filter === 'linked' && !artistsFor(m).length) return false;
      if (CAT_L[M.filter] && M.filter !== 'all' && category(m) !== M.filter) return false;
      if (q && !norm(`${m.subject} ${m.from && m.from.name} ${m.from && m.from.address} ${m.snippet || ''}`).includes(q)) return false;
      return true;
    });
  }

  const who = (a) => (a ? a.name || a.address : '');
  function relDate(d) {
    const x = new Date(d), now = new Date();
    if (x.toDateString() === now.toDateString()) return x.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (x.toDateString() === y.toDateString()) return 'Hier';
    if (now - x < 6 * 864e5) return x.toLocaleDateString('fr-CH', { weekday: 'short' });
    return x.toLocaleDateString('fr-CH', { day: 'numeric', month: 'short', year: x.getFullYear() === now.getFullYear() ? undefined : '2-digit' });
  }
  const sizeTxt = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' Mo' : Math.max(1, Math.round(n / 1e3)) + ' ko');
  const avatarFor = (addr) => `<div class="av" style="background:${STYLE_COLORS[hashN((addr && addr.address) || '') % STYLE_COLORS.length]}">${esc(initials(who(addr)))}</div>`;

  // ---------- rendu ----------
  function render(v) {
    if (!M.acc) { v.innerHTML = `<div class="page setup">${head('Mails', 'Connecte la boîte mail du festival pour lire et répondre aux propositions sans quitter le logiciel')}${Owa.chooser()}<details class="card panel"><summary style="cursor:pointer;font-weight:600">Connexion avancée (IMAP) : tri automatique des mails, mais configuration plus technique</summary><div style="margin-top:14px">${setupForm()}</div></details></div>`; mountSetup(v); return; }
    v.innerHTML = `<div class="mailhead"><h1>Mails</h1><span class="sync" id="m-sync"></span><div style="flex:1"></div>
      <button class="btn" data-act="m-analyze-unread">${ic('sparkle')}Faire le tri avec Orbiz</button>
      <button class="btn" data-act="m-sync" id="m-sync-btn">${ic('refresh')}Relever</button>
      <button class="btn primary" data-act="m-compose">${ic('edit')}Nouveau mail</button></div>
      <div id="m-load"></div>
      <div class="mailview"><nav class="mfolders" id="m-folders"></nav><section class="mlist" id="m-list"><div class="msearch"><div class="search">${ic('search')}<input id="m-q" placeholder="Rechercher dans les mails…" value="${esc(M.q)}" data-input="m-q"></div></div><div id="m-rows"></div></section><section class="mread" id="m-read"></section></div>`;
    renderHead(); renderFolders(); renderList(); renderReader();
  }
  const inMail = () => S.view === 'mail' && M.acc && $('#m-list');

  function renderHead() {
    if (!inMail()) return;
    const s = $('#m-sync');
    s.innerHTML = M.err ? `<span style="color:var(--bad)">${esc(M.err)}</span>` : M.syncing ? 'Relève en cours…' : M.lastSync ? `${esc(M.acc.email)} · relevé à ${new Date(M.lastSync).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}` : esc(M.acc.email);
    $('#m-load').innerHTML = M.syncing || M.loadingMsg ? '<div class="loadline"></div>' : '';
    const b = $('#m-sync-btn'); b.disabled = M.syncing; b.innerHTML = M.syncing ? '<span class="spin"></span>Relève…' : `${ic('refresh')}Relever`;
  }

  function renderFolders() {
    if (!inMail()) return;
    const msgs = cur();
    const cnt = (k) => msgs.filter((m) => category(m) === k).length;
    const fIcon = { '\\Inbox': 'inbox', '\\Sent': 'send', '\\Drafts': 'draft', '\\Trash': 'trash', '\\Junk': 'spam', '\\Archive': 'archive', '\\Flagged': 'flag' };
    const folders = M.folders.length ? M.folders : [{ path: 'INBOX', name: 'Boîte de réception', specialUse: '\\Inbox' }];
    const fb = (k, l, n, dot) => `<button class="${M.filter === k ? 'on' : ''}" data-act="m-filter" data-filter="${k}">${dot ? `<span class="cdot" style="background:${dot}"></span>` : ''}${l}${n != null ? `<span class="n">${n}</span>` : ''}</button>`;
    $('#m-folders').innerHTML = `<div class="grp">Dossiers</div>${folders.map((f) => `<button class="${M.folder === f.path ? 'on' : ''}" data-act="m-folder" data-path="${esc(f.path)}">${ic(fIcon[f.specialUse] || 'folder')}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span>${f.path === 'INBOX' && unreadCount() ? `<span class="n">${unreadCount()}</span>` : ''}</button>`).join('')}
      <div class="grp">Trier</div>${fb('all', 'Tous les mails', msgs.length)}${fb('unread', 'Non lus', msgs.filter((m) => !m.seen).length)}${fb('linked', 'Liés à un artiste', msgs.filter((m) => artistsFor(m).length).length)}${fb('flagged', 'Suivis', msgs.filter((m) => m.flagged).length)}
      <div class="grp">Catégories</div>${fb('booking', 'Booking', cnt('booking'), 'var(--accent)')}${fb('candidature', 'Candidatures', cnt('candidature'), 'var(--violet)')}${fb('admin', 'Admin / Contrat', cnt('admin'), 'var(--warn)')}${fb('presse', 'Presse / Partenaires', cnt('presse'), 'var(--cyan)')}${fb('autre', 'Autres', cnt('autre'), 'var(--line-strong)')}`;
  }

  function renderList() {
    if (!inMail()) return;
    const list = visible();
    const el = $('#m-rows');
    const st = $('#m-list').scrollTop;
    el.innerHTML = `${list.length ? list.map((m) => {
        const as = artistsFor(m), c = category(m);
        return `<div class="mrow ${m.seen ? '' : 'unread'} ${M.sel === m.uid ? 'on' : ''}" data-act="m-open" data-uid="${m.uid}">
          <div class="l1"><span class="fr">${esc(M.folder === sentFolder() ? 'À : ' + (m.to || []).map(who).join(', ') : who(m.from))}</span><span class="icons">${m.attachments ? ic('clip') : ''}${m.flagged ? ic('flag') : ''}${m.answered ? ic('reply') : ''}</span><span class="dt">${relDate(m.date)}</span></div>
          <div class="sj">${esc(m.subject)}</div>${m.snippet ? `<div class="sn">${esc(m.snippet)}</div>` : ''}
          ${c !== 'autre' || as.length ? `<div class="l3">${c !== 'autre' ? `<span class="tag cat-${c}">${CAT_L[c]}</span>` : ''}${as.slice(0, 3).map((a) => `<span class="tag artist">${ic('music')}${esc(a.name)}</span>`).join('')}</div>` : ''}
        </div>`;
      }).join('') : `<div class="empty" style="padding:40px 20px">${ic('inbox')}<p style="margin-top:10px">${cur().length ? 'Aucun mail ne correspond.' : M.syncing ? 'Relève en cours…' : 'Aucun mail dans ce dossier.'}</p></div>`}`;
    $('#m-list').scrollTop = st;
  }

  function renderReader() {
    if (!inMail()) return;
    const el = $('#m-read');
    const m = M.msg;
    if (!m) { el.innerHTML = `<div class="mempty"><div style="text-align:center">${ic('envopen')}<p>${M.loadingMsg ? 'Chargement…' : 'Sélectionne un mail pour le lire'}</p></div></div>`; return; }
    const meta = cur().find((x) => x.uid === m.uid) || {};
    const as = artistsFor({ ...meta, ...m, from: m.from[0], snippet: m.text.slice(0, 2000) });
    const fromA = m.from[0] || {};
    const looksProposal = ['booking', 'candidature'].includes(category({ subject: m.subject, snippet: m.text.slice(0, 1500) }));
    el.innerHTML = `<div class="rh"><h2>${esc(m.subject)}</h2>
      <div class="who">${avatarFor(fromA)}<div class="tx"><b>${esc(fromA.name || fromA.address)}</b><span>${esc(fromA.address)} → ${esc(m.to.map(who).join(', '))}${m.cc.length ? ` · cc ${esc(m.cc.map(who).join(', '))}` : ''}</span></div><span class="muted" style="font-size:12.5px;white-space:nowrap">${new Date(m.date).toLocaleString('fr-CH', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
      <div class="acts"><button class="btn sm" data-act="m-reply">${ic('reply')}Répondre</button><button class="btn sm" data-act="m-forward">${ic('forward')}Transférer</button>
        <button class="btn sm ghost" data-act="m-unread">${ic('mail')}Marquer non lu</button><button class="btn sm ghost" data-act="m-flag">${ic('flag')}${meta.flagged ? 'Ne plus suivre' : 'Suivre'}</button><button class="btn sm ghost danger" data-act="m-trash">${ic('trash')}Supprimer</button></div>
      <div class="assist">${as.length ? `<span>Artiste${as.length > 1 ? 's' : ''} :</span>${as.map((a) => `<span class="tag artist" data-act="open-artist" data-id="${a.id}">${ic('music')}${esc(a.name)}${stOf(a) ? ' · ' + esc(STATUS_L[stOf(a)]) : ''}</span>`).join('')}` : `<span class="muted">${looksProposal ? 'Ça ressemble à une proposition, aucun artiste lié.' : 'Aucun artiste lié.'}</span>`}
        <span class="sp"></span><button class="btn sm" data-act="m-link">${ic('link')}Lier à un artiste</button><button class="btn sm" data-act="m-create">${ic('plus')}Créer la fiche</button><button class="btn sm primary" data-act="m-analyze">${ic('sparkle')}Analyser avec Orbiz</button></div></div>
      ${m.attachments.length ? `<div class="atts">${m.attachments.map((a) => `<span class="att">${ic('clip')}<span>${esc(a.filename)}</span><span class="sz">${sizeTxt(a.size)}</span><button class="btn sm ghost" data-act="m-att" data-i="${a.index}" data-mode="open">Ouvrir</button><button class="btn sm ghost icon" data-act="m-att" data-i="${a.index}" data-mode="save" title="Enregistrer">${ic('download')}</button></span>`).join('')}</div>` : ''}
      ${m.html ? '<div class="frame"><iframe sandbox="allow-popups allow-popups-to-escape-sandbox" id="m-frame"></iframe></div>' : `<pre class="txt">${linkify(m.text)}</pre>`}`;
    if (m.html) {
      $('#m-frame').srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'"><base target="_blank">
        <style>body{font-family:"Segoe UI",system-ui,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a;margin:20px 24px;word-wrap:break-word;background:#fff}img{max-width:100%;height:auto}table{max-width:100%}blockquote{border-left:3px solid #ddd;margin-left:0;padding-left:12px;color:#555}</style></head><body>${m.html.replace(/<script[\s\S]*?<\/script>/gi, '')}</body></html>`;
    }
  }
  const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<>"')]+)/g, '<a href="#" data-act="open-url" data-url="$1">$1</a>');

  // ---------- configuration du compte ----------
  let setupState = null;
  const MS_REDIRECT = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
  function setupForm() {
    const acc = M.acc || {};
    setupState = setupState || { preset: acc.preset || 'outlook', advanced: false, guide: !(acc.msClientId), ms: null };
    const p = M.presets[setupState.preset] || {};
    const oauth = !!p.oauth;
    const val = (k) => esc(acc[k] != null && acc.preset === setupState.preset ? acc[k] : p[k] != null ? p[k] : '');
    const msDone = setupState.ms || (acc.authType === 'oauth-ms' && acc.hasPassword ? { email: acc.email, saved: true } : null);
    const common = `
        <div class="field half"><label>Nom affiché à l'envoi</label><input id="su-name" value="${esc(acc.displayName || '')}" placeholder="Programmation du festival"></div>
        <div class="field half"></div>
        <div class="field full"><label>Signature</label><textarea id="su-sig" rows="3" placeholder="Prénom Nom&#10;Programmation – Nom du festival">${esc(acc.signature || '')}</textarea></div>`;
    const guide = `
      <div class="callout" style="margin:0 0 14px;background:var(--surface-2);border:1px solid var(--line)">
        <b>À faire une seule fois (5 minutes) : obtenir un « ID d'application » Microsoft</b> · <a href="#" data-act="m-guide">${setupState.guide ? 'masquer' : 'afficher le guide'}</a>
        ${setupState.guide ? `<ol style="margin:10px 0 0;padding-left:20px;line-height:1.7">
          <li>Ouvre <a href="#" data-act="open-url" data-url="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade">entra.microsoft.com → Inscriptions d'applications</a> et connecte-toi avec le compte Microsoft du festival (ou ton compte perso).</li>
          <li>Clique <b>« Nouvelle inscription »</b>. Nom : <code>IrisProg</code>. Types de comptes : <b>« Comptes dans un annuaire d'organisation et comptes Microsoft personnels »</b>.</li>
          <li>URI de redirection : choisis la plateforme <b>« Client public/natif (mobile et bureau) »</b> et colle :<br><code style="user-select:all">${MS_REDIRECT}</code> <a href="#" data-act="m-copy" data-text="${MS_REDIRECT}">copier</a></li>
          <li>Clique <b>« S'inscrire »</b>, puis copie l'<b>« ID d'application (client) »</b> affiché en haut et colle-le ci-dessous.</li>
        </ol>
        <p class="muted" style="margin:8px 0 0;font-size:12.5px">Si l'inscription est refusée (compte d'école ou d'entreprise verrouillé), demande à l'admin informatique de le faire ou d'autoriser l'app. Avec un compte perso @outlook/@hotmail, Microsoft peut demander de créer un compte Azure gratuit.</p>` : ''}
      </div>`;
    return `<div id="setup">
      <div class="field" style="margin-bottom:12px"><label>Fournisseur de la boîte mail</label>
      <div class="preset-grid">${Object.entries(M.presets).map(([k, v]) => `<button class="preset ${setupState.preset === k ? 'on' : ''}" data-act="m-preset" data-k="${k}">${esc(v.label)}</button>`).join('')}</div></div>
      <div class="callout" style="margin-bottom:14px">${esc(p.help || '')}</div>
      ${oauth ? `${guide}
      <div class="form" style="padding:0">
        <div class="field half"><label>ID d'application (client)</label><input id="su-cid" value="${esc(acc.msClientId || '')}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></div>
        <div class="field half"><label>Adresse mail <span class="muted">(facultatif, pré-remplit la connexion)</span></label><input id="su-email" type="email" value="${esc(acc.email || '')}" placeholder="prog@monfestival.ch"></div>
        <div class="field full"><div class="row-actions" style="align-items:center">
          <button class="btn ${msDone ? '' : 'primary'}" data-act="m-mslogin">${ic('user')}${msDone ? 'Changer de compte' : 'Se connecter avec Microsoft'}</button>
          ${msDone ? `<span class="pill st-confirme">Connecté : ${esc(msDone.email)}</span>` : '<span class="muted">Une fenêtre Microsoft va s’ouvrir : connecte-toi et accepte l’accès aux mails.</span>'}</div></div>
        ${common}
        <div class="field full"><a href="#" data-act="m-adv">${setupState.advanced ? 'Masquer' : 'Afficher'} les options avancées</a></div>
        <div class="field half" ${setupState.advanced ? '' : 'hidden'}><label>Annuaire (tenant)</label><input id="su-tenant" value="${esc(acc.msTenant || 'common')}"><div class="hint">Laisse « common », sauf si l'app a été inscrite pour « cette organisation uniquement » : mets alors l'ID de l'annuaire.</div></div>
      </div>` : `
      <div class="form" style="padding:0">
        <div class="field half"><label>Adresse mail</label><input id="su-email" type="email" value="${esc(acc.email || '')}" placeholder="prog@monfestival.ch"></div>
        <div class="field half"><label>Mot de passe ${acc.hasPassword && acc.authType !== 'oauth-ms' ? '<span class="muted">(laisser vide pour garder l’actuel)</span>' : ''}</label><input id="su-pass" type="password" placeholder="${acc.hasPassword && acc.authType !== 'oauth-ms' ? '••••••••' : ''}"></div>
        <div class="field half"><label>Identifiant <span class="muted">(si différent de l'adresse)</span></label><input id="su-user" value="${esc(acc.user || '')}"></div>
        ${common}
        <div class="field full"><a href="#" data-act="m-adv">${setupState.advanced ? 'Masquer' : 'Afficher'} les paramètres serveur</a></div>
        <div class="field third" ${setupState.advanced ? '' : 'hidden'}><label>Serveur IMAP</label><input id="su-ih" value="${val('imapHost')}"></div>
        <div class="field third" ${setupState.advanced ? '' : 'hidden'}><label>Port IMAP</label><input id="su-ip" type="number" value="${val('imapPort')}"></div>
        <div class="field third" ${setupState.advanced ? '' : 'hidden'}></div>
        <div class="field third" ${setupState.advanced ? '' : 'hidden'}><label>Serveur SMTP</label><input id="su-sh" value="${val('smtpHost')}"></div>
        <div class="field third" ${setupState.advanced ? '' : 'hidden'}><label>Port SMTP</label><input id="su-sp" type="number" value="${val('smtpPort')}"></div>
      </div>`}
      <div id="su-res" style="margin-top:14px"></div>
      <div class="row-actions" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-act="m-test">Tester la connexion</button><button class="btn primary" data-act="m-save">${ic('check')}Enregistrer et relever</button></div>
      <p class="muted" style="font-size:12.5px;margin:12px 0 0">${oauth ? 'Aucun mot de passe n’est stocké : seule une autorisation Microsoft, chiffrée par Windows, reste sur cet ordinateur. Tu peux la révoquer à tout moment depuis ton compte Microsoft.' : 'Le mot de passe est chiffré par Windows et reste sur cet ordinateur.'} Les mails sont lus directement sur le serveur (IMAP) : rien n'est supprimé ni déplacé sans ton action.</p></div>`;
  }
  function readSetup() {
    const p = M.presets[setupState.preset] || {};
    const g = (id) => ($('#' + id) ? $('#' + id).value.trim() : '');
    const base = { preset: setupState.preset, displayName: g('su-name'), signature: $('#su-sig') ? $('#su-sig').value : '' };
    if (p.oauth) {
      const ms = setupState.ms;
      return { ...base, authType: 'oauth-ms', email: (ms && ms.email) || g('su-email') || (M.acc && M.acc.email) || '', msClientId: g('su-cid'), msTenant: g('su-tenant') || 'common', _ready: !!ms || !!(M.acc && M.acc.authType === 'oauth-ms' && M.acc.hasPassword) };
    }
    return {
      ...base, authType: 'password', email: g('su-email'), password: $('#su-pass') ? $('#su-pass').value : '', user: g('su-user'),
      imapHost: g('su-ih') || p.imapHost, imapPort: Number(g('su-ip')) || p.imapPort, smtpHost: g('su-sh') || p.smtpHost, smtpPort: Number(g('su-sp')) || p.smtpPort,
    };
  }
  function mountSetup() {}
  function rerenderSetup() { const keep = readSetupSafe(); const s = $('#setup'); if (s) s.outerHTML = setupForm(); restoreSetup(keep); }

  // ---------- opérations ----------
  async function sync(folder = M.folder, quiet = false) {
    if (!M.acc || M.syncing) return;
    M.syncing = true; M.err = null; renderHead();
    const before = new Set(inbox().filter((m) => !m.seen).map((m) => m.uid));
    const r = await api.sync(folder);
    M.syncing = false;
    if (r.error) { M.err = r.error; renderHead(); if (!quiet) toast(r.error, { error: true }); return; }
    M.lists[folder] = r; M.lastSync = r.syncedAt;
    if (folder === 'INBOX') {
      const fresh = inbox().filter((m) => !m.seen && !before.has(m.uid));
      if (before.size || quiet) { if (fresh.length && quiet) toast(`${fresh.length} nouveau${fresh.length > 1 ? 'x' : ''} mail${fresh.length > 1 ? 's' : ''}`, { action: 'Voir', onAction: () => go('mail') }); }
    }
    afterChange();
    // textes des mails récents, pour les extraits, les catégories et Orbiz
    api.prefetch(folder).then((p) => { if (p && !p.error && p.messages) { M.lists[folder] = p; afterChange(); } });
    if (!M.folders.length || !quiet) api.folders().then((f) => { if (Array.isArray(f)) { M.folders = f; try { localStorage.setItem('bv-folders', JSON.stringify(f)); } catch {} renderFolders(); } });
  }
  function afterChange() {
    cur().forEach((m) => delete m._cat);
    renderHead(); renderFolders(); renderList(); renderNav();
    if (S.view === 'dashboard') render();
    if (S.drawer && !S.drawer.edit) refreshDrawer();
  }

  async function open(uid, folder = M.folder) {
    if (folder !== M.folder) { M.folder = folder; M.lists[folder] = M.lists[folder] || (await api.cached(folder)); }
    M.sel = uid; M.loadingMsg = true; M.msg = null;
    renderHead(); renderList(); renderReader();
    const r = await api.get(folder, uid, { markSeen: true });
    M.loadingMsg = false;
    if (r.error) { toast(r.error, { error: true }); renderHead(); renderReader(); return null; }
    if (M.sel !== uid) return r;
    M.msg = r;
    const meta = cur().find((m) => m.uid === uid); if (meta) { meta.seen = true; meta.snippet = meta.snippet || r.snippet; }
    renderHead(); renderFolders(); renderList(); renderReader(); renderNav();
    return r;
  }

  function linkPicker(m, folder) {
    const meta = { uid: m.uid, folder, messageId: m.messageId, subject: m.subject, from: m.from[0] || m.from, date: m.date };
    const draw = (q = '') => artists().filter((a) => !q || norm(a.name).includes(norm(q))).slice(0, 60).map((a) => {
      const on = a.mailLinks.some((l) => l.uid === m.uid && (l.folder || 'INBOX') === folder);
      return `<div class="it" data-pick="${a.id}">${avatar(a, 'sm')}<div class="tx"><b>${esc(a.name)}</b><span>${esc(a.styles.join(', '))}</span></div>${on ? `<span class="pill st-confirme">Lié</span>` : ''}</div>`;
    }).join('') || '<p class="muted">Aucun artiste.</p>';
    modal({ title: 'Lier ce mail à un artiste', body: `<div class="search" style="margin-bottom:10px">${ic('search')}<input id="lp-q" style="width:100%" placeholder="Chercher un artiste…"></div><div class="mini-list" id="lp-list" style="max-height:50vh;overflow:auto">${draw()}</div>`,
      onMount: (w, close) => {
        const q = $('#lp-q', w); q.focus();
        q.oninput = () => ($('#lp-list', w).innerHTML = draw(q.value));
        $('#lp-list', w).onclick = (e) => {
          const it = e.target.closest('[data-pick]'); if (!it) return;
          const a = byId(it.dataset.pick);
          const i = a.mailLinks.findIndex((l) => l.uid === m.uid && (l.folder || 'INBOX') === folder);
          if (i >= 0) { a.mailLinks.splice(i, 1); touch(a); toast(`Mail délié de ${a.name}`); }
          else { a.mailLinks.push(meta); touch(a, `Mail lié : « ${m.subject} »`); toast(`Mail lié à ${a.name}`); }
          close(); renderReader(); renderList(); renderFolders();
        };
      } });
  }

  function guessName(m) {
    const f = m.from[0] || {};
    const subj = m.subject.replace(/^(re|tr|fwd?|fw)\s*:\s*/i, '');
    const mm = subj.match(/(?:booking|proposition|offre|offer|avails?|candidature|application)\s*[:\-–|]\s*([^\-–|:,(]{2,40})/i) || subj.match(/^([^\-–|:,(]{2,40})\s*[\-–|:]\s*(?:booking|proposition|offre|offer|avails?|tour|EPK)/i);
    if (mm) return mm[1].trim();
    if (f.name && !/booking|agency|agence|management|mgmt|prod|records|music|live|team|info|contact/i.test(f.name)) return f.name;
    return '';
  }

  function fill(t, a) {
    const st = settings();
    const dates = st.dateStart ? (st.dateEnd && st.dateEnd !== st.dateStart ? `du ${fmtDate(st.dateStart, { day: 'numeric', month: 'long' })} au ${fmtDate(st.dateEnd, { day: 'numeric', month: 'long', year: 'numeric' })}` : `le ${fmtDate(st.dateStart, { day: 'numeric', month: 'long', year: 'numeric' })}`) : 'en 2027';
    return t.replace(/\{artiste\}/g, a ? a.name : '[artiste]').replace(/\{festival\}/g, st.edition || 'le festival').replace(/\{dates\}/g, dates);
  }

  // Fenêtre de rédaction
  function compose(o = {}) {
    if (window.Owa && Owa.active()) {
      const base = (settings().owaUrl || '').includes('live.com') ? 'https://outlook.live.com/mail/0/deeplink/compose' : 'https://outlook.cloud.microsoft/mail/deeplink/compose';
      const q = new URLSearchParams(); if (o.to) q.set('to', o.to); if (o.subject) q.set('subject', o.subject); if (o.body) q.set('body', o.body);
      go('mail');
      setTimeout(() => Owa.open(`${base}?${q.toString()}`.replace(/\+/g, '%20')), 50);
      return;
    }
    if (!M.acc) { toast('Connecte d’abord la boîte mail (Paramètres → Boîte mail)', { error: true }); return go('mail'); }
    const files = [];
    const artist = o.artist || null;
    modal({
      title: o.title || 'Nouveau mail', wide: true,
      body: `<div class="form compose" style="padding:0">
        <div class="field half"><label>À</label><input id="c-to" value="${esc(o.to || '')}" placeholder="adresse@exemple.com (plusieurs : séparer par des virgules)"></div>
        <div class="field half"><label>Cc</label><input id="c-cc" value="${esc(o.cc || '')}"></div>
        <div class="field full"><label>Objet</label><input id="c-sub" value="${esc(o.subject || '')}"></div>
        <div class="field full"><label>Modèle <span class="muted">(remplace le texte)</span></label><select id="c-tpl" class="sel"><option value="">— Choisir un modèle de réponse —</option>${TEMPLATES.map((t) => `<option value="${t.k}">${esc(t.l)}</option>`).join('')}</select></div>
        <div class="field full"><label>Message</label><textarea id="c-body">${esc(o.body || '')}</textarea>${M.acc.signature ? '<div class="hint">Ta signature sera ajoutée automatiquement.</div>' : ''}</div>
        <div class="field full"><div class="attach-list" id="c-files"></div></div></div>`,
      foot: `<button class="btn" id="c-att">${ic('clip')}Joindre un fichier</button><button class="btn ghost" id="c-orbiz">${ic('sparkle')}Rédiger avec Orbiz</button><span class="sp"></span><button class="btn" data-close3>Annuler</button><button class="btn primary" id="c-send">${ic('send')}Envoyer</button>`,
      onMount: (w, close) => {
        const body = $('#c-body', w);
        if (o.focusBody !== false && o.to) { body.focus(); body.setSelectionRange(0, 0); } else $('#c-to', w).focus();
        const drawFiles = () => ($('#c-files', w).innerHTML = files.map((f, i) => `<span class="att" style="display:inline-flex;gap:6px;align-items:center;border:1px solid var(--line);border-radius:8px;padding:4px 6px 4px 10px">${ic('clip')}${esc(f.name)} <span class="muted">${sizeTxt(f.size)}</span><button class="btn sm ghost icon" data-rm="${i}">${ic('x')}</button></span>`).join(''));
        $('#c-files', w).onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { files.splice(Number(b.dataset.rm), 1); drawFiles(); } };
        $('#c-att', w).onclick = async () => { (await api.pickFiles()).forEach((f) => files.push(f)); drawFiles(); };
        $('[data-close3]', w).onclick = close;
        $('#c-tpl', w).onchange = (e) => {
          const t = TEMPLATES.find((x) => x.k === e.target.value); if (!t) return;
          const quote = o.quote ? '\n\n' + o.quote : '';
          body.value = fill(t.body, artist) + quote;
          if (!o.keepSubject) $('#c-sub', w).value = fill(t.subject, artist);
        };
        $('#c-orbiz', w).onclick = () => {
          window.bv.ask(`Aide-moi à rédiger un mail${artist ? ` à propos de l'artiste « ${artist.name} »` : ''}${o.replyUid ? ` en réponse au mail uid ${o.replyUid} (lis-le avec irisprog__read_email)` : ''}. Destinataire : ${$('#c-to', w).value || '?'}. Objet : ${$('#c-sub', w).value || '?'}. Brouillon actuel :\n${body.value.split('\n\n\nLe ')[0] || '(vide)'}\n\nPropose un texte clair et professionnel en français ; une fois que je valide, ouvre-le avec irisprog__draft_email.`, false);
        };
        $('#c-send', w).onclick = async () => {
          const to = $('#c-to', w).value.trim(); if (!to) return toast('Indique un destinataire', { error: true });
          const btn = $('#c-send', w); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Envoi…';
          const r = await api.send({ to, cc: $('#c-cc', w).value.trim(), subject: $('#c-sub', w).value, text: body.value, inReplyTo: o.inReplyTo, references: o.references, attachments: files.map((f) => f.path) });
          if (r.error) { btn.disabled = false; btn.innerHTML = `${ic('send')}Envoyer`; return toast(r.error, { error: true }); }
          close(); toast('Mail envoyé');
          const linked = artist ? [artist] : artists().filter((a) => a.contact.email && to.toLowerCase().includes(a.contact.email.toLowerCase()));
          linked.forEach((a) => touch(a, `Mail envoyé : « ${$('#c-sub', w).value} »`));
          if (o.replyUid) { const meta = inbox().find((m) => m.uid === o.replyUid); if (meta) meta.answered = true; renderList(); }
          if (S.drawer && !S.drawer.edit) refreshDrawer();
          const sf = sentFolder(); if (sf && M.lists[sf]) setTimeout(() => api.sync(sf).then((r2) => { if (!r2.error) M.lists[sf] = r2; }), 3000);
        };
      },
    });
  }

  function replyTo(m, forward = false) {
    const f = (m.replyTo && m.replyTo[0]) || m.from[0] || {};
    const d = new Date(m.date).toLocaleString('fr-CH', { dateStyle: 'long', timeStyle: 'short' });
    const quote = forward
      ? `---------- Message transféré ----------\nDe : ${who(m.from[0])} <${(m.from[0] || {}).address}>\nDate : ${d}\nObjet : ${m.subject}\nÀ : ${m.to.map((t) => t.address).join(', ')}\n\n${m.text}`
      : `Le ${d}, ${who(m.from[0])} <${(m.from[0] || {}).address}> a écrit :\n${m.text.split('\n').map((l) => '> ' + l).join('\n')}`;
    const as = artistsFor({ ...m, from: m.from[0], snippet: m.text.slice(0, 2000) });
    const subj = m.subject.replace(/^((re|tr|fwd?|fw)\s*:\s*)+/i, '');
    compose({
      title: forward ? 'Transférer' : 'Répondre', to: forward ? '' : f.address, subject: (forward ? 'Tr: ' : 'Re: ') + subj,
      body: '\n\n\n' + quote, quote, keepSubject: true, artist: as[0], replyUid: forward ? null : m.uid,
      inReplyTo: forward ? undefined : m.messageId, references: forward ? undefined : [...(m.references || []), m.messageId].filter(Boolean),
    });
  }

  // ---------- actions ----------
  const ACTM = {
    'm-folder': async (el) => {
      M.folder = el.dataset.path; M.sel = null; M.msg = null; M.filter = 'all';
      M.lists[M.folder] = M.lists[M.folder] || (await api.cached(M.folder));
      renderFolders(); renderList(); renderReader();
      sync(M.folder, true);
    },
    'm-filter': (el) => { M.filter = el.dataset.filter; renderFolders(); renderList(); },
    'mail-filter': (el) => { M.folder = 'INBOX'; M.filter = el.dataset.filter; go('mail'); },
    'm-open': (el) => open(Number(el.dataset.uid)),
    'open-mail': (el) => { M.filter = 'all'; go('mail'); closeDrawer(); open(Number(el.dataset.uid), el.dataset.folder || 'INBOX'); },
    'm-sync': () => sync(M.folder),
    'm-compose': () => compose(),
    'm-reply': () => M.msg && replyTo(M.msg),
    'm-forward': () => M.msg && replyTo(M.msg, true),
    'm-unread': async () => {
      const uid = M.msg.uid; const r = await api.flag(M.folder, uid, 'seen', false);
      if (r.error) return toast(r.error, { error: true });
      const meta = cur().find((m) => m.uid === uid); if (meta) meta.seen = false;
      M.sel = null; M.msg = null; renderFolders(); renderList(); renderReader(); renderNav();
    },
    'm-flag': async () => {
      const uid = M.msg.uid; const meta = cur().find((m) => m.uid === uid) || {};
      const r = await api.flag(M.folder, uid, 'flagged', !meta.flagged);
      if (r.error) return toast(r.error, { error: true });
      meta.flagged = !meta.flagged; renderFolders(); renderList(); renderReader();
    },
    'm-trash': async () => {
      if (!(await confirmBox('Mettre ce mail à la corbeille ?', 'Supprimer'))) return;
      const uid = M.msg.uid; const r = await api.trash(M.folder, uid);
      if (r.error) return toast(r.error, { error: true });
      M.lists[M.folder].messages = cur().filter((m) => m.uid !== uid);
      M.sel = null; M.msg = null; renderFolders(); renderList(); renderReader(); renderNav(); toast('Mail mis à la corbeille');
    },
    'm-att': async (el) => { const r = await api.attachment(M.folder, M.msg.uid, Number(el.dataset.i), el.dataset.mode); if (r && r.error) toast(r.error, { error: true }); },
    'm-link': () => linkPicker(M.msg, M.folder),
    'm-create': () => {
      const m = M.msg, f = m.from[0] || {};
      newArtist({ name: guessName(m), contact: { name: f.name || '', email: f.address || '', agency: '', phone: '' }, source: `Mail de ${f.name || f.address} (${fmtDate(m.date)})`, notes: `Mail reçu : « ${m.subject} »` },
        { uid: m.uid, folder: M.folder, messageId: m.messageId, subject: m.subject, from: f, date: m.date });
    },
    'm-analyze': () => {
      const m = M.msg;
      window.bv.ask(`Analyse le mail uid ${m.uid} (dossier ${M.folder}) « ${m.subject} » avec irisprog__read_email. Résume-le en quelques lignes (qui écrit, quel artiste, style, origine, dates, cachet et conditions demandés, ce qu'on attend de nous). Si c'est une proposition d'artiste : vérifie avec irisprog__list_artists s'il existe déjà, sinon propose de créer la fiche (irisprog__add_artist puis irisprog__link_email_to_artist). Termine par la réponse que tu me conseilles.`, true)
        .then((r) => r && r.error && toast(r.error, { error: true }));
    },
    'm-analyze-unread': () => {
      window.bv.ask(`Fais le tri dans ma boîte mail du festival : utilise irisprog__list_emails (non lus d'abord, puis catégories booking et candidature), lis ceux qui comptent avec irisprog__read_email, et donne-moi un récap court : propositions d'artistes intéressantes (style, origine, cachet), ce qui demande une réponse rapide, et ce qui peut attendre. Propose ensuite de créer les fiches des artistes proposés.`, true)
        .then((r) => r && r.error && toast(r.error, { error: true }));
    },
    'm-preset': (el) => { setupState.preset = el.dataset.k; rerenderSetup(); },
    'm-adv': (el, e) => { e.preventDefault(); setupState.advanced = !setupState.advanced; rerenderSetup(); },
    'm-guide': (el, e) => { e.preventDefault(); setupState.guide = !setupState.guide; rerenderSetup(); },
    'm-copy': (el, e) => { e.preventDefault(); navigator.clipboard.writeText(el.dataset.text).then(() => toast('Copié')); },
    'm-mslogin': async (el) => {
      const cfg = readSetup();
      if (!/^[0-9a-f-]{36}$/i.test(cfg.msClientId)) return toast("Colle d'abord l'ID d'application (voir le guide)", { error: true });
      el.disabled = true; el.innerHTML = '<span class="spin"></span>Connexion en cours…';
      const r = await api.msLogin({ clientId: cfg.msClientId, tenant: cfg.msTenant, hint: $('#su-email') ? $('#su-email').value.trim() : '' });
      if (r.error) { el.disabled = false; el.innerHTML = `${ic('user')}Se connecter avec Microsoft`; $('#su-res').innerHTML = `<div class="callout bad">${esc(r.error)}</div>`; return; }
      setupState.ms = { email: r.email, name: r.name };
      rerenderSetup();
      $('#su-res').innerHTML = `<div class="callout good">Connecté en tant que <b>${esc(r.email)}</b>. Clique sur « Enregistrer et relever ».</div>`;
      if ($('#su-name') && !$('#su-name').value && r.name) $('#su-name').value = r.name;
    },
    'm-test': async (el) => {
      const cfg = readSetup();
      if (cfg.authType === 'oauth-ms' && !cfg._ready) return toast('Connecte-toi d’abord avec Microsoft', { error: true });
      if (!cfg.email) return toast('Indique l’adresse mail', { error: true });
      el.disabled = true; el.innerHTML = '<span class="spin"></span>Test…';
      const { _ready, ...cfgOut } = cfg; const r = await api.test(cfgOut);
      el.disabled = false; el.textContent = 'Tester la connexion';
      const ok = r.imap === 'ok' && r.smtp === 'ok';
      $('#su-res').innerHTML = r.error ? `<div class="callout bad">${esc(r.error)}</div>` : `<div class="callout ${ok ? 'good' : 'bad'}"><b>Réception (IMAP) :</b> ${r.imap === 'ok' ? 'OK ✓' : esc(r.imap)}<br><b>Envoi (SMTP) :</b> ${r.smtp === 'ok' ? 'OK ✓' : esc(r.smtp)}</div>`;
    },
    'm-save': async (el) => {
      const cfg = readSetup();
      if (cfg.authType === 'oauth-ms') { if (!cfg._ready) return toast('Connecte-toi d’abord avec Microsoft', { error: true }); }
      else {
        if (!cfg.email || !cfg.imapHost) return toast('Adresse et serveur obligatoires', { error: true });
        if (!cfg.password && !(M.acc && M.acc.hasPassword && M.acc.authType !== 'oauth-ms')) return toast('Indique le mot de passe', { error: true });
      }
      el.disabled = true; el.innerHTML = '<span class="spin"></span>Connexion…';
      const { _ready, ...cfgOut } = cfg;
      const t = await api.test(cfgOut);
      if (t.imap !== 'ok') { el.disabled = false; el.innerHTML = `${ic('check')}Enregistrer et relever`; $('#su-res').innerHTML = `<div class="callout bad"><b>Impossible de se connecter :</b> ${esc(t.imap || t.error)}</div>`; return; }
      M.acc = await api.saveAccount(cfgOut);
      setupState = null;
      $$('.modal-wrap').forEach((w) => w.remove());
      toast(t.smtp === 'ok' ? 'Boîte mail connectée' : `Réception OK, mais l'envoi a échoué : ${t.smtp}`, { error: t.smtp !== 'ok' });
      M.lists = {}; M.folder = 'INBOX'; M.sel = null; M.msg = null;
      go('mail'); sync('INBOX');
    },
    'mail-setup': () => { setupState = null; modal({ title: 'Boîte mail', wide: true, body: setupForm() }); },
    'mail-remove': async () => {
      if (!(await confirmBox('Déconnecter la boîte mail ? Le cache local des mails sera effacé (les mails restent sur le serveur).', 'Déconnecter'))) return;
      await api.removeAccount(); M.acc = null; M.lists = {}; M.folders = []; M.msg = null; M.sel = null; render(); toast('Boîte mail déconnectée');
    },
  };
  function readSetupSafe() { try { return readSetup(); } catch { return null; } }
  function restoreSetup(c) {
    if (!c) return;
    const set = (id, v) => { const e = $('#' + id); if (e && v != null) e.value = v; };
    set('su-email', c.email); set('su-pass', c.password); set('su-name', c.displayName); set('su-user', c.user); set('su-sig', c.signature); set('su-cid', c.msClientId); set('su-tenant', c.msTenant);
    set('su-ih', c.imapHost); set('su-ip', c.imapPort); set('su-sh', c.smtpHost); set('su-sp', c.smtpPort);
  }

  // ---------- démarrage ----------
  async function init() {
    M.presets = await api.presets();
    M.acc = await api.account();
    try { M.folders = JSON.parse(localStorage.getItem('bv-folders') || '[]'); } catch { M.folders = []; }
    if (!M.acc) return;
    M.lists.INBOX = await api.cached('INBOX');
    M.lastSync = M.lists.INBOX.syncedAt;
    const sf = sentFolder(); if (sf) M.lists[sf] = await api.cached(sf);
    setTimeout(() => sync('INBOX', true).then(() => { const s = sentFolder(); if (s) api.sync(s).then((r) => { if (!r.error) { M.lists[s] = r; if (S.drawer) refreshDrawer(); } }); }), 400);
    setInterval(() => { if (M.acc) sync('INBOX', true); }, 4 * 60 * 1000);
  }

  window.Mail = {
    init, render, ACT: ACTM, compose,
    account: () => M.acc,
    hasAccount: () => !!M.acc,
    unreadCount,
    countCategory: (k) => inbox().filter((m) => category(m) === k).length,
    recentProposals: (n) => inbox().filter((m) => ['booking', 'candidature'].includes(category(m))).slice(0, n),
    mailsForArtist,
    onInput(el) { if (el.dataset.input === 'm-q') { M.q = el.value; renderList(); return true; } return false; },
    onChange() { return false; },
    // pour l'assistant (agent.js)
    _state: M, category, CAT_L, artistsFor, open, sync, linkPicker, replyTo, inbox, cur,
    list(folder = 'INBOX') { return (M.lists[folder] && M.lists[folder].messages) || []; },
    async ensureList(folder) { if (!M.lists[folder]) M.lists[folder] = await api.cached(folder); return M.lists[folder].messages || []; },
  };
})();
