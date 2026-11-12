// Sources de données officielles : Spotify Web API, Wikidata, Discogs, Last.fm, YouTube Data API,
// + SoundCloud / Resident Advisor / MusicBrainz (origine et genres). Clés chiffrées dans api-keys.json.
// Utilisé par la recherche d'un artiste et par « Enrichir toute la base ».
use crate::countries;
use crate::data;
use crate::http::{self, enc, get_json, get_text, num, BOT, BROWSER};
use crate::secrets;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const KEYS: [&str; 5] = ["spotifyId", "spotifySecret", "lastfmKey", "discogsToken", "youtubeKey"];

async fn sleep(ms: u64) {
    tokio::time::sleep(Duration::from_millis(ms)).await;
}
/// norm + « the » en tête ignoré (comme sources.js)
pub fn norm(s: &str) -> String {
    let t = s.trim();
    let t = if t.len() > 4 && t[..4].eq_ignore_ascii_case("the ") { &t[4..] } else { t };
    http::norm(t)
}
fn s(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
fn re(p: &str) -> Regex {
    Regex::new(p).unwrap()
}
fn cap1(p: &str, h: &str) -> Option<String> {
    re(p).captures(h).map(|c| c[1].to_string())
}

// ------------------------------------------------------------ clés
pub fn load_keys() -> HashMap<String, String> {
    let raw = iris_store::read_json(&data::keys_file()).unwrap_or(json!({}));
    KEYS.iter().map(|k| (k.to_string(), secrets::unprotect(s(&raw[*k])))).collect()
}
pub fn save_keys(patch: &Value) -> Value {
    let mut next = load_keys();
    for k in KEYS {
        if let Some(v) = patch.get(k).and_then(|v| v.as_str()) {
            if v != "••••" {
                next.insert(k.into(), v.trim().into());
            }
        }
    }
    let raw: Map<String, Value> = KEYS.iter().map(|k| (k.to_string(), json!(secrets::protect(next.get(*k).map(|s| s.as_str()).unwrap_or(""))))).collect();
    let _ = iris_store::write_json(&data::keys_file(), &Value::Object(raw));
    *SP_TOKEN.lock().unwrap() = None;
    status()
}
pub fn masked_keys() -> Value {
    Value::Object(load_keys().into_iter().map(|(k, v)| (k, json!(if v.is_empty() { "" } else { "••••" }))).collect())
}
pub fn status() -> Value {
    let k = load_keys();
    let has = |n: &str| !k.get(n).map(|s| s.is_empty()).unwrap_or(true);
    json!({ "spotify": has("spotifyId") && has("spotifySecret"), "lastfm": has("lastfmKey"), "discogs": has("discogsToken"), "youtube": has("youtubeKey"), "wikidata": true })
}

// ------------------------------------------------------------ Spotify Web API
static SP_TOKEN: Mutex<Option<(String, Instant)>> = Mutex::new(None);

async fn spotify_token() -> Result<Option<String>, String> {
    if let Some((t, exp)) = SP_TOKEN.lock().unwrap().clone() {
        if exp > Instant::now() {
            return Ok(Some(t));
        }
    }
    let k = load_keys();
    let (id, secret) = (k["spotifyId"].clone(), k["spotifySecret"].clone());
    if id.is_empty() || secret.is_empty() {
        return Ok(None);
    }
    use base64::{engine::general_purpose::STANDARD, Engine};
    let r = http::client()
        .post("https://accounts.spotify.com/api/token")
        .header("Authorization", format!("Basic {}", STANDARD.encode(format!("{id}:{secret}"))))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body("grant_type=client_credentials")
        .timeout(Duration::from_secs(12))
        .send()
        .await
        .map_err(|e| format!("Spotify : {e}"))?;
    let ok = r.status().is_success();
    let j: Value = r.json().await.unwrap_or(json!({}));
    match j["access_token"].as_str() {
        Some(t) if ok => {
            let exp = Instant::now() + Duration::from_secs(j["expires_in"].as_u64().unwrap_or(3600).saturating_sub(60));
            *SP_TOKEN.lock().unwrap() = Some((t.to_string(), exp));
            Ok(Some(t.to_string()))
        }
        _ => {
            *SP_TOKEN.lock().unwrap() = None;
            let e = j["error_description"].as_str().or(j["error"].as_str()).unwrap_or("refusé");
            Err(format!("Spotify : {e}"))
        }
    }
}
async fn sp_get(path: &str) -> Result<Option<Value>, String> {
    let Some(t) = spotify_token().await? else { return Ok(None) };
    Ok(get_json(&format!("https://api.spotify.com/v1{path}"), &[("Authorization", format!("Bearer {t}"))]).await)
}
fn sp_shape(a: &Value) -> Value {
    json!({
        "id": a["id"], "name": a["name"], "url": format!("https://open.spotify.com/artist/{}", s(&a["id"])),
        "followers": a["followers"]["total"], "popularity": a["popularity"],
        "genres": a["genres"].as_array().cloned().unwrap_or_default(),
        "img": a["images"][0]["url"].as_str().unwrap_or(""),
    })
}
pub async fn spotify_search(q: &str, limit: u32) -> Result<Option<Vec<Value>>, String> {
    let j = sp_get(&format!("/search?type=artist&limit={limit}&q={}", enc(q))).await?;
    Ok(j.and_then(|j| j["artists"]["items"].as_array().map(|l| l.iter().map(sp_shape).collect())))
}
async fn spotify_artist(id: &str) -> Result<Option<Value>, String> {
    Ok(sp_get(&format!("/artists/{id}")).await?.filter(|a| a["id"].is_string()).map(|a| sp_shape(&a)))
}
pub async fn spotify_monthly(id: &str) -> Option<u64> {
    let h = get_text(&format!("https://open.spotify.com/artist/{id}"), BOT, 12000).await?;
    let d = http::meta(&h, "og:description");
    cap1(r"([\d.,]+[KkMm]?) monthly listeners", &d).and_then(|m| num(&m))
}
pub async fn test_spotify() -> Value {
    match spotify_token().await {
        Err(e) => json!({ "error": e }),
        Ok(None) => json!({ "error": "Clés Spotify manquantes." }),
        Ok(Some(_)) => match spotify_search("Voice Of Ruin", 1).await {
            Ok(Some(r)) => json!({ "ok": true, "sample": r.first().map(|x| x["name"].clone()) }),
            Ok(None) => json!({ "error": "Spotify a répondu sans résultat (vérifie que l'app a bien accès à la Web API)." }),
            Err(e) => json!({ "error": e }),
        },
    }
}

// ------------------------------------------------------------ ancrage : une source trouvée par le nom n'est fiable que si elle pointe vers un lien déjà connu
pub fn link_key(u: &str) -> String {
    if u.is_empty() {
        return String::new();
    }
    let full = if u.to_lowercase().starts_with("http") { u.to_string() } else { format!("https://{u}") };
    let Ok(x) = url::Url::parse(&full) else { return String::new() };
    let host = x.host_str().unwrap_or("").to_lowercase();
    let host = re(r"^(www\.|m\.|mobile\.)").replace(&host, "").to_string();
    let parts: Vec<&str> = x.path().split('/').filter(|p| !p.is_empty()).collect();
    if host.ends_with("spotify.com") {
        return if parts.first() == Some(&"artist") {
            format!("spotify/{}", parts.get(1).unwrap_or(&""))
        } else if parts.get(1) == Some(&"artist") {
            format!("spotify/{}", parts.get(2).unwrap_or(&""))
        } else {
            String::new()
        };
    }
    if host.ends_with("facebook.com") && parts.first() == Some(&"profile.php") {
        let id = x.query_pairs().find(|(k, _)| k == "id").map(|(_, v)| v.to_string()).unwrap_or_default();
        return format!("facebook/{id}");
    }
    let seg = parts.first().map(|p| p.trim_start_matches('@').to_lowercase()).unwrap_or_default();
    if seg.is_empty() {
        return host;
    }
    let hp: Vec<&str> = host.split('.').collect();
    let site = if hp.len() >= 2 { hp[hp.len() - 2] } else { hp[0] };
    format!("{site}/{seg}")
}
fn link_values(links: &Value) -> Vec<String> {
    links.as_object().map(|m| m.values().filter_map(|v| v.as_str()).map(String::from).collect()).unwrap_or_default()
}
pub fn keys_of(links: &Value) -> HashSet<String> {
    link_values(links).iter().map(|u| link_key(u)).filter(|k| k.contains('/')).collect()
}
pub fn anchored_by(known: &HashSet<String>, links: &Value) -> bool {
    link_values(links).iter().any(|u| known.contains(&link_key(u)))
}
fn merge_links(a: &Value, b: &Value) -> Value {
    let mut m = a.as_object().cloned().unwrap_or_default();
    if let Some(bm) = b.as_object() {
        for (k, v) in bm {
            m.insert(k.clone(), v.clone());
        }
    }
    Value::Object(m)
}

// ------------------------------------------------------------ Wikidata
const WD: &str = "https://www.wikidata.org/w/api.php";
const MUSIC_P: [&str; 7] = ["P1902", "P434", "P1953", "P2003", "P3040", "P7085", "P2397"];
async fn wd_entities(ids: &[String], props: &str) -> Map<String, Value> {
    if ids.is_empty() {
        return Map::new();
    }
    let j = get_json(&format!("{WD}?action=wbgetentities&ids={}&props={props}&languages=fr|en&format=json", ids.join("|")), &[]).await;
    j.and_then(|j| j["entities"].as_object().cloned()).unwrap_or_default()
}
fn claim<'a>(e: &'a Value, p: &str) -> Vec<&'a Value> {
    e["claims"][p].as_array().map(|l| l.iter().filter_map(|c| c["mainsnak"]["datavalue"].get("value")).collect()).unwrap_or_default()
}
fn wd_label(e: &Value) -> String {
    e["labels"]["fr"]["value"].as_str().or(e["labels"]["en"]["value"].as_str()).unwrap_or("").to_string()
}
pub async fn wikidata(name: &str, spotify_id: Option<&str>) -> Option<Value> {
    let mut ids: Vec<String> = vec![];
    if let Some(sid) = spotify_id {
        let q = format!("SELECT ?i WHERE {{ ?i wdt:P1902 \"{sid}\" }}");
        let j = get_json(&format!("https://query.wikidata.org/sparql?format=json&query={}", enc(&q)), &[]).await;
        ids = j
            .and_then(|j| j["results"]["bindings"].as_array().cloned())
            .unwrap_or_default()
            .iter()
            .filter_map(|b| b["i"]["value"].as_str().and_then(|v| v.rsplit('/').next()).map(String::from))
            .collect();
    }
    let by_spotify = !ids.is_empty();
    if ids.is_empty() && !name.is_empty() {
        let sj = get_json(&format!("{WD}?action=wbsearchentities&search={}&language=fr&uselang=fr&type=item&limit=7&format=json", enc(name)), &[]).await;
        let n = norm(name);
        ids = sj
            .and_then(|j| j["search"].as_array().cloned())
            .unwrap_or_default()
            .iter()
            .filter(|x| norm(s(&x["label"])) == n || x["aliases"].as_array().is_some_and(|a| a.iter().any(|al| norm(s(al)) == n)))
            .filter_map(|x| x["id"].as_str().map(String::from))
            .collect();
    }
    if ids.is_empty() {
        return None;
    }
    let ents = wd_entities(&ids, "claims|labels|descriptions").await;
    let music: Vec<&Value> = ents.values().filter(|e| MUSIC_P.iter().any(|p| !claim(e, p).is_empty())).collect();
    if music.len() != 1 && spotify_id.is_none() {
        return if music.len() > 1 { Some(json!({ "ambiguous": music.len() })) } else { None };
    }
    let e = music.first().copied().or_else(|| ents.values().next())?.clone();
    let qid = |v: &Value| v["id"].as_str().map(String::from);
    let mut ref_ids: Vec<String> = ["P495", "P27", "P136"].iter().flat_map(|p| claim(&e, p).into_iter().filter_map(qid)).collect();
    ref_ids.sort();
    ref_ids.dedup();
    ref_ids.truncate(40);
    let refs = wd_entities(&ref_ids, "labels").await;
    let lab = |v: Option<&Value>| v.and_then(qid).and_then(|id| refs.get(&id)).map(wd_label).unwrap_or_default();
    let first = |p: &str| claim(&e, p).first().and_then(|v| v.as_str()).unwrap_or("").to_string();
    let country = {
        let c = lab(claim(&e, "P495").first().copied());
        if c.is_empty() { lab(claim(&e, "P27").first().copied()) } else { c }
    };
    let genres: Vec<String> = claim(&e, "P136").into_iter().map(|v| lab(Some(v))).filter(|g| !g.is_empty()).collect();
    let link = |p: &str, f: &dyn Fn(&str) -> String| {
        let v = first(p);
        if v.is_empty() { String::new() } else { f(&v) }
    };
    let website = claim(&e, "P856").first().and_then(|v| v.as_str()).unwrap_or("").to_string();
    Some(json!({
        "bySpotify": by_spotify,
        "qid": e["id"],
        "description": e["descriptions"]["fr"]["value"].as_str().or(e["descriptions"]["en"]["value"].as_str()).unwrap_or(""),
        "country": country,
        "genres": genres,
        "links": {
            "spotify": link("P1902", &|v| format!("https://open.spotify.com/artist/{v}")),
            "instagram": link("P2003", &|v| format!("https://www.instagram.com/{v}/")),
            "tiktok": link("P7085", &|v| format!("https://www.tiktok.com/@{v}")),
            "youtube": link("P2397", &|v| format!("https://www.youtube.com/channel/{v}")),
            "facebook": link("P2013", &|v| format!("https://www.facebook.com/{v}")),
            "soundcloud": link("P3040", &|v| format!("https://soundcloud.com/{v}")),
            "website": website,
        },
    }))
}

