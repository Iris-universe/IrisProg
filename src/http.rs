// Requêtes HTTP communes (recherche d'artistes, sources de données, OAuth).
use serde_json::Value;
use std::sync::OnceLock;
use std::time::Duration;

pub const UA: &str = "IrisProg/2.0 (logiciel de programmation de festival)";
pub const BOT: &str = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
pub const BROWSER: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

pub fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| reqwest::Client::builder().connect_timeout(Duration::from_secs(10)).build().expect("client HTTP"))
}

/// Texte d'une page (None si erreur ou statut non 2xx).
pub async fn get_text(url: &str, ua: &str, ms: u64) -> Option<String> {
    let r = client()
        .get(url)
        .header("User-Agent", ua)
        .header("Accept-Language", "en-US,en;q=0.9")
        .timeout(Duration::from_millis(ms))
        .send()
        .await
        .ok()?;
    if !r.status().is_success() {
        return None;
    }
    r.text().await.ok()
}

/// JSON (User-Agent identifié, 429 = on attend et on réessaie).
pub async fn get_json(url: &str, headers: &[(&str, String)]) -> Option<Value> {
    for _ in 0..4 {
        let mut rq = client().get(url).header("User-Agent", UA).header("Accept", "application/json").timeout(Duration::from_secs(12));
        for (k, v) in headers {
            rq = rq.header(*k, v);
        }
        let r = rq.send().await.ok()?;
        if r.status().as_u16() == 429 {
            let wait = r.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok()).unwrap_or(3);
            tokio::time::sleep(Duration::from_secs(wait.min(30))).await;
            continue;
        }
        if !r.status().is_success() {
            return None;
        }
        return r.json().await.ok();
    }
    None
}

/// Image téléchargée en data URL (1,5 Ko à 3 Mo).
pub async fn image_data_url(url: &str) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    if url.is_empty() {
        return None;
    }
    let r = client().get(url).header("User-Agent", BROWSER).timeout(Duration::from_secs(15)).send().await.ok()?;
    if !r.status().is_success() {
        return None;
    }
    let ct = r.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("image/jpeg").to_string();
    let b = r.bytes().await.ok()?;
    if b.len() < 1500 || b.len() > 3_000_000 {
        return None;
    }
    Some(format!("data:{ct};base64,{}", STANDARD.encode(&b)))
}

pub fn enc(s: &str) -> String {
    urlencoding::encode(s).into_owned()
}

// ------------------------------------------------------------ petits outils texte (comme en JS)
/// Normalise un nom : sans accents, minuscules, & -> and, seulement a-z0-9.
pub fn norm(s: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    let s: String = s.nfkc().collect::<String>().nfd().filter(|c| !('\u{300}'..='\u{36f}').contains(c)).collect();
    s.to_lowercase().replace('&', "and").chars().filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit()).collect()
}

/// Décode les entités HTML courantes.
pub fn dec(s: &str) -> String {
    let re = regex::Regex::new(r"&#x([0-9a-fA-F]+);|&#(\d+);").unwrap();
    let s = re.replace_all(s, |c: &regex::Captures| {
        let n = c.get(1).and_then(|h| u32::from_str_radix(h.as_str(), 16).ok()).or_else(|| c.get(2).and_then(|d| d.as_str().parse().ok()));
        n.and_then(char::from_u32).map(String::from).unwrap_or_default()
    });
    s.replace("&amp;", "&").replace("&quot;", "\"").replace("&#039;", "'")
}

/// "12.3K" -> 12300
pub fn num(t: &str) -> Option<u64> {
    let re = regex::Regex::new(r"([\d.,]+)\s*([KkMm]?)").unwrap();
    let c = re.captures(t)?;
    let mut n: f64 = c[1].replace(',', "").parse().ok()?;
    match &c[2] {
        "k" | "K" => n *= 1e3,
        "m" | "M" => n *= 1e6,
        _ => {}
    }
    Some(n.round() as u64)
}

/// Contenu d'une balise `<meta property="..." content="...">`.
pub fn meta(h: &str, p: &str) -> String {
    let re = regex::Regex::new(&format!(r#"<meta property="{}" content="([^"]*)""#, regex::escape(p))).unwrap();
    re.captures(h).map(|c| dec(&c[1])).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn helpers() {
        assert_eq!(norm("Rōse & Co"), "roseandco");
        assert_eq!(norm("Dr. Peacock"), "drpeacock");
        assert_eq!(num("12.3K monthly"), Some(12300));
        assert_eq!(num("1,234"), Some(1234));
        assert_eq!(dec("a &amp; b &#233; &#x41;"), "a & b é A");
    }
}
