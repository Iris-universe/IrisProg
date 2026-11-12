// IrisProg : état, artistes, fiche, pipeline, tableau de bord, paramètres, exports.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const norm = (s) => String(s || '').normalize('NFKC').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const nf = new Intl.NumberFormat('fr-CH');
const money = (n, cur = 'CHF') => (n == null || n === '' || isNaN(n) ? '' : `${nf.format(Math.round(n))} ${cur}`);
const fmtDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => (d ? new Date(d).toLocaleDateString('fr-CH', opts) : '');

const S = {
  data: { artists: [], settings: { ...DEFAULT_SETTINGS } },
  view: 'dashboard',
  f: { styles: [], status: '', via: '', q: '', country: '', minPrio: 0, period: '', from: '', to: '', pop: '', sort: 'recent' },
  layout: 'grid',
  pf: { q: '', status: '', layout: 'board' }, // vue Propositions
  drawer: null, // { id, edit, draft }
  sel: null, // mode sélection (vue Artistes) : Set d'ids, null = désactivé
  selLast: null,
  openSecs: new Set(), // sections repliables ouvertes dans la fiche
  player: null, // { id, k } lecteur choisi dans la fiche
};

// ---------- persistance ----------
let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => window.bv.save(S.data), 300);
}
const settings = () => S.data.settings;
const artists = () => S.data.artists;
const byId = (id) => artists().find((a) => a.id === id);
// Propositions : liste à part des artistes proposés pour l'édition en cours (la base d'artistes reste générale)
const edition = () => settings().edition || 'Festival';
const proposals = () => (S.data.proposals = S.data.proposals || []);
const propOf = (a) => (a ? proposals().find((p) => p.artistId === a.id && p.edition === edition()) : null);
const stOf = (a) => { const p = propOf(a); return p ? p.status : ''; };
const proposedArtists = () => artists().filter((a) => propOf(a));
function propose(a, status = 'proposition', quiet = false) {
  let p = propOf(a);
  if (p) p.status = status;
  else { p = { id: uid(), artistId: a.id, edition: edition(), status, addedAt: new Date().toISOString() }; proposals().push(p); if (!quiet) touch(a, `Ajouté aux propositions ${edition()}`); }
  save(); return p;
}
function unpropose(a) {
  const p = propOf(a); if (!p) return null;
  S.data.proposals = proposals().filter((x) => x !== p);
  touch(a, `Retiré des propositions ${edition()}`); return p;
}

function blankArtist() {
  return {
    id: uid(), name: '', photo: '', styles: [], country: '', city: '', formation: '', bio: '',
    status: 'proposition', priority: 0, source: '', foundVia: '', availability: '', listeners: null,
    links: { spotify: '', instagram: '', youtube: '', soundcloud: '', facebook: '', tiktok: '', website: '' },
    contact: { agency: '', name: '', email: '', phone: '' },
    fee: { amount: null, max: null, currency: 'CHF', type: 'fixe', includes: {}, notes: '' },
    notes: '', tags: [], history: [], mailLinks: [], messages: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}
function fixArtist(a) {
  const b = blankArtist();
  return { ...b, ...a, links: { ...b.links, ...(a.links || {}) }, contact: { ...b.contact, ...(a.contact || {}) }, fee: { ...b.fee, ...(a.fee || {}), includes: { ...((a.fee || {}).includes || {}) } },
    styles: a.styles || [], history: a.history || [], mailLinks: a.mailLinks || [], tags: a.tags || [], messages: a.messages || [] };
}
function touch(a, hist) {
  a.updatedAt = new Date().toISOString();
  if (hist) a.history.unshift({ d: a.updatedAt, t: hist });
  save();
}

// ---------- utilitaires d'affichage ----------
const styleColor = (s) => { const i = settings().styles.indexOf(s); return STYLE_COLORS[(i < 0 ? hashN(s) : i) % STYLE_COLORS.length]; };
function hashN(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
const initials = (n) => String(n || '?').replace(/[^\p{L}\p{N} &]/gu, '').split(/[\s&]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
function gradient(a) {
  const c1 = styleColor(a.styles[0] || a.name), c2 = STYLE_COLORS[(hashN(a.name) + 5) % STYLE_COLORS.length];
  return `linear-gradient(135deg, ${c1}, ${c2})`;
}
const bgOf = (a) => (a.photo ? `url("${String(a.photo).replace(/"/g, '%22')}") center/cover, ${gradient(a)}` : gradient(a));
const avatar = (a, cls = '') => `<div class="av ${cls}" style='background:${bgOf(a)}'>${a.photo ? '' : esc(initials(a.name))}</div>`;
// Popularité : audience cumulée (auditeurs mensuels Spotify + abonnés Instagram + abonnés SoundCloud)
const POP_TIERS = [[1000, 'Émergent'], [10000, 'Local'], [50000, 'Régional'], [250000, 'National'], [Infinity, 'Tête d’affiche']];
function popOf(a) {
  const p = a.popularity;
  if (!p || ['spotify', 'spotifyFollowers', 'instagram', 'soundcloud', 'youtube'].every((k) => p[k] == null)) return null;
  // audience cumulée : auditeurs mensuels Spotify (sinon abonnés Spotify) + Instagram + SoundCloud + YouTube
  const R = (p.spotify ?? p.spotifyFollowers ?? 0) + (p.instagram || 0) + (p.soundcloud || 0) + (p.youtube || 0);
  return { R, score: Math.min(100, Math.round((Math.log10(R + 1) / 6) * 100)), tier: POP_TIERS.find((t) => R < t[0])[1] };
}
const popTag = (a) => { const p = popOf(a); return p ? `<span class="tag pop" title="Popularité : audience cumulée ≈ ${nf.format(p.R)}">${ic('sparkle')}${esc(p.tier)} · ${p.score}</span>` : ''; };
const pill = (st) => (st ? `<span class="pill st-${st}" title="${esc(edition())}">${esc(STATUS_L[st] || st)}</span>` : '');
const styleTag = (s) => `<span class="tag"><span class="dot" style="background:${styleColor(s)}"></span>${esc(s)}</span>`;
const stars = (n) => `<span class="stars" title="Priorité ${n}/3">${[1, 2, 3].map((i) => `<svg viewBox="0 0 24 24" class="${i <= n ? '' : 'off'}"><path d="${STAR}"/></svg>`).join('')}</span>`;
const origin = (a) => [a.city, a.country].filter(Boolean).join(', ');
const toCHF = (amount, cur) => (amount == null || amount === '' ? null : Number(amount) * (settings().rates[cur || 'CHF'] || 1));
function feeText(a, short = false) {
  const f = a.fee || {};
  if (f.type === 'negocier' || (f.amount == null || f.amount === '')) return f.type === 'negocier' ? 'À négocier' : '';
  if (f.type === 'fourchette' && f.max) return `${nf.format(f.amount)}–${nf.format(f.max)} ${f.currency}`;
  return money(f.amount, f.currency);
}
const feeCHF = (a) => toCHF(a.fee && a.fee.amount, a.fee && a.fee.currency);

function toast(msg, opts = {}) {
  const t = document.createElement('div');
  t.className = 'toast' + (opts.error ? ' err' : '');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (opts.action) { const b = document.createElement('button'); b.textContent = opts.action; b.onclick = () => { opts.onAction(); t.remove(); }; t.appendChild(b); }
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), opts.ms || (opts.error ? 7000 : 3500));
}

// ---------- tâches longues (barre de progression, pilotable par Orbiz / scripts) ----------
// setProgress('photos', 'Recherche photos', 12, 121, 'Albert Chinet') ; done >= total ou hide=true pour la retirer
function setProgress(id, label, done, total, sub = '', hide = false) {
  const box = $('#jobs');
  let el = box.querySelector(`[data-job="${id}"]`);
  if (hide) { if (el) { el.classList.add('done'); setTimeout(() => el.remove(), 1500); } return true; }
  if (!el) { el = document.createElement('div'); el.className = 'job'; el.dataset.job = id; box.appendChild(el); }
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  el.innerHTML = `<div class="jt"><span class="spin"></span><span>${esc(label)}</span><span class="n">${done} / ${total} · ${pct} %</span></div><div class="jb"><i style="width:${pct}%"></i></div>${sub ? `<div class="js">${esc(sub)}</div>` : ''}`;
  return true;
}

// ---------- modales ----------
function modal({ title, body, foot = '', wide = false, onMount }) {
  const root = $('#modal-root');
  const w = document.createElement('div');
  w.className = 'modal-wrap';
  w.innerHTML = `<div class="modal ${wide ? 'wide' : ''}"><div class="mh"><h3>${title}</h3><button class="btn ghost icon sm" data-close>${ic('x')}</button></div><div class="mb">${body}</div>${foot ? `<div class="mf">${foot}</div>` : ''}</div>`;
  const close = () => w.remove();
  w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
  w.querySelector('[data-close]').onclick = close;
  root.appendChild(w);
  onMount && onMount(w, close);
  return { el: w, close };
}
function confirmBox(text, okLabel = 'Confirmer', danger = true) {
  return new Promise((res) => {
    modal({ title: 'Confirmation', body: `<p style="margin:0;line-height:1.5">${text}</p>`,
      foot: `<button class="btn" data-no>Annuler</button><button class="btn ${danger ? 'primary' : 'primary'}" data-yes>${esc(okLabel)}</button>`,
      onMount: (w, close) => { w.querySelector('[data-no]').onclick = () => { close(); res(false); }; w.querySelector('[data-yes]').onclick = () => { close(); res(true); }; } });
  });
}

// ---------- navigation ----------
const NAV = [
  { v: 'dashboard', l: 'Tableau de bord', i: 'dash' },
  { v: 'artists', l: 'Artistes', i: 'users' },
  { v: 'proposals', l: 'Propositions', i: 'board' },
  { v: 'timetable', l: 'Timetable', i: 'clock' },
  { v: 'mail', l: 'Mails', i: 'mail' },
  { v: 'settings', l: 'Paramètres', i: 'gear' },
];
function renderNav() {
  NAV.forEach((n) => {
    const b = $(`.nav [data-view="${n.v}"]`);
    let extra = '';
    if (n.v === 'artists') extra = `<span class="cnt">${artists().length}</span>`;
    if (n.v === 'proposals') extra = `<span class="cnt">${proposedArtists().length}</span>`;
    if (n.v === 'mail') { const u = window.Mail ? Mail.unreadCount() : 0; extra = u ? `<span class="badge">${u}</span>` : ''; }
    b.innerHTML = `${ic(n.i)}<span>${n.l}</span>${extra}`;
    b.classList.toggle('on', S.view === n.v || (n.v === 'proposals' && S.view === 'pipeline'));
  });
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#theme-btn').innerHTML = `${ic(dark ? 'sun' : 'moon')}<span>${dark ? 'Mode clair' : 'Mode sombre'}</span>`;
  $('[data-act="ask-orbiz"]').innerHTML = `${ic('sparkle')}<span>Demander à Orbiz</span>`;
  $('#brand-name').textContent = settings().edition || 'IrisProg';
  const st = settings();
  let cd = '';
  if (st.dateStart) {
    const days = Math.ceil((new Date(st.dateStart) - new Date(new Date().toDateString())) / 864e5);
    if (days >= 0) cd = `<div class="countdown"><b>J-${days}</b><span>avant le festival · ${fmtDate(st.dateStart, { day: 'numeric', month: 'long' })}</span></div>`;
  }
  $('#countdown').innerHTML = cd;
}

function go(view, opts = {}) {
  if (view !== S.view) S.sel = null;
  S.view = view;
  if (opts.filters) S.f = { ...S.f, ...opts.filters };
  render();
  $('#view').scrollTop = 0;
}

// Re-rendu en conservant le focus et le curseur du champ actif.
function render() {
  const a = document.activeElement;
  const keep = a && a.id && $('#view').contains(a) ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
  renderNav();
  const web = S.view === 'mail' && window.Owa && Owa.active();
  $('#view').hidden = web;
  if (window.Owa) Owa.show(web);
  if (web) return;
  const v = $('#view');
  const scr = $$('[data-keep-scroll]', v).map((el) => [el.dataset.keepScroll, el.scrollTop, el.scrollLeft]);
  if (S.view === 'settings' && !S.keys) loadKeysState().then(() => S.view === 'settings' && render());
  if (S.view === 'dashboard') v.innerHTML = viewDashboard();
  else if (S.view === 'artists') v.innerHTML = viewArtists();
  else if (S.view === 'pipeline' || S.view === 'proposals') v.innerHTML = viewProposals();
  else if (S.view === 'mail') Mail.render(v);
  else if (S.view === 'settings') v.innerHTML = viewSettings();
  else if (S.view === 'timetable') v.innerHTML = TT.view();
  scr.forEach(([k, t, l]) => { const el = $(`[data-keep-scroll="${k}"]`, v); if (el) { el.scrollTop = t; el.scrollLeft = l; } });
  if (keep) { const el = document.getElementById(keep.id); if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch {} } }
}

// ---------- filtres ----------
function filtered(list = artists(), f = S.f) {
  const q = norm(f.q);
  let r = list.filter((a) =>
    (!f.styles.length || f.styles.some((s) => a.styles.includes(s))) &&
    (!f.status || (f.status === 'in' ? !!stOf(a) : f.status === 'out' ? !stOf(a) : stOf(a) === f.status)) &&
    (!f.via || viaOf(a) === f.via) &&
    (!f.country || a.country === f.country) &&
    (a.priority || 0) >= (f.minPrio || 0) &&
    inPeriod(a, f) &&
    (!f.sugg || !!a.suggest) &&
    (!f.pop || ((popOf(a) || {}).tier || 'Inconnue') === f.pop) &&
    (!q || norm([a.name, a.city, a.country, a.bio, a.styles.join(' '), a.contact.agency, a.contact.name, a.contact.email, a.source, a.notes, a.tags.join(' '), a.messages.map((m) => m.text).join(' ')].join(' ')).includes(q)));
  const cmp = {
    recent: (a, b) => artistDate(b) - artistDate(a),
    oldest: (a, b) => artistDate(a) - artistDate(b),
    updated: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''),
    name: (a, b) => a.name.localeCompare(b.name, 'fr'),
    popularity: (a, b) => ((popOf(b) || { score: -1 }).score - (popOf(a) || { score: -1 }).score),
    priority: (a, b) => (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name, 'fr'),
    feeDesc: (a, b) => (feeCHF(b) ?? -1) - (feeCHF(a) ?? -1),
    feeAsc: (a, b) => (feeCHF(a) ?? 1e12) - (feeCHF(b) ?? 1e12),
    status: (a, b) => STATUSES.findIndex((s) => s.k === stOf(a)) - STATUSES.findIndex((s) => s.k === stOf(b)),
    country: (a, b) => (a.country || 'zz').localeCompare(b.country || 'zz', 'fr'),
  }[f.sort] || (() => 0);
  return r.sort(cmp);
}
const viaOf = (a) => a.foundVia || 'Non renseigné';
const activeFilters = () => S.f.styles.length || S.f.status || S.f.via || S.f.pop || S.f.q || S.f.country || S.f.minPrio || S.f.period;
// Date d'une fiche = date de la demande (premier contact), sinon date de création
const artistDate = (a) => new Date(a.createdAt || a.updatedAt || 0);
const PERIODS = [['', 'Toutes les dates'], ['7', '7 derniers jours'], ['30', '30 derniers jours'], ['90', '3 derniers mois'], ['182', '6 derniers mois'], ['365', '12 derniers mois']];
function inPeriod(a, f) {
  if (!f.period) return true;
  const d = artistDate(a);
  if (/^\d+$/.test(f.period)) return Date.now() - d <= Number(f.period) * 864e5;
  if (/^y\d{4}$/.test(f.period)) return d.getFullYear() === Number(f.period.slice(1));
  if (f.period === 'custom') {
    if (f.from && d < new Date(f.from + 'T00:00:00')) return false;
    if (f.to && d > new Date(f.to + 'T23:59:59')) return false;
    return true;
  }
  return true;
}

