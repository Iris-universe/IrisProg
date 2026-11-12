// Recherche d'un artiste sur internet (Spotify, Instagram, SoundCloud, Deezer, MusicBrainz, Wikidata) pour pré-remplir une fiche.
use crate::http::{self, enc, get_text, meta, norm, num, BOT, BROWSER};
use crate::sources;
use futures::future::join_all;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashSet;

const MB_UA: &str = "IrisProg/2.0 (logiciel de programmation de festival)";

fn re(p: &str) -> Regex {
    Regex::new(p).unwrap()
}
fn cap1(p: &str, h: &str) -> Option<String> {
    re(p).captures(h).map(|c| c[1].to_string())
}
fn s(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}

/// Mots d'un nom, sans accents ni parenthèses : "Dr. Peacock (NL)" -> ["dr", "peacock"]
fn words(q: &str) -> Vec<String> {
    use unicode_normalization::UnicodeNormalization;
    let q = re(r"\(.*?\)").replace_all(q, "").replace(['’', '\''], "");
    let q: String = q.nfd().filter(|c| !('\u{300}'..='\u{36f}').contains(c)).collect::<String>().to_lowercase().replace('&', " and ");
    re(r"[^a-z0-9]+").split(&q).filter(|w| !w.is_empty()).map(String::from).collect()
}
fn uniq(v: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    v.into_iter().filter(|x| seen.insert(x.clone())).collect()
}

