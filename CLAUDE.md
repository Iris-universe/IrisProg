# IrisProg

Logiciel de programmation de festival / d'événements (base d'artistes générale, propositions par édition, pipeline de booking, timetable, mails). Le nom du festival et l'édition sont des réglages (`settings.edition`) : rien n'est propre à un festival dans le code. **Rust + Tauri 2**, interface HTML/JS dans `ui/`. Pilotable par Orbiz via iris-link (id `irisprog`). Lancement : `IrisProg.vbs` (lance `target\release\irisprog.exe`).
Reprise facultative d'une ancienne version Electron au premier lancement (seulement si `data.json` n'existe pas encore) : le dossier à reprendre (nom dans `%APPDATA%` ou chemin complet) est écrit dans `%APPDATA%\IrisProg\import-from.txt` ; son fichier `*-data.json` devient `data.json`, avec les sauvegardes, le cache mail et les secrets (safeStorage Electron déchiffré puis rechiffré en DPAPI). Notes perso éventuelles : `CLAUDE.local.md` (non versionné).

## Compiler / tester
- `cargo build --release` ; **les fichiers de `ui/` sont intégrés au binaire** : recompiler après toute modif de l'interface.
- `cargo test` (unitaires) ; `cargo test -- --ignored --nocapture` : tests en ligne (recherche d'artiste) et lecture des anciens secrets (affiche seulement des longueurs).
- Ne pas lancer l'exe pour tester sans demander à l'utilisateur.

## Rust (`src/`)
- `main.rs` : fenêtre, commandes Tauri (mêmes fonctions que l'ancien preload), export PDF (fenêtre cachée + protocole `irisexport` + `wv2::print_pdf`, paysage si le HTML contient « A4 landscape »), iris-link (outils dans `tools.json`, consignes avec le nom de l'édition).
- `data.rs` : `%APPDATA%\IrisProg\data.json` + `sauvegardes/` (1 par jour, 30 gardées), reprise d'une ancienne version (`import-from.txt`). `secrets.rs` : brique `iris-secrets` (DPAPI + safeStorage Electron).
- `mail.rs` : IMAP (async-imap + rustls, une connexion à la fois), SMTP (lettre), OAuth Microsoft (fenêtre de connexion Tauri, PKCE, XOAUTH2), cache `mail/` (même format qu'avant).
- `sources.rs` / `lookup.rs` / `countries.rs` / `http.rs` : enrichissement et recherche (ports de sources.js / lookup.js), pays en français (table au lieu d'Intl.DisplayNames).
- `owa.rs` : **Outlook intégré** = webview enfant de la fenêtre (feature `unstable` de Tauri), session dans `%APPDATA%\IrisProg\outlook`, popups Microsoft autorisées. L'interface (`ui/owa.js`) envoie la position du cadre `#owa-frame` ; la webview est cachée quand une modale ou la fiche artiste est ouverte (elle passe au-dessus du HTML). `owa_read(js)` exécute un script dans Outlook (`wv2::eval`).
- `wv2.rs` : appels WebView2 directs (ExecuteScript avec résultat, PrintToPdf).
- Briques partagées : `iris-store`, `iris-link`, `iris-secrets` (`../iris-briques`).

## Interface (`ui/`)
- `bridge.js` : `window.bv` (même API que l'ancien preload, + `bv.owaEval(js)`), outils génériques d'Orbiz, F5/F11/F12, liens externes.
- `data.js`, `app.js`, `timetable.js`, `mailui.js`, `owa.js`, `agent.js` : repris de l'ancienne version Electron (voir ci-dessous). Prompts Orbiz : préfixe d'outils `irisprog__`.

## Données artistes
- `messages` : messages reçus (formulaire du site, mails) `{ source, date, author, email, phone, text }`, affichés dans la fiche (« Messages reçus ») et inclus dans la recherche.
- `foundVia` : où l'artiste a été trouvé (`FOUND_VIA` dans data.js, valeur libre possible) → filtre « Trouvé via » ; `source` = détail (agence, expéditeur…).
- Filtre de date (`S.f.period`, `from`, `to`) sur `createdAt` = date de la demande.
- `setProgress(id, label, done, total, sous_titre, hide)` (app.js) : encart de progression en bas à droite pour les tâches longues lancées par un script ou Orbiz (via `execute_javascript`). Liens `facebook` et `tiktok` ajoutés aux fiches.
- Depuis le 2026-11-10 : la base d'artistes est générale. Les propositions pour le festival sont dans `S.data.proposals` = `[{ id, artistId, edition, status, addedAt }]` (édition = `settings().edition`). Helpers : `propOf(a)`, `stOf(a)`, `propose(a, status)`, `unpropose(a)`, `proposedArtists()`. Vue `proposals` (pipeline ou cartes) ; `a.status` n'est plus utilisé (ancien champ, migré au premier lancement s'il différait de « proposition »). Outils Orbiz : `propose_artist`, `unpropose_artist`, `list_artists({ proposed })`.
- `src/lookup.rs` (commandes `lookup_artist` / `lookup_image`) : recherche d'un artiste sur Spotify (via DuckDuckGo, souvent bloqué), MusicBrainz (liens officiels, fiable), Instagram et SoundCloud (identifiants devinés, balises og:), Deezer (API publique). Utilisé par « Ajouter un artiste » (`addArtistDialog`).
- Popularité : `a.popularity = { spotify, instagram, soundcloud, updatedAt, note }` → `popOf(a)` = audience cumulée, score 0-100 (log, 1 M ≈ 100) et niveau (Émergent < 1k, Local < 10k, Régional < 50k, National < 250k, Tête d'affiche). Tri, filtre, étiquette sur les cartes, section dans la fiche.
- `src/sources.rs` : Spotify Web API (client credentials, clés dans Paramètres), Wikidata (sans clé, liens officiels + pays + genres), Discogs (token), Last.fm (clé), YouTube Data API (clé). Clés chiffrées dans `userData/api-keys.json`. `enrichAll` envoie `enrich:progress/patch/done` au renderer ; `applyEnrich(p)` (app.js) ne remplace jamais un champ déjà rempli. Garde-fou homonymes : nom identique exigé, homonyme célèbre sans genre commun écarté (cas « Rōse » / ROSÉ).
- Origine et genres (`origin_genre` dans sources.rs) : SoundCloud (API v2 du site, `client_id` extrait des scripts publics : ville, pays et genres des morceaux déclarés par l'artiste) > Resident Advisor (GraphQL public `ra.co/graphql`, recherche exacte) > MusicBrainz (retrouvé par URL d'un lien connu) > Wikidata ; genres pondérés + Spotify/Last.fm si clés. Côté app : champ vide = rempli (avec `originSource`/`citySource`), sinon `a.suggest` (bandeau « Appliquer / Ignorer » dans la fiche, filtre « À vérifier »).
- Règle d'ancrage (depuis le cas « Neko ») : une source interrogée par le NOM seul (Resident Advisor, Wikidata par recherche, Discogs, Last.fm, Spotify trouvé par nom) n'est utilisée que si elle partage un lien avec la fiche (`linkKey`/`anchoredBy`), ou via un identifiant sûr (Wikidata par ID Spotify, Last.fm par MBID = MusicBrainz retrouvé par URL). Sinon : aucun lien ajouté, aucun champ rempli, au mieux une suggestion « à confirmer » si le champ est vide (`p.weak`).

## Ajouts du 2026-11-11
- Mode sélection (vue Artistes) : `S.sel` (Set d'ids, null = off). Clic = cocher, Maj+clic = plage, Ctrl+A = tout (filtrés). Actions groupées : proposer, retirer des propositions, CSV, supprimer (avec Annuler).
- Fiche artiste simplifiée : en-tête, statut, lecteur intégré (`playersOf(a)` : embeds Spotify / SoundCloud / YouTube vidéo-playlist-/channel/), présentation, « En bref », notes ; messages, mails, cachet détaillé, popularité, historique repliés (`details.fold[data-sec]`, état gardé dans `S.openSecs`). `refreshDrawer` ne recharge pas le lecteur si on reste sur la même fiche (`#dv-head`, `#dv-a`, `#dv-b` remplacés seuls). CSP `frame-src` (index.html) autorise ces embeds.
- `app/timetable.js` (`window.TT`, vue `timetable`) : `S.data.timetables` (versions par édition, `S.data.ttActive`), jours avec horaires (fin < début = lendemain), scènes, créneaux `{ dayId, stageId, start (min depuis minuit, >1440 après minuit), dur, kind artist|break|free }`. Glisser-déposer en pointer events (aimant sur les blocs voisins, pas de 5 min), redimension par le bas, retrait en glissant vers la liste, « Enchaîner » (changements de plateau `auto`), conflits, PDF paysage, outil Orbiz `get_timetable`. `render()` garde le scroll des éléments `[data-keep-scroll]`.

## Briques partagées : où elles sont prises
`Cargo.toml` les prend sur GitHub (`github.com/Iris-universe/iris-briques`) ; `.cargo/config.toml` (local, non versionné) les redirige vers `../iris-briques` pour développer. Modifier une brique = la modifier dans `iris-briques`, puis la pousser.