// ------------------------------------------------------------ Discogs
async fn discogs(name: &str) -> Option<Value> {
    let k = load_keys();
    let tok = k.get("discogsToken").cloned().unwrap_or_default();
    if tok.is_empty() {
        return None;
    }
    let h = [("Authorization", format!("Discogs token={tok}"))];
    let sj = get_json(&format!("https://api.discogs.com/database/search?type=artist&per_page=10&q={}", enc(name)), &h).await?;
    let n = norm(name);
    let ex: Vec<Value> = sj["results"].as_array().cloned().unwrap_or_default().into_iter().filter(|r| norm(&re(r"\s*\(\d+\)$").replace(s(&r["title"]), "")) == n).collect();
    if ex.len() != 1 {
        return if ex.len() > 1 { Some(json!({ "ambiguous": ex.len() })) } else { None };
    }
    let a = get_json(&format!("https://api.discogs.com/artists/{}", ex[0]["id"]), &h).await?;
    let urls: Vec<String> = a["urls"].as_array().map(|l| l.iter().filter_map(|v| v.as_str()).map(String::from).collect()).unwrap_or_default();
    let f = |p: &str| {
        let r = re(p);
        urls.iter().find(|u| r.is_match(u)).cloned().unwrap_or_default()
    };
    let other = re(r"instagram|soundcloud|facebook|youtube|tiktok|spotify|discogs|twitter|x\.com|bandcamp|beatport|myspace|wikipedia|residentadvisor|ra\.co");
    let website = urls.iter().find(|u| u.starts_with("http") && !other.is_match(u)).cloned().unwrap_or_default();
    let profile: String = re(r"(?i)\[[a-z]=?[^\]]*\]").replace_all(s(&a["profile"]), "").chars().take(500).collect();
    Some(json!({
        "id": a["id"], "url": a["uri"], "profile": profile, "img": a["images"][0]["uri"].as_str().unwrap_or(""),
        "links": { "instagram": f(r"instagram\.com/"), "soundcloud": f(r"soundcloud\.com/"), "facebook": f(r"facebook\.com/"), "youtube": f(r"youtube\.com/"),
                   "tiktok": f(r"tiktok\.com/@"), "spotify": f(r"open\.spotify\.com/artist/"), "website": website },
    }))
}

