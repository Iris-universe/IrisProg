// API de pilotage de l'app par l'assistant (Orbiz), appelée par main.js via iris-link.
(function () {
  const brief = (a) => ({ id: a.id, nom: a.name, popularite: (() => { const p = popOf(a); return p ? `${p.tier} (${p.score}/100, audience ≈ ${p.R})` : undefined; })(), styles: a.styles, trouve_via: a.foundVia || undefined, origine: origin(a), formation: a.formation || undefined, propose: !!propOf(a), statut_baleinev: stOf(a) ? STATUS_L[stOf(a)] : 'non proposé', priorite: a.priority || 0, cachet: feeText(a) || undefined, cachet_chf: feeCHF(a) != null ? Math.round(feeCHF(a)) : undefined, contact: a.contact.agency || a.contact.email || undefined });
  const full = (a) => ({
    ...brief(a), pays: a.country, ville: a.city, presentation: a.bio, source: a.source, disponibilites: a.availability, auditeurs_mensuels: a.listeners,
    tarif: { type: a.fee.type, montant: a.fee.amount, max: a.fee.max, devise: a.fee.currency, a_notre_charge: Object.keys(a.fee.includes || {}).filter((k) => a.fee.includes[k]), remarques: a.fee.notes },
    contact: a.contact, liens: a.links, notes: a.notes, messages_recus: (a.messages || []).map((m) => ({ source: m.source, date: m.date, auteur: m.author, email: m.email, texte: m.text.slice(0, 4000) })), historique: a.history.slice(0, 15).map((h) => `${h.d.slice(0, 10)} : ${h.t}`),
    mails: Mail.mailsForArtist(a).slice(0, 15).map((m) => ({ uid: m.uid, dossier: m.folder, objet: m.subject, de: m.from && (m.from.name || m.from.address), date: m.date })),
  });
  const findArtist = ({ id, name } = {}) => (id && byId(id)) || (name && (artists().find((a) => norm(a.name) === norm(name)) || artists().find((a) => norm(a.name).includes(norm(name)))));
  const styleOf = (s) => settings().styles.find((x) => norm(x) === norm(s)) || settings().styles.find((x) => norm(x).includes(norm(s)) || norm(s).includes(norm(x))) || s;

  function apply(a, f) {
    const set = (k, v) => { if (v !== undefined) a[k] = v; };
    set('name', f.name); set('foundVia', f.found_via); set('country', f.country); set('city', f.city); set('formation', f.formation); set('bio', f.bio); set('source', f.source); set('notes', f.notes); set('listeners', f.listeners);
    if (f.priority !== undefined) a.priority = Math.max(0, Math.min(3, Number(f.priority) || 0));
    if (f.styles) { a.styles = [...new Set(f.styles.map(styleOf))]; a.styles.forEach((s) => { if (!settings().styles.includes(s)) settings().styles.push(s); }); }
    if (f.tags) a.tags = f.tags;
    if (f.fee_amount !== undefined) a.fee.amount = f.fee_amount;
    if (f.fee_max !== undefined) { a.fee.max = f.fee_max; if (f.fee_max) a.fee.type = 'fourchette'; }
    if (f.fee_currency) a.fee.currency = f.fee_currency;
    if (f.fee_notes !== undefined) a.fee.notes = f.fee_notes;
    ['agency', 'name', 'email', 'phone'].forEach((k) => { if (f['contact_' + k] !== undefined) a.contact[k] = f['contact_' + k]; });
    ['spotify', 'instagram', 'youtube', 'soundcloud', 'website'].forEach((k) => { if (f['link_' + k] !== undefined) a.links[k] = f['link_' + k]; });
  }
  const refresh = () => { render(); if (S.drawer && !S.drawer.edit) refreshDrawer(); };

  const mailBrief = (m, folder) => ({ uid: m.uid, dossier: folder, de: m.from ? `${m.from.name || ''} <${m.from.address}>`.trim() : '', objet: m.subject, date: m.date, lu: !!m.seen, suivi: !!m.flagged, repondu: !!m.answered,
    categorie: Mail.CAT_L[Mail.category(m)], pieces_jointes: !!m.attachments, extrait: m.snippet || undefined, artistes_lies: Mail.artistsFor(m, folder).map((a) => ({ id: a.id, nom: a.name })) });

  window.irisAgent = {
    get_state() {
      const M = Mail._state;
      const d = S.drawer && (S.drawer.draft || byId(S.drawer.id));
      return {
        festival: settings().edition, dates: [settings().dateStart, settings().dateEnd].filter(Boolean).join(' → ') || 'non définies', budget_chf: settings().budget || undefined,
        vue: S.view, filtres: S.f,
        nb_artistes: artists().length,
        nb_propositions: proposedArtists().length,
        propositions_par_statut: Object.fromEntries(STATUSES.map((s) => [s.l, proposedArtists().filter((a) => stOf(a) === s.k).length])),
        styles_disponibles: settings().styles,
        fiche_ouverte: d ? (S.drawer.edit ? { en_edition: true, nom: d.name } : full(d)) : null,
        boite_mail: M.acc ? { adresse: M.acc.email, dossier: M.folder, non_lus: Mail.unreadCount(), mail_ouvert: M.msg ? { uid: M.msg.uid, objet: M.msg.subject, de: M.msg.from[0] } : null } : 'non connectée',
      };
    },
    list_artists({ style, status, query, proposed } = {}) {
      const f = { styles: style ? [styleOf(style)] : [], status: status || (proposed === true ? 'in' : proposed === false ? 'out' : ''), via: '', q: query || '', country: '', minPrio: 0, period: '', sort: 'name' };
      return filtered(artists(), f).map(brief);
    },
    get_timetable({ all_versions } = {}) { return window.TT ? TT.summary(!!all_versions) : { error: 'Timetable indisponible' }; },
    get_artist(args) { const a = findArtist(args); return a ? full(a) : { error: 'Artiste introuvable. Utilise list_artists.' }; },
    add_artist(f = {}) {
      if (!f.name) return { error: 'name obligatoire' };
      const dup = artists().find((a) => norm(a.name) === norm(f.name));
      if (dup) return { error: `« ${dup.name} » existe déjà (id ${dup.id}). Utilise update_artist.` };
      const a = fixArtist(blankArtist());
      apply(a, f);
      a.history.unshift({ d: new Date().toISOString(), t: 'Fiche créée par Orbiz' });
      artists().unshift(a); if (f.status && STATUS_L[f.status]) propose(a, f.status, true); touch(a); refresh();
      toast(`Orbiz a ajouté ${a.name}`, { action: 'Voir', onAction: () => openArtist(a.id) });
      return { ok: true, artiste: full(a) };
    },
    update_artist(f = {}) {
      const a = byId(f.id); if (!a) return { error: 'Artiste introuvable' };
      const { id, note_history, ...rest } = f;
      const old = stOf(a);
      apply(a, rest);
      if (rest.status && STATUS_L[rest.status] && rest.status !== old) propose(a, rest.status, true);
      touch(a, note_history || (rest.status && rest.status !== old ? `${edition()} : ${STATUS_L[old] || 'non proposé'} → ${STATUS_L[rest.status]} (Orbiz)` : 'Fiche complétée par Orbiz'));
      refresh();
      return { ok: true, artiste: full(a) };
    },
    open_artist({ id }) { const a = byId(id); if (!a) return { error: 'Artiste introuvable' }; if (S.view === 'dashboard') go('artists'); openArtist(id); return { ok: true }; },
    enrich_artist({ id } = {}) { const a = byId(id); if (!a) return { error: 'Artiste introuvable' }; startEnrich([a]); return { ok: true, info: 'Enrichissement lancé (Spotify, Wikidata, Discogs, Last.fm selon les clés configurées).' }; },
    propose_artist({ id, status = 'proposition' } = {}) {
      const a = byId(id); if (!a) return { error: 'Artiste introuvable' };
      propose(a, STATUS_L[status] ? status : 'proposition'); refresh();
      return { ok: true, edition: edition(), statut: STATUS_L[stOf(a)] };
    },
    unpropose_artist({ id } = {}) {
      const a = byId(id); if (!a) return { error: 'Artiste introuvable' };
      unpropose(a); save(); refresh(); return { ok: true };
    },
    set_view({ view, style, status, query } = {}) {
      const filters = {};
      if (style !== undefined) filters.styles = style ? [styleOf(style)] : [];
      if (status !== undefined) filters.status = status;
      if (query !== undefined) filters.q = query;
      closeDrawer();
      go(view || S.view, { filters });
      return window.irisAgent.get_state();
    },
    async read_open_email() {
      if (!Owa.active()) return { error: "Le mode Outlook intégré n'est pas utilisé : utilise list_emails / read_email." };
      return Owa.readCurrent();
    },
    async list_emails({ folder = 'INBOX', unread_only, category, query, limit = 30 } = {}) {
      if (Owa.active()) return { error: "Mode Outlook intégré : la liste des mails n'est pas accessible. Demande à l'utilisateur d'ouvrir le mail dans l'app, puis utilise read_open_email." };
      if (!Mail.hasAccount()) return { error: "La boîte mail n'est pas connectée (Paramètres → Boîte mail)." };
      const list = await Mail.ensureList(folder);
      const q = norm(query);
      const out = list.filter((m) => (!unread_only || !m.seen) && (!category || Mail.category(m) === category) && (!q || norm(`${m.subject} ${m.from && m.from.name} ${m.from && m.from.address} ${m.snippet || ''}`).includes(q)));
      return { dossier: folder, total: out.length, releve_le: Mail._state.lists[folder] && Mail._state.lists[folder].syncedAt, mails: out.slice(0, limit).map((m) => mailBrief(m, folder)) };
    },
    async read_email({ uid, folder = 'INBOX', open } = {}) {
      if (open) { closeDrawer(); go('mail'); const r = await Mail.open(uid, folder); if (!r || r.error) return { error: (r && r.error) || 'Mail introuvable' }; }
      const r = await window.bv.mail.get(folder, uid, { markSeen: !!open });
      if (r.error) return r;
      const meta = (await Mail.ensureList(folder)).find((m) => m.uid === uid) || {};
      return { uid, dossier: folder, objet: r.subject, de: r.from, a: r.to, cc: r.cc, date: r.date, pieces_jointes: r.attachments.map((a) => a.filename), texte: r.text.slice(0, 12000),
        artistes_lies: Mail.artistsFor({ ...meta, ...r, from: r.from[0], snippet: r.text.slice(0, 2000) }, folder).map((a) => ({ id: a.id, nom: a.name })) };
    },
    async link_email_to_artist({ uid, folder = 'INBOX', artist_id }) {
      const a = byId(artist_id); if (!a) return { error: 'Artiste introuvable' };
      const m = (await Mail.ensureList(folder)).find((x) => x.uid === uid);
      if (!m) return { error: 'Mail introuvable dans le cache' };
      if (!a.mailLinks.some((l) => l.uid === uid && (l.folder || 'INBOX') === folder)) a.mailLinks.push({ uid, folder, messageId: m.messageId, subject: m.subject, from: m.from, date: m.date });
      touch(a, `Mail lié : « ${m.subject} »`); refresh();
      return { ok: true };
    },
    async draft_email({ to, subject, body, reply_to_uid, folder = 'INBOX' } = {}) {
      if (Owa.active()) { Mail.compose({ to, subject, body }); return { ok: true, info: "Brouillon ouvert dans Outlook intégré : l'utilisateur le relit et l'envoie." }; }
      if (!Mail.hasAccount()) return { error: "La boîte mail n'est pas connectée." };
      if (reply_to_uid) {
        const m = await window.bv.mail.get(folder, reply_to_uid, { markSeen: false });
        if (m.error) return m;
        Mail.replyTo(m);
        setTimeout(() => { const b = document.getElementById('c-body'); if (b) { b.value = body + b.value; } if (to) document.getElementById('c-to').value = to; if (subject) document.getElementById('c-sub').value = subject; }, 50);
      } else {
        const a = artists().find((x) => x.contact.email && to && to.toLowerCase().includes(x.contact.email.toLowerCase()));
        Mail.compose({ to, subject, body, artist: a });
      }
      return { ok: true, info: "Brouillon ouvert à l'écran : l'utilisateur le relit et clique sur Envoyer." };
    },
    async sync_mail() { await Mail.sync('INBOX'); return { ok: true, non_lus: Mail.unreadCount() }; },
  };
})();
