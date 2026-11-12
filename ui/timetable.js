// Timetable : grille horaire par jour et par scène, glisser-déposer des artistes et des pauses (changements de plateau).
// Données : S.data.timetables = [{ id, name, edition, days:[{ id, label, date, start:'18:00', end:'03:00' }], stages:[{ id, name }],
//   setDur, changeover, slots:[{ id, dayId, stageId, start, dur, kind:'artist'|'break'|'free', artistId, label, note, auto }] }]
// start = minutes depuis minuit du jour (peut dépasser 1440 après minuit). S.data.ttActive = version affichée.
(function () {
  const ZOOMS = [0.9, 1.2, 1.6, 2.2, 3];
  const SNAP = 5;
  S.tt = { day: '', zoom: 1.6, src: 'prop', q: '' };

  const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const hm = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  const durTxt = (d) => (d >= 60 ? `${Math.floor(d / 60)} h${d % 60 ? String(d % 60).padStart(2, '0') : ''}` : `${d} min`);
  const range = (day) => { const s = toMin(day.start); let e = toMin(day.end); if (e <= s) e += 1440; return [s, e]; };
  const snap = (m) => Math.round(m / SNAP) * SNAP;
  const all = () => (S.data.timetables = S.data.timetables || []);
  const versions = () => all().filter((t) => !t.edition || t.edition === edition());
  const ORD = ['confirme', 'negociation', 'contacte', 'shortlist', 'proposition', 'refuse'];
  const rank = (a) => (ORD.indexOf(stOf(a)) + 1) || 9;

  function defaultTT(name) {
    const st = settings(), days = [];
    if (st.dateStart) {
      const d1 = new Date((st.dateEnd || st.dateStart) + 'T12:00');
      for (let d = new Date(st.dateStart + 'T12:00'); d <= d1 && days.length < 7; d.setDate(d.getDate() + 1)) {
        const l = d.toLocaleDateString('fr-CH', { weekday: 'long', day: 'numeric', month: 'short' });
        days.push({ id: uid(), label: l[0].toUpperCase() + l.slice(1), date: d.toISOString().slice(0, 10), start: '18:00', end: '03:00' });
      }
    }
    if (!days.length) days.push({ id: uid(), label: 'Vendredi', date: '', start: '18:00', end: '03:00' }, { id: uid(), label: 'Samedi', date: '', start: '16:00', end: '04:00' });
    return { id: uid(), name: name || 'Version 1', edition: edition(), days, stages: [{ id: uid(), name: 'Scène 1' }, { id: uid(), name: 'Scène 2' }], setDur: 60, changeover: 15, slots: [], createdAt: new Date().toISOString() };
  }
  function cur() {
    let L = versions();
    if (!L.length) { const t = defaultTT(); all().push(t); S.data.ttActive = t.id; save(); L = [t]; }
    const t = L.find((x) => x.id === S.data.ttActive) || L[0];
    S.data.ttActive = t.id;
    if (!t.days.some((d) => d.id === S.tt.day)) S.tt.day = t.days[0] ? t.days[0].id : '';
    return t;
  }
  // créneaux valides (un artiste supprimé de la base disparaît de la grille)
  const live = (t) => t.slots.filter((s) => s.kind !== 'artist' || byId(s.artistId));
  function placedMap(t) { const m = {}; live(t).forEach((s) => { if (s.kind === 'artist') (m[s.artistId] = m[s.artistId] || []).push(s); }); return m; }
  function conflicts(t, dayId) {
    const bad = new Set(), L = live(t).filter((s) => s.dayId === dayId);
    const chk = (arr) => { arr.sort((a, b) => a.start - b.start); for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length && arr[j].start < arr[i].start + arr[i].dur; j++) { bad.add(arr[i].id); bad.add(arr[j].id); } };
    t.stages.forEach((st) => chk(L.filter((s) => s.stageId === st.id)));
    const byA = {}; L.filter((s) => s.kind === 'artist').forEach((s) => (byA[s.artistId] = byA[s.artistId] || []).push(s));
    Object.values(byA).forEach((arr) => arr.length > 1 && chk(arr));
    return bad;
  }
  const dayOf = (t, id) => t.days.find((d) => d.id === id);
  const stageOf = (t, id) => t.stages.find((s) => s.id === id);
  const slotLabel = (s) => (s.kind === 'artist' ? (byId(s.artistId) || {}).name : s.label || (s.kind === 'break' ? 'Changement de plateau' : 'Bloc'));

  // ---------- vue ----------
  function view() {
    const t = cur(), day = dayOf(t, S.tt.day);
    const placed = placedMap(t);
    const conf = proposedArtists().filter((a) => stOf(a) === 'confirme');
    const confTodo = conf.filter((a) => !placed[a.id]).length;
    const nArt = Object.keys(placed).length;
    const fees = Object.keys(placed).reduce((s, id) => s + (feeCHF(byId(id)) || 0), 0);
    let nBad = 0; t.days.forEach((d) => (nBad += conflicts(t, d.id).size));
    const st = settings();
    const right = `<select class="sel" data-change="tt-version" title="Version de la timetable">${versions().map((v) => `<option value="${v.id}" ${v.id === t.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
      <button class="btn" data-act="tt-dup" title="Copie de cette version pour tester une variante">${ic('copy')}Dupliquer</button>
      <button class="btn" data-act="tt-new">${ic('plus')}Nouvelle</button>
      <button class="btn" data-act="tt-config">${ic('gear')}Réglages</button>
      <button class="btn" data-act="tt-pdf">${ic('file')}PDF</button>`;
    const stats = `<div class="tt-stats">
      <span class="tag">${ic('users')}<b>${nArt}</b> artiste${nArt > 1 ? 's' : ''} placé${nArt > 1 ? 's' : ''}</span>
      ${conf.length ? `<span class="tag ${confTodo ? 'warn' : 'good'}" ${confTodo ? 'data-act="tt-src" data-src="todo" style="cursor:pointer"' : ''}>${ic(confTodo ? 'flag' : 'check')}${confTodo ? `<b>${confTodo}</b> confirmé${confTodo > 1 ? 's' : ''} pas encore placé${confTodo > 1 ? 's' : ''}` : 'Tous les confirmés sont placés'}</span>` : ''}
      ${fees ? `<span class="tag">${ic('money')}Cachets placés ≈ <b>${money(fees)}</b>${st.budget ? ` / ${money(st.budget)}` : ''}</span>` : ''}
      ${nBad ? `<span class="tag bad">${ic('spam')}<b>${nBad}</b> créneau${nBad > 1 ? 'x' : ''} en conflit</span>` : ''}
    </div>`;
    const days = `<div class="seg tt-days">${t.days.map((d) => { const n = live(t).filter((s) => s.dayId === d.id && s.kind === 'artist').length; return `<button class="${d.id === S.tt.day ? 'on' : ''}" data-act="tt-day" data-id="${d.id}">${esc(d.label)}${n ? `<span class="n">${n}</span>` : ''}</button>`; }).join('')}</div>`;
    const tools = `<div class="tt-tools"><span class="muted">${day ? `${hm(range(day)[0])} → ${hm(range(day)[1])}` : ''}</span>
      <button class="btn sm" data-act="tt-pack-all" title="Recale les passages de chaque scène les uns après les autres, avec un changement de plateau de ${t.changeover} min entre deux artistes">${ic('list')}Enchaîner tout (${t.changeover} min de changement)</button>
      <span class="seg"><button data-act="tt-zoom" data-d="-1" title="Dézoomer">${ic('minus')}</button><button data-act="tt-zoom" data-d="1" title="Zoomer">${ic('plus')}</button></span></div>`;
    return `<div class="tt-page">
      ${head('Timetable', `${esc(edition())} · glisse les artistes et les pauses sur la grille, tire le bas d'un bloc pour changer sa durée`, right)}
      <div class="tt-bar">${days}${stats}<span class="sp"></span>${tools}</div>
      <div class="tt-main">${side(t, placed)}${day ? grid(t, day) : `<div class="card empty">${ic('calendar')}<h3>Aucun jour</h3><p>Ajoute un jour dans les réglages.</p><button class="btn" data-act="tt-config">${ic('gear')}Réglages</button></div>`}</div>
    </div>`;
  }

  function side(t, placed) {
    const q = norm(S.tt.q);
    let L = S.tt.src === 'all' ? artists() : S.tt.src === 'todo' ? proposedArtists().filter((a) => !placed[a.id] && stOf(a) !== 'refuse') : proposedArtists();
    if (q) L = L.filter((a) => norm([a.name, a.styles.join(' '), a.city, a.country].join(' ')).includes(q));
    L = [...L].sort((a, b) => rank(a) - rank(b) || (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name, 'fr'));
    const more = L.length > 250; L = L.slice(0, 250);
    const item = (a) => {
      const pl = placed[a.id] || [];
      const where = pl.map((s) => `${(dayOf(t, s.dayId) || {}).label || ''} ${hm(s.start)}`).join(' · ');
      return `<div class="tt-item ${pl.length ? 'placed' : ''} ${stOf(a) === 'refuse' ? 'off' : ''}" data-ttnew="artist" data-id="${a.id}" title="Glisse sur la grille · clic = ouvrir la fiche (écouter)">
        ${avatar(a, 'sm')}<div class="tx"><b>${esc(a.name)}</b><span>${pl.length ? `${ic('clock')}${esc(where)}` : esc([a.styles.slice(0, 2).join(', '), feeText(a)].filter(Boolean).join(' · ') || '—')}</span></div>
        ${stOf(a) ? `<span class="pill st-${stOf(a)} mini" title="${esc(STATUS_L[stOf(a)])}"></span>` : ''}</div>`;
    };
    return `<aside class="tt-side">
      <div class="tt-pal"><div class="lbl">Blocs</div>
        <div class="tt-item brk" data-ttnew="break" data-dur="${t.changeover}" data-label="Changement de plateau">${ic('refresh')}<div class="tx"><b>Changement de plateau</b><span>${t.changeover} min</span></div></div>
        <div class="tt-item brk" data-ttnew="break" data-dur="30" data-label="Pause">${ic('clock')}<div class="tx"><b>Pause</b><span>30 min</span></div></div>
        <div class="tt-item free" data-ttnew="free" data-dur="30" data-label="Bloc libre">${ic('edit')}<div class="tx"><b>Bloc libre</b><span>ouverture des portes, discours…</span></div></div>
      </div>
      <div class="tt-src"><div class="seg">${[['prop', 'Proposés'], ['todo', 'Pas placés'], ['all', 'Toute la base']].map(([k, l]) => `<button class="${S.tt.src === k ? 'on' : ''}" data-act="tt-src" data-src="${k}">${l}</button>`).join('')}</div>
        <div class="search">${ic('search')}<input id="tt-q" placeholder="Chercher un artiste…" value="${esc(S.tt.q)}" data-input="tt-q"></div></div>
      <div class="tt-list" data-keep-scroll="tt-list">${L.map(item).join('') || `<p class="muted" style="padding:10px;margin:0">${S.tt.src === 'prop' && !proposedArtists().length ? 'Aucun artiste proposé. Passe sur « Toute la base » ou ajoute des propositions.' : 'Aucun artiste.'}</p>`}${more ? '<p class="muted" style="padding:8px;margin:0;font-size:12px">… affine la recherche pour voir les autres</p>' : ''}</div>
      <div class="tt-hint">Glisse un bloc de la grille ici pour le retirer.</div>
    </aside>`;
  }

  function grid(t, day) {
    const [s, e] = range(day), ppm = S.tt.zoom, H = (e - s) * ppm;
    const bad = conflicts(t, day.id), L = live(t).filter((x) => x.dayId === day.id);
    const cols = `58px repeat(${t.stages.length}, minmax(200px, 1fr))`;
    const hours = []; for (let m = Math.ceil(s / 60) * 60; m <= e; m += 60) hours.push(`<span style="top:${(m - s) * ppm}px">${hm(m)}</span>`);
    const off = (((60 - (s % 60)) % 60) * ppm), off2 = (((30 - (s % 30)) % 30) * ppm);
    const bg = `background-size:100% ${60 * ppm}px,100% ${30 * ppm}px;background-position:0 ${off}px,0 ${off2}px`;
    const headCol = (st) => {
      const l = L.filter((x) => x.stageId === st.id).sort((a, b) => a.start - b.start);
      const n = l.filter((x) => x.kind === 'artist').length, last = l.reduce((m, x) => Math.max(m, x.start + x.dur), 0);
      return `<div class="tt-sh"><b>${esc(st.name)}</b><span class="muted">${n} set${n > 1 ? 's' : ''}${last ? ` · fin ${hm(last)}` : ''}</span><span class="sp"></span>${l.length ? `<button class="btn sm ghost icon" data-act="tt-pack" data-stage="${st.id}" title="Enchaîner les passages de cette scène (changements de plateau de ${t.changeover} min)">${ic('list')}</button>` : ''}</div>`;
    };
    return `<div class="tt-scroll" data-keep-scroll="tt-grid">
      <div class="tt-head" style="grid-template-columns:${cols}"><div></div>${t.stages.map(headCol).join('')}</div>
      <div class="tt-body" style="grid-template-columns:${cols};height:${H + 24}px">
        <div class="tt-axis">${hours.join('')}</div>
        ${t.stages.map((st) => `<div class="tt-col" data-ttcol="${st.id}" style="height:${H}px;${bg}">${L.filter((x) => x.stageId === st.id).map((x) => blk(x, s, ppm, bad)).join('')}</div>`).join('')}
      </div></div>`;
  }

  function blk(x, s, ppm, bad) {
    const a = x.kind === 'artist' ? byId(x.artistId) : null;
    const top = (x.start - s) * ppm, h = Math.max(8, x.dur * ppm - 2);
    const time = `${hm(x.start)}–${hm(x.start + x.dur)}`;
    const size = h < 30 ? 'xs' : h < 56 ? 'sm' : '';
    const color = a ? `--c:${styleColor(a.styles[0] || a.name)}` : '';
    const title = `${slotLabel(x)} · ${time} (${durTxt(x.dur)})${bad.has(x.id) ? ' · CONFLIT : chevauche un autre créneau' : ''}${x.note ? ' · ' + x.note : ''}`;
    const inner = a
      ? `${size ? '' : avatar(a, 'sm')}<div class="tx"><b>${esc(a.name)}</b><span class="tm">${time} · ${durTxt(x.dur)}</span>${size ? '' : `<span>${esc([a.styles.slice(0, 2).join(', '), stOf(a) ? STATUS_L[stOf(a)] : 'pas proposé'].filter(Boolean).join(' · '))}</span>`}</div>`
      : `<div class="tx"><b>${esc(x.label || (x.kind === 'break' ? 'Changement de plateau' : 'Bloc'))}</b><span class="tm">${time} · ${durTxt(x.dur)}</span></div>`;
    return `<div class="tt-blk ${x.kind} ${size} ${bad.has(x.id) ? 'bad' : ''} ${a && stOf(a) !== 'confirme' ? 'tent' : ''}" data-slot="${x.id}" style="top:${top}px;height:${h}px;${color}" title="${esc(title)}">${inner}<div class="rz"></div></div>`;
  }

  // ---------- glisser-déposer (souris) ----------
  let D = null;
  const cleanup = (d) => { if (!d) return; d.ghost && d.ghost.remove(); d.prev && d.prev.remove(); d.el && d.el.classList.remove('dragging'); document.body.classList.remove('tt-dragging'); $$('.tt-side.drop').forEach((x) => x.classList.remove('drop')); };
  document.addEventListener('pointerdown', (e) => {
    if (S.view !== 'timetable' || e.button !== 0) return;
    const rz = e.target.closest('.tt-blk .rz'), b = e.target.closest('.tt-blk'), n = e.target.closest('[data-ttnew]');
    if (!b && !n) return;
    const t = cur();
    if (b) {
      const sl = t.slots.find((x) => x.id === b.dataset.slot); if (!sl) return;
      D = rz ? { mode: 'resize', sl, el: b, dur: sl.dur } : { mode: 'move', sl, el: b, dur: sl.dur, grab: (e.clientY - b.getBoundingClientRect().top) / S.tt.zoom };
    } else {
      const kind = n.dataset.ttnew, dur = kind === 'artist' ? t.setDur : Number(n.dataset.dur) || t.changeover;
      D = { mode: 'new', kind, id: n.dataset.id, label: n.dataset.label || '', dur, grab: Math.min(10, dur / 3), el: n };
    }
    Object.assign(D, { t, x0: e.clientX, y0: e.clientY, moved: false });
    e.preventDefault();
  });
  document.addEventListener('pointermove', (e) => {
    if (!D) return;
    const d = D, t = d.t, day = dayOf(t, S.tt.day); if (!day) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
      d.moved = true; document.body.classList.add('tt-dragging');
      if (d.mode !== 'resize') {
        d.ghost = document.createElement('div'); d.ghost.className = 'tt-ghost';
        d.ghost.textContent = d.mode === 'move' ? slotLabel(d.sl) : d.kind === 'artist' ? (byId(d.id) || {}).name : d.label;
        document.body.appendChild(d.ghost);
        if (d.mode === 'move') d.el.classList.add('dragging');
        d.prev = document.createElement('div'); d.prev.className = 'tt-prev';
      }
    }
    const [s, e2] = range(day), ppm = S.tt.zoom;
    const sc = $('.tt-scroll');
    if (sc) { const r = sc.getBoundingClientRect(); if (e.clientY > r.bottom - 40) sc.scrollTop += 14; else if (e.clientY < r.top + 60 && e.clientY > r.top - 30) sc.scrollTop -= 14; }
    if (d.mode === 'resize') {
      const r = d.el.parentElement.getBoundingClientRect();
      const end = Math.min(e2, snap(s + (e.clientY - r.top) / ppm));
      d.dur = Math.max(SNAP, end - d.sl.start);
      d.el.style.height = Math.max(8, d.dur * ppm - 2) + 'px';
      const tm = $('.tm', d.el); if (tm) tm.textContent = `${hm(d.sl.start)}–${hm(d.sl.start + d.dur)} · ${durTxt(d.dur)}`;
      return;
    }
    d.ghost.style.left = e.clientX + 14 + 'px'; d.ghost.style.top = e.clientY + 10 + 'px';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const col = under && under.closest('.tt-col');
    const onSide = d.mode === 'move' && under && under.closest('.tt-side');
    $$('.tt-side').forEach((x) => x.classList.toggle('drop', !!onSide));
    d.ghost.classList.toggle('del', !!onSide);
    if (!col) { d.target = null; d.prev.remove(); return; }
    const r = col.getBoundingClientRect();
    const raw = s + (e.clientY - r.top) / ppm - d.grab;
    let m = snap(raw);
    // aimant : colle au bloc voisin (fin du précédent ou début du suivant)
    const others = t.slots.filter((x) => x.dayId === day.id && x.stageId === col.dataset.ttcol && (!d.sl || x.id !== d.sl.id));
    let best = 8;
    others.forEach((x) => [x.start + x.dur, x.start - d.dur].forEach((c) => { if (Math.abs(raw - c) < best) { best = Math.abs(raw - c); m = c; } }));
    m = Math.max(s, Math.min(e2 - SNAP, m));
    d.target = { stageId: col.dataset.ttcol, start: m };
    if (d.prev.parentElement !== col) col.appendChild(d.prev);
    d.prev.style.top = (m - s) * ppm + 'px'; d.prev.style.height = Math.max(8, d.dur * ppm - 2) + 'px';
    d.prev.textContent = `${hm(m)} – ${hm(m + d.dur)}`;
  });
  const endDrag = (e, cancel) => {
    if (!D) return;
    const d = D; D = null; cleanup(d);
    if (cancel) return render();
    const t = d.t;
    if (!d.moved) {
      if (d.mode === 'move') editSlot(d.sl.id);
      else if (d.mode === 'new' && d.kind === 'artist') openArtist(d.id);
      else if (d.mode === 'new') toast('Glisse ce bloc sur la grille, à l’heure voulue');
      return;
    }
    if (d.mode === 'resize') { d.sl.dur = d.dur; save(); return render(); }
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (!d.target) {
      if (d.mode === 'move' && under && under.closest('.tt-side')) removeSlot(t, d.sl);
      else render();
      return;
    }
    if (d.mode === 'move') { Object.assign(d.sl, { stageId: d.target.stageId, start: d.target.start, dayId: S.tt.day }); delete d.sl.auto; }
    else {
      t.slots.push({ id: uid(), dayId: S.tt.day, stageId: d.target.stageId, start: d.target.start, dur: d.dur, kind: d.kind, artistId: d.kind === 'artist' ? d.id : undefined, label: d.kind === 'artist' ? '' : d.label });
      if (d.kind === 'artist') { const a = byId(d.id); const pl = placedMap(t)[d.id] || []; if (pl.length > 1) toast(`${a.name} est maintenant placé ${pl.length} fois`); }
    }
    save(); render();
  };
  document.addEventListener('pointerup', (e) => endDrag(e, false));
  document.addEventListener('pointercancel', (e) => endDrag(e, true));

  function removeSlot(t, sl) {
    const i = t.slots.indexOf(sl); if (i < 0) return;
    t.slots.splice(i, 1); save(); render();
    toast(`${slotLabel(sl)} retiré de la timetable`, { action: 'Annuler', onAction: () => { t.slots.splice(i, 0, sl); save(); render(); } });
  }

  // recale les passages d'une scène les uns après les autres, avec un changement de plateau entre deux artistes
  function pack(t, dayId, stageId) {
    const L = t.slots.filter((x) => x.dayId === dayId && x.stageId === stageId && !x.auto).sort((a, b) => a.start - b.start);
    t.slots = t.slots.filter((x) => !(x.dayId === dayId && x.stageId === stageId && x.auto));
    if (!L.length) return;
    let m = L[0].start;
    L.forEach((x, i) => {
      x.start = m; m += x.dur;
      const nx = L[i + 1];
      if (x.kind === 'artist' && nx && nx.kind === 'artist' && t.changeover) { t.slots.push({ id: uid(), dayId, stageId, start: m, dur: t.changeover, kind: 'break', label: 'Changement de plateau', auto: true }); m += t.changeover; }
    });
  }
  function withUndo(t, label, fn) {
    const snap0 = JSON.stringify(t.slots);
    fn(); save(); render();
    toast(label, { action: 'Annuler', onAction: () => { t.slots = JSON.parse(snap0); save(); render(); } });
  }

  // ---------- modifier un créneau ----------
  function editSlot(id) {
    const t = cur(), sl = t.slots.find((x) => x.id === id); if (!sl) return;
    const a = sl.kind === 'artist' ? byId(sl.artistId) : null;
    modal({
      title: a ? esc(a.name) : 'Bloc',
      body: `${a ? `<div class="mini-list" style="margin-bottom:6px"><div class="it" data-ts-open style="cursor:pointer">${avatar(a)}<div class="tx"><b>${esc(a.name)}</b><span>${esc([a.styles.join(', '), origin(a), feeText(a)].filter(Boolean).join(' · '))}</span></div>${pill(stOf(a)) || '<span class="muted" style="font-size:12px">pas proposé</span>'}</div></div>`
        : `<div class="field"><label>Texte du bloc</label><input id="ts-label" value="${esc(sl.label || '')}"></div>`}
        <div class="form" style="padding:12px 0 0">
          <div class="field half"><label>Jour</label><select id="ts-day">${t.days.map((d) => `<option value="${d.id}" ${d.id === sl.dayId ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</select></div>
          <div class="field half"><label>Scène</label><select id="ts-stage">${t.stages.map((x) => `<option value="${x.id}" ${x.id === sl.stageId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
          <div class="field third"><label>Début</label><input type="time" id="ts-start" value="${hm(sl.start)}"></div>
          <div class="field third"><label>Durée (min)</label><input type="number" id="ts-dur" min="5" step="5" value="${sl.dur}"></div>
          <div class="field third"><label>Fin</label><input type="time" id="ts-end" value="${hm(sl.start + sl.dur)}"></div>
          <div class="field full"><label>Note</label><input id="ts-note" value="${esc(sl.note || '')}" placeholder="ex. line check 20 min avant, B2B, set spécial…"></div>
        </div>`,
      foot: `<button class="btn danger" id="ts-del">${ic('trash')}Retirer</button><span class="sp"></span><button class="btn" id="ts-x">Annuler</button><button class="btn primary" id="ts-ok">${ic('check')}Enregistrer</button>`,
      onMount: (w, close) => {
        const st = $('#ts-start', w), du = $('#ts-dur', w), en = $('#ts-end', w);
        du.oninput = () => { en.value = hm(toMin(st.value) + (Number(du.value) || 0)); };
        st.oninput = du.oninput;
        en.oninput = () => { let d = toMin(en.value) - toMin(st.value); if (d <= 0) d += 1440; du.value = d; };
        $('#ts-x', w).onclick = close;
        const op = $('[data-ts-open]', w); if (op) op.onclick = () => { close(); openArtist(a.id); };
        $('#ts-del', w).onclick = () => { close(); removeSlot(t, sl); };
        $('#ts-ok', w).onclick = () => {
          const day = dayOf(t, $('#ts-day', w).value), [s] = range(day);
          let m = toMin(st.value); if (m < s) m += 1440;
          Object.assign(sl, { dayId: day.id, stageId: $('#ts-stage', w).value, start: m, dur: Math.max(SNAP, Number(du.value) || sl.dur), note: $('#ts-note', w).value.trim() });
          if (!a) sl.label = $('#ts-label', w).value.trim();
          delete sl.auto;
          if (day.id !== S.tt.day) S.tt.day = day.id;
          close(); save(); render();
        };
      },
    });
  }

  // ---------- réglages (jours, horaires, scènes) ----------
  function config(t, isNew) {
    const dr = JSON.parse(JSON.stringify({ name: t.name, setDur: t.setDur, changeover: t.changeover, days: t.days, stages: t.stages }));
    const body = () => `<div class="form" style="padding:0">
        <div class="field full"><label>Nom de la version</label><input data-k="name" value="${esc(dr.name)}" placeholder="ex. Version A, Test tête d'affiche samedi…"></div>
        <div class="field half"><label>Durée d'un set par défaut (min)</label><input type="number" min="5" step="5" data-k="setDur" value="${dr.setDur}"></div>
        <div class="field half"><label>Changement de plateau (min)</label><input type="number" min="0" step="5" data-k="changeover" value="${dr.changeover}"></div>
        <h4>Scènes</h4>
        <div class="full tt-cfg">${dr.stages.map((s, i) => `<div class="r"><input data-st="${i}" value="${esc(s.name)}" placeholder="Nom de la scène">${dr.stages.length > 1 ? `<button type="button" class="btn sm ghost icon" data-delst="${i}" title="Supprimer">${ic('x')}</button>` : ''}</div>`).join('')}
          <button type="button" class="btn sm" data-addst>${ic('plus')}Ajouter une scène</button></div>
        <h4>Jours et horaires</h4>
        <div class="full tt-cfg">${dr.days.map((d, i) => `<div class="r"><input data-dl="${i}" value="${esc(d.label)}" placeholder="Nom (ex. Vendredi)" style="flex:1.4"><input type="date" data-dd="${i}" value="${esc(d.date || '')}"><span class="muted">de</span><input type="time" data-ds="${i}" value="${esc(d.start)}"><span class="muted">à</span><input type="time" data-de="${i}" value="${esc(d.end)}">${dr.days.length > 1 ? `<button type="button" class="btn sm ghost icon" data-delday="${i}" title="Supprimer">${ic('x')}</button>` : ''}</div>`).join('')}
          <button type="button" class="btn sm" data-addday>${ic('plus')}Ajouter un jour</button>
          <div class="hint">Une heure de fin plus petite que le début = le lendemain (ex. 18:00 → 03:00).</div></div>
      </div>`;
    const read = (w) => {
      $$('[data-k]', w).forEach((i) => (dr[i.dataset.k] = i.type === 'number' ? Math.max(0, Number(i.value) || 0) : i.value.trim()));
      $$('[data-st]', w).forEach((i) => (dr.stages[+i.dataset.st].name = i.value.trim()));
      [['dl', 'label'], ['dd', 'date'], ['ds', 'start'], ['de', 'end']].forEach(([k, f]) => $$(`[data-${k}]`, w).forEach((i) => (dr.days[+i.dataset[k]][f] = i.value.trim())));
    };
    modal({
      title: isNew ? 'Nouvelle timetable' : 'Réglages de la timetable', wide: true,
      body: `<div id="tt-cfg">${body()}</div>`,
      foot: `${isNew ? '' : `<button class="btn danger" id="cf-del">${ic('trash')}Supprimer cette version</button>`}<span class="sp"></span><button class="btn" id="cf-x">Annuler</button><button class="btn primary" id="cf-ok">${ic('check')}${isNew ? 'Créer' : 'Enregistrer'}</button>`,
      onMount: (w, close) => {
        const box = $('#tt-cfg', w);
        box.onclick = (e) => {
          const b = e.target.closest('button'); if (!b) return;
          read(w);
          if (b.hasAttribute('data-addst')) dr.stages.push({ id: uid(), name: `Scène ${dr.stages.length + 1}` });
          else if (b.dataset.delst) dr.stages.splice(+b.dataset.delst, 1);
          else if (b.hasAttribute('data-addday')) { const p = dr.days[dr.days.length - 1]; let date = ''; if (p && p.date) { const x = new Date(p.date + 'T12:00'); x.setDate(x.getDate() + 1); date = x.toISOString().slice(0, 10); } dr.days.push({ id: uid(), label: `Jour ${dr.days.length + 1}`, date, start: p ? p.start : '18:00', end: p ? p.end : '03:00' }); }
          else if (b.dataset.delday) dr.days.splice(+b.dataset.delday, 1);
          box.innerHTML = body();
        };
        $('#cf-x', w).onclick = close;
        if (!isNew) $('#cf-del', w).onclick = async () => {
          if (!(await confirmBox(`Supprimer la version « ${esc(t.name)} » et ses ${live(t).length} créneaux ?`, 'Supprimer'))) return;
          S.data.timetables = all().filter((x) => x !== t); S.data.ttActive = ''; save(); close(); render(); toast('Version supprimée');
        };
        $('#cf-ok', w).onclick = async () => {
          read(w);
          dr.days.forEach((d) => { d.start = d.start || '18:00'; d.end = d.end || '03:00'; d.label = d.label || 'Jour'; });
          dr.stages.forEach((s, i) => (s.name = s.name || `Scène ${i + 1}`));
          const dayIds = new Set(dr.days.map((d) => d.id)), stIds = new Set(dr.stages.map((s) => s.id));
          const lost = t.slots.filter((x) => !dayIds.has(x.dayId) || !stIds.has(x.stageId));
          if (lost.length && !(await confirmBox(`${lost.length} créneau${lost.length > 1 ? 'x' : ''} sur un jour ou une scène supprimés ${lost.length > 1 ? 'seront retirés' : 'sera retiré'}. Continuer ?`, 'Continuer'))) return;
          Object.assign(t, { name: dr.name || 'Sans nom', setDur: dr.setDur || 60, changeover: dr.changeover, days: dr.days, stages: dr.stages });
          t.slots = t.slots.filter((x) => dayIds.has(x.dayId) && stIds.has(x.stageId));
          if (isNew) all().push(t);
          S.data.ttActive = t.id; save(); close(); render();
          if (isNew) toast(`Timetable « ${t.name} » créée`);
        };
      },
    });
  }

  // ---------- PDF ----------
  function pdfHtml(t) {
    const st = settings();
    const pages = t.days.map((day) => {
      const L = live(t).filter((x) => x.dayId === day.id);
      return `<div class="pg"><div class="k">${esc(st.edition)} · ${esc(t.name)}</div><h1>${esc(day.label)}${day.date ? ` <small>${fmtDate(day.date, { day: 'numeric', month: 'long', year: 'numeric' })}</small>` : ''}</h1>
        <div class="cols">${t.stages.map((sg) => `<div class="c"><h2>${esc(sg.name)}</h2>${L.filter((x) => x.stageId === sg.id).sort((a, b) => a.start - b.start).map((x) => {
          const a = x.kind === 'artist' ? byId(x.artistId) : null;
          return a ? `<div class="r"><span class="t">${hm(x.start)}–${hm(x.start + x.dur)}</span><div><b>${esc(a.name)}</b>${stOf(a) && stOf(a) !== 'confirme' ? ` <span class="tent">${esc(STATUS_L[stOf(a)])}</span>` : ''}<div class="m">${esc([a.styles.join(', '), origin(a)].filter(Boolean).join(' · '))}${x.note ? ' · ' + esc(x.note) : ''}</div></div></div>`
            : `<div class="r b"><span class="t">${hm(x.start)}–${hm(x.start + x.dur)}</span><div>${esc(x.label || 'Pause')}</div></div>`;
        }).join('') || '<p class="m">—</p>'}</div>`).join('')}</div></div>`;
    }).join('');
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
      @page { size: A4 landscape; margin: 0; } * { box-sizing: border-box; } body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; color: #0f1a2e; font-size: 10pt; }
      .pg { padding: 12mm 14mm; page-break-after: always; } .pg:last-child { page-break-after: auto; }
      .k { color: #1463f3; font-size: 8.5pt; letter-spacing: 1.5px; text-transform: uppercase; font-weight: 700; }
      h1 { font-size: 22pt; margin: 2px 0 6mm; } h1 small { font-size: 12pt; color: #7a8699; font-weight: 500; }
      .cols { display: flex; gap: 6mm; } .c { flex: 1; min-width: 0; } h2 { font-size: 12pt; margin: 0 0 3mm; padding-bottom: 2mm; border-bottom: 2px solid #0f1a2e; }
      .r { display: flex; gap: 4mm; padding: 2.4mm 0; border-bottom: 1px solid #e2e6ee; page-break-inside: avoid; } .t { font-variant-numeric: tabular-nums; font-weight: 700; white-space: nowrap; width: 25mm; flex: none; }
      .r b { font-size: 11pt; } .m { color: #6b778c; font-size: 8.5pt; margin-top: 1px; } .r.b { color: #7a8699; font-style: italic; font-size: 9pt; padding: 1.4mm 0; }
      .tent { font-size: 7.5pt; background: #fff2db; color: #a15c00; padding: 1px 6px; border-radius: 8px; font-weight: 700; }
    </style></head><body>${pages}</body></html>`;
  }

  // ---------- actions ----------
  Object.assign(ACT, {
    'tt-day': (el) => { S.tt.day = el.dataset.id; render(); },
    'tt-src': (el) => { S.tt.src = el.dataset.src; render(); },
    'tt-zoom': (el) => { const i = ZOOMS.indexOf(S.tt.zoom); S.tt.zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 2 : i) + Number(el.dataset.d)))]; render(); },
    'tt-config': () => config(cur(), false),
    'tt-new': () => { const c = cur(), t = defaultTT(`Version ${versions().length + 1}`); t.days = JSON.parse(JSON.stringify(c.days)); t.stages = JSON.parse(JSON.stringify(c.stages)); t.setDur = c.setDur; t.changeover = c.changeover; config(t, true); },
    'tt-dup': () => {
      const c = cur(), t = JSON.parse(JSON.stringify(c));
      t.id = uid(); t.name = `${c.name} (variante)`; t.createdAt = new Date().toISOString(); t.slots.forEach((x) => (x.id = uid()));
      all().push(t); S.data.ttActive = t.id; save(); render();
      toast(`Copie créée : « ${t.name} ». Tu peux tester des changements sans toucher à l’original.`);
    },
    'tt-pack': (el) => { const t = cur(); withUndo(t, `${(stageOf(t, el.dataset.stage) || {}).name} : passages enchaînés`, () => pack(t, S.tt.day, el.dataset.stage)); },
    'tt-pack-all': () => { const t = cur(); withUndo(t, 'Passages enchaînés sur toutes les scènes', () => t.stages.forEach((s) => pack(t, S.tt.day, s.id))); },
    'tt-pdf': async () => {
      const t = cur(); toast('Création du PDF…');
      const r = await window.bv.exportPdf(pdfHtml(t), `${(settings().edition || 'Festival').replace(/[^\w -]/g, '')} - Timetable ${t.name.replace(/[^\w -]/g, '')}.pdf`);
      if (r && r.error) toast(r.error, { error: true }); else if (r && r.ok) toast('PDF créé');
    },
  });

  window.TT = {
    view,
    onInput(el) { if (el.dataset.input !== 'tt-q') return false; S.tt.q = el.value; render(); return true; },
    onChange(el) { if (el.dataset.change !== 'tt-version') return false; S.data.ttActive = el.value; S.tt.day = ''; save(); render(); return true; },
    // « Ven. 22:00–23:00 · Scène 1 » pour la fiche artiste
    placesText(a) {
      if (!versions().length) return '';
      const t = cur(), L = (placedMap(t)[a.id] || []).sort((x, y) => t.days.indexOf(dayOf(t, x.dayId)) - t.days.indexOf(dayOf(t, y.dayId)) || x.start - y.start);
      if (!L.length) return '';
      return L.map((x) => `${esc((dayOf(t, x.dayId) || {}).label || '')} ${hm(x.start)}–${hm(x.start + x.dur)} · ${esc((stageOf(t, x.stageId) || {}).name || '')}`).join('<br>') + `<div class="muted" style="font-size:11.5px;font-weight:400">version « ${esc(t.name)} »</div>`;
    },
    // pour Orbiz
    summary(allVersions) {
      const one = (t) => {
        const placed = placedMap(t);
        return {
          version: t.name, active: t.id === S.data.ttActive, duree_set_defaut_min: t.setDur, changement_plateau_min: t.changeover,
          jours: t.days.map((d) => { const bad = conflicts(t, d.id); return {
            jour: d.label, date: d.date || undefined, horaires: `${d.start} → ${d.end}`,
            scenes: t.stages.map((sg) => ({ scene: sg.name, passages: live(t).filter((x) => x.dayId === d.id && x.stageId === sg.id).sort((a, b) => a.start - b.start).map((x) => ({
              debut: hm(x.start), fin: hm(x.start + x.dur), duree_min: x.dur, type: x.kind === 'artist' ? 'artiste' : x.kind === 'break' ? 'pause' : 'bloc',
              nom: slotLabel(x), artist_id: x.artistId, statut: x.artistId ? STATUS_L[stOf(byId(x.artistId))] || 'non proposé' : undefined, conflit: bad.has(x.id) || undefined, note: x.note || undefined })) })),
          }; }),
          confirmes_pas_places: proposedArtists().filter((a) => stOf(a) === 'confirme' && !placed[a.id]).map((a) => ({ id: a.id, nom: a.name })),
        };
      };
      if (!versions().length) return { info: 'Aucune timetable pour l’instant.' };
      cur();
      return allVersions ? versions().map(one) : one(cur());
    },
  };
})();