// ---------- tableau de bord ----------
function viewDashboard() {
  const all = artists(), A = proposedArtists(), st = settings();
  const live = A.filter((a) => stOf(a) !== 'refuse');
  const conf = A.filter((a) => stOf(a) === 'confirme');
  const nego = A.filter((a) => stOf(a) === 'negociation');
  const pool = live.length ? live : all; // graphiques : propositions, sinon toute la base
  const sum = (l) => l.reduce((t, a) => t + (feeCHF(a) || 0), 0);
  const confSum = sum(conf), negoSum = sum(nego);
  const weekAgo = Date.now() - 7 * 864e5;
  const newWeek = all.filter((a) => new Date(a.createdAt) > weekAgo).length;
  const unread = window.Mail ? Mail.unreadCount() : 0;
  const props = window.Mail ? Mail.recentProposals(6) : [];
  const budgetPct = st.budget ? Math.min(100, (confSum / st.budget) * 100) : 0;
  const negoPct = st.budget ? Math.min(100 - budgetPct, (negoSum / st.budget) * 100) : 0;

  if (!all.length) {
    return `<div class="page">${head('Tableau de bord', `${esc(st.edition)} · vue d'ensemble de la programmation`)}
      <div class="card empty">${ic('users')}<h3>Bienvenue dans ton logiciel de prog</h3>
      <p>Commence par ajouter les artistes proposés, importer une liste (CSV/Excel) ou charger quelques exemples fictifs pour voir à quoi ressemble le logiciel une fois rempli.</p>
      <div class="row-actions" style="justify-content:center"><button class="btn primary" data-act="new-artist">${ic('plus')}Ajouter un artiste</button><button class="btn" data-act="import-csv">${ic('upload')}Importer un CSV</button><button class="btn" data-act="load-examples">${ic('sparkle')}Charger des exemples</button></div></div></div>`;
  }

  // répartition par style
  const styleCounts = {};
  pool.forEach((a) => (a.styles.length ? a.styles : ['Sans style']).forEach((s) => (styleCounts[s] = (styleCounts[s] || 0) + 1)));
  const styleRows = Object.entries(styleCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxS = Math.max(1, ...styleRows.map((r) => r[1]));
  // origines
  const cc = {};
  pool.forEach((a) => { const c = a.country || 'Non renseigné'; cc[c] = (cc[c] || 0) + 1; });
  const ccRows = Object.entries(cc).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxC = Math.max(1, ...ccRows.map((r) => r[1]));
  const swiss = pool.filter((a) => a.country === 'Suisse').length;
  // pipeline
  const pipe = STATUSES.map((s) => { const l = A.filter((a) => stOf(a) === s.k); return { ...s, n: l.length, sum: sum(l) }; });
  const maxP = Math.max(1, ...pipe.map((p) => p.n));
  const favs = all.filter((a) => a.priority >= 3 && !['confirme', 'refuse'].includes(stOf(a))).slice(0, 6);

  return `<div class="page">
    ${head('Tableau de bord', `${esc(st.edition)} · vue d'ensemble de la programmation`, `<button class="btn" data-act="export-pdf">${ic('file')}Dossier PDF</button><button class="btn primary" data-act="new-artist">${ic('plus')}Ajouter un artiste</button>`)}
    <div class="kpis">
      <div class="card kpi" data-act="nav" data-view="proposals" style="cursor:pointer"><div class="l">${ic('board')}Propositions ${esc(edition())}</div><div class="v">${live.length}</div><div class="s">${all.length} artistes dans la base · ${newWeek ? `+${newWeek} cette semaine` : 'aucun ajout cette semaine'}</div></div>
      <div class="card kpi"><div class="l">${ic('check')}Confirmés</div><div class="v">${conf.length}${st.slots ? `<small> / ${st.slots} créneaux</small>` : ''}</div>
        ${st.slots ? `<div class="meter" data-tip="${conf.length} confirmés sur ${st.slots} créneaux"><i style="width:${Math.min(100, (conf.length / st.slots) * 100)}%;background:var(--good)"></i></div>` : `<div class="s">${nego.length} en négociation</div>`}</div>
      <div class="card kpi"><div class="l">${ic('money')}Budget artistique engagé</div><div class="v">${nf.format(Math.round(confSum))}<small> CHF${st.budget ? ` / ${nf.format(st.budget)}` : ''}</small></div>
        ${st.budget ? `<div class="meter"><i style="width:${budgetPct}%;background:var(--bar)" data-tip="Confirmé : ${money(confSum)}"></i><i style="width:${negoPct}%;background:var(--bar);opacity:.4" data-tip="En négociation : ${money(negoSum)}"></i></div><div class="s" style="margin-top:6px">+ ${money(negoSum)} en négociation</div>` : `<div class="s">+ ${money(negoSum) || '0 CHF'} en négo · <a href="#" data-act="nav" data-view="settings">définir le budget</a></div>`}</div>
      <div class="card kpi" data-act="nav" data-view="mail" style="cursor:pointer"><div class="l">${ic('mail')}Mails non lus</div><div class="v">${Owa.active() ? '<small style="font-size:20px;color:var(--ink)">Outlook</small>' : unread}</div><div class="s">${Owa.active() ? 'Outlook intégré · cliquer pour ouvrir' : window.Mail && Mail.hasAccount() ? `${Mail.countCategory('booking')} propositions de booking récentes` : 'Boîte mail pas encore connectée'}</div></div>
    </div>
    <div class="dash-grid">
      <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
        <div class="card panel"><h2>Propositions ${esc(edition())}<span class="sp"></span><span class="lnk" data-act="nav" data-view="proposals">Ouvrir →</span></h2>
          <div class="funnel">${pipe.map((p) => `<div class="row" data-act="filter-status" data-status="${p.k}" data-tip="${esc(p.l)} : ${p.n} artiste${p.n > 1 ? 's' : ''}${p.sum ? ' · ' + money(p.sum) : ''}">
            <span>${pill(p.k)}</span><div class="tr"><div class="fl" style="width:${(p.n / maxP) * 100}%"></div></div><span class="vl"><b>${p.n}</b>${p.sum ? nf.format(Math.round(p.sum / 100) * 100) + ' CHF' : ''}</span></div>`).join('')}</div></div>
        <div class="card panel"><h2>${live.length ? 'Propositions par style' : 'Base d’artistes par style'}<span class="sp"></span><span class="muted" style="font-weight:400;font-size:12.5px">${live.length ? 'hors refusés · ' : ''}cliquer pour filtrer</span></h2>
          <div class="hbars">${styleRows.map(([s, n]) => `<div class="hbar" data-act="filter-style" data-style="${esc(s)}" data-tip="${esc(s)} : ${n} artiste${n > 1 ? 's' : ''}">
            <span class="lb"><span class="dot" style="width:8px;height:8px;border-radius:50%;flex:none;background:${s === 'Sans style' ? 'var(--line-strong)' : styleColor(s)}"></span>${esc(s)}</span><div class="tr"><div class="fl" style="width:${(n / maxS) * 100}%"></div></div><span class="vl">${n}</span></div>`).join('')}</div></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
        <div class="card panel"><h2>${ic('heart')}Coups de cœur à suivre<span class="sp"></span><span class="lnk" data-act="filter-prio">Tout voir →</span></h2>
          ${favs.length ? `<div class="mini-list">${favs.map((a) => `<div class="it" data-act="open-artist" data-id="${a.id}">${avatar(a, 'sm')}<div class="tx"><b>${esc(a.name)}</b><span>${esc([a.styles.join(', '), origin(a)].filter(Boolean).join(' · '))}</span></div>${pill(stOf(a)) || '<span class="muted" style="font-size:12px">pas proposé</span>'}</div>`).join('')}</div>`
            : `<p class="muted" style="margin:0">Donne 3 étoiles aux artistes prioritaires pour les retrouver ici.</p>`}</div>
        <div class="card panel"><h2>${ic('inbox')}Dernières propositions reçues<span class="sp"></span><span class="lnk" data-act="mail-filter" data-filter="booking">Boîte mail →</span></h2>
          ${props.length ? `<div class="mini-list">${props.map((m) => `<div class="it" data-act="open-mail" data-uid="${m.uid}"><div class="av sm" style="background:${STYLE_COLORS[hashN(m.from && m.from.address) % STYLE_COLORS.length]}">${esc(initials((m.from && (m.from.name || m.from.address)) || '?'))}</div><div class="tx"><b>${esc(m.subject)}</b><span>${esc((m.from && (m.from.name || m.from.address)) || '')} · ${fmtDate(m.date, { day: 'numeric', month: 'short' })}</span></div>${m.seen ? '' : '<span class="pill st-contacte">Nouveau</span>'}</div>`).join('')}</div>`
            : `<p class="muted" style="margin:0">${Owa.active() ? 'Avec Outlook intégré, ouvre un mail puis clique sur « Analyser avec Orbiz » ou « Créer la fiche artiste ».' : window.Mail && Mail.hasAccount() ? 'Aucun mail de booking repéré récemment.' : 'Connecte la boîte mail du festival pour voir les propositions ici.'}</p>`}</div>
        <div class="card panel"><h2>${ic('globe')}Origines<span class="sp"></span><span class="muted" style="font-weight:400;font-size:12.5px">${pool.length ? Math.round((swiss / pool.length) * 100) : 0} % d'artistes suisses${live.length ? '' : ' (toute la base)'}</span></h2>
          <div class="hbars">${ccRows.map(([c, n]) => `<div class="hbar" data-act="filter-country" data-country="${esc(c)}" data-tip="${esc(c)} : ${n}"><span class="lb">${esc(c)}</span><div class="tr"><div class="fl" style="width:${(n / maxC) * 100}%"></div></div><span class="vl">${n}</span></div>`).join('')}</div></div>
      </div>
    </div></div>`;
}
const linkText = (t) => esc(t).replace(/(https?:\/\/[^\s<>"')\]]+)/g, '<a href="#" data-act="open-url" data-url="$1">$1</a>');
function viaIcon(v) {
  const n = norm(v);
  if (n.includes('formulaire')) return 'file';
  if (n.includes('mail')) return 'mail';
  if (n.includes('agence') || n.includes('booker')) return 'user';
  if (n.includes('comite')) return 'users';
  if (n.includes('concert')) return 'music';
  if (n.includes('web') || n.includes('reseau')) return 'globe';
  if (n.includes('recommand') || n.includes('coeur')) return 'heart';
  return 'pin';
}
const head = (title, sub, right = '') => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="sp"></div>${right}</div>`;

// ---------- liste des artistes ----------
function viewArtists() {
  const A = artists();
  const list = filtered();
  const base = filtered(A, { ...S.f, styles: [] });
  const sc = {}; base.forEach((a) => a.styles.forEach((s) => (sc[s] = (sc[s] || 0) + 1)));
  const allStyles = [...new Set([...settings().styles, ...A.flatMap((a) => a.styles)])].filter((s) => sc[s] || S.f.styles.includes(s));
  const baseSt = filtered(A, { ...S.f, status: '' });
  const baseVia = filtered(A, { ...S.f, via: '' });
  const vias = [...new Set([...FOUND_VIA, ...A.map(viaOf)])].filter((v) => baseVia.some((a) => viaOf(a) === v) || S.f.via === v);
  const countries = [...new Set(A.map((a) => a.country).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));

  const toolbar = `<div class="toolbar">
      <div class="search">${ic('search')}<input id="q" placeholder="Rechercher un artiste, une ville, une agence…" value="${esc(S.f.q)}" data-input="q"></div>
      <select class="sel" data-change="country"><option value="">Tous les pays</option>${countries.map((c) => `<option ${S.f.country === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select class="sel" data-change="period" title="Date de la demande">${PERIODS.map(([v, l]) => `<option value="${v}" ${S.f.period === v ? 'selected' : ''}>${l}</option>`).join('')}${[...new Set(A.map((a) => artistDate(a).getFullYear()))].sort((x, y) => y - x).map((y) => `<option value="y${y}" ${S.f.period === 'y' + y ? 'selected' : ''}>Année ${y}</option>`).join('')}<option value="custom" ${S.f.period === 'custom' ? 'selected' : ''}>Entre deux dates…</option></select>
      ${S.f.period === 'custom' ? `<span class="muted">du</span><input type="date" class="sel" value="${esc(S.f.from)}" data-change="from"><span class="muted">au</span><input type="date" class="sel" value="${esc(S.f.to)}" data-change="to">` : ''}
      <select class="sel" data-change="pop" title="Popularité (Spotify + Instagram + SoundCloud)"><option value="">Toutes popularités</option>${POP_TIERS.map(([, t]) => `<option ${S.f.pop === t ? 'selected' : ''}>${t}</option>`).join('')}<option ${S.f.pop === 'Inconnue' ? 'selected' : ''}>Inconnue</option></select>
      <select class="sel" data-change="minPrio">${[[0, 'Toutes priorités'], [1, '★ et plus'], [2, '★★ et plus'], [3, '★★★ seulement']].map(([v, l]) => `<option value="${v}" ${S.f.minPrio == v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select class="sel" data-change="sort">${[['recent', 'Demandes les plus récentes'], ['oldest', 'Demandes les plus anciennes'], ['updated', 'Modifiés récemment'], ['name', 'Nom (A→Z)'], ['priority', 'Priorité'], ['popularity', 'Popularité'], ['status', 'Statut'], ['feeDesc', 'Cachet décroissant'], ['feeAsc', 'Cachet croissant'], ['country', 'Pays']].map(([v, l]) => `<option value="${v}" ${S.f.sort === v ? 'selected' : ''}>Tri : ${l}</option>`).join('')}</select>
      <div class="sp" style="flex:1"></div>
      <div class="seg"><button class="${S.layout === 'grid' ? 'on' : ''}" data-act="layout" data-l="grid">${ic('grid')}Cartes</button><button class="${S.layout === 'list' ? 'on' : ''}" data-act="layout" data-l="list">${ic('list')}Liste</button></div>
    </div>`;

  const filters = `<div class="filters">
      <div class="chips"><span class="lbl">Styles</span>${allStyles.map((s) => `<button class="chip ${S.f.styles.includes(s) ? 'on' : ''}" data-act="toggle-style" data-style="${esc(s)}"><span class="dot" style="background:${styleColor(s)}"></span>${esc(s)}<span class="n">${sc[s] || 0}</span></button>`).join('') || '<span class="muted">Aucun style renseigné pour l’instant</span>'}</div>
      <div class="chips"><span class="lbl">${esc(edition())}</span><button class="chip ${!S.f.status ? 'on' : ''}" data-act="set-status-filter" data-status="">Tous<span class="n">${baseSt.length}</span></button><button class="chip ${S.f.status === 'in' ? 'on' : ''}" data-act="set-status-filter" data-status="in">${ic('board')}Proposés<span class="n">${baseSt.filter((a) => stOf(a)).length}</span></button><button class="chip ${S.f.status === 'out' ? 'on' : ''}" data-act="set-status-filter" data-status="out">Pas proposés<span class="n">${baseSt.filter((a) => !stOf(a)).length}</span></button></div>
      ${A.some((a) => a.suggest) ? `<div class="chips"><span class="lbl">À vérifier</span><button class="chip ${S.f.sugg ? 'on' : ''}" data-act="sugg-filter">${ic('refresh')}Suggestions d'origine ou de style<span class="n">${A.filter((a) => a.suggest).length}</span></button></div>` : ''}
      <div class="chips"><span class="lbl">Trouvé via</span><button class="chip ${!S.f.via ? 'on' : ''}" data-act="set-via-filter" data-via="">Partout<span class="n">${baseVia.length}</span></button>${vias.map((v) => `<button class="chip ${S.f.via === v ? 'on' : ''}" data-act="set-via-filter" data-via="${esc(v)}">${ic(viaIcon(v))}${esc(v)}<span class="n">${baseVia.filter((a) => viaOf(a) === v).length}</span></button>`).join('')}</div>
    </div>`;

  const total = list.reduce((t, a) => t + (feeCHF(a) || 0), 0);
  const resbar = `<div class="resbar"><span><b>${list.length}</b> artiste${list.length > 1 ? 's' : ''}${activeFilters() ? ` sur ${A.length}` : ''}</span>${total ? `<span>· cachets cumulés ≈ <b>${money(total)}</b></span>` : ''}${activeFilters() ? '<span class="clear" data-act="clear-filters">Effacer les filtres</span>' : ''}</div>`;

  let body;
  if (!A.length) {
    body = `<div class="card empty">${ic('users')}<h3>Aucun artiste pour l'instant</h3><p>Ajoute les propositions au fur et à mesure, importe un fichier CSV (export Excel) ou charge des exemples fictifs pour tester.</p>
      <div class="row-actions" style="justify-content:center"><button class="btn primary" data-act="new-artist">${ic('plus')}Ajouter un artiste</button><button class="btn" data-act="import-csv">${ic('upload')}Importer un CSV</button><button class="btn" data-act="load-examples">${ic('sparkle')}Charger des exemples</button></div></div>`;
  } else if (!list.length) {
    body = `<div class="card empty">${ic('search')}<h3>Aucun résultat</h3><p>Aucun artiste ne correspond à ces filtres.</p><button class="btn" data-act="clear-filters">Effacer les filtres</button></div>`;
  } else if (S.layout === 'grid') {
    body = `<div class="grid ${S.sel ? 'selmode' : ''}">${list.map(cardHtml).join('')}</div>`;
  } else {
    const th = (k, l, cls = '') => `<th class="${cls} ${S.f.sort === k ? 'on' : ''}" data-act="sort" data-sort="${k}">${l}</th>`;
    body = `<div class="card" style="overflow:hidden"><table class="list ${S.sel ? 'selmode' : ''}"><thead><tr>${S.sel ? '<th style="width:36px"></th>' : ''}${th('name', 'Artiste')}<th>Styles</th>${th('country', 'Origine')}${th('status', 'Statut')}${th('priority', 'Priorité')}${th('feeDesc', 'Cachet', 'right')}<th>Contact</th>${th('popularity', 'Popularité')}${th('recent', 'Reçu le', 'right')}</tr></thead><tbody>
      ${list.map((a) => `<tr data-act="open-artist" data-id="${a.id}" class="${S.sel && S.sel.has(a.id) ? 'sel' : ''}">${S.sel ? `<td><span class="ckb">${ic('check')}</span></td>` : ''}<td><div class="nmc">${avatar(a, 'sm')}${esc(a.name)}</div></td><td>${a.styles.map(styleTag).join(' ')}</td><td>${esc(origin(a))}</td><td>${pill(stOf(a))}</td><td>${stars(a.priority || 0)}</td><td class="right num">${esc(feeText(a))}</td><td class="muted">${esc(a.contact.agency || a.contact.email || '')}</td><td>${popTag(a) || '<span class="muted">—</span>'}</td><td class="right muted num">${fmtDate(artistDate(a), { day: '2-digit', month: '2-digit', year: 'numeric' })}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  const selbar = S.sel ? `<div class="selbar"><span class="n"><b>${S.sel.size}</b> sélectionné${S.sel.size > 1 ? 's' : ''}</span>
      <button class="btn sm ghost" data-act="sel-all">Tout sélectionner (${list.length}${activeFilters() ? ' affichés' : ''})</button>${S.sel.size ? '<button class="btn sm ghost" data-act="sel-none">Aucun</button>' : ''}
      <span class="hint">Clic = cocher · Maj+clic = une plage · Ctrl+A = tout</span><span class="sp"></span>
      <button class="btn sm" data-act="sel-propose" ${S.sel.size ? '' : 'disabled'}>${ic('board')}Proposer pour ${esc(edition())}</button>
      <button class="btn sm" data-act="sel-unpropose" ${S.sel.size ? '' : 'disabled'}>Retirer des propositions</button>
      <button class="btn sm" data-act="sel-csv" ${S.sel.size ? '' : 'disabled'}>${ic('download')}CSV</button>
      <button class="btn sm danger" data-act="sel-delete" ${S.sel.size ? '' : 'disabled'}>${ic('trash')}Supprimer</button>
      <button class="btn sm primary" data-act="sel-mode">Terminer</button></div>` : '';
  return `<div class="page">
    ${head('Artistes', `Ta base d’artistes : tous ceux que tu suis, proposés pour ${esc(edition())} ou non`, `${A.length ? `<button class="btn ${S.sel ? 'on' : ''}" data-act="sel-mode">${ic('checksq')}${S.sel ? 'Quitter la sélection' : 'Sélectionner'}</button>` : ''}<button class="btn" data-act="export-menu">${ic('download')}Exporter</button><button class="btn primary" data-act="new-artist">${ic('plus')}Ajouter un artiste</button>`)}
    ${A.length ? toolbar + filters + selbar + resbar : ''}${body}</div>`;
}

function cardHtml(a) {
  const nm = Mail ? Mail.mailsForArtist(a).length : 0;
  const sel = S.sel && S.view === 'artists';
  return `<div class="card acard ${sel && S.sel.has(a.id) ? 'sel' : ''}" data-act="open-artist" data-id="${a.id}">
    <div class="ph" style='background:${bgOf(a)}'>${a.photo ? '' : esc(initials(a.name))}${pill(stOf(a))}${a.priority ? stars(a.priority) : ''}${sel ? `<span class="ckb">${ic('check')}</span>` : ''}</div>
    <div class="bd"><div class="nm">${esc(a.name)}</div>
      <div class="or">${origin(a) ? `${ic('pin')}${esc(origin(a))}` : '<span>Origine non renseignée</span>'}${a.formation ? ` · ${esc(a.formation)}` : ''}</div>
      <div class="tg">${popTag(a)}${a.styles.map(styleTag).join('')}${a.foundVia ? `<span class="tag via" title="Trouvé via">${ic(viaIcon(a.foundVia))}${esc(a.foundVia)}</span>` : ''}</div>
      <div class="ft"><span class="fee">${esc(feeText(a)) || '<span class="muted" style="font-weight:400">Cachet ?</span>'}</span><span class="mails" title="Date de la demande">${nm ? `${ic('mail')}${nm} · ` : ''}${fmtDate(artistDate(a), { day: 'numeric', month: 'short', year: '2-digit' })}</span></div></div></div>`;
}

// ---------- propositions (liste à part, pour l'édition en cours) ----------
function proposalsList() {
  const all = proposedArtists();
  let list = filtered(all, { styles: [], status: '', via: '', q: S.pf.q, country: '', minPrio: 0, period: '', sort: S.f.sort });
  if (S.pf.status) list = list.filter((a) => stOf(a) === S.pf.status);
  return { all, list };
}
function viewProposals() {
  const { all, list } = proposalsList();
  const ed = edition();
  const conf = all.filter((a) => stOf(a) === 'confirme').length;
  const right = `<div class="search">${ic('search')}<input id="qp" placeholder="Filtrer…" value="${esc(S.pf.q)}" data-input="pq"></div>
    <div class="seg"><button class="${S.pf.layout === 'board' ? 'on' : ''}" data-act="playout" data-l="board">${ic('board')}Pipeline</button><button class="${S.pf.layout === 'grid' ? 'on' : ''}" data-act="playout" data-l="grid">${ic('grid')}Cartes</button></div>
    <button class="btn" data-act="export-pdf">${ic('file')}Dossier PDF</button><button class="btn primary" data-act="add-proposals">${ic('plus')}Ajouter des artistes</button>`;
  const top = head(`Propositions ${esc(ed)}`, all.length ? `${all.length} artiste${all.length > 1 ? 's' : ''} proposé${all.length > 1 ? 's' : ''} · ${conf} confirmé${conf > 1 ? 's' : ''}${S.pf.layout === 'board' ? ' · glisse les cartes pour changer le statut' : ''}` : 'Ta liste spéciale : les artistes que tu proposes pour le festival', right);
  if (!all.length) {
    return `<div class="page">${top}<div class="card empty">${ic('board')}<h3>Aucune proposition pour l'instant</h3><p>Ajoute ici les artistes de ta base que tu veux proposer pour ${esc(ed)}. Tu peux aussi le faire depuis une fiche artiste, avec le bouton « Proposer pour ${esc(ed)} ».</p>
      <div class="row-actions" style="justify-content:center"><button class="btn primary" data-act="add-proposals">${ic('plus')}Choisir dans ma base</button><button class="btn" data-act="new-artist-proposed">${ic('user')}Nouvel artiste</button></div></div></div>`;
  }
  const chips = `<div class="filters"><div class="chips"><span class="lbl">Statut</span><button class="chip ${!S.pf.status ? 'on' : ''}" data-act="set-pstatus" data-status="">Tous<span class="n">${all.length}</span></button>${STATUSES.map((s) => `<button class="chip ${S.pf.status === s.k ? 'on' : ''}" data-act="set-pstatus" data-status="${s.k}">${s.l}<span class="n">${all.filter((a) => stOf(a) === s.k).length}</span></button>`).join('')}</div></div>`;
  if (S.pf.layout === 'grid') {
    return `<div class="page">${top}${chips}${list.length ? `<div class="grid">${list.map(cardHtml).join('')}</div>` : `<div class="card empty">${ic('search')}<h3>Aucun résultat</h3></div>`}</div>`;
  }
  return `<div class="page" style="padding-bottom:14px">${top}</div>
    <div class="board">${STATUSES.map((s) => {
      const l = list.filter((a) => stOf(a) === s.k);
      const sum = l.reduce((t, a) => t + (feeCHF(a) || 0), 0);
      return `<div class="col" data-drop="${s.k}"><div class="hd">${pill(s.k)}<span class="n">${l.length}</span><span class="sum">${sum ? money(sum) : ''}</span></div>
        <div class="bd">${l.map((a) => `<div class="kcard" draggable="true" data-drag="${a.id}" data-act="open-artist" data-id="${a.id}">${avatar(a, 'sm')}<div class="tx"><b>${esc(a.name)}</b><span>${esc(a.styles.join(', ') || '—')}</span><div class="ln"><span class="muted">${esc(a.country || '')}</span><span class="num">${esc(feeText(a))}</span></div></div></div>`).join('')}</div></div>`;
    }).join('')}</div>`;
}

// ---------- genres (Spotify, Wikidata, Last.fm) -> styles de l'app ----------
const STYLE_WORDS = { 'Rap / Hip-hop': /rap|hip.?hop|trap|drill/, Pop: /\bpop\b/, 'Rock / Indie': /rock|indie|alternative|garage|psych|grunge|shoegaze/, 'Électro': /electro|electronic|edm|electronica|électronique/, Techno: /techno/, House: /house/, 'Hardcore / Uptempo': /hardcore(?! punk)|uptempo|gabber|frenchcore|hardstyle|rawstyle|raw hard|terror|hard dance|hardtek|tekno/, Hardstyle: /hardstyle|hard dance/, 'DnB / Bass': /drum.?(and|&|n).?bass|dnb|jungle|dubstep|bass music/, 'Punk / Métal': /punk|metal|thrash|grind|métal/, 'R&B / Soul': /r&b|rnb|\bsoul\b/, 'Afro / Amapiano': /afro|amapiano/, 'Reggae / Dub': /reggae|\bdub\b|dancehall|\bska\b/, 'Jazz / Funk': /jazz|funk|swing|blues/, Chanson: /chanson|variet|french pop|singer.?songwriter|folk/, 'Musiques du monde': /world|balkan|cumbia|latin|maloya|klezmer|musique du monde/, 'Expérimental': /experimental|expérimental|noise|idm|ambient/ };
// Styles à partir de genres pondérés [{ g, w }] : on garde les styles qui pèsent au moins 30 % du premier (3 max)
function stylesFromWeighted(gw) {
  const sc = {};
  for (const { g, w } of gw || []) for (const s of settings().styles) if (STYLE_WORDS[s] && STYLE_WORDS[s].test(String(g).toLowerCase())) sc[s] = (sc[s] || 0) + w;
  let L = Object.entries(sc).sort((a, b) => b[1] - a[1]);
  if (!L.length) return [];
  const max = L[0][1];
  L = L.filter(([, v]) => v >= max * 0.3).map(([k]) => k);
  if (L.some((s) => ['Techno', 'House', 'Hardcore / Uptempo', 'Hardstyle', 'DnB / Bass'].includes(s))) L = L.filter((s) => s !== 'Électro');
  return L.slice(0, 3);
}
function genresToStyles(genres) {
  const g = (genres || []).map((x) => String(x).toLowerCase());
  return settings().styles.filter((s) => STYLE_WORDS[s] && g.some((x) => STYLE_WORDS[s].test(x)));
}

// Applique le résultat d'enrichissement d'un artiste (ne remplace jamais ce qui est déjà rempli)
function applyEnrich(p) {
  const a = byId(p.id); if (!a) return false;
  let changed = false;
  for (const [k, v] of Object.entries(p.links || {})) if (v && !a.links[k]) { a.links[k] = v; changed = true; }
  if (p.photo && !a.photo) { a.photo = p.photo; changed = true; }
  const sugg = {};
  const o = p.origin || {};
  if (o.country) { if (!a.country) { a.country = o.country; a.originSource = o.countrySrc; changed = true; } else if (norm(a.country) !== norm(o.country)) sugg.country = o.country; else if (!a.originSource) a.originSource = o.countrySrc; }
  if (o.city) { if (!a.city) { a.city = o.city; a.citySource = o.citySrc; changed = true; } else if (norm(a.city) !== norm(o.city)) sugg.city = o.city; }
  if (p.bio && !a.bio) { a.bio = p.bio; changed = true; }
  const gw = p.genresW || [];
  if (gw.length) {
    const st = stylesFromWeighted(gw);
    a.genres = gw.slice(0, 8).map((x) => x.g);
    if (st.length) { const add = st.filter((x) => !a.styles.includes(x) && x !== 'Électro'); if (!a.styles.length) { a.styles = st; a.stylesSource = (p.sources || []).join(', '); changed = true; } else if (add.length) sugg.styles = [...a.styles, ...add]; }
  }
  // sources trouvées par le nom seul : jamais de remplissage, seulement une suggestion « à confirmer »
  const wk = p.weak || {};
  if (wk.country && !o.country && !a.country) { sugg.country = wk.country; if (wk.city) sugg.city = wk.city; sugg.weak = wk.src; }
  if (!gw.length && !a.styles.length && wk.genres && wk.genres.length) { const st = stylesFromWeighted(wk.genres).filter((x) => !a.styles.includes(x) && x !== 'Électro'); if (st.length) { sugg.styles = [...a.styles, ...st]; sugg.weak = sugg.weak || wk.genres[0].src; } }
  if (Object.keys(sugg).length) { a.suggest = { ...sugg, from: [...new Set([o.citySrc, o.countrySrc].filter(Boolean))].concat(gw.length ? ['genres : ' + gw.slice(0, 4).map((x) => x.g).join(', ')] : []).join(' · ') }; changed = true; }
  else delete a.suggest;
  const pop = Object.fromEntries(Object.entries(p.pop || {}).filter(([, v]) => v != null));
  if (Object.keys(pop).length) { a.popularity = { ...(a.popularity || {}), ...pop, updatedAt: new Date().toISOString() }; if (pop.spotify != null) a.listeners = pop.spotify; changed = true; }
  if (changed || (p.notes || []).length) {
    a.notes = (a.notes ? a.notes + '\n' : '') + `[Enrichissement ${fmtDate(new Date())}] ${(p.sources || []).join(', ') || 'aucune source'}${(p.notes || []).length ? ' · ' + p.notes.join(' · ') : ''}`;
    a.updatedAt = new Date().toISOString();
  }
  return changed;
}

// Tâche « Enrichir toute la base » (tourne dans le processus principal, résultats appliqués ici)
const ENR = { running: false, changed: 0, sources: {}, errors: 0 };
function startEnrich(list) {
  if (ENR.running) return toast('Un enrichissement est déjà en cours');
  Object.assign(ENR, { running: true, changed: 0, sources: {}, errors: 0, firstError: '' });
  const L = (list || artists()).map((a) => ({ id: a.id, name: a.name, country: a.country, styles: a.styles, links: a.links, hasPhoto: !!a.photo }));
  window.bv.enrich.start(L);
  setProgress('enrich', 'Enrichissement de la base', 0, L.length, 'Démarrage…');
  render();
}
window.bv.enrich.on((ch, d) => {
  if (ch === 'enrich:progress') setProgress('enrich', 'Enrichissement (Spotify, Wikidata…)', d.done, d.total, d.name);
  else if (ch === 'enrich:patch') { if (applyEnrich(d)) ENR.changed++; (d.sources || []).forEach((x) => (ENR.sources[x] = (ENR.sources[x] || 0) + 1)); if (d.error) { ENR.errors++; ENR.firstError = ENR.firstError || d.error; } save(); }
  else if (ch === 'enrich:done') {
    ENR.running = false; setProgress('enrich', '', 0, 0, '', true); render(); if (S.drawer && !S.drawer.edit) refreshDrawer();
    const src = Object.entries(ENR.sources).map(([k, v]) => `<li>${esc(k)} : <b>${v}</b> artistes</li>`).join('') || '<li>Aucune source n’a répondu</li>';
    modal({ title: d.stopped ? 'Enrichissement arrêté' : '✅ Enrichissement terminé', body: `<p style="margin:0 0 10px;line-height:1.55"><b>${ENR.changed}</b> fiches complétées sur ${d.done} parcourues (liens, photo, styles, pays, popularité). Rien de ce qui était déjà rempli n'a été remplacé.</p>
      <ul style="margin:0 0 12px;padding-left:20px;line-height:1.7">${src}</ul>
      ${ENR.errors ? `<div class="callout bad" style="margin-bottom:10px">${ENR.errors} erreurs${ENR.firstError ? ' : ' + esc(ENR.firstError) : ''}</div>` : ''}
      ${artists().some((a) => a.suggest) ? `<div class="callout" style="margin-bottom:10px"><b>${artists().filter((a) => a.suggest).length}</b> fiches ont une suggestion d'origine ou de style différente de ce qui était saisi : filtre « Suggestions d'origine ou de style » dans l'onglet Artistes pour les valider une par une.</div>` : ''}
      <p class="muted" style="margin:0;font-size:13px;line-height:1.5">Chaque fiche a une ligne « [Enrichissement …] » dans ses notes internes avec les sources utilisées et ce qui est à vérifier (homonymes écartés, correspondances par nom).</p>`,
      foot: '<button class="btn primary" data-enr-ok>Voir les artistes par popularité</button>',
      onMount: (w, close) => { w.querySelector('[data-enr-ok]').onclick = () => { close(); go('artists', { filters: { styles: [], status: '', via: '', q: '', country: '', minPrio: 0, period: '', pop: '', sort: 'popularity' } }); }; } });
  }
});

// clé d'un lien de profil (même logique que linkKey dans sources.js)
function linkKeyR(u) {
  try { const x = new URL(/^https?:/i.test(u) ? u : 'https://' + u); const host = x.hostname.replace(/^(www\.|m\.)/, ''); const parts = x.pathname.split('/').filter(Boolean);
    if (/spotify\.com$/.test(host)) return 'spotify/' + (parts[0] === 'artist' ? parts[1] : parts[2]);
    return host.split('.').slice(-2, -1)[0] + '/' + (parts[0] || '').replace(/^@/, '').toLowerCase(); } catch { return ''; }
}

// ---------- ajouter un artiste : recherche sur internet ----------
const SRC = { spotify: ['Spotify', 'spotify'], instagram: ['Instagram', 'instagram'], soundcloud: ['SoundCloud', 'soundcloud'], deezer: ['Deezer', 'music'] };
function addArtistDialog(proposeDefault = false) {
  let results = {}, picked = {}, query = '';
  const local = (q) => { const n = norm(q); return n.length < 2 ? [] : artists().filter((a) => norm(a.name).includes(n) || n.includes(norm(a.name))).slice(0, 5); };
  const card = (src, x, i) => `<div class="lk ${picked[src] === i ? 'sel' : ''}" data-src="${src}" data-i="${i}">
      <div class="av" style='background:${x.img ? `url("${String(x.img).replace(/"/g, '%22')}") center/cover` : 'var(--surface-3)'}'>${x.img ? '' : esc(initials(x.name))}</div>
      <div class="tx"><b>${esc(x.name)}</b><span>${x.stat != null ? `${nf.format(x.stat)} ${x.statLabel}` : ''}${x.handle ? ` · @${esc(x.handle)}` : ''}${x.note ? ` · ${esc(x.note)}` : ''}</span></div>
      <a href="#" data-act="open-url" data-url="${esc(x.url)}" title="Ouvrir">${ic('ext')}</a><span class="ck">${ic('check')}</span></div>`;
  const drawResults = (w) => {
    const L = local(query);
    const any = Object.values(results).some((v) => v && v.length);
    $('#lk-res', w).innerHTML = (L.length ? `<div class="lk-grp"><h4>Déjà dans ta base</h4>${L.map((a) => `<div class="lk" data-open="${a.id}">${avatar(a)}<div class="tx"><b>${esc(a.name)}</b><span>${esc([a.styles.join(', '), origin(a)].filter(Boolean).join(' · ') || 'fiche existante')}</span></div><span class="pill st-contacte">Ouvrir</span></div>`).join('')}</div>` : '')
      + Object.entries(SRC).map(([k, [label, icon]]) => (results[k] && results[k].length ? `<div class="lk-grp"><h4>${ic(icon)}${label} <span class="muted">· clique pour sélectionner</span></h4>${results[k].map((x, i) => card(k, x, i)).join('')}</div>` : '')).join('')
      + (query && !any && !L.length && !$('#lk-load', w).innerHTML ? `<p class="muted">Rien trouvé en ligne pour « ${esc(query)} ». Tu peux créer la fiche à la main.</p>` : '');
    const n = Object.keys(picked).length;
    $('#lk-go', w).disabled = !n; $('#lk-go', w).innerHTML = `${ic('check')}Créer la fiche${n ? ` (${n} source${n > 1 ? 's' : ''})` : ''}`;
  };
  modal({ title: 'Ajouter un artiste', wide: true,
    body: `<div class="lk-bar"><div class="search" style="flex:1">${ic('search')}<input id="lk-q" style="width:100%" placeholder="Nom de l'artiste, ou colle un lien Spotify / Instagram / SoundCloud"></div><button class="btn primary" id="lk-s">Rechercher</button></div>
      <div id="lk-load" style="margin:12px 0 0"></div><div id="lk-res" style="max-height:56vh;overflow:auto;margin-top:8px"><p class="muted" style="margin:6px 0">L'app cherche l'artiste sur Spotify, Instagram, SoundCloud et Deezer, puis pré-remplit la fiche (photo, liens, auditeurs, abonnés). Tu vérifies avant d'enregistrer.</p></div>`,
    foot: `<button class="btn" id="lk-blank">${ic('edit')}Fiche vide</button><span class="sp"></span><button class="btn primary" id="lk-go" disabled>${ic('check')}Créer la fiche</button>`,
    onMount: (w, close) => {
      const q = $('#lk-q', w); q.focus();
      const search = async () => {
        query = q.value.trim(); if (!query) return;
        results = {}; picked = {};
        $('#lk-load', w).innerHTML = `<div class="muted" style="display:flex;gap:8px;align-items:center"><span class="spin" style="width:14px;height:14px;border:2px solid var(--accent);border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite"></span>Recherche de « ${esc(query)} » sur Spotify, Instagram, SoundCloud et Deezer…</div>`;
        drawResults(w);
        const r = await window.bv.lookupArtist(query);
        if (query !== q.value.trim()) return;
        $('#lk-load', w).innerHTML = r && r.error ? `<div class="callout bad">${esc(r.error)}</div>` : '';
        results = r && !r.error ? r : {};
        // présélection : le résultat au nom identique de chaque réseau
        Object.entries(results).forEach(([k, L]) => { const i = (L || []).findIndex((x) => (norm(x.name) === norm(query) || norm(x.handle || '').startsWith(norm(query))) && (x.stat || 0) >= 50); if (i >= 0 && k !== 'deezer') picked[k] = i; });
        drawResults(w);
      };
      $('#lk-s', w).onclick = search;
      q.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } };
      $('#lk-res', w).onclick = (e) => {
        if (e.target.closest('[data-act="open-url"]')) return;
        const o = e.target.closest('[data-open]'); if (o) { close(); return openArtist(o.dataset.open); }
        const c = e.target.closest('[data-src]'); if (!c) return;
        const k = c.dataset.src, i = +c.dataset.i;
        if (picked[k] === i) delete picked[k]; else picked[k] = i;
        drawResults(w);
      };
      $('#lk-blank', w).onclick = () => { close(); newArtist({ name: q.value.trim() }, null, proposeDefault); };
      $('#lk-go', w).onclick = async () => {
        const sel = Object.fromEntries(Object.entries(picked).map(([k, i]) => [k, results[k][i]]));
        const btn = $('#lk-go', w); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Préparation de la fiche…';
        const first = sel.spotify || sel.deezer || sel.soundcloud || sel.instagram;
        const imgSrc = [sel.spotify, sel.deezer, sel.soundcloud, sel.instagram].find((x) => x && x.img);
        const photo = imgSrc ? await window.bv.lookupImage(imgSrc.img) : null;
        const pop = { updatedAt: new Date().toISOString() };
        if (sel.spotify) { if (sel.spotify.statLabel === 'auditeurs/mois') pop.spotify = sel.spotify.stat || 0; if (sel.spotify.followers != null) pop.spotifyFollowers = sel.spotify.followers; if (sel.spotify.popularity != null) pop.spotifyPopularity = sel.spotify.popularity; }
        const selKeys = new Set(Object.values(sel).map((x) => linkKeyR(x.url)).filter(Boolean));
        const ex0 = results.extra || {};
        const ex = Object.values(ex0.links || {}).some((u) => selKeys.has(linkKeyR(u))) ? ex0 : {};
        const genres = [...((sel.spotify && sel.spotify.genres) || []), ...(ex.genres || [])];
        if (sel.instagram) pop.instagram = sel.instagram.stat || 0;
        if (sel.soundcloud) pop.soundcloud = sel.soundcloud.stat || 0;
        const prefill = {
          name: (first && first.name) || query, photo: typeof photo === 'string' ? photo : '',
          links: { spotify: sel.spotify ? sel.spotify.url : '', instagram: sel.instagram ? sel.instagram.url : '', soundcloud: sel.soundcloud ? sel.soundcloud.url : '', website: !sel.spotify && sel.deezer ? sel.deezer.url : '',
            ...Object.fromEntries(Object.entries(ex.links || {}).filter(([k, v]) => v && !(sel[k]))) },
          listeners: pop.spotify ?? null, popularity: pop, foundVia: 'Repéré sur le web / réseaux',
          styles: genresToStyles(genres), country: ex.country || '', genres,
          bio: sel.soundcloud && sel.soundcloud.desc ? sel.soundcloud.desc.replace(/\s+/g, ' ').trim().slice(0, 400) : '',
          notes: `Fiche créée depuis la recherche (${Object.keys(sel).map((k) => SRC[k][0]).join(', ')}) le ${fmtDate(new Date())}.`,
        };
        const dup = artists().find((a) => norm(a.name) === norm(prefill.name));
        if (dup) { close(); toast(`« ${dup.name} » est déjà dans ta base`, { action: 'Ouvrir', onAction: () => openArtist(dup.id) }); return; }
        close(); newArtist(prefill, null, proposeDefault);
        toast('Vérifie et complète la fiche (styles, origine…), puis enregistre');
      };
    } });
}

// Choisir des artistes de la base à proposer
function addProposalsDialog() {
  const draw = (q = '') => {
    const nq = norm(q);
    const L = artists().filter((a) => !nq || norm([a.name, a.styles.join(' '), a.city, a.country].join(' ')).includes(nq))
      .sort((a, b) => !!stOf(a) - !!stOf(b) || (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name, 'fr')).slice(0, 80);
    return L.map((a) => `<div class="it" data-pick="${a.id}">${avatar(a, 'sm')}<div class="tx"><b>${esc(a.name)}</b><span>${esc([a.styles.join(', '), origin(a)].filter(Boolean).join(' · '))}</span></div>${a.priority ? stars(a.priority) : ''}${stOf(a) ? `<span class="pill st-confirme">Proposé</span>` : `<button class="btn sm">${ic('plus')}Proposer</button>`}</div>`).join('') || '<p class="muted">Aucun artiste.</p>';
  };
  modal({ title: `Ajouter aux propositions ${esc(edition())}`, wide: true,
    body: `<div class="search" style="margin-bottom:10px">${ic('search')}<input id="ap-q" style="width:100%" placeholder="Chercher dans ta base (nom, style, ville…)"></div><div class="mini-list" id="ap-list" style="max-height:58vh;overflow:auto">${draw()}</div>`,
    foot: `<button class="btn" id="ap-new">${ic('user')}Nouvel artiste</button><span class="sp"></span><button class="btn primary" id="ap-ok">Terminé</button>`,
    onMount: (w, close) => {
      const q = $('#ap-q', w); q.focus();
      q.oninput = () => ($('#ap-list', w).innerHTML = draw(q.value));
      $('#ap-list', w).onclick = (e) => {
        const it = e.target.closest('[data-pick]'); if (!it) return;
        const a = byId(it.dataset.pick);
        if (stOf(a)) return openArtist(a.id);
        propose(a); toast(`${a.name} ajouté aux propositions`);
        $('#ap-list', w).innerHTML = draw(q.value); renderNav();
      };
      $('#ap-ok', w).onclick = () => { close(); render(); };
      $('#ap-new', w).onclick = () => { close(); addArtistDialog(true); };
    } });
}

// glisser-déposer
document.addEventListener('dragstart', (e) => { const c = e.target.closest('[data-drag]'); if (!c) return; e.dataTransfer.setData('text/plain', c.dataset.drag); c.classList.add('drag'); });
document.addEventListener('dragend', (e) => { const c = e.target.closest && e.target.closest('[data-drag]'); if (c) c.classList.remove('drag'); $$('.col.over').forEach((x) => x.classList.remove('over')); });
document.addEventListener('dragover', (e) => { const col = e.target.closest('[data-drop]'); if (!col) return; e.preventDefault(); $$('.col.over').forEach((x) => x !== col && x.classList.remove('over')); col.classList.add('over'); });
document.addEventListener('drop', (e) => {
  const col = e.target.closest('[data-drop]'); if (!col) return;
  e.preventDefault();
  const a = byId(e.dataTransfer.getData('text/plain'));
  if (a && stOf(a) !== col.dataset.drop) setStatus(a, col.dataset.drop);
  render();
});

function setStatus(a, st) {
  const p0 = propOf(a), old = p0 ? p0.status : '';
  const p = propose(a, st, true);
  touch(a, old ? `${edition()} : ${STATUS_L[old]} → ${STATUS_L[st]}` : `Ajouté aux propositions ${edition()} (${STATUS_L[st]})`);
  toast(`${a.name} → ${STATUS_L[st]}`, { action: 'Annuler', onAction: () => { if (old) p.status = old; else S.data.proposals = proposals().filter((x) => x !== p); a.history.shift(); touch(a); render(); refreshDrawer(); } });
}

// ---------- fiche artiste (tiroir) ----------
function openArtist(id, edit = false) {
  if (!S.drawer || S.drawer.id !== id) { S.openSecs.clear(); S.player = null; }
  S.drawer = { id, edit };
  if (edit) S.drawer.copy = JSON.parse(JSON.stringify(byId(id)));
  refreshDrawer();
  $('#drawer').classList.add('on'); $('#scrim').classList.add('on');
}
function newArtist(prefill = {}, mailLink = null, proposeDefault = false) {
  const a = fixArtist({ ...blankArtist(), ...prefill });
  S.drawer = { id: a.id, edit: true, draft: a, mailLink, proposeDefault };
  refreshDrawer();
  $('#drawer').classList.add('on'); $('#scrim').classList.add('on');
  setTimeout(() => { const n = $('#drawer [name="name"]'); n && n.focus(); }, 250);
}
function closeDrawer() {
  S.drawer = null; $('#drawer').dataset.id = '';
  setTimeout(() => { if (!S.drawer) $('#drawer').innerHTML = ''; }, 250); // coupe le lecteur
  $('#drawer').classList.remove('on'); $('#scrim').classList.remove('on');
}
function refreshDrawer() {
  if (!S.drawer) return;
  const a = S.drawer.draft || (S.drawer.edit && S.drawer.copy) || byId(S.drawer.id);
  if (!a) return closeDrawer();
  const dr = $('#drawer');
  // même fiche, même lecteur : on ne recharge pas le lecteur (la musique continue)
  const pl = $('#dv-player', dr);
  if (!S.drawer.edit && dr.dataset.id === a.id && pl && pl.dataset.src === ((curPlayer(a) || {}).src || '')) {
    const db = $('.db', dr), sc = db.scrollTop;
    $('#dv-head', dr).outerHTML = drawerHead(a); $('#dv-a', dr).innerHTML = drawerA(a); $('#dv-b', dr).innerHTML = drawerB(a);
    db.scrollTop = sc; return;
  }
  dr.dataset.id = S.drawer.edit ? '' : a.id;
  dr.innerHTML = S.drawer.edit ? drawerEdit(a) : drawerView(a);
}

function linkBtn(url, icon, label) {
  if (!url) return '';
  const u = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  return `<button class="btn sm" data-act="open-url" data-url="${esc(u)}">${ic(icon)}${label}</button>`;
}
// Lecteurs intégrés : Spotify (artiste, album, titre, playlist), SoundCloud (profil ou titre), YouTube (vidéo, playlist, chaîne /channel/)
function playersOf(a) {
  const L = [], https = (u) => (/^https?:\/\//i.test(u) ? u : 'https://' + u);
  let m;
  if ((m = String(a.links.spotify || '').match(/spotify\.com\/(?:intl-[a-z-]+\/)?(artist|album|track|playlist)\/([A-Za-z0-9]+)/)))
    L.push({ k: 'spotify', l: 'Spotify', icon: 'spotify', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator`, h: 352 });
  const sc = String(a.links.soundcloud || '');
  if (/soundcloud\.com\/[^/?#]+/i.test(sc))
    L.push({ k: 'soundcloud', l: 'SoundCloud', icon: 'soundcloud', src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(https(sc.trim()))}&color=%231463f3&auto_play=false&hide_related=true&show_comments=false&show_reposts=false&visual=false`, h: 330 });
  const yt = String(a.links.youtube || '');
  let ys = '';
  if ((m = yt.match(/(?:[?&]v=|youtu\.be\/|\/embed\/|\/shorts\/)([\w-]{11})/))) ys = `https://www.youtube-nocookie.com/embed/${m[1]}`;
  else if ((m = yt.match(/[?&]list=([\w-]+)/))) ys = `https://www.youtube-nocookie.com/embed/videoseries?list=${m[1]}`;
  else if ((m = yt.match(/\/channel\/UC([\w-]{22})/))) ys = `https://www.youtube-nocookie.com/embed/videoseries?list=UU${m[1]}`;
  if (ys) L.push({ k: 'youtube', l: 'YouTube', icon: 'youtube', src: ys, h: 320 });
  return L;
}
function curPlayer(a) {
  const L = playersOf(a);
  return L.find((p) => S.player && S.player.id === a.id && p.k === S.player.k) || L[0] || null;
}
function drawerPlayer(a) {
  const L = playersOf(a), p = curPlayer(a);
  if (!p) return `<div id="dv-player" data-src=""></div>`;
  return `<div id="dv-player" class="sec" data-src="${esc(p.src)}"><h3>${ic('music')}Écouter<span class="sp"></span>${L.length > 1 ? `<span class="seg">${L.map((x) => `<button class="${x.k === p.k ? 'on' : ''}" data-act="player" data-k="${x.k}">${ic(x.icon)}${x.l}</button>`).join('')}</span>` : ''}</h3>
    <div class="player"><iframe src="${esc(p.src)}" style="height:${p.h}px" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe></div></div>`;
}
function drawerHead(a) {
  return `<div class="dh" id="dv-head" style='background:${bgOf(a)}'>
    <div class="x"><button class="btn sm" data-act="enrich-one" title="Compléter liens, photo, styles et popularité (Spotify, Wikidata…)">${ic('refresh')}Compléter</button><button class="btn sm" data-act="ask-artist" data-id="${a.id}">${ic('sparkle')}Orbiz</button><button class="btn sm" data-act="edit-artist">${ic('edit')}Modifier</button><button class="btn sm icon" data-act="close-drawer">${ic('x')}</button></div>
    <div><h2>${esc(a.name)}</h2>
      <div class="or">${origin(a) ? `<span>${ic('pin')}${esc(origin(a))}</span>` : ''}${a.formation ? `<span>${ic('users')}${esc(a.formation)}</span>` : ''}${a.listeners ? `<span>${ic('spotify')}${nf.format(a.listeners)} auditeurs/mois</span>` : ''}</div>
      <div class="tg">${popTag(a)}${a.styles.map((s) => `<span class="tag"><span class="dot" style="background:${styleColor(s)}"></span>${esc(s)}</span>`).join('')}</div></div>
  </div>`;
}
// barre de statut + suggestion (au-dessus du lecteur)
function drawerA(a) {
  return `<div class="bar">${propOf(a) ? `<span class="muted" style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">${esc(edition())}</span><div class="statusbar">${STATUSES.map((s) => `<button class="${stOf(a) === s.k ? 'on st-' + s.k : ''}" data-act="set-status" data-status="${s.k}">${s.l}</button>`).join('')}</div><button class="btn sm ghost" data-act="unpropose" title="Retirer des propositions ${esc(edition())}">${ic('x')}Retirer</button>`
      : `<button class="btn sm primary" data-act="propose">${ic('plus')}Proposer pour ${esc(edition())}</button><span class="muted" style="font-size:12.5px">Dans ta base, pas encore proposé.</span>`}<div class="sp" style="flex:1"></div>
      <span class="stars edit">${[1, 2, 3].map((i) => `<button data-act="set-prio" data-p="${i}" title="Priorité ${i}"><svg viewBox="0 0 24 24" class="${i <= (a.priority || 0) ? '' : 'off'}"><path d="${STAR}"/></svg></button>`).join('')}</span></div>
    ${a.suggest ? `<div class="callout" style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="flex:1;min-width:240px"><b>Suggestion</b> d'après les profils de l'artiste (${esc(a.suggest.from || '')}) :
        ${a.suggest.weak ? `<span class="pill st-negociation" title="Trouvé par le nom seul : peut être un homonyme">à confirmer · ${esc(a.suggest.weak)}</span> ` : ''}${[a.suggest.city && `ville <b>${esc(a.suggest.city)}</b>`, a.suggest.country && `pays <b>${esc(a.suggest.country)}</b>`, a.suggest.styles && `styles <b>${esc(a.suggest.styles.join(', '))}</b>`].filter(Boolean).join(' · ')}
        <span class="muted">(actuellement : ${esc([a.city, a.country].filter(Boolean).join(', ') || '—')}${a.suggest.styles ? ' · ' + esc(a.styles.join(', ') || '—') : ''})</span></span>
        <button class="btn sm primary" data-act="sugg-apply">Appliquer</button><button class="btn sm" data-act="sugg-ignore">Ignorer</button></div>` : ''}`;
}
// le reste : présentation, l'essentiel, puis les détails repliés (messages, mails, historique…)
function drawerB(a) {
  const f = a.fee || {};
  const inc = Object.entries({ hebergement: 'Hébergement', transport: 'Transport', catering: 'Catering', technique: 'Technique' }).filter(([k]) => f.includes && f.includes[k]).map(([, l]) => `<span class="tag">${ic('check')}${l} à notre charge</span>`).join('');
  const chf = feeCHF(a), p = popOf(a), d = a.popularity || {};
  const mails = Mail.mailsForArtist(a);
  const links = [linkBtn(a.links.spotify, 'spotify', 'Spotify'), linkBtn(a.links.youtube, 'youtube', 'YouTube'), linkBtn(a.links.soundcloud, 'soundcloud', /bandcamp/i.test(a.links.soundcloud || '') ? 'Bandcamp' : 'SoundCloud'), linkBtn(a.links.instagram, 'instagram', 'Instagram'), linkBtn(a.links.tiktok, 'tiktok', 'TikTok'), linkBtn(a.links.facebook, 'facebook', 'Facebook'), linkBtn(a.links.website, 'globe', 'Site / EPK')].join('');
  const fact = (l, v, span = 1) => `<div class="fact" ${span > 1 ? `style="grid-column:span ${span}"` : ''}><div class="l">${l}</div><div class="v">${v || '<span class="muted" style="font-weight:400">—</span>'}</div></div>`;
  const fold = (k, title, n, body) => `<details class="fold" data-sec="${k}" ${S.openSecs.has(k) ? 'open' : ''}><summary>${title}${n != null ? `<span class="n">${n}</span>` : ''}</summary><div class="fb">${body}</div></details>`;
  const contact = [a.contact.agency, a.contact.name].filter(Boolean).join(' · ');
  const tt = window.TT ? TT.placesText(a) : '';
  const chip = (icon, label, v, unit) => (v != null ? `<span class="tag">${ic(icon)}${label} : <b>${nf.format(v)}</b> ${unit}</span>` : '');
  return `
    ${links ? `<div class="links" style="margin-top:12px">${links}</div>` : ''}
    ${!playersOf(a).length ? `<p class="muted" style="margin:12px 0 0;font-size:13px">${ic('music')} Pas de lecteur : ajoute un lien Spotify, SoundCloud ou une vidéo YouTube (<a href="#" data-act="edit-artist">Modifier</a>) ou clique sur « Compléter ».</p>` : ''}
    <div class="sec"><h3>Présentation</h3>${a.bio ? `<p class="bio">${esc(a.bio)}</p>` : `<p class="muted" style="margin:0">Pas encore de présentation. <a href="#" data-act="edit-artist">Ajouter</a> ou <a href="#" data-act="ask-artist" data-id="${a.id}">demander à Orbiz</a>.</p>`}</div>
    <div class="sec"><h3>En bref</h3><div class="facts">
      ${fact('Cachet', esc(feeText(a)) + (chf && f.currency !== 'CHF' ? `<div class="muted" style="font-size:11.5px;font-weight:400">≈ ${money(chf)}</div>` : ''))}
      ${fact('Popularité', p ? `${esc(p.tier)} <span class="muted" style="font-weight:400">· ${p.score}/100</span>` : '')}
      ${fact('Trouvé via', a.foundVia ? `<span style="display:inline-flex;gap:6px;align-items:center">${ic(viaIcon(a.foundVia))}${esc(a.foundVia)}</span>` : '')}
      ${fact('Contact booking', (contact ? esc(contact) : '') + (a.contact.email ? `${contact ? '<br>' : ''}<a href="#" data-act="write-artist" data-id="${a.id}" style="font-weight:500">${esc(a.contact.email)}</a>` : '') + (a.contact.phone ? `<br><a href="#" data-act="open-url" data-url="tel:${esc(a.contact.phone)}" style="font-weight:500">${esc(a.contact.phone)}</a>` : ''), 2)}
      ${fact('Disponibilités', esc(a.availability))}
      ${tt ? fact('Timetable', tt, 3) : ''}
    </div></div>
    <div class="sec"><h3>Notes internes</h3>
      <div class="field"><textarea id="notes-${a.id}" data-input="artist-notes" placeholder="Avis du comité, remarques, idées de créneau…" style="min-height:70px">${esc(a.notes)}</textarea></div></div>
    <div class="sec folds">
      ${a.messages.length ? fold('messages', `${ic('inbox')}Messages reçus`, a.messages.length, a.messages.map((m, i) => `<details class="msg" ${i === 0 ? 'open' : ''}><summary><b>${esc(m.source || 'Message')}</b><span class="muted"> · ${esc(m.date || '')}${m.author ? ' · ' + esc(m.author) : ''}</span></summary>
        <div class="msg-meta">${m.email ? `<a href="#" data-act="write-to" data-to="${esc(m.email)}" data-id="${a.id}">${ic('mail')}${esc(m.email)}</a>` : ''}${m.phone ? `<a href="#" data-act="open-url" data-url="tel:${esc(m.phone.replace(/\s/g, ''))}">${ic('phone')}${esc(m.phone)}</a>` : ''}</div>
        <div class="msg-txt">${linkText(m.text)}</div></details>`).join('')) : ''}
      ${fold('mails', `${ic('mail')}Échanges mail`, mails.length, `<div class="mlinks">${mails.length ? mails.slice(0, 12).map((m) => `<div class="ml" data-act="open-mail" data-uid="${m.uid}" data-folder="${esc(m.folder || 'INBOX')}">${ic(m.folder && m.folder !== 'INBOX' ? 'send' : 'mail')}<div class="tx"><b>${esc(m.subject)}</b><span>${esc((m.from && (m.from.name || m.from.address)) || '')} · ${fmtDate(m.date)}${m.manual ? ' · lié manuellement' : ''}</span></div>${m.seen === false ? '<span class="pill st-contacte">Non lu</span>' : ''}</div>`).join('')
        : `<p class="muted" style="margin:0">Aucun mail trouvé. Les mails venant de l'adresse de contact ou mentionnant « ${esc(a.name)} » apparaissent ici automatiquement.</p>`}</div>`)}
      ${fold('fee', `${ic('money')}Cachet & conditions`, null, `<div class="fee-box"><div><div class="big">${esc(feeText(a)) || '<span class="muted" style="font-size:16px;font-weight:500">Non renseigné</span>'}</div>${chf && f.currency !== 'CHF' ? `<div class="conv">≈ ${money(chf)}${f.type === 'fourchette' && f.max ? ' (bas de fourchette)' : ''}</div>` : ''}</div><div class="inc">${inc}</div></div>${f.notes ? `<p class="bio" style="margin-top:10px;font-size:13.5px">${esc(f.notes)}</p>` : ''}`)}
      ${fold('pop', `${ic('sparkle')}Popularité détaillée`, null, p ? `<div class="pop-box"><div class="pop-score"><b>${p.score}</b><span>/ 100</span></div><div style="flex:1;min-width:0"><div class="pop-tier">${esc(p.tier)} <span class="muted">· audience cumulée ≈ ${nf.format(p.R)}</span></div>
        <div class="meter" style="margin:8px 0 10px"><i style="width:${p.score}%;background:var(--accent)"></i></div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${chip('spotify', 'Spotify', d.spotify, 'auditeurs/mois')}${chip('spotify', 'Spotify', d.spotifyFollowers, 'abonnés')}${d.spotifyPopularity != null ? `<span class="tag">${ic('spotify')}Indice Spotify : <b>${d.spotifyPopularity}</b>/100</span>` : ''}${chip('instagram', 'Instagram', d.instagram, 'abonnés')}${chip('soundcloud', 'SoundCloud', d.soundcloud, 'abonnés')}${chip('youtube', 'YouTube', d.youtube, 'abonnés')}${chip('music', 'Last.fm', d.lastfm, 'auditeurs')}</div>
        ${d.note ? `<div class="muted" style="font-size:12px;margin-top:8px">${esc(d.note)}</div>` : ''}${d.updatedAt ? `<div class="muted" style="font-size:12px;margin-top:6px">mise à jour le ${fmtDate(d.updatedAt)}</div>` : ''}</div></div>` : `<p class="muted" style="margin:0">Pas encore de données (aucun compte Spotify, Instagram ou SoundCloud connu).</p>`)}
      ${fold('more', `${ic('file')}Autres infos`, null, `<div class="facts">${fact('Proposé par / source', esc(a.source))}${fact('Origine', esc(origin(a)) + (a.originSource || a.citySource ? `<div class="muted" style="font-size:11.5px;font-weight:400">source : ${esc([...new Set([a.citySource, a.originSource].filter(Boolean))].join(', '))}</div>` : ''))}${fact('Formation', esc(a.formation))}
        ${a.genres && a.genres.length ? fact('Genres détectés (profils en ligne)', a.genres.map((g) => `<span class="tag" style="margin:2px 4px 2px 0;font-weight:500">${esc(g)}</span>`).join(''), 3) : ''}
        ${fact('Ajouté le', fmtDate(a.createdAt))}${fact('Dernière modif.', fmtDate(a.updatedAt))}${fact('Tags', esc(a.tags.join(', ')))}</div>`)}
      ${fold('hist', `${ic('clock')}Historique`, a.history.length, `<div class="addnote" style="margin-top:0"><input id="hist-in" placeholder="Ajouter une étape (ex. « Appel avec l'agent, offre envoyée »)" data-enter="add-history"><button class="btn sm" data-act="add-history">Ajouter</button></div>
        <div class="hist" style="margin-top:8px">${a.history.map((h, i) => `<div class="h"><span class="d">${fmtDate(h.d, { day: '2-digit', month: '2-digit', year: '2-digit' })}</span><span>${esc(h.t)}</span><span class="del" data-act="del-history" data-i="${i}" title="Supprimer">${ic('x')}</span></div>`).join('') || '<p class="muted">Rien pour l’instant.</p>'}</div>`)}
    </div>
    <div class="sec" style="padding-top:24px"><button class="btn sm danger" data-act="delete-artist">${ic('trash')}Supprimer cet artiste</button></div>`;
}
function drawerView(a) {
  return `${drawerHead(a)}<div class="db"><div id="dv-a">${drawerA(a)}</div>${drawerPlayer(a)}<div id="dv-b">${drawerB(a)}</div></div>`;
}

function drawerEdit(a) {
  const f = a.fee;
  const isNew = !!S.drawer.draft;
  const allStyles = [...new Set([...settings().styles, ...a.styles])];
  const inp = (name, label, val, cls = 'half', type = 'text', extra = '') => `<div class="field ${cls}"><label>${label}</label><input name="${name}" type="${type}" value="${esc(val ?? '')}" ${extra}></div>`;
  return `
  <div class="dh" style='background:${bgOf(a)};min-height:120px'>
    <div class="x"><button class="btn sm icon" data-act="cancel-edit">${ic('x')}</button></div>
    <div><h2>${isNew ? 'Nouvel artiste' : 'Modifier ' + esc(a.name)}</h2></div>
  </div>
  <form class="db" id="artist-form" autocomplete="off">
    <div class="form">
      <div class="field full"><label>Nom de scène *</label><input name="name" required value="${esc(a.name)}" placeholder="Nom de l'artiste ou du groupe"></div>
      <div class="field full"><label>Styles</label><div class="stylepick">${allStyles.map((s) => `<button type="button" class="chip ${a.styles.includes(s) ? 'on' : ''}" data-act="pick-style" data-style="${esc(s)}"><span class="dot" style="background:${styleColor(s)}"></span>${esc(s)}</button>`).join('')}
        <button type="button" class="chip" data-act="new-style">${ic('plus')}Autre style</button></div></div>
      ${inp('country', 'Pays', a.country, 'third', 'text', 'list="countries"')}${inp('city', 'Ville', a.city, 'third')}
      <div class="field third"><label>Formation</label><select name="formation"><option value=""></option>${FORMATIONS.map((x) => `<option ${a.formation === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="field full"><label>Petite présentation</label><textarea name="bio" rows="5" placeholder="Qui est l'artiste, son univers, ce qui le rend intéressant pour le festival…">${esc(a.bio)}</textarea></div>
      <div class="field full"><label>Photo</label><div class="photo-edit"><div class="av" id="photo-prev" style='background:${bgOf(a)}'>${a.photo ? '' : esc(initials(a.name))}</div>
        <div class="col2"><input name="photo" value="${esc(a.photo && a.photo.startsWith('data:') ? '' : a.photo)}" placeholder="Coller l'adresse d'une image (clic droit sur une photo → Copier l'adresse de l'image)">
        <div class="row-actions"><button type="button" class="btn sm" data-act="pick-photo">${ic('upload')}Choisir un fichier</button>${a.photo ? `<button type="button" class="btn sm ghost" data-act="clear-photo">Retirer la photo</button>` : ''}</div></div></div>
        <input type="file" id="photo-file" accept="image/*" hidden></div>
      <div class="field third"><label>${esc(edition())}</label><select name="editionStatus">${(() => { const cur = S.drawer.draft ? (S.drawer.proposeDefault ? 'proposition' : '') : stOf(byId(S.drawer.id)); return `<option value="">Pas proposé</option>` + STATUSES.map((s) => `<option value="${s.k}" ${cur === s.k ? 'selected' : ''}>Proposé · ${s.l}</option>`).join(''); })()}</select></div>
      <div class="field third"><label>Priorité</label><select name="priority">${[0, 1, 2, 3].map((p) => `<option value="${p}" ${a.priority == p ? 'selected' : ''}>${p ? '★'.repeat(p) : 'Aucune'}</option>`).join('')}</select></div>
      ${inp('listeners', 'Auditeurs mensuels Spotify', a.listeners, 'third', 'number', 'min="0"')}
      <div class="field third"><label>Trouvé via</label><input name="foundVia" list="found-via" value="${esc(a.foundVia || '')}" placeholder="Choisir ou écrire…"><datalist id="found-via">${FOUND_VIA.map((v) => `<option value="${esc(v)}">`).join('')}</datalist></div>
      ${inp('source', 'Proposé par / détail', a.source, 'third', 'text', 'placeholder="Agence X, mail de…, membre du comité…"')}${inp('availability', 'Disponibilités', a.availability, 'third', 'text', 'placeholder="ex. dispo vendredi"')}

      <h4>Cachet & conditions</h4>
      <div class="field third"><label>Type</label><select name="fee.type"><option value="fixe" ${f.type === 'fixe' ? 'selected' : ''}>Cachet fixe</option><option value="fourchette" ${f.type === 'fourchette' ? 'selected' : ''}>Fourchette</option><option value="negocier" ${f.type === 'negocier' ? 'selected' : ''}>À négocier</option></select></div>
      ${inp('fee.amount', f.type === 'fourchette' ? 'Montant min.' : 'Montant', f.amount, 'third', 'number', 'min="0" step="50"')}
      <div class="field third"><label>Devise</label><select name="fee.currency">${CURRENCIES.map((c) => `<option ${f.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      ${f.type === 'fourchette' ? inp('fee.max', 'Montant max.', f.max, 'third', 'number', 'min="0" step="50"') : ''}
      <div class="field full"><label>À la charge du festival</label><div class="checks">${Object.entries({ hebergement: 'Hébergement', transport: 'Transport', catering: 'Catering', technique: 'Technique / backline' }).map(([k, l]) => `<label><input type="checkbox" name="fee.includes.${k}" ${f.includes[k] ? 'checked' : ''}>${l}</label>`).join('')}</div></div>
      <div class="field full"><label>Remarques sur le tarif</label><input name="fee.notes" value="${esc(f.notes)}" placeholder="ex. hors TVA, % sur la billetterie, dégressif si 2 dates…"></div>

      <h4>Contact booking</h4>
      ${inp('contact.agency', 'Agence / label', a.contact.agency)}${inp('contact.name', 'Nom du contact', a.contact.name)}
      ${inp('contact.email', 'Email', a.contact.email, 'half', 'email')}${inp('contact.phone', 'Téléphone', a.contact.phone)}

      <h4>Liens</h4>
      ${inp('links.spotify', 'Spotify', a.links.spotify)}${inp('links.youtube', 'YouTube', a.links.youtube)}
      ${inp('links.soundcloud', 'SoundCloud / Bandcamp', a.links.soundcloud)}${inp('links.instagram', 'Instagram', a.links.instagram)}
      ${inp('links.facebook', 'Facebook', a.links.facebook)}${inp('links.tiktok', 'TikTok', a.links.tiktok)}
      ${inp('links.website', 'Site / EPK / dossier de presse', a.links.website, 'full')}
    </div>
    <datalist id="countries">${COUNTRIES.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="form-actions"><button type="button" class="btn" data-act="cancel-edit">Annuler</button><button type="submit" class="btn primary">${ic('check')}${isNew ? 'Créer la fiche' : 'Enregistrer'}</button></div>
  </form>`;
}

// lit le formulaire dans l'objet (sans enregistrer)
function readForm(a) {
  const form = $('#artist-form');
  if (!form) return a;
  const set = (path, v) => { const k = path.split('.'); let o = a; k.slice(0, -1).forEach((x) => (o = o[x] = o[x] || {})); o[k[k.length - 1]] = v; };
  $$('input[name], select[name], textarea[name]', form).forEach((el) => {
    const n = el.name;
    if (n === 'photo') { if (el.value.trim()) a.photo = el.value.trim(); else if (a.photo && !a.photo.startsWith('data:')) a.photo = ''; return; }
    if (el.type === 'checkbox') return set(n, el.checked);
    let v = el.value.trim();
    if (['fee.amount', 'fee.max', 'listeners'].includes(n)) v = v === '' ? null : Number(v);
    if (n === 'priority') v = Number(v);
    set(n, v);
  });
  return a;
}

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'artist-form') return;
  e.preventDefault();
  const d = S.drawer;
  const a = readForm(editTarget());
  if (!a.name) return toast('Le nom est obligatoire', { error: true });
  if (d.draft) {
    const dup = artists().find((x) => norm(x.name) === norm(a.name));
    if (dup) { toast(`« ${dup.name} » existe déjà dans la base`, { error: true, action: 'Ouvrir', onAction: () => openArtist(dup.id) }); return; }
    a.history.unshift({ d: new Date().toISOString(), t: 'Fiche créée' + (d.mailLink ? ' depuis un mail' : '') });
    if (d.mailLink) a.mailLinks.push(d.mailLink);
    artists().unshift(a);
    touch(a);
    toast(`${a.name} ajouté`);
  } else {
    const i = artists().findIndex((x) => x.id === a.id);
    artists()[i] = a;
    touch(a);
    toast('Fiche enregistrée');
  }
  const bs = a.editionStatus; delete a.editionStatus;
  const stored = byId(a.id); if (stored) delete stored.editionStatus;
  if (bs !== undefined) { const cur = stOf(a); if (bs && bs !== cur) { if (cur) propOf(a).status = bs; else propose(a, bs); } else if (!bs && cur) unpropose(a); save(); }
  S.drawer = { id: a.id, edit: false };
  refreshDrawer();
  render();
});

// photo depuis un fichier : redimensionnée et stockée dans la fiche
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'photo-file') return;
  const file = e.target.files[0]; if (!file) return;
  const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
  const img = new Image();
  img.onload = () => {
    const max = 800, k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const t = editTarget();
    readForm(t);
    t.photo = c.toDataURL('image/jpeg', 0.85);
    rerenderEdit(t);
  };
  img.src = url;
});

// ---------- paramètres ----------
function viewSettings() {
  const st = settings();
  const acc = Mail.account();
  return `<div class="page">${head('Paramètres', 'Festival, styles, boîte mail et données')}
  <div class="settings">
    <div style="display:flex;flex-direction:column;gap:16px">
    <div class="card panel"><h2>${ic('calendar')}Festival</h2>
      <div class="form">
        <div class="field full"><label>Nom de l'édition</label><input id="st-edition" value="${esc(st.edition)}" data-input="setting" data-key="edition"></div>
        <div class="field half"><label>Premier jour</label><input type="date" value="${esc(st.dateStart)}" data-change="setting" data-key="dateStart"></div>
        <div class="field half"><label>Dernier jour</label><input type="date" value="${esc(st.dateEnd)}" data-change="setting" data-key="dateEnd"></div>
        <div class="field half"><label>Budget artistique (CHF)</label><input type="number" min="0" step="500" value="${st.budget || ''}" data-change="setting" data-key="budget" data-num="1"></div>
        <div class="field half"><label>Nombre de créneaux à remplir</label><input type="number" min="0" value="${st.slots || ''}" data-change="setting" data-key="slots" data-num="1"></div>
        <div class="field full"><label>Taux de conversion vers CHF</label><div class="checks">${['EUR', 'USD', 'GBP'].map((c) => `<label>1 ${c} = <input type="number" step="0.01" style="width:80px;border:1px solid var(--line-strong);border-radius:6px;padding:4px 6px;background:var(--surface)" value="${st.rates[c]}" data-change="rate" data-cur="${c}"> CHF</label>`).join('')}</div><div class="hint">Sert à additionner les cachets dans le budget.</div></div>
      </div></div>
    <div class="card panel"><h2>${ic('music')}Styles musicaux</h2>
      <div class="style-edit">${st.styles.map((s) => `<span class="tag"><span class="dot" style="background:${styleColor(s)}"></span>${esc(s)}<button data-act="del-style" data-style="${esc(s)}" title="Retirer">${ic('x')}</button></span>`).join('')}</div>
      <div class="addnote"><input id="new-style" placeholder="Ajouter un style (ex. Shatta, Hyperpop…)" data-enter="add-style"><button class="btn sm" data-act="add-style">Ajouter</button></div></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px">
    <div class="card panel"><h2>${ic('mail')}Boîte mail</h2>
      ${Owa.active() ? `<p style="margin:0 0 12px">Mode <b>Outlook intégré</b> (${esc(settings().owaUrl && settings().owaUrl.includes('live.com') ? Owa.URLS.perso.l : Owa.URLS.pro.l)}).</p>
        <div class="row-actions"><button class="btn sm" data-act="nav" data-view="mail">${ic('mail')}Ouvrir Outlook</button><button class="btn sm" data-act="owa-switch">${ic('edit')}Changer de type de compte</button><button class="btn sm danger" data-act="owa-logout">${ic('trash')}Se déconnecter d'Outlook</button><button class="btn sm ghost" data-act="owa-leave">Connexion avancée (IMAP)</button></div>`
      : acc ? `<p style="margin:0 0 12px">Connectée : <b>${esc(acc.email)}</b> <span class="muted">(${esc(acc.imapHost)})</span></p>
        <div class="row-actions"><button class="btn sm" data-act="mail-setup">${ic('edit')}Modifier</button><button class="btn sm danger" data-act="mail-remove">${ic('trash')}Déconnecter</button></div>`
        : `<p class="muted" style="margin:0 0 12px">Aucune boîte connectée.</p><div class="row-actions"><button class="btn primary sm" data-act="owa-switch">${ic('mail')}Outlook intégré (le plus simple)</button><button class="btn sm" data-act="mail-setup">${ic('plus')}Connexion avancée (IMAP)</button></div>`}
      ${!Owa.active() && acc ? `<div class="row-actions" style="margin-top:8px"><button class="btn sm ghost" data-act="owa-switch">${ic('mail')}Utiliser Outlook intégré à la place</button></div>` : ''}</div>
    <div class="card panel"><h2>${ic('archive')}Données</h2>
      <p class="muted" style="margin:0 0 12px;line-height:1.5">Tout est enregistré automatiquement sur cet ordinateur, avec une sauvegarde par jour (30 jours gardés).</p>
      <div class="row-actions" style="margin-bottom:10px"><button class="btn sm" data-act="export-csv">${ic('download')}Exporter CSV (Excel)</button><button class="btn sm" data-act="import-csv">${ic('upload')}Importer CSV</button><button class="btn sm" data-act="export-pdf">${ic('file')}Dossier PDF</button></div>
      <div class="row-actions" style="margin-bottom:10px"><button class="btn sm" data-act="backup-export">${ic('download')}Sauvegarde complète (.json)</button><button class="btn sm" data-act="backup-import">${ic('upload')}Restaurer une sauvegarde</button><button class="btn sm ghost" data-act="open-data">${ic('folder')}Ouvrir le dossier</button></div>
      <div class="row-actions">${artists().some((a) => a.tags.includes('exemple')) ? `<button class="btn sm danger" data-act="remove-examples">${ic('trash')}Supprimer les exemples</button>` : `<button class="btn sm ghost" data-act="load-examples">${ic('sparkle')}Charger des exemples fictifs</button>`}</div></div>
    <div class="card panel"><h2>${ic('globe')}Sources de données (API)</h2>${keysPanel()}</div>
    <div class="card panel"><h2>${ic('sparkle')}Orbiz</h2><p class="muted" style="margin:0;line-height:1.55">Le logiciel est pilotable depuis le chat d'Orbiz : « analyse les mails de booking de cette semaine », « crée la fiche de l'artiste du dernier mail », « liste les artistes techno en négo »… Orbiz prépare les réponses, mais c'est toujours toi qui cliques sur Envoyer.</p></div>
    </div>
  </div></div>`;
}

function keysPanel() {
  const k = S.keysMask || {}, st = S.keys || {};
  const ok = (b) => (b ? '<span class="pill st-confirme">Active</span>' : '<span class="pill st-proposition">Pas de clé</span>');
  const f = (id, label, val, ph) => `<div class="field half"><label>${label}</label><input id="${id}" type="password" value="${esc(val || '')}" placeholder="${ph}" autocomplete="off"></div>`;
  return `<p class="muted" style="margin:0 0 12px;line-height:1.5;font-size:13px">Ces services officiels complètent les fiches automatiquement : liens, photo, genres → styles, pays, popularité. Les clés sont gratuites et restent chiffrées sur cet ordinateur. <b>Wikidata</b> fonctionne sans clé.</p>
    <details open style="margin-bottom:10px"><summary style="cursor:pointer;font-weight:600">Spotify ${ok(st.spotify)}</summary>
      <ol style="margin:8px 0;padding-left:20px;font-size:13px;line-height:1.6"><li>Va sur <a href="#" data-act="open-url" data-url="https://developer.spotify.com/dashboard">developer.spotify.com/dashboard</a> et connecte-toi avec ton compte Spotify.</li>
      <li>« Create app » : nom <code>IrisProg</code>, description libre, Redirect URI <code>http://127.0.0.1:8888/callback</code>, coche <b>Web API</b>, accepte les conditions.</li>
      <li>Dans l'app → « Settings » : copie le <b>Client ID</b> et le <b>Client secret</b> (« View client secret ») ici.</li></ol>
      <div class="form" style="padding:0">${f('k-spid', 'Client ID', k.spotifyId, 'xxxxxxxxxxxxxxxx')}${f('k-spsec', 'Client secret', k.spotifySecret, 'xxxxxxxxxxxxxxxx')}</div></details>
    <details style="margin-bottom:10px"><summary style="cursor:pointer;font-weight:600">Last.fm (tags de style, auditeurs) ${ok(st.lastfm)}</summary>
      <p style="font-size:13px;margin:8px 0">Crée une clé sur <a href="#" data-act="open-url" data-url="https://www.last.fm/api/account/create">last.fm/api/account/create</a> (nom d'app libre, le reste peut rester vide) et colle l'« API key ».</p>
      <div class="form" style="padding:0">${f('k-lf', 'API key', k.lastfmKey, '32 caractères')}</div></details>
    <details style="margin-bottom:10px"><summary style="cursor:pointer;font-weight:600">Discogs (liens, très bon pour les DJs) ${ok(st.discogs)}</summary>
      <p style="font-size:13px;margin:8px 0">Sur <a href="#" data-act="open-url" data-url="https://www.discogs.com/settings/developers">discogs.com/settings/developers</a> : « Generate new token » et colle-le ici.</p>
      <div class="form" style="padding:0">${f('k-dg', 'Token personnel', k.discogsToken, 'token Discogs')}</div></details>
    <details style="margin-bottom:10px"><summary style="cursor:pointer;font-weight:600">YouTube (abonnés) ${ok(st.youtube)}</summary>
      <p style="font-size:13px;margin:8px 0">Sur <a href="#" data-act="open-url" data-url="https://console.cloud.google.com/apis/library/youtube.googleapis.com">console.cloud.google.com</a> : crée un projet, active « YouTube Data API v3 », puis « Identifiants » → « Créer une clé API ».</p>
      <div class="form" style="padding:0">${f('k-yt', 'Clé API', k.youtubeKey, 'AIza…')}</div></details>
    <div id="k-res" style="margin:8px 0"></div>
    <div class="row-actions"><button class="btn sm primary" data-act="keys-save">${ic('check')}Enregistrer les clés</button><button class="btn sm" data-act="keys-test">Tester Spotify</button>
      ${ENR.running ? `<button class="btn sm danger" data-act="enrich-stop">Arrêter l'enrichissement</button>` : `<button class="btn sm" data-act="enrich-all">${ic('refresh')}Enrichir toute la base</button>`}</div>`;
}
async function loadKeysState() { S.keys = await window.bv.keys.status(); S.keysMask = await window.bv.keys.get(); }

// ---------- export CSV / import CSV ----------
const CSV_COLS = [
  ['Nom', (a) => a.name], ['Styles', (a) => a.styles.join(', ')], ['Pays', (a) => a.country], ['Ville', (a) => a.city], ['Formation', (a) => a.formation],
  [edition(), (a) => (stOf(a) ? STATUS_L[stOf(a)] : '')], ['Trouvé via', (a) => a.foundVia || ''], ['Priorité', (a) => a.priority || 0], ['Cachet', (a) => a.fee.amount ?? ''], ['Cachet max', (a) => a.fee.max ?? ''], ['Devise', (a) => a.fee.currency],
  ['Cachet CHF', (a) => { const v = feeCHF(a); return v == null ? '' : Math.round(v); }], ['Agence', (a) => a.contact.agency], ['Contact', (a) => a.contact.name], ['Email', (a) => a.contact.email], ['Téléphone', (a) => a.contact.phone],
  ['Spotify', (a) => a.links.spotify], ['Instagram', (a) => a.links.instagram], ['YouTube', (a) => a.links.youtube], ['SoundCloud', (a) => a.links.soundcloud], ['Site', (a) => a.links.website],
  ['Auditeurs', (a) => a.listeners ?? ''], ['Popularité', (a) => { const p = popOf(a); return p ? `${p.tier} (${p.score}/100)` : ''; }], ['Instagram (abonnés)', (a) => (a.popularity || {}).instagram ?? ''], ['SoundCloud (abonnés)', (a) => (a.popularity || {}).soundcloud ?? ''], ['Source', (a) => a.source], ['Disponibilités', (a) => a.availability], ['Présentation', (a) => a.bio], ['Notes', (a) => a.notes],
];
function toCSV(list) {
  const cell = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [CSV_COLS.map((c) => c[0]).join(';'), ...list.map((a) => CSV_COLS.map((c) => cell(c[1](a))).join(';'))].join('\r\n');
}
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0];
  const sep = [';', ',', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
function importRows(rows) {
  const hd = rows[0].map(norm);
  const find = (...names) => hd.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const edn = norm(edition());
  const col = {
    name: find('nom', 'name', 'artiste', 'artist', 'groupe'), styles: find('style', 'genre'), country: find('pays', 'country', 'origine'), city: find('ville', 'city'),
    formation: find('formation'), status: find('statut', 'status', edn), priority: find('priorite', 'priority'), amount: find('cachet', 'fee', 'tarif', 'prix'), max: find('cachet max'),
    currency: find('devise', 'currency', 'monnaie'), agency: find('agence', 'agency', 'label', 'booker'), cname: find('contact'), email: find('email', 'mail', 'e-mail'), phone: find('telephone', 'tel', 'phone'),
    spotify: find('spotify'), instagram: find('instagram', 'insta'), youtube: find('youtube'), soundcloud: find('soundcloud', 'bandcamp'), website: find('site', 'web', 'epk', 'lien'),
    listeners: find('auditeurs', 'listeners'), source: find('source', 'propose'), availability: find('disponib'), bio: find('presentation', 'bio', 'description'), notes: find('notes', 'remarque', 'commentaire'),
  };
  if (col.name < 0) return { error: 'Colonne « Nom » introuvable dans le fichier.' };
  const g = (r, k) => (col[k] >= 0 ? (r[col[k]] || '').trim() : '');
  const stFromLabel = (s) => { const n = norm(s); const f = STATUSES.find((x) => norm(x.l) === n || x.k === n || norm(x.l).startsWith(n.slice(0, 5))); return f ? f.k : 'proposition'; };
  let added = 0, skipped = 0;
  rows.slice(1).forEach((r) => {
    const name = g(r, 'name'); if (!name) return;
    if (artists().some((a) => norm(a.name) === norm(name))) { skipped++; return; }
    const cur = g(r, 'currency').toUpperCase();
    const num = (v) => { const x = parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(/[,](?=\d{3}\b)/g, '').replace(',', '.')); return isNaN(x) ? null : x; };
    const styles = g(r, 'styles').split(/[,/|;]+/).map((s) => s.trim()).filter(Boolean).map((s) => settings().styles.find((x) => norm(x) === norm(s) || norm(x).includes(norm(s))) || s);
    const a = fixArtist({ name, styles, country: g(r, 'country'), city: g(r, 'city'), formation: g(r, 'formation'),
      priority: Math.max(0, Math.min(3, parseInt(g(r, 'priority')) || 0)),
      fee: { amount: num(g(r, 'amount')), max: num(g(r, 'max')), currency: CURRENCIES.includes(cur) ? cur : 'CHF', type: num(g(r, 'max')) ? 'fourchette' : 'fixe', includes: {} },
      contact: { agency: g(r, 'agency'), name: col.cname !== col.email ? g(r, 'cname') : '', email: g(r, 'email'), phone: g(r, 'phone') },
      links: { spotify: g(r, 'spotify'), instagram: g(r, 'instagram'), youtube: g(r, 'youtube'), soundcloud: g(r, 'soundcloud'), website: g(r, 'website') },
      listeners: num(g(r, 'listeners')), source: g(r, 'source'), availability: g(r, 'availability'), bio: g(r, 'bio'), notes: g(r, 'notes'),
      history: [{ d: new Date().toISOString(), t: 'Importé depuis un fichier' }] });
    artists().push(a); added++;
    if (col.status >= 0 && g(r, 'status')) propose(a, stFromLabel(g(r, 'status')), true);
  });
  save();
  return { added, skipped };
}

// ---------- dossier PDF ----------
function exportPdfDialog() {
  const list = S.view === 'proposals' || S.view === 'pipeline' ? proposalsList().list : filtered();
  modal({
    title: 'Dossier PDF', wide: false,
    body: `<p style="margin:0 0 14px;line-height:1.5">Crée un dossier propre à montrer (président, comité) avec les <b>${list.length}</b> artistes actuellement affichés${activeFilters() ? ' (filtres appliqués)' : ''}.</p>
      <div class="field" style="margin-bottom:12px"><label>Artistes à inclure</label><select id="pdf-scope" class="sel"><option value="filtered">Les ${list.length} artistes affichés</option><option value="short">Propositions : shortlist, contactés, en négo et confirmés</option><option value="confirmed">Propositions confirmées uniquement</option><option value="all">Toutes les propositions (hors refusés)</option></select></div>
      <div class="checks" style="flex-direction:column;gap:8px"><label><input type="checkbox" id="pdf-fee" checked>Inclure les cachets et le total</label><label><input type="checkbox" id="pdf-notes">Inclure les notes internes</label><label><input type="checkbox" id="pdf-contact">Inclure les contacts booking</label></div>`,
    foot: `<button class="btn" data-close2>Annuler</button><button class="btn primary" id="pdf-go">${ic('file')}Créer le PDF</button>`,
    onMount: (w, close) => {
      w.querySelector('[data-close2]').onclick = close;
      w.querySelector('#pdf-go').onclick = async () => {
        const scope = $('#pdf-scope', w).value;
        const A = artists();
        const P = proposedArtists(); const sel = scope === 'filtered' ? list : scope === 'short' ? P.filter((a) => ['shortlist', 'contacte', 'negociation', 'confirme'].includes(stOf(a))) : scope === 'confirmed' ? P.filter((a) => stOf(a) === 'confirme') : P.filter((a) => stOf(a) !== 'refuse');
        const html = pdfHtml(sel, { fee: $('#pdf-fee', w).checked, notes: $('#pdf-notes', w).checked, contact: $('#pdf-contact', w).checked, scope: $('#pdf-scope', w).selectedOptions[0].textContent });
        close();
        toast('Création du PDF…');
        const r = await window.bv.exportPdf(html, `${(settings().edition || 'Festival').replace(/[^\w -]/g, '')} - Programmation ${new Date().toISOString().slice(0, 10)}.pdf`);
        if (r && r.error) toast(r.error, { error: true }); else if (r && r.ok) toast('PDF créé');
      };
    },
  });
}
function pdfHtml(list, o) {
  const st = settings();
  const ORD = ['confirme', 'negociation', 'contacte', 'shortlist', 'proposition', 'refuse'];
  const sorted = [...list].sort((a, b) => ORD.indexOf(stOf(a)) - ORD.indexOf(stOf(b)) || (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name, 'fr'));
  const total = sorted.reduce((t, a) => t + (feeCHF(a) || 0), 0);
  const conf = sorted.filter((a) => stOf(a) === 'confirme').reduce((t, a) => t + (feeCHF(a) || 0), 0);
  const sc = {}; sorted.forEach((a) => a.styles.forEach((s) => (sc[s] = (sc[s] || 0) + 1)));
  const pdfPill = (s) => (s ? `<span class="pl p-${s}">${STATUS_L[s]}</span>` : '');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; } body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; color: #0f1a2e; font-size: 10.5pt; }
  .pg { padding: 16mm 15mm; }
  .cover { background: #0b1426; color: #fff; padding: 20mm 15mm 14mm; }
  .cover .k { color: #8fb3ff; font-size: 10pt; letter-spacing: 2px; text-transform: uppercase; font-weight: 600; }
  .cover h1 { font-size: 30pt; margin: 6px 0 4px; letter-spacing: -.5px; } .cover p { margin: 0; color: #b9c6df; }
  .stats { display: flex; gap: 10mm; margin-top: 10mm; } .stats div b { display: block; font-size: 20pt; } .stats div span { color: #b9c6df; font-size: 9pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 4mm; font-size: 9.5pt; } th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .5px; color: #6b778c; border-bottom: 1.5px solid #0f1a2e; padding: 5px 6px; }
  td { padding: 6px; border-bottom: 1px solid #e2e6ee; vertical-align: top; } td.r, th.r { text-align: right; white-space: nowrap; }
  h2 { font-size: 14pt; margin: 0 0 3mm; } .styles { color: #4a5568; font-size: 9.5pt; margin-top: 3mm; line-height: 1.6; }
  .pl { display: inline-block; font-size: 8pt; font-weight: 700; padding: 2px 7px; border-radius: 10px; white-space: nowrap; }
  .p-proposition { background: #eceff4; color: #4a5568; } .p-shortlist { background: #efe9fb; color: #6b46c1; } .p-contacte { background: #e0f3f7; color: #0f7891; } .p-negociation { background: #fff2db; color: #a15c00; } .p-confirme { background: #e3f5ed; color: #12805c; } .p-refuse { background: #fde8e6; color: #c0362c; }
  .art { display: flex; gap: 6mm; padding: 6mm 0; border-bottom: 1px solid #e2e6ee; page-break-inside: avoid; }
  .ph { width: 34mm; height: 34mm; border-radius: 4mm; flex: none; background-size: cover; background-position: center; color: #fff; font-size: 16pt; font-weight: 800; display: flex; align-items: center; justify-content: center; }
  .art h3 { margin: 0; font-size: 14pt; } .meta { color: #4a5568; font-size: 9.5pt; margin: 1mm 0 2mm; } .bio { margin: 0 0 2mm; line-height: 1.5; }
  .row { display: flex; gap: 6mm; flex-wrap: wrap; font-size: 9pt; color: #4a5568; } .row b { color: #0f1a2e; } .note { background: #f7f8fb; border-left: 3px solid #3b7cf6; padding: 2mm 3mm; font-size: 9pt; margin-top: 2mm; }
  .foot { color: #7a8699; font-size: 8pt; margin-top: 6mm; }
  </style></head><body>
  <div class="cover"><div class="k">Programmation · document interne</div><h1>${esc(st.edition)}</h1><p>${esc(o.scope)} · état au ${fmtDate(new Date(), { day: 'numeric', month: 'long', year: 'numeric' })}${st.dateStart ? ` · festival le ${fmtDate(st.dateStart, { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}</p>
    <div class="stats"><div><b>${sorted.length}</b><span>artistes</span></div><div><b>${sorted.filter((a) => stOf(a) === 'confirme').length}</b><span>confirmés</span></div>
    ${o.fee ? `<div><b>${money(conf)}</b><span>engagés (confirmés)</span></div><div><b>${money(total)}</b><span>si tous retenus</span></div>${st.budget ? `<div><b>${money(st.budget)}</b><span>budget artistique</span></div>` : ''}` : ''}</div></div>
  <div class="pg">
    <h2>Vue d'ensemble</h2>
    <table><thead><tr><th>Artiste</th><th>Styles</th><th>Origine</th><th>Statut</th>${o.fee ? '<th class="r">Cachet</th>' : ''}</tr></thead><tbody>
    ${sorted.map((a) => `<tr><td><b>${esc(a.name)}</b>${a.priority ? ' ' + '★'.repeat(a.priority) : ''}</td><td>${esc(a.styles.join(', '))}</td><td>${esc(origin(a))}</td><td>${pdfPill(stOf(a))}</td>${o.fee ? `<td class="r">${esc(feeText(a))}</td>` : ''}</tr>`).join('')}
    </tbody></table>
    <div class="styles"><b>Répartition par style :</b> ${Object.entries(sc).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${esc(s)} (${n})`).join(' · ')}</div>
  </div>
  <div class="pg" style="page-break-before: always; padding-top: 12mm">
    <h2>Fiches artistes</h2>
    ${sorted.map((a) => `<div class="art"><div class="ph" style='background:${bgOf(a)}'>${a.photo ? '' : esc(initials(a.name))}</div><div style="flex:1;min-width:0">
      <h3>${esc(a.name)} ${pdfPill(stOf(a))}</h3><div class="meta">${esc([a.styles.join(', '), origin(a), a.formation, a.listeners ? nf.format(a.listeners) + ' auditeurs/mois' : ''].filter(Boolean).join(' · '))}</div>
      ${a.bio ? `<p class="bio">${esc(a.bio)}</p>` : ''}
      <div class="row">${o.fee && feeText(a) ? `<span>Cachet : <b>${esc(feeText(a))}</b>${a.fee.currency !== 'CHF' && feeCHF(a) ? ` (≈ ${money(feeCHF(a))})` : ''}</span>` : ''}${a.source ? `<span>Source : <b>${esc(a.source)}</b></span>` : ''}${o.contact && (a.contact.agency || a.contact.email) ? `<span>Contact : <b>${esc([a.contact.agency, a.contact.name, a.contact.email].filter(Boolean).join(' – '))}</b></span>` : ''}${a.links.spotify || a.links.youtube ? `<span>Écouter : ${esc(a.links.spotify || a.links.youtube)}</span>` : ''}</div>
      ${o.notes && a.notes ? `<div class="note">${esc(a.notes)}</div>` : ''}</div></div>`).join('')}
    <div class="foot">Généré par IrisProg le ${new Date().toLocaleString('fr-CH')}.${o.fee ? ' Montants en devises étrangères convertis en CHF à titre indicatif.' : ''}</div>
  </div></body></html>`;
}

// ---------- actions (clics) ----------
const ACT = {
  nav: (el) => go(el.dataset.view),
  theme: () => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    settings().theme = dark ? 'dark' : 'light'; save(); renderNav();
  },
  'ask-orbiz': () => window.bv.ask('', false).then((r) => r && r.error && toast(r.error, { error: true })),
  'new-artist': () => addArtistDialog(),
  'new-artist-blank': () => newArtist(),
  'open-artist': (el, e) => (S.sel && S.view === 'artists' && el.closest('#view') ? toggleSel(el.dataset.id, e.shiftKey) : openArtist(el.dataset.id)),
  'sel-mode': () => { S.sel = S.sel ? null : new Set(); S.selLast = null; render(); },
  'sel-all': () => { filtered().forEach((a) => S.sel.add(a.id)); render(); },
  'sel-none': () => { S.sel.clear(); render(); },
  'sel-propose': () => { const L = [...S.sel].map(byId).filter((a) => a && !propOf(a)); L.forEach((a) => propose(a)); save(); render(); toast(L.length ? `${L.length} artiste${L.length > 1 ? 's' : ''} ajouté${L.length > 1 ? 's' : ''} aux propositions` : 'Déjà tous proposés'); },
  'sel-unpropose': () => { const L = [...S.sel].map(byId).filter((a) => a && propOf(a)); L.forEach((a) => unpropose(a)); save(); render(); toast(L.length ? `${L.length} retiré${L.length > 1 ? 's' : ''} des propositions (ils restent dans la base)` : 'Aucun n’était proposé'); },
  'sel-csv': async () => { const r = await window.bv.exportText(toCSV(artists().filter((a) => S.sel.has(a.id))), `artistes-selection-${new Date().toISOString().slice(0, 10)}.csv`, 'csv'); if (r && r.ok) toast('CSV exporté'); },
  'sel-delete': async () => {
    const L = artists().filter((a) => S.sel.has(a.id)); if (!L.length) return;
    const names = L.slice(0, 12).map((a) => esc(a.name)).join(', ') + (L.length > 12 ? ` et ${L.length - 12} autres` : '');
    if (!(await confirmBox(`Supprimer définitivement <b>${L.length}</b> fiche${L.length > 1 ? 's' : ''} d'artiste ?<br><span class="muted" style="font-size:13px">${names}</span>`, `Supprimer ${L.length}`))) return;
    const snapA = artists().slice(), snapP = proposals().slice(), ids = new Set(L.map((a) => a.id));
    S.data.artists = artists().filter((a) => !ids.has(a.id)); S.data.proposals = proposals().filter((p) => !ids.has(p.artistId));
    if (S.drawer && ids.has(S.drawer.id)) closeDrawer();
    S.sel.clear(); save(); render();
    toast(`${L.length} artiste${L.length > 1 ? 's' : ''} supprimé${L.length > 1 ? 's' : ''}`, { action: 'Annuler', ms: 12000, onAction: () => { S.data.artists = snapA; S.data.proposals = snapP; save(); render(); } });
  },
  'player': (el) => { const a = byId(S.drawer.id); S.player = { id: a.id, k: el.dataset.k }; const box = $('#dv-player'); if (box) box.outerHTML = drawerPlayer(a); },
  'close-drawer': () => closeDrawer(),
  'edit-artist': (el, e) => { e.preventDefault(); S.drawer.edit = true; S.drawer.copy = JSON.parse(JSON.stringify(byId(S.drawer.id))); refreshDrawer(); },
  'cancel-edit': () => { if (S.drawer.draft) closeDrawer(); else { S.drawer.edit = false; S.drawer.copy = null; refreshDrawer(); } },
  'set-status': (el) => { const a = byId(S.drawer.id); if (stOf(a) !== el.dataset.status) setStatus(a, el.dataset.status); refreshDrawer(); render(); },
  'propose': () => { const a = byId(S.drawer.id); propose(a); toast(`${a.name} ajouté aux propositions ${edition()}`); refreshDrawer(); render(); },
  'unpropose': () => { const a = byId(S.drawer.id); const p = unpropose(a); save(); refreshDrawer(); render(); toast(`${a.name} retiré des propositions`, { action: 'Annuler', onAction: () => { proposals().push(p); a.history.shift(); touch(a); refreshDrawer(); render(); } }); },
  'add-proposals': () => addProposalsDialog(),
  'new-artist-proposed': () => addArtistDialog(true),
  'playout': (el) => { S.pf.layout = el.dataset.l; render(); },
  'set-pstatus': (el) => { S.pf.status = el.dataset.status; render(); },
  'set-prio': (el) => { const a = byId(S.drawer.id); const p = Number(el.dataset.p); a.priority = a.priority === p ? p - 1 : p; touch(a); refreshDrawer(); render(); },
  'add-history': () => { const i = $('#hist-in'); if (!i.value.trim()) return; const a = byId(S.drawer.id); touch(a, i.value.trim()); refreshDrawer(); },
  'del-history': (el) => { const a = byId(S.drawer.id); a.history.splice(Number(el.dataset.i), 1); touch(a); refreshDrawer(); },
  'delete-artist': async () => {
    const a = byId(S.drawer.id);
    if (!(await confirmBox(`Supprimer définitivement la fiche de <b>${esc(a.name)}</b> ?`, 'Supprimer'))) return;
    const i = artists().indexOf(a); artists().splice(i, 1); const ps = proposals().filter((p) => p.artistId === a.id); S.data.proposals = proposals().filter((p) => p.artistId !== a.id); save(); closeDrawer(); render();
    toast(`${a.name} supprimé`, { action: 'Annuler', onAction: () => { artists().splice(i, 0, a); proposals().push(...ps); save(); render(); } });
  },
  'pick-style': (el) => { const t = readForm(editTarget()); toggleIn(t.styles, el.dataset.style); el.classList.toggle('on'); },
  'new-style': async (el) => {
    modal({ title: 'Nouveau style', body: `<div class="field"><label>Nom du style</label><input id="ns" placeholder="ex. Shatta, Hyperpop, Gqom…"></div>`, foot: `<button class="btn primary" id="ns-ok">Ajouter</button>`,
      onMount: (w, close) => { const i = $('#ns', w); i.focus(); const ok = () => { const v = i.value.trim(); if (!v) return; if (!settings().styles.includes(v)) settings().styles.push(v); save(); const t = editTarget(); readForm(t); if (!t.styles.includes(v)) t.styles.push(v); close(); rerenderEdit(t); };
        $('#ns-ok', w).onclick = ok; i.onkeydown = (e) => e.key === 'Enter' && ok(); } });
  },
  'pick-photo': () => $('#photo-file').click(),
  'clear-photo': () => { const t = editTarget(); readForm(t); t.photo = ''; rerenderEdit(t); },
  'open-url': (el, e) => { e.preventDefault(); window.bv.openExternal(el.dataset.url); },
  'write-artist': (el) => { const a = byId(el.dataset.id); Mail.compose({ to: a.contact.email, artist: a }); },
  'write-to': (el, e) => { e.preventDefault(); const a = byId(el.dataset.id); Mail.compose({ to: el.dataset.to, artist: a }); },
  'ask-artist': (el, e) => {
    e.preventDefault();
    const a = byId(el.dataset.id);
    window.bv.ask(`Regarde la fiche de l'artiste « ${a.name} » (id ${a.id}) avec irisprog__get_artist. Dis-moi ce que tu sais de cet artiste (origine, style, parcours, popularité), puis propose de compléter les champs vides de la fiche (présentation, origine, styles, liens) avec baleinev__update_artist. Signale ce dont tu n'es pas sûr.`, true)
      .then((r) => r && r.error && toast(r.error, { error: true }));
  },
  layout: (el) => { S.layout = el.dataset.l; render(); },
  sort: (el) => { S.f.sort = el.dataset.sort; render(); },
  'toggle-style': (el) => { toggleIn(S.f.styles, el.dataset.style); render(); },
  'set-status-filter': (el) => { S.f.status = el.dataset.status; render(); },
  'set-via-filter': (el) => { S.f.via = el.dataset.via; render(); },
  'clear-filters': () => { S.f = { ...S.f, styles: [], status: '', via: '', q: '', country: '', minPrio: 0, period: '', from: '', to: '', pop: '', sugg: false }; render(); },
  'filter-style': (el) => go('artists', { filters: { styles: el.dataset.style === 'Sans style' ? [] : [el.dataset.style], status: '', country: '', q: '', minPrio: 0 } }),
  'filter-status': (el) => { S.pf.status = el.dataset.status; S.pf.layout = 'grid'; go('proposals'); },
  'filter-country': (el) => go('artists', { filters: { country: el.dataset.country === 'Non renseigné' ? '' : el.dataset.country, styles: [], status: '', q: '', minPrio: 0 } }),
  'filter-prio': () => go('artists', { filters: { minPrio: 3, styles: [], status: '', country: '', q: '', sort: 'priority' } }),
  'export-menu': () => modal({ title: 'Exporter', body: `<div class="row-actions" style="flex-direction:column;align-items:stretch">
      <button class="btn" data-act="export-pdf" style="height:auto;padding:12px 14px;justify-content:flex-start">${ic('file')}<span style="text-align:left"><b>Dossier PDF</b><br><span class="muted" style="font-weight:400">Présentation propre à montrer (président, comité)</span></span></button>
      <button class="btn" data-act="export-csv" style="height:auto;padding:12px 14px;justify-content:flex-start">${ic('download')}<span style="text-align:left"><b>Tableau CSV</b><br><span class="muted" style="font-weight:400">S'ouvre dans Excel / Google Sheets</span></span></button></div>`,
    onMount: (w, close) => w.addEventListener('click', (e) => { if (e.target.closest('[data-act]')) close(); }) }),
  'export-pdf': () => exportPdfDialog(),
  'export-csv': async () => { const r = await window.bv.exportText(toCSV(filtered()), `artistes-${new Date().toISOString().slice(0, 10)}.csv`, 'csv'); if (r && r.ok) toast('CSV exporté'); },
  'import-csv': async () => {
    const r = await window.bv.importText(['csv', 'txt', 'tsv']); if (!r || r.canceled) return;
    if (r.error) return toast(r.error, { error: true });
    const rows = parseCSV(r.text); if (rows.length < 2) return toast('Fichier vide ou illisible', { error: true });
    const res = importRows(rows); if (res.error) return toast(res.error, { error: true });
    render(); toast(`${res.added} artiste(s) importé(s)${res.skipped ? `, ${res.skipped} déjà présent(s)` : ''}`);
  },
  'backup-export': async () => { const r = await window.bv.exportText(JSON.stringify(S.data, null, 1), `irisprog-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, 'json'); if (r && r.ok) toast('Sauvegarde exportée'); },
  'backup-import': async () => {
    const r = await window.bv.importText(['json']); if (!r || r.canceled) return;
    let d; try { d = JSON.parse(r.text); } catch { return toast('Fichier invalide', { error: true }); }
    if (!d || !Array.isArray(d.artists)) return toast('Ce fichier n’est pas une sauvegarde IrisProg', { error: true });
    if (!(await confirmBox(`Remplacer les données actuelles (${artists().length} artistes) par celles de la sauvegarde (${d.artists.length} artistes) ?`, 'Restaurer'))) return;
    S.data = { artists: d.artists.map(fixArtist), settings: { ...DEFAULT_SETTINGS, ...d.settings }, proposals: d.proposals || [], timetables: d.timetables || [], ttActive: d.ttActive || '' }; save(); render(); toast('Sauvegarde restaurée');
  },
  'open-data': () => window.bv.openDataFolder(),
  'enrich-one': () => startEnrich([byId(S.drawer.id)]),
  'sugg-apply': () => { const a = byId(S.drawer.id), g = a.suggest; if (!g) return; if (g.city) a.city = g.city; if (g.country) a.country = g.country; if (g.styles) a.styles = g.styles; a.originSource = (g.from || '').split(' · ')[0]; delete a.suggest; touch(a, 'Suggestion d’origine / styles appliquée'); refreshDrawer(); render(); },
  'sugg-ignore': () => { const a = byId(S.drawer.id); delete a.suggest; touch(a); refreshDrawer(); render(); },
  'sugg-filter': () => { S.f.sugg = !S.f.sugg; render(); },
  'enrich-all': () => startEnrich(),
  'enrich-stop': () => window.bv.enrich.stop(),
  'keys-save': async () => {
    const v = (id) => ($('#' + id) ? $('#' + id).value.trim() : undefined);
    const st = await window.bv.keys.save({ spotifyId: v('k-spid'), spotifySecret: v('k-spsec'), lastfmKey: v('k-lf'), discogsToken: v('k-dg'), youtubeKey: v('k-yt') });
    S.keys = st; toast('Clés enregistrées (chiffrées sur cet ordinateur)'); render();
  },
  'keys-test': async (el) => {
    el.disabled = true; el.innerHTML = '<span class="spin"></span>Test…';
    const r = await window.bv.keys.testSpotify();
    el.disabled = false; el.textContent = 'Tester Spotify';
    $('#k-res').innerHTML = r.error ? `<div class="callout bad">${esc(r.error)}</div>` : `<div class="callout good">Spotify fonctionne ✓ (test : « ${esc(r.sample || '')} » trouvé)</div>`;
  },
  'owa-switch': () => modal({ title: 'Outlook intégré', wide: true, body: Owa.chooser() }),
  'load-examples': () => {
    let n = 0;
    EXAMPLES.forEach((e, i) => { if (artists().some((a) => norm(a.name) === norm(e.name))) return; const a = fixArtist({ ...e, id: uid(), tags: ['exemple'], createdAt: new Date(Date.now() - i * 36e5 * 20).toISOString(), history: [{ d: new Date().toISOString(), t: 'Exemple fictif' }] }); artists().push(a); propose(a, e.status || 'proposition', true); n++; });
    save(); render(); toast(`${n} artistes fictifs ajoutés (supprimables dans Paramètres)`);
  },
  'remove-examples': async () => {
    if (!(await confirmBox('Supprimer tous les artistes d’exemple ?', 'Supprimer'))) return;
    const ex = new Set(artists().filter((a) => a.tags.includes('exemple')).map((a) => a.id)); S.data.artists = artists().filter((a) => !ex.has(a.id)); S.data.proposals = proposals().filter((p) => !ex.has(p.artistId)); save(); render(); toast('Exemples supprimés');
  },
  'add-style': () => { const i = $('#new-style'); const v = i.value.trim(); if (!v) return; if (!settings().styles.includes(v)) settings().styles.push(v); save(); render(); },
  'del-style': (el) => { const s = settings(); s.styles = s.styles.filter((x) => x !== el.dataset.style); save(); render(); },
};
function toggleSel(id, range) {
  const L = filtered().map((a) => a.id);
  if (range && S.selLast && L.includes(S.selLast) && L.includes(id)) {
    const [i, j] = [L.indexOf(S.selLast), L.indexOf(id)].sort((x, y) => x - y);
    const on = !S.sel.has(id);
    L.slice(i, j + 1).forEach((x) => (on ? S.sel.add(x) : S.sel.delete(x)));
  } else if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
  S.selLast = id; render();
}
const toggleIn = (arr, v) => { const i = arr.indexOf(v); if (i < 0) arr.push(v); else arr.splice(i, 1); };
// cible du formulaire en cours d'édition (copie de travail pour une fiche existante)
function editTarget() { return S.drawer.draft || S.drawer.copy; }
function rerenderEdit(t) { const sc = $('#drawer .db') ? $('#drawer .db').scrollTop : 0; $('#drawer').innerHTML = drawerEdit(t); const db = $('#drawer .db'); if (db) db.scrollTop = sc; }

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACT[el.dataset.act] || (window.Mail && Mail.ACT[el.dataset.act]) || (window.Owa && Owa.ACT[el.dataset.act]);
  if (fn) { if (el.tagName === 'A') e.preventDefault(); e.stopPropagation(); fn(el, e); }
});
document.addEventListener('input', (e) => {
  const el = e.target;
  const k = el.dataset.input;
  if (k === 'q') { S.f.q = el.value; render(); }
  else if (k === 'pq') { S.pf.q = el.value; render(); }
  else if (k === 'artist-notes') { const a = byId(S.drawer.id); a.notes = el.value; touch(a); }
  else if (k === 'setting') { settings()[el.dataset.key] = el.value; save(); renderNav(); }
  else if (window.TT && TT.onInput(el)) {}
  else if (window.Mail && Mail.onInput(el)) {}
});
document.addEventListener('change', (e) => {
  const el = e.target;
  const k = el.dataset.change;
  if (!k) {
    // le type de cachet change la forme du formulaire
    if (el.name === 'fee.type') { const t = editTarget(); readForm(t); rerenderEdit(t); }
    if (el.name === 'photo') { const t = editTarget(); readForm(t); const p = $('#photo-prev'); if (p) { p.style.background = bgOf(t); p.textContent = t.photo ? '' : initials(t.name); } }
    return;
  }
  if (k === 'country') S.f.country = el.value;
  else if (k === 'minPrio') S.f.minPrio = Number(el.value);
  else if (k === 'period') S.f.period = el.value;
  else if (k === 'pop') S.f.pop = el.value;
  else if (k === 'from') S.f.from = el.value;
  else if (k === 'to') S.f.to = el.value;
  else if (k === 'sort') S.f.sort = el.value;
  else if (k === 'setting') { settings()[el.dataset.key] = el.dataset.num ? Number(el.value) || 0 : el.value; save(); }
  else if (k === 'rate') { settings().rates[el.dataset.cur] = Number(el.value) || 0; save(); }
  else if (window.TT && TT.onChange(el)) return;
  else if (window.Mail && Mail.onChange(el)) return;
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.enter) { e.preventDefault(); ACT[e.target.dataset.enter](e.target, e); }
  if (e.key === 'Escape') {
    if ($('#modal-root').children.length) $('#modal-root').lastElementChild.remove();
    else if (S.drawer) S.drawer.edit && !S.drawer.draft ? ACT['cancel-edit']() : closeDrawer();
    else if (S.sel) { S.sel = null; render(); }
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && S.sel && S.view === 'artists' && !S.drawer && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { e.preventDefault(); ACT['sel-all'](); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && ['artists', 'pipeline', 'proposals'].includes(S.view)) { e.preventDefault(); const q = $('#q') || $('#qp'); q && q.focus(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !S.drawer) { e.preventDefault(); addArtistDialog(); }
});

// sections repliables de la fiche : on garde celles ouvertes quand la fiche se rafraîchit
document.addEventListener('toggle', (e) => { const d = e.target; if (d.dataset && d.dataset.sec) d.open ? S.openSecs.add(d.dataset.sec) : S.openSecs.delete(d.dataset.sec); }, true);

// infobulles des graphiques
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]'); const tip = $('#tip');
  if (!el) { tip.hidden = true; return; }
  tip.textContent = el.dataset.tip; tip.hidden = false;
});
document.addEventListener('mousemove', (e) => {
  const tip = $('#tip'); if (tip.hidden) return;
  const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
  tip.style.left = x + 'px'; tip.style.top = e.clientY + 16 + 'px';
});

// ---------- démarrage ----------
window.addEventListener('DOMContentLoaded', async function init() {
  const d = await window.bv.load();
  if (d) S.data = { artists: (d.artists || []).map(fixArtist), settings: { ...DEFAULT_SETTINGS, ...d.settings, rates: { ...DEFAULT_SETTINGS.rates, ...((d.settings || {}).rates || {}) } }, proposals: d.proposals, timetables: d.timetables || [], ttActive: d.ttActive || '' };
  if (!Array.isArray(S.data.proposals)) {
    S.data.proposals = [];
    artists().forEach((a) => { if (a.status && a.status !== 'proposition') S.data.proposals.push({ id: uid(), artistId: a.id, edition: edition(), status: a.status, addedAt: a.updatedAt || new Date().toISOString() }); });
    save();
  }
  const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = settings().theme || (sysDark ? 'dark' : 'light');
  await Mail.init();
  render();
});