// ------------------------------------------------------------ Last.fm
async fn lastfm(name: &str) -> Option<Value> {
    let key = load_keys().get("lastfmKey").cloned().unwrap_or_default();
    if key.is_empty() {
        return None;
    }
    let j = get_json(&format!("https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&autocorrect=0&format=json&artist={}&api_key={key}", enc(name)), &[]).await?;
    let a = &j["artist"];
    if a.is_null() || norm(s(&a["name"])) != norm(name) {
        return None;
    }
    let listeners: u64 = a["stats"]["listeners"].as_str().and_then(|v| v.parse().ok()).unwrap_or(0);
    let tags: Vec<Value> = a["tags"]["tag"].as_array().map(|l| l.iter().take(6).map(|t| t["name"].clone()).collect()).unwrap_or_default();
    Some(json!({ "mbid": s(&a["mbid"]), "listeners": listeners, "tags": tags, "url": a["url"] }))
}

// ------------------------------------------------------------ YouTube
async fn youtube_subs(url: &str) -> Option<u64> {
    let key = load_keys().get("youtubeKey").cloned().unwrap_or_default();
    if key.is_empty() || url.is_empty() {
        return None;
    }
    let q = if let Some(c) = cap1(r"channel/(UC[\w-]{20,})", url) {
        format!("id={c}")
    } else if let Some(h) = cap1(r"youtube\.com/@([\w.-]+)", url) {
        format!("forHandle=@{h}")
    } else {
        return None;
    };
    let j = get_json(&format!("https://www.googleapis.com/youtube/v3/channels?part=statistics&{q}&key={key}"), &[]).await?;
    let st = &j["items"][0]["statistics"];
    if st.is_null() || st["hiddenSubscriberCount"].as_bool() == Some(true) {
        return None;
    }
    st["subscriberCount"].as_str().and_then(|v| v.parse().ok())
}