async fn spotify_artist(id: &str) -> Option<Value> {
    let h = get_text(&format!("https://open.spotify.com/artist/{id}"), BOT, 9000).await?;
    let title = meta(&h, "og:title");
    if title.is_empty() || title.starts_with("Spotify") {
        return None;
    }
    let desc = meta(&h, "og:description");
    let stat = cap1(r"([\d.,]+[KkMm]?) monthly listeners", &desc).and_then(|m| num(&m)).unwrap_or(0);
    Some(json!({ "source": "spotify", "name": title, "url": format!("https://open.spotify.com/artist/{id}"), "img": meta(&h, "og:image"), "stat": stat, "statLabel": "auditeurs/mois" }))
}
async fn spotify_official(q: &str) -> Option<Vec<Value>> {
    let l = sources::spotify_search(q, 8).await.ok()??;
    let top: Vec<Value> = l.into_iter().take(6).collect();
    let ml = join_all(top.iter().take(3).map(|x| sources::spotify_monthly(s(&x["id"])))).await;
    Some(
        top.iter()
            .enumerate()
            .map(|(i, x)| {
                let m = ml.get(i).copied().flatten();
                let genres: Vec<&str> = x["genres"].as_array().map(|g| g.iter().filter_map(|v| v.as_str()).collect()).unwrap_or_default();
                json!({
                    "source": "spotify", "name": x["name"], "url": x["url"], "img": x["img"],
                    "stat": m.map(|v| json!(v)).unwrap_or(x["followers"].clone()),
                    "statLabel": if m.is_some() { "auditeurs/mois" } else { "abonnés Spotify" },
                    "followers": x["followers"], "popularity": x["popularity"], "genres": x["genres"],
                    "note": genres.iter().take(3).cloned().collect::<Vec<_>>().join(", "),
                })
            })
            .collect(),
    )
}
async fn spotify(q: &str) -> Vec<Value> {
    if sources::status()["spotify"] == json!(true) {
        if let Some(r) = spotify_official(q).await {
            return r;
        }
    }
    let h = get_text(&format!("https://html.duckduckgo.com/html/?q={}", enc(&format!("\"{q}\" site:open.spotify.com/artist"))), BROWSER, 9000).await.unwrap_or_default();
    let ids: Vec<String> = uniq(re(r"open\.spotify\.com/artist/([A-Za-z0-9]{22})").captures_iter(&h).map(|c| c[1].to_string()).collect()).into_iter().take(5).collect();
    join_all(ids.iter().map(|id| spotify_artist(id))).await.into_iter().flatten().collect()
}
async fn ig_profile(handle: &str) -> Option<Value> {
    let h = get_text(&format!("https://www.instagram.com/{handle}/"), BOT, 7000).await?;
    let t = meta(&h, "og:title");
    if t.is_empty() {
        return None;
    }
    let d = meta(&h, "og:description");
    let f = cap1(r"^([\d.,]+[KkMm]?) Followers", &d).and_then(|m| num(&m)).unwrap_or(0);
    let posts: u64 = cap1(r"([\d,]+) Posts", &d).map(|p| p.replace(',', "")).and_then(|p| p.parse().ok()).unwrap_or(0);
    let name = cap1(r"^(.*?) \(@", &t).unwrap_or_else(|| handle.to_string());
    Some(json!({ "source": "instagram", "name": name, "handle": handle, "url": format!("https://www.instagram.com/{handle}/"), "img": meta(&h, "og:image"), "stat": f, "statLabel": "abonnés", "posts": posts }))
}
async fn instagram(q: &str) -> Vec<Value> {
    let w = words(q);
    if w.is_empty() {
        return vec![];
    }
    let j = w.join("");
    let cands: Vec<String> = uniq(vec![
        j.clone(), w.join("_"), w.join("."), format!("{j}music"), format!("{j}_music"), format!("{j}.music"), format!("{j}official"),
        format!("{j}_official"), format!("{j}band"), format!("dj{j}"), format!("dj_{j}"), format!("{j}dj"), format!("{j}_dj"),
    ])
    .into_iter()
    .filter(|v| v.len() >= 3 && v.len() <= 30)
    .collect();
    let mut res: Vec<Value> = join_all(cands.iter().map(|c| ig_profile(c))).await.into_iter().flatten().filter(|x| x["posts"].as_u64().unwrap_or(0) > 0).collect();
    res.sort_by_key(|x| std::cmp::Reverse(x["stat"].as_u64().unwrap_or(0)));
    res.truncate(6);
    res
}
async fn sc_profile(slug: &str) -> Option<Value> {
    let t = get_text(&format!("https://soundcloud.com/oembed?format=json&url=https://soundcloud.com/{slug}"), BROWSER, 7000).await?;
    let j: Value = serde_json::from_str(&t).ok()?;
    let page = get_text(&format!("https://soundcloud.com/{slug}"), BROWSER, 7000).await.unwrap_or_default();
    let f: u64 = cap1(r#""followers_count":(\d+)"#, &page).and_then(|v| v.parse().ok()).unwrap_or(0);
    let thumb = s(&j["thumbnail_url"]);
    Some(json!({
        "source": "soundcloud", "name": j["title"], "url": format!("https://soundcloud.com/{slug}"),
        "img": if thumb.contains("default_avatar") { "" } else { thumb }, "stat": f, "statLabel": "abonnés",
        "desc": s(&j["description"]).chars().take(600).collect::<String>(),
    }))
}
async fn soundcloud(q: &str) -> Vec<Value> {
    let w = words(q);
    if w.is_empty() {
        return vec![];
    }
    let j = w.join("");
    let d = w.join("-");
    let cands = uniq(vec![d.clone(), j.clone(), format!("{j}music"), format!("{d}-music"), format!("{j}official"), format!("{j}band"), w.join("_"), format!("dj-{d}"), format!("{j}dj")]);
    join_all(cands.iter().map(|c| sc_profile(c))).await.into_iter().flatten().take(6).collect()
}
async fn deezer(q: &str) -> Vec<Value> {
    let Some(t) = get_text(&format!("https://api.deezer.com/search/artist?q={}&limit=6", enc(q)), BROWSER, 9000).await else { return vec![] };
    let Ok(j) = serde_json::from_str::<Value>(&t) else { return vec![] };
    j["data"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|a| {
            let pic = s(&a["picture_xl"]);
            json!({ "source": "deezer", "name": a["name"], "url": a["link"], "img": if pic.contains("/artist//") { "" } else { pic }, "stat": a["nb_fan"], "statLabel": "fans" })
        })
        .collect()
}

// MusicBrainz : base musicale ouverte, donne les liens officiels (Spotify, Instagram, SoundCloud…)
async fn musicbrainz(q: &str) -> (Vec<Value>, Vec<Value>, Vec<Value>) {
    let mut out = (vec![], vec![], vec![]);
    let Some(t) = get_text(&format!("https://musicbrainz.org/ws/2/artist/?query={}&fmt=json&limit=5", enc(&format!("artist:\"{q}\""))), MB_UA, 9000).await else { return out };
    let Ok(j) = serde_json::from_str::<Value>(&t) else { return out };
    let n = norm(q);
    let l: Vec<Value> = j["artists"].as_array().cloned().unwrap_or_default().into_iter().filter(|x| norm(s(&x["name"])) == n).take(3).collect();
    for x in l {
        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        let r = get_text(&format!("https://musicbrainz.org/ws/2/artist/{}?inc=url-rels&fmt=json", s(&x["id"])), MB_UA, 9000).await;
        let rel: Vec<String> = r
            .and_then(|r| serde_json::from_str::<Value>(&r).ok())
            .and_then(|r| r["relations"].as_array().cloned())
            .unwrap_or_default()
            .iter()
            .filter_map(|y| y["url"]["resource"].as_str().map(String::from))
            .collect();
        let tag = if !s(&x["disambiguation"]).is_empty() { s(&x["disambiguation"]) } else { s(&x["country"]) };
        let with_note = |mut v: Value| {
            v["note"] = json!(tag);
            v
        };
        if let Some(id) = rel.iter().find_map(|u| cap1(r"open\.spotify\.com/artist/([A-Za-z0-9]{22})", u)) {
            if let Some(v) = spotify_artist(&id).await {
                out.0.push(with_note(v));
            }
        }
        if let Some(h) = rel.iter().find_map(|u| cap1(r"instagram\.com/([A-Za-z0-9_.]+)", u)) {
            if let Some(v) = ig_profile(&h).await {
                out.1.push(with_note(v));
            }
        }
        if let Some(h) = rel.iter().find_map(|u| cap1(r"soundcloud\.com/([A-Za-z0-9_-]+)", u)) {
            if let Some(v) = sc_profile(&h).await {
                out.2.push(with_note(v));
            }
        }
    }
    out
}

// Un lien collé : on va directement au bon profil
async fn from_url(q: &str) -> Option<Value> {
    if let Some(id) = cap1(r"open\.spotify\.com/(?:intl-\w+/)?artist/([A-Za-z0-9]{22})", q) {
        return Some(json!({ "spotify": spotify_artist(&id).await.into_iter().collect::<Vec<_>>() }));
    }
    if let Some(h) = cap1(r"instagram\.com/([A-Za-z0-9_.]+)", q) {
        return Some(json!({ "instagram": ig_profile(&h).await.into_iter().collect::<Vec<_>>() }));
    }
    if let Some(h) = cap1(r"soundcloud\.com/([A-Za-z0-9_-]+)", q) {
        return Some(json!({ "soundcloud": sc_profile(&h).await.into_iter().collect::<Vec<_>>() }));
    }
    None
}

pub async fn lookup(q: &str) -> Value {
    let q = q.trim();
    if q.is_empty() {
        return json!({});
    }
    if let Some(u) = from_url(q).await {
        return u;
    }
    let (sp0, ig0, sc0, dz, mb, wd) = tokio::join!(spotify(q), instagram(q), soundcloud(q), deezer(q), musicbrainz(q), sources::wikidata(q, None));
    let merge = |a: Vec<Value>, b: Vec<Value>| {
        let mut seen = HashSet::new();
        b.into_iter().chain(a).filter(|x| seen.insert(s(&x["url"]).to_string())).collect::<Vec<_>>()
    };
    let (sp, ig, sc) = (merge(sp0, mb.0), merge(ig0, mb.1), merge(sc0, mb.2));
    let n = norm(q);
    let close = |x: &str| -> u8 {
        let a = norm(x);
        if a.is_empty() {
            return 0;
        }
        if a == n {
            return 2;
        }
        let (sh, lo) = if a.len() < n.len() { (&a, &n) } else { (&n, &a) };
        if lo.contains(sh.as_str()) && sh.len() as f64 / lo.len() as f64 >= 0.6 { 1 } else { 0 }
    };
    // identifiant = nom + suffixe courant (laloumusic, lalou_official, djlalou…) : considéré comme identique
    let handle_re = re(&format!("^(dj)?{}(music|official|officiel|band|dj|hard|live|prod)?$", regex::escape(&n)));
    let handle_ok = |h: &str| -> u8 {
        let a = norm(h);
        if a == n || handle_re.is_match(&a) { 2 } else { close(h) }
    };
    let score = |x: &Value| -> u8 {
        let mut sc = close(s(&x["name"]));
        if let Some(h) = x["handle"].as_str() {
            sc = sc.max(handle_ok(h));
        }
        if s(&x["source"]) == "soundcloud" {
            sc = sc.max(handle_ok(s(&x["url"]).rsplit('/').next().unwrap_or("")));
        }
        sc
    };
    let rank = |l: Vec<Value>| {
        let mut l: Vec<(u8, Value)> = l.into_iter().map(|x| (score(&x), x)).filter(|(sc, _)| *sc > 0).collect();
        l.sort_by(|a, b| b.0.cmp(&a.0).then(b.1["stat"].as_u64().unwrap_or(0).cmp(&a.1["stat"].as_u64().unwrap_or(0))));
        l.into_iter().map(|(_, x)| x).collect::<Vec<_>>()
    };
    let extra = wd.filter(|w| w["links"].is_object()).map(|w| json!({ "country": w["country"], "genres": w["genres"], "links": w["links"], "description": w["description"] }));
    json!({
        "spotify": rank(sp), "instagram": rank(ig), "soundcloud": rank(sc),
        "deezer": rank(dz).into_iter().take(4).collect::<Vec<_>>(),
        "extra": extra,
    })
}

pub async fn image(url: &str) -> Value {
    json!(http::image_data_url(url).await)
}

#[cfg(test)]
mod tests {
    #[test]
    fn words() {
        assert_eq!(super::words("Dr. Peacock (NL)"), vec!["dr", "peacock"]);
        assert_eq!(super::words("Rōse & Co’s"), vec!["rose", "and", "cos"]);
    }
}