// ------------------------------------------------------------ réseaux sans API (balises publiques)
pub async fn ig_followers(url: &str) -> Option<u64> {
    let h = cap1(r"instagram\.com/([A-Za-z0-9_.]+)", url)?;
    let page = get_text(&format!("https://www.instagram.com/{h}/"), BOT, 12000).await?;
    let d = http::meta(&page, "og:description");
    cap1(r"^([\d.,]+[KkMm]?) Followers", &d).and_then(|m| num(&m))
}
async fn sc_followers(url: &str) -> Option<u64> {
    let h = cap1(r"soundcloud\.com/([A-Za-z0-9_-]+)", url)?;
    let page = get_text(&format!("https://soundcloud.com/{h}"), BROWSER, 12000).await?;
    cap1(r#""followers_count":(\d+)"#, &page).and_then(|v| v.parse().ok())
}

// ------------------------------------------------------------ SoundCloud (API publique du site : ville, pays et genres déclarés)
static SC_CID: Mutex<Option<String>> = Mutex::new(None);
async fn sc_client_id(force: bool) -> Option<String> {
    if !force {
        if let Some(c) = SC_CID.lock().unwrap().clone() {
            return Some(c);
        }
    }
    let h = get_text("https://soundcloud.com/discover", BROWSER, 12000).await?;
    let mut js: Vec<String> = re(r#"https://a-v2\.sndcdn\.com/assets/[^"]+\.js"#).find_iter(&h).map(|m| m.as_str().to_string()).collect();
    js.reverse();
    for u in js.iter().take(6) {
        if let Some(t) = get_text(u, BROWSER, 12000).await {
            if let Some(c) = cap1(r#"client_id:"([A-Za-z0-9]{32})""#, &t) {
                *SC_CID.lock().unwrap() = Some(c.clone());
                return Some(c);
            }
        }
    }
    None
}
async fn sc_profile(url: &str) -> Option<Value> {
    let slug = cap1(r"soundcloud\.com/([A-Za-z0-9_-]+)", url)?;
    for attempt in 0..2 {
        let cid = sc_client_id(attempt > 0).await?;
        let Some(u) = get_json(&format!("https://api-v2.soundcloud.com/resolve?url={}&client_id={cid}", enc(&format!("https://soundcloud.com/{slug}"))), &[]).await else { continue };
        if s(&u["kind"]) != "user" {
            return None;
        }
        let t = get_json(&format!("https://api-v2.soundcloud.com/users/{}/tracks?limit=40&client_id={cid}", u["id"]), &[]).await;
        let mut genres: Map<String, Value> = Map::new();
        let split = re(r"[,/&|]");
        for tr in t.and_then(|t| t["collection"].as_array().cloned()).unwrap_or_default() {
            for g in split.split(s(&tr["genre"])).map(|x| x.trim().to_lowercase()).filter(|x| !x.is_empty() && x.len() < 40) {
                let n = genres.get(&g).and_then(|v| v.as_f64()).unwrap_or(0.0) + 1.0;
                genres.insert(g, json!(n));
            }
        }
        return Some(json!({ "city": s(&u["city"]), "country": countries::fr(s(&u["country_code"])), "followers": u["followers_count"], "genres": genres }));
    }
    None
}

// ------------------------------------------------------------ Resident Advisor (pays et ville des DJs)
async fn ra_query(query: &str) -> Option<Value> {
    let r = http::client()
        .post("https://ra.co/graphql")
        .header("Content-Type", "application/json")
        .header("User-Agent", BROWSER)
        .header("Referer", "https://ra.co/")
        .timeout(Duration::from_secs(12))
        .body(json!({ "query": query }).to_string())
        .send()
        .await
        .ok()?;
    let j: Value = r.json().await.ok()?;
    Some(j["data"].clone())
}
async fn resident_advisor(name: &str, known: &HashSet<String>) -> Option<Value> {
    let d = ra_query(&format!("{{ search(searchTerm:{}, indices:[ARTIST], limit:10) {{ value contentUrl countryName areaName }} }}", json!(name))).await?;
    let n = norm(name);
    let strip = re(r"\s*\(.*?\)\s*$");
    let ex: Vec<Value> = d["search"].as_array().cloned().unwrap_or_default().into_iter().filter(|x| norm(&strip.replace(s(&x["value"]), "")) == n).take(5).collect();
    if ex.is_empty() {
        return None;
    }
    let mut cands = vec![];
    for x in ex {
        let slug = s(&x["contentUrl"]).rsplit('/').next().unwrap_or("").to_string();
        let Some(a) = ra_query(&format!("{{ artist(slug:{}) {{ country {{ name }} area {{ name }} soundcloud instagram facebook website }} }}", json!(slug))).await else { continue };
        let ar = &a["artist"];
        if ar.is_null() {
            continue;
        }
        let links = json!({ "soundcloud": ar["soundcloud"], "instagram": ar["instagram"], "facebook": ar["facebook"], "website": ar["website"] });
        let area = s(&ar["area"]["name"]);
        let city = if !area.is_empty() && !re(r"(?i)^(all|worldwide|international)$").is_match(area) { area } else { "" };
        let anchored = anchored_by(known, &links);
        cands.push(json!({ "country": countries::fr(s(&ar["country"]["name"])), "city": city, "url": format!("https://ra.co{}", s(&x["contentUrl"])), "links": links, "anchored": anchored }));
    }
    let sure: Vec<&Value> = cands.iter().filter(|c| c["anchored"] == json!(true)).collect();
    if sure.len() == 1 {
        return Some(sure[0].clone());
    }
    if cands.len() == 1 {
        let mut c = cands[0].clone();
        c["weak"] = json!(true);
        return Some(c);
    }
    if cands.is_empty() { None } else { Some(json!({ "ambiguous": cands.len() })) }
}

// ------------------------------------------------------------ MusicBrainz retrouvé par un lien sûr (pas de risque d'homonyme)
async fn mb_by_links(links: &Value) -> Option<String> {
    for k in ["soundcloud", "spotify", "instagram", "website", "youtube", "facebook"] {
        let u = s(&links[k]);
        if u.is_empty() {
            continue;
        }
        let mut variants = vec![
            u.to_string(),
            u.trim_end_matches('/').to_string(),
            if u.ends_with('/') { u.to_string() } else { format!("{u}/") },
            u.replace("https://www.", "https://"),
            u.replacen("://", "://www.", 1),
        ];
        let mut seen = HashSet::new();
        variants.retain(|v| seen.insert(v.clone()));
        for v in variants {
            let j = get_json(&format!("https://musicbrainz.org/ws/2/url?resource={}&inc=artist-rels&fmt=json", enc(&v)), &[]).await;
            sleep(1050).await;
            if let Some(id) = j.and_then(|j| j["relations"].as_array().and_then(|r| r.iter().find(|x| x["artist"].is_object()).map(|x| s(&x["artist"]["id"]).to_string()))) {
                return Some(id);
            }
        }
    }
    None
}
async fn mb_details(id: &str) -> Option<Value> {
    let j = get_json(&format!("https://musicbrainz.org/ws/2/artist/{id}?inc=genres+tags&fmt=json"), &[]).await;
    sleep(1050).await;
    let j = j?;
    let area = s(&j["area"]["name"]);
    let begin = s(&j["begin-area"]["name"]);
    let city = if !begin.is_empty() && begin != area { begin } else if s(&j["area"]["type"]) == "City" { area } else { "" };
    let country_raw = if !s(&j["country"]).is_empty() { s(&j["country"]) } else if s(&j["area"]["type"]) == "Country" { area } else { "" };
    let mut genres: Vec<Value> = j["genres"].as_array().cloned().unwrap_or_default().iter().map(|g| json!({ "g": g["name"], "w": 2 })).collect();
    genres.extend(j["tags"].as_array().cloned().unwrap_or_default().iter().filter(|t| t["count"].as_i64().unwrap_or(0) > 0).take(5).map(|t| json!({ "g": t["name"], "w": 1 })));
    Some(json!({ "country": countries::fr(country_raw), "city": city, "genres": genres }))
}

// ------------------------------------------------------------ origine et genres
#[derive(Default)]
struct Origin {
    country: String,
    country_src: String,
    city: String,
    city_src: String,
    genres: Vec<(String, f64, String)>,
    weak_country: String,
    weak_city: String,
    weak_src: String,
    weak_genres: Vec<(String, f64, String)>,
    sources: Vec<String>,
    sc_followers: Option<u64>,
    mbid: Option<String>,
    ra_url: Option<String>,
}
impl Origin {
    fn set_c(&mut self, c: &str, src: &str) {
        if !c.is_empty() && self.country.is_empty() {
            self.country = c.into();
            self.country_src = src.into();
        }
    }
    fn set_v(&mut self, v: &str, src: &str) {
        if !v.is_empty() && self.city.is_empty() {
            self.city = v.into();
            self.city_src = src.into();
        }
    }
    fn weak_c(&mut self, c: &str, v: &str, src: &str) {
        if !c.is_empty() && self.weak_country.is_empty() {
            self.weak_country = c.into();
            self.weak_city = v.into();
            self.weak_src = src.into();
        }
    }
    fn add_g(&mut self, list: Vec<(String, f64)>, src: &str, weak: bool) {
        for (g, w) in list {
            if !g.is_empty() {
                let t = (g.to_lowercase(), w, src.to_string());
                if weak { self.weak_genres.push(t) } else { self.genres.push(t) }
            }
        }
    }
}
fn fuse(l: &[(String, f64, String)]) -> Value {
    let mut order: Vec<String> = vec![];
    let mut m: HashMap<String, f64> = HashMap::new();
    for (g, w, _) in l {
        if !m.contains_key(g) {
            order.push(g.clone());
        }
        *m.entry(g.clone()).or_insert(0.0) += w;
    }
    let mut v: Vec<(String, f64)> = order.into_iter().map(|g| { let w = m[&g]; (g, (w * 10.0).round() / 10.0) }).collect();
    v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    json!(v.into_iter().map(|(g, w)| json!({ "g": g, "w": w })).collect::<Vec<_>>())
}
fn str_list(v: &Value) -> Vec<String> {
    v.as_array().map(|l| l.iter().filter_map(|x| x.as_str()).map(String::from).collect()).unwrap_or_default()
}

async fn origin_genre(a: &Value, links: &Value, wd: Option<&Value>, spotify_genres: &[String], spotify_sure: bool, lf: Option<&Value>) -> Origin {
    let known = keys_of(links);
    let mut res = Origin::default();
    if !s(&links["soundcloud"]).is_empty() {
        if let Some(sc) = sc_profile(s(&links["soundcloud"])).await {
            res.sources.push("SoundCloud".into());
            res.set_c(s(&sc["country"]), "SoundCloud");
            res.set_v(s(&sc["city"]), "SoundCloud");
            let g = sc["genres"].as_object().cloned().unwrap_or_default();
            let tot: f64 = g.values().filter_map(|v| v.as_f64()).sum::<f64>().max(1.0);
            res.add_g(g.iter().map(|(k, v)| (k.clone(), v.as_f64().unwrap_or(0.0) / tot * 6.0)).collect(), "SoundCloud", false);
            res.sc_followers = sc["followers"].as_u64();
        }
    }
    let mbid = mb_by_links(links).await;
    res.mbid = mbid.clone();
    if let Some(id) = &mbid {
        if let Some(mb) = mb_details(id).await {
            res.sources.push("MusicBrainz".into());
            res.set_c(s(&mb["country"]), "MusicBrainz");
            res.set_v(s(&mb["city"]), "MusicBrainz");
            res.add_g(mb["genres"].as_array().cloned().unwrap_or_default().iter().map(|g| (s(&g["g"]).to_string(), g["w"].as_f64().unwrap_or(1.0))).collect(), "MusicBrainz", false);
        }
    }
    if let Some(ra) = resident_advisor(s(&a["name"]), &known).await {
        let weak = ra["weak"] == json!(true);
        if !s(&ra["country"]).is_empty() && !weak {
            res.sources.push("Resident Advisor".into());
            res.set_c(s(&ra["country"]), "Resident Advisor");
            res.set_v(s(&ra["city"]), "Resident Advisor");
            res.ra_url = Some(s(&ra["url"]).to_string());
        } else if weak {
            res.weak_c(s(&ra["country"]), s(&ra["city"]), "Resident Advisor (nom seul)");
        }
    }
    if let Some(wd) = wd {
        let sure = wd["bySpotify"] == json!(true) || anchored_by(&known, &wd["links"]);
        let g: Vec<(String, f64)> = str_list(&wd["genres"]).into_iter().map(|g| (g, 2.0)).collect();
        if sure {
            res.set_c(s(&wd["country"]), "Wikidata");
            res.add_g(g, "Wikidata", false);
        } else {
            res.weak_c(s(&wd["country"]), "", "Wikidata (nom seul)");
            res.add_g(g, "Wikidata", true);
        }
    }
    if !spotify_genres.is_empty() {
        res.add_g(spotify_genres.iter().map(|g| (g.clone(), 3.0)).collect(), "Spotify", !spotify_sure);
    }
    if let Some(lf) = lf {
        let same = mbid.is_some() && mbid.as_deref() == lf["mbid"].as_str();
        res.add_g(str_list(&lf["tags"]).into_iter().take(4).enumerate().map(|(i, g)| (g, 2.0 - i as f64 * 0.3)).collect(), "Last.fm", !same);
    }
    res
}

// ------------------------------------------------------------ choix du bon artiste Spotify
const STYLE_WORDS: &[(&str, &str)] = &[
    ("Rap / Hip-hop", "rap|hip hop|trap|drill"), ("Pop", "pop"), ("Rock / Indie", "rock|indie|alternative|garage|psych|grunge|shoegaze"),
    ("Électro", "electro|electronic|edm|electronica"), ("Techno", "techno"), ("House", "house"),
    ("Hardcore / Uptempo", "hardcore|uptempo|gabber|frenchcore|hardstyle|hard dance|rawstyle|raw"), ("Hardstyle", "hardstyle|hard dance|rawstyle"),
    ("DnB / Bass", "drum and bass|dnb|jungle|dubstep|bass"), ("Punk / Métal", "punk|metal|thrash|grindcore|metalcore"), ("R&B / Soul", "r&b|rnb|soul"),
    ("Afro / Amapiano", "afro|amapiano"), ("Reggae / Dub", "reggae|dub|dancehall|ska"), ("Jazz / Funk", "jazz|funk|swing|blues"),
    ("Chanson", "chanson|variete|french pop|singer-songwriter|folk"), ("Musiques du monde", "world|balkan|cumbia|latin|maloya|klezmer"),
    ("Expérimental", "experimental|noise|idm|ambient"),
];
fn fits(genres: &[String], styles: &[String]) -> bool {
    styles.iter().any(|st| {
        STYLE_WORDS.iter().find(|(k, _)| k == st).is_some_and(|(_, p)| {
            let r = re(p);
            genres.iter().any(|g| r.is_match(&g.to_lowercase()))
        })
    })
}
enum Pick {
    Artist(Value, bool),
    Ambiguous(usize),
    Skipped(String),
}
async fn pick_spotify(a: &Value) -> Result<Option<Pick>, String> {
    let styles = str_list(&a["styles"]);
    if let Some(id) = cap1(r"artist/([A-Za-z0-9]{22})", s(&a["links"]["spotify"])) {
        return Ok(spotify_artist(&id).await?.map(|x| Pick::Artist(x, true)));
    }
    let l = spotify_search(&format!("artist:\"{}\"", s(&a["name"])), 10).await?.unwrap_or_default();
    let n = norm(s(&a["name"]));
    let ex: Vec<Value> = l.into_iter().filter(|x| norm(s(&x["name"])) == n).collect();
    if ex.is_empty() {
        return Ok(None);
    }
    if ex.len() == 1 {
        let x = ex[0].clone();
        let g = str_list(&x["genres"]);
        let followers = x["followers"].as_u64().unwrap_or(0);
        // garde-fou : star mondiale vs fiche d'un petit artiste sans genre commun -> on s'abstient (ex. « Rōse » ≠ ROSÉ)
        if followers > 500_000 && !styles.is_empty() && !fits(&g, &styles) {
            let gs = if g.is_empty() { "?".to_string() } else { g.join(", ") };
            return Ok(Some(Pick::Skipped(format!("{} ({followers} abonnés, genres {gs}) ne colle pas aux styles", s(&x["name"])))));
        }
        let sure = !styles.is_empty() && (fits(&g, &styles) || g.is_empty());
        return Ok(Some(Pick::Artist(x, sure)));
    }
    let good: Vec<&Value> = ex.iter().filter(|x| fits(&str_list(&x["genres"]), &styles)).collect();
    if good.len() == 1 {
        return Ok(Some(Pick::Artist(good[0].clone(), true)));
    }
    Ok(Some(Pick::Ambiguous(ex.len())))
}

// ------------------------------------------------------------ enrichissement d'un artiste
pub async fn enrich_one(a: &Value, photos: bool) -> Value {
    let st = status();
    let a_links = if a["links"].is_object() { a["links"].clone() } else { json!({}) };
    let has_link = |k: &str| !s(&a_links[k]).is_empty();
    let mut links = Map::new();
    let mut pop = Map::new();
    let mut genres: Vec<String> = vec![];
    let mut notes: Vec<String> = vec![];
    let mut sources: Vec<String> = vec![];
    let mut p = Map::new();
    p.insert("id".into(), a["id"].clone());
    let mut sp_id: Option<String> = None;
    let mut spotify_genres: Vec<String> = vec![];
    let mut spotify_sure = false;
    let mut photo_url = String::new();
    let has_photo = a["hasPhoto"].as_bool().unwrap_or(false);
    if st["spotify"] == json!(true) {
        match pick_spotify(a).await {
            Ok(Some(Pick::Artist(sx, sure))) => {
                sp_id = sx["id"].as_str().map(String::from);
                sources.push("Spotify".into());
                spotify_sure = sure;
                if !has_link("spotify") {
                    links.insert("spotify".into(), sx["url"].clone());
                    if !sure {
                        notes.push("Spotify trouvé par nom identique, à vérifier".into());
                    }
                }
                pop.insert("spotifyFollowers".into(), sx["followers"].clone());
                pop.insert("spotifyPopularity".into(), sx["popularity"].clone());
                spotify_genres = str_list(&sx["genres"]);
                genres.extend(spotify_genres.clone());
                if !has_photo && !s(&sx["img"]).is_empty() {
                    photo_url = s(&sx["img"]).to_string();
                }
                if let Some(id) = &sp_id {
                    if let Some(ml) = spotify_monthly(id).await {
                        pop.insert("spotify".into(), json!(ml));
                    }
                }
            }
            Ok(Some(Pick::Ambiguous(n))) => notes.push(format!("Spotify : {n} artistes portent ce nom, aucun retenu")),
            Ok(Some(Pick::Skipped(why))) => notes.push(format!("Spotify : homonyme célèbre écarté ({why})")),
            Ok(None) => {}
            Err(e) => {
                p.insert("error".into(), json!(e));
            }
        }
    }
    p.insert("spotifySure".into(), json!(spotify_sure));
    let known0 = keys_of(&merge_links(&a_links, &Value::Object(links.clone())));
    let sid = sp_id.clone().or_else(|| cap1(r"artist/([A-Za-z0-9]{22})", s(&a_links["spotify"])));
    let mut wd = wikidata(s(&a["name"]), sid.as_deref()).await;
    let wd_has_links = wd.as_ref().is_some_and(|w| w["links"].is_object());
    let wd_sure = wd_has_links && wd.as_ref().is_some_and(|w| w["bySpotify"] == json!(true) || anchored_by(&known0, &w["links"]));
    if wd_has_links && !wd_sure {
        notes.push("Wikidata : fiche trouvée par le nom seul, non utilisée pour les liens".into());
    }
    if wd_sure {
        let w = wd.as_mut().unwrap();
        sources.push("Wikidata".into());
        if let Some(m) = w["links"].as_object() {
            for (k, v) in m {
                if !s(v).is_empty() && !has_link(k) {
                    links.insert(k.clone(), v.clone());
                }
            }
        }
        let c = countries::fr(s(&w["country"]));
        if !c.is_empty() {
            w["country"] = json!(c);
        }
        genres.extend(str_list(&w["genres"]));
        if !s(&w["description"]).is_empty() {
            p.insert("wdDescription".into(), w["description"].clone());
        }
    }
    if st["discogs"] == json!(true) {
        let dg = discogs(s(&a["name"])).await;
        sleep(1100).await;
        if let Some(dg) = dg.filter(|d| d["links"].is_object()) {
            if !anchored_by(&keys_of(&merge_links(&a_links, &Value::Object(links.clone()))), &dg["links"]) {
                if link_values(&dg["links"]).iter().any(|v| !v.is_empty()) {
                    notes.push("Discogs : homonyme possible (aucun lien commun), ignoré".into());
                }
            } else {
                sources.push("Discogs".into());
                for (k, v) in dg["links"].as_object().cloned().unwrap_or_default() {
                    if !s(&v).is_empty() && !has_link(&k) && !links.contains_key(&k) {
                        links.insert(k, v);
                    }
                }
                if !has_photo && photo_url.is_empty() && !s(&dg["img"]).is_empty() {
                    photo_url = s(&dg["img"]).to_string();
                }
                if !s(&dg["profile"]).is_empty() && s(&a["bio"]).is_empty() {
                    p.insert("bio".into(), dg["profile"].clone());
                }
            }
        }
    }
    let lf = if st["lastfm"] == json!(true) { lastfm(s(&a["name"])).await } else { None };
    let all_links = merge_links(&a_links, &Value::Object(links.clone()));
    let wd_for = wd.as_ref().filter(|w| w["links"].is_object());
    let og = origin_genre(a, &all_links, wd_for, &spotify_genres, spotify_sure, lf.as_ref()).await;
    // Last.fm fusionne les homonymes : ses auditeurs ne comptent que si son MBID correspond à l'artiste retrouvé par lien
    if let (Some(lf), Some(mb)) = (&lf, &og.mbid) {
        if lf["mbid"].as_str() == Some(mb.as_str()) {
            sources.push("Last.fm".into());
            pop.insert("lastfm".into(), lf["listeners"].clone());
        }
    }
    p.insert("origin".into(), json!({ "country": og.country, "countrySrc": og.country_src, "city": og.city, "citySrc": og.city_src }));
    p.insert("weak".into(), json!({ "country": og.weak_country, "city": og.weak_city, "src": og.weak_src, "genres": fuse(&og.weak_genres) }));
    p.insert("genresW".into(), fuse(&og.genres));
    for x in &og.sources {
        if !sources.contains(x) {
            sources.push(x.clone());
        }
    }
    if let Some(u) = &og.ra_url {
        if !has_link("website") && !links.contains_key("website") {
            links.insert("website".into(), json!(u));
        }
    }
    if !s(&all_links["instagram"]).is_empty() {
        if let Some(v) = ig_followers(s(&all_links["instagram"])).await {
            pop.insert("instagram".into(), json!(v));
        }
    }
    if let Some(v) = og.sc_followers {
        pop.insert("soundcloud".into(), json!(v));
    } else if !s(&all_links["soundcloud"]).is_empty() {
        if let Some(v) = sc_followers(s(&all_links["soundcloud"])).await {
            pop.insert("soundcloud".into(), json!(v));
        }
    }
    if st["youtube"] == json!(true) && !s(&all_links["youtube"]).is_empty() {
        if let Some(v) = youtube_subs(s(&all_links["youtube"])).await {
            pop.insert("youtube".into(), json!(v));
        }
    }
    if !photo_url.is_empty() {
        p.insert("photoUrl".into(), json!(photo_url));
        if photos {
            p.insert("photo".into(), json!(http::image_data_url(&photo_url).await));
        }
    }
    let mut seen = HashSet::new();
    let mut g: Vec<String> = genres.into_iter().map(|g| g.to_lowercase()).filter(|g| seen.insert(g.clone())).collect();
    if !spotify_sure {
        g.clear(); // genres bruts : seulement s'ils viennent d'un Spotify confirmé (le reste passe par genresW)
    }
    if !spotify_genres.is_empty() {
        p.insert("spotifyGenres".into(), json!(spotify_genres));
    }
    p.insert("links".into(), Value::Object(links));
    p.insert("pop".into(), Value::Object(pop));
    p.insert("genres".into(), json!(g));
    p.insert("notes".into(), json!(notes));
    p.insert("sources".into(), json!(sources));
    Value::Object(p)
}

// ------------------------------------------------------------ tâche « Enrichir toute la base »
static RUNNING: AtomicBool = AtomicBool::new(false);
static STOP: AtomicBool = AtomicBool::new(false);

pub fn enrich_all(app: AppHandle, list: Vec<Value>) -> Value {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return json!({ "error": "Un enrichissement est déjà en cours." });
    }
    STOP.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn(async move {
        let st = status();
        let total = list.len();
        let _ = app.emit("enrich:progress", json!({ "done": 0, "total": total, "name": "Démarrage…", "status": st }));
        let (mut n, mut errors) = (0, 0);
        for a in &list {
            if STOP.load(Ordering::SeqCst) {
                break;
            }
            let p = enrich_one(a, true).await;
            if p.get("error").is_some() {
                errors += 1;
            }
            let _ = app.emit("enrich:patch", p);
            n += 1;
            let _ = app.emit("enrich:progress", json!({ "done": n, "total": total, "name": a["name"] }));
            sleep(if st["spotify"] == json!(true) { 150 } else { 400 }).await;
        }
        let stopped = STOP.load(Ordering::SeqCst);
        RUNNING.store(false, Ordering::SeqCst);
        let _ = app.emit("enrich:done", json!({ "done": n, "total": total, "errors": errors, "stopped": stopped, "status": st }));
    });
    json!({ "ok": true })
}
pub fn stop_enrich() -> Value {
    STOP.store(true, Ordering::SeqCst);
    json!({ "ok": true })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn link_keys() {
        assert_eq!(link_key("https://open.spotify.com/artist/abc"), "spotify/abc");
        assert_eq!(link_key("https://open.spotify.com/intl-fr/artist/abc"), "spotify/abc");
        assert_eq!(link_key("https://www.instagram.com/Lalou/"), "instagram/lalou");
        assert_eq!(link_key("soundcloud.com/lalou-music"), "soundcloud/lalou-music");
        assert_eq!(link_key("https://www.facebook.com/profile.php?id=42"), "facebook/42");
        assert_eq!(link_key("https://www.tiktok.com/@lalou"), "tiktok/lalou");
        assert_eq!(link_key("https://lalou.ch"), "lalou.ch");
        assert_eq!(norm("The Prodigy"), "prodigy");
        assert!(fits(&["frenchcore".into()], &["Hardcore / Uptempo".into()]));
    }
}
