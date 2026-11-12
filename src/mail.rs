// Boîte mail intégrée : IMAP (lecture, async-imap) + SMTP (envoi, lettre), connexion Microsoft (OAuth 2 + XOAUTH2).
// Cache local (mêmes fichiers que l'ancienne version) : mail/account.json, mail/list-<hash>.json, mail/bodies/<hash>-<uid>.json.
use crate::data;
use crate::http;
use crate::secrets;
use async_imap::types::{Flag, NameAttribute};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64URL, Engine};
use futures::TryStreamExt;
use mail_parser::{MessageParser, MimeHeaders};
use regex::Regex;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::net::TcpStream;
use tokio_rustls::client::TlsStream;

type Sess = async_imap::Session<TlsStream<TcpStream>>;
type R<T> = Result<T, String>;

fn s(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

// ------------------------------------------------------------ fichiers
fn dir() -> PathBuf {
    data::mail_dir()
}
fn cfg_file() -> PathBuf {
    dir().join("account.json")
}
fn body_dir() -> PathBuf {
    dir().join("bodies")
}
fn hash(x: &str) -> String {
    sha1_smol::Sha1::from(x).digest().to_string()[..12].to_string()
}
fn list_file(folder: &str) -> PathBuf {
    dir().join(format!("list-{}.json", hash(folder)))
}
fn body_file(folder: &str, uid: u32) -> PathBuf {
    body_dir().join(format!("{}-{uid}.json", hash(folder)))
}
fn write(f: &std::path::Path, v: &Value) {
    let _ = std::fs::create_dir_all(f.parent().unwrap());
    let tmp = f.with_extension("tmp");
    if std::fs::write(&tmp, serde_json::to_string(v).unwrap_or_default()).is_ok() {
        let _ = std::fs::rename(&tmp, f);
    }
}

pub fn presets() -> Value {
    json!({
        "gmail": { "label": "Gmail / Google Workspace", "imapHost": "imap.gmail.com", "imapPort": 993, "smtpHost": "smtp.gmail.com", "smtpPort": 465,
            "help": "Avec Gmail il faut un « mot de passe d'application » : Compte Google → Sécurité → Validation en 2 étapes → Mots de passe des applications." },
        "infomaniak": { "label": "Infomaniak", "imapHost": "mail.infomaniak.com", "imapPort": 993, "smtpHost": "mail.infomaniak.com", "smtpPort": 465,
            "help": "Adresse mail complète + mot de passe de la boîte (ou mot de passe d’application si la double authentification est active)." },
        "outlook": { "label": "Outlook / Microsoft 365", "oauth": true, "imapHost": "outlook.office365.com", "imapPort": 993, "smtpHost": "smtp.office365.com", "smtpPort": 587,
            "help": "Microsoft n'accepte plus les mots de passe pour les logiciels de mail : la connexion se fait par la fenêtre de connexion Microsoft (comme Thunderbird). Il faut une seule fois créer un « ID d'application » gratuit, voir le guide ci-dessous." },
        "autre": { "label": "Autre (manuel)", "imapHost": "", "imapPort": 993, "smtpHost": "", "smtpPort": 465, "help": "Les paramètres IMAP/SMTP sont donnés par ton hébergeur mail." },
    })
}

// ------------------------------------------------------------ Microsoft (OAuth 2)
const MS_SCOPES: &str = "offline_access openid email profile https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send";
const MS_REDIRECT: &str = "https://login.microsoftonline.com/common/oauth2/nativeclient";
static PENDING_OAUTH: Mutex<Option<Value>> = Mutex::new(None);
static MS_ACCESS: Mutex<Option<(String, i64, String)>> = Mutex::new(None); // jeton, expiration, refresh token

fn ms_authority(t: &str) -> String {
    format!("https://login.microsoftonline.com/{}/oauth2/v2.0", http::enc(if t.is_empty() { "common" } else { t }))
}
fn ms_personal(email: &str) -> bool {
    Regex::new(r"(?i)@(outlook|hotmail|live|msn|passport)\.[a-z.]+$").unwrap().is_match(email)
}
fn ms_hosts(mut c: Value) -> Value {
    if s(&c["authType"]) != "oauth-ms" {
        return c;
    }
    let smtp = if ms_personal(s(&c["email"])) { "smtp-mail.outlook.com" } else { "smtp.office365.com" };
    c["imapHost"] = json!("outlook.office365.com");
    c["imapPort"] = json!(993);
    c["smtpHost"] = json!(smtp);
    c["smtpPort"] = json!(587);
    c
}
fn ms_err(j: &Value) -> String {
    let d = j["error_description"].as_str().or(j["error"].as_str()).unwrap_or("Erreur Microsoft").lines().next().unwrap_or("").to_string();
    let has = |p: &str| Regex::new(p).unwrap().is_match(&d);
    if has("AADSTS700016") {
        format!("ID d'application introuvable : vérifie l'ID copié et le type de comptes choisi à l'inscription. ({d})")
    } else if has(r"(?i)AADSTS50011|redirect") {
        format!("Adresse de redirection manquante dans l'inscription de l'app (voir le guide, étape 3). ({d})")
    } else if has(r"(?i)AADSTS65001|AADSTS90094|consent") {
        format!("L'administrateur de ton organisation doit autoriser l'app. ({d})")
    } else if has(r"(?i)AADSTS70000|AADSTS50173|AADSTS700082|invalid_grant") {
        format!("Connexion Microsoft expirée : reconnecte-toi (Paramètres → Boîte mail). ({d})")
    } else {
        d
    }
}
async fn ms_token(tenant: &str, params: &[(&str, &str)]) -> R<Value> {
    let r = http::client().post(format!("{}/token", ms_authority(tenant))).form(params).timeout(Duration::from_secs(20)).send().await.map_err(|e| e.to_string())?;
    let ok = r.status().is_success();
    let j: Value = r.json().await.unwrap_or(json!({}));
    if !ok || j.get("error").is_some() {
        return Err(ms_err(&j));
    }
    Ok(j)
}
fn jwt(t: &str) -> Value {
    t.split('.').nth(1).and_then(|p| B64URL.decode(p.trim_end_matches('=')).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(json!({}))
}

/// Ouvre la page de connexion Microsoft dans une fenêtre de l'app et récupère les jetons.
pub async fn ms_login(app: &AppHandle, o: &Value) -> R<Value> {
    use sha2::Digest;
    let client_id = s(&o["clientId"]).trim().to_string();
    let tenant = if s(&o["tenant"]).is_empty() { "common".to_string() } else { s(&o["tenant"]).to_string() };
    let hint = s(&o["hint"]).to_string();
    if !Regex::new(r"(?i)^[0-9a-f-]{36}$").unwrap().is_match(&client_id) {
        return Err("ID d'application invalide (format attendu : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).".into());
    }
    let verifier = B64URL.encode(rand::random::<[u8; 32]>());
    let challenge = B64URL.encode(sha2::Sha256::digest(verifier.as_bytes()));
    let state: String = rand::random::<[u8; 12]>().iter().map(|b| format!("{b:02x}")).collect();
    let mut q = vec![
        ("client_id", client_id.clone()), ("response_type", "code".into()), ("redirect_uri", MS_REDIRECT.into()), ("response_mode", "query".into()),
        ("scope", MS_SCOPES.into()), ("code_challenge", challenge), ("code_challenge_method", "S256".into()), ("state", state.clone()), ("prompt", "select_account".into()),
    ];
    if !hint.is_empty() {
        q.push(("login_hint", hint.clone()));
    }
    let qs: String = q.iter().map(|(k, v)| format!("{k}={}", http::enc(v))).collect::<Vec<_>>().join("&");
    let auth_url = format!("{}/authorize?{qs}", ms_authority(&tenant));

    let (tx, rx) = tokio::sync::oneshot::channel::<R<String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let label = format!("mslogin{}", now_ms());
    let profile = std::env::temp_dir().join(format!("irisprog-{label}"));
    let (tx1, app1, label1, state1) = (tx.clone(), app.clone(), label.clone(), state.clone());
    let w = tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::External(auth_url.parse().map_err(|_| "URL invalide")?))
        .title("Connexion Microsoft")
        .inner_size(520.0, 720.0)
        .data_directory(profile.clone())
        .on_navigation(move |u| {
            if !u.as_str().starts_with(MS_REDIRECT) {
                return true;
            }
            let p: std::collections::HashMap<String, String> = u.query_pairs().map(|(k, v)| (k.to_string(), v.to_string())).collect();
            let res = if let Some(e) = p.get("error") {
                Err(ms_err(&json!({ "error": e, "error_description": p.get("error_description") })))
            } else if p.get("state") != Some(&state1) {
                Err("Réponse de connexion invalide, réessaie.".to_string())
            } else {
                p.get("code").cloned().ok_or_else(|| "Réponse de connexion invalide, réessaie.".to_string())
            };
            if let Some(t) = tx1.lock().unwrap().take() {
                let _ = t.send(res);
            }
            let (a, l) = (app1.clone(), label1.clone());
            tauri::async_runtime::spawn(async move {
                if let Some(w) = a.get_webview_window(&l) {
                    let _ = w.close();
                }
            });
            false
        })
        .build()
        .map_err(|e| e.to_string())?;
    let tx2 = tx.clone();
    w.on_window_event(move |e| {
        if let tauri::WindowEvent::Destroyed = e {
            if let Some(t) = tx2.lock().unwrap().take() {
                let _ = t.send(Err("Connexion annulée.".into()));
            }
        }
    });
    let code = rx.await.map_err(|_| "Connexion annulée.".to_string())??;
    tokio::time::sleep(Duration::from_millis(500)).await;
    let _ = std::fs::remove_dir_all(&profile);
    let tok = ms_token(&tenant, &[
        ("client_id", &client_id), ("grant_type", "authorization_code"), ("code", &code), ("redirect_uri", MS_REDIRECT),
        ("code_verifier", &verifier), ("scope", MS_SCOPES),
    ])
    .await?;
    let id = jwt(s(&tok["id_token"]));
    let email = id["email"].as_str().or(id["preferred_username"].as_str()).unwrap_or(&hint).to_lowercase();
    let name = s(&id["name"]).to_string();
    *PENDING_OAUTH.lock().unwrap() = Some(json!({
        "clientId": client_id, "tenant": tenant, "email": email, "name": name, "refreshToken": tok["refresh_token"], "accessToken": tok["access_token"],
        "expiresAt": now_ms() + (tok["expires_in"].as_i64().unwrap_or(3600) - 120) * 1000,
    }));
    Ok(json!({ "ok": true, "email": email, "name": name }))
}

async fn ms_access_token(c: &Value) -> R<String> {
    if !s(&c["accessToken"]).is_empty() && c["expiresAt"].as_i64().unwrap_or(0) > now_ms() {
        return Ok(s(&c["accessToken"]).to_string());
    }
    let rt = s(&c["refreshToken"]).to_string();
    if let Some((t, exp, r)) = MS_ACCESS.lock().unwrap().clone() {
        if r == rt && exp > now_ms() {
            return Ok(t);
        }
    }
    if rt.is_empty() {
        return Err("Connexion Microsoft expirée : reconnecte-toi (Paramètres → Boîte mail).".into());
    }
    let tok = ms_token(s(&c["msTenant"]), &[("client_id", s(&c["msClientId"])), ("grant_type", "refresh_token"), ("refresh_token", &rt), ("scope", MS_SCOPES)]).await?;
    let new_rt = tok["refresh_token"].as_str().unwrap_or(&rt).to_string();
    if new_rt != rt {
        if let Some(mut raw) = iris_store::read_json(&cfg_file()) {
            if s(&raw["authType"]) == "oauth-ms" {
                raw["refreshEnc"] = json!(secrets::protect(&new_rt));
                write(&cfg_file(), &raw);
            }
        }
    }
    let at = s(&tok["access_token"]).to_string();
    *MS_ACCESS.lock().unwrap() = Some((at.clone(), now_ms() + (tok["expires_in"].as_i64().unwrap_or(3600) - 120) * 1000, new_rt));
    Ok(at)
}

enum Auth {
    Pass(String, String),
    OAuth(String, String),
}
async fn auth_of(c: &Value) -> R<Auth> {
    if s(&c["authType"]) == "oauth-ms" {
        return Ok(Auth::OAuth(s(&c["email"]).to_string(), ms_access_token(c).await?));
    }
    let user = if s(&c["user"]).is_empty() { s(&c["email"]) } else { s(&c["user"]) };
    Ok(Auth::Pass(user.to_string(), s(&c["password"]).to_string()))
}

// ------------------------------------------------------------ compte
fn load_account() -> Option<Value> {
    let mut c = iris_store::read_json(&cfg_file())?;
    c["password"] = json!(secrets::unprotect(s(&c["passEnc"])));
    c["refreshToken"] = json!(secrets::unprotect(s(&c["refreshEnc"])));
    Some(ms_hosts(c))
}
pub fn public_account() -> Value {
    let Some(mut c) = load_account() else { return Value::Null };
    let has = !s(&c["password"]).is_empty() || !s(&c["refreshToken"]).is_empty();
    let m = c.as_object_mut().unwrap();
    for k in ["password", "passEnc", "refreshToken", "refreshEnc"] {
        m.remove(k);
    }
    m.insert("hasPassword".into(), json!(has));
    c
}
/// Compte « candidat » (formulaire + connexion Microsoft en attente), pour tester ou enregistrer.
fn candidate(cfg: &Value) -> Value {
    let prev = load_account().unwrap_or(json!({}));
    let mut c = prev.as_object().cloned().unwrap_or_default();
    for (k, v) in cfg.as_object().cloned().unwrap_or_default() {
        c.insert(k, v);
    }
    let same_type = s(&prev["authType"]) == s(&cfg["authType"]);
    let pass = if !s(&cfg["password"]).is_empty() { s(&cfg["password"]).to_string() } else if same_type { s(&prev["password"]).to_string() } else { String::new() };
    c.insert("password".into(), json!(pass));
    let mut c = Value::Object(c);
    if s(&cfg["authType"]) == "oauth-ms" {
        if let Some(p) = PENDING_OAUTH.lock().unwrap().clone() {
            if !s(&p["email"]).is_empty() {
                c["email"] = p["email"].clone();
            }
            c["msClientId"] = p["clientId"].clone();
            c["msTenant"] = p["tenant"].clone();
            c["refreshToken"] = p["refreshToken"].clone();
            c["accessToken"] = p["accessToken"].clone();
            c["expiresAt"] = p["expiresAt"].clone();
        } else if s(&prev["authType"]) != "oauth-ms" {
            c["refreshToken"] = json!("");
        }
    }
    ms_hosts(c)
}
pub fn save_account(cfg: &Value) -> Value {
    let c = candidate(cfg);
    let oauth = s(&c["authType"]) == "oauth-ms";
    let mut out = c.as_object().cloned().unwrap_or_default();
    for k in ["password", "refreshToken", "accessToken", "expiresAt", "hasPassword", "passEnc", "refreshEnc"] {
        out.remove(k);
    }
    out.insert("passEnc".into(), json!(if oauth { String::new() } else { secrets::protect(s(&c["password"])) }));
    out.insert("refreshEnc".into(), json!(if oauth { secrets::protect(s(&c["refreshToken"])) } else { String::new() }));
    write(&cfg_file(), &Value::Object(out));
    *PENDING_OAUTH.lock().unwrap() = None;
    *MS_ACCESS.lock().unwrap() = None;
    public_account()
}
pub fn remove_account() -> Value {
    let _ = std::fs::remove_dir_all(dir());
    let _ = std::fs::create_dir_all(body_dir());
    json!({ "ok": true })
}

// ------------------------------------------------------------ connexion IMAP (une seule à la fois)
static IMAP_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn tls() -> tokio_rustls::TlsConnector {
    use tokio_rustls::rustls;
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let cfg = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .expect("TLS")
        .with_root_certificates(roots)
        .with_no_client_auth();
    tokio_rustls::TlsConnector::from(Arc::new(cfg))
}

struct XOAuth2(String, String);
impl async_imap::Authenticator for &XOAuth2 {
    type Response = String;
    fn process(&mut self, _: &[u8]) -> String {
        format!("user={}\x01auth=Bearer {}\x01\x01", self.0, self.1)
    }
}

async fn open(c: &Value) -> R<Sess> {
    let host = s(&c["imapHost"]).to_string();
    if host.is_empty() {
        return Err("Aucun compte mail configuré (Paramètres → Boîte mail).".into());
    }
    let port = c["imapPort"].as_u64().or_else(|| s(&c["imapPort"]).parse().ok()).unwrap_or(993) as u16;
    let fut = async {
        let tcp = TcpStream::connect((host.as_str(), port)).await.map_err(|e| e.to_string())?;
        let sni = tokio_rustls::rustls::pki_types::ServerName::try_from(host.clone()).map_err(|e| e.to_string())?;
        let tls_stream = if port == 143 {
            let mut plain = async_imap::Client::new(tcp);
            plain.read_response().await.ok_or("Pas de réponse du serveur")?.map_err(|e| e.to_string())?;
            plain.run_command_and_check_ok("STARTTLS", None).await.map_err(|e| e.to_string())?;
            tls().connect(sni, plain.into_inner()).await.map_err(|e| e.to_string())?
        } else {
            tls().connect(sni, tcp).await.map_err(|e| e.to_string())?
        };
        let mut client = async_imap::Client::new(tls_stream);
        if port != 143 {
            client.read_response().await.ok_or("Pas de réponse du serveur")?.map_err(|e| e.to_string())?;
        }
        let sess = match auth_of(c).await? {
            Auth::Pass(u, p) => client.login(u, p).await.map_err(|(e, _)| e.to_string())?,
            Auth::OAuth(u, t) => {
                let a = XOAuth2(u, t);
                client.authenticate("XOAUTH2", &a).await.map_err(|(e, _)| format!("XOAUTH AUTHENTICATE failed: {e}"))?
            }
        };
        Ok::<Sess, String>(sess)
    };
    tokio::time::timeout(Duration::from_secs(25), fut).await.map_err(|_| "timeout".to_string())?
}
async fn close(mut sess: Sess) {
    let _ = tokio::time::timeout(Duration::from_secs(5), sess.logout()).await;
}
fn account() -> R<Value> {
    load_account().filter(|c| !s(&c["imapHost"]).is_empty()).ok_or_else(|| "Aucun compte mail configuré (Paramètres → Boîte mail).".to_string())
}

pub fn human_error(m: &str) -> String {
    let has = |p: &str| Regex::new(p).unwrap().is_match(m);
    if has(r"(?i)AUTHENTICATE failed|XOAUTH|5\.7\.139|SmtpClientAuthentication") {
        format!("Microsoft a refusé l'accès : IMAP ou l'envoi SMTP est probablement désactivé pour cette boîte. L'admin Microsoft 365 doit activer « IMAP » et « SMTP authentifié » pour ce compte (centre d'administration → Utilisateurs → Courrier → Gérer les applications de messagerie). ({m})")
    } else if has(r"(?i)auth|credentials|login|password|LOGIN failed|Invalid") {
        format!("Connexion refusée : identifiant ou mot de passe incorrect. ({m})")
    } else if has(r"(?i)dns|failed to lookup|No such host|nodename") {
        format!("Serveur introuvable : vérifie l'adresse du serveur ou ta connexion internet. ({m})")
    } else if has(r"(?i)refused|reset|unreachable|10061|10054|10065") {
        format!("Impossible de joindre le serveur mail (hors ligne ou mauvais serveur/port). ({m})")
    } else if has(r"(?i)timed? ?out") {
        format!("Le serveur ne répond pas (délai dépassé). ({m})")
    } else {
        m.to_string()
    }
}

// ------------------------------------------------------------ SMTP
async fn transport(c: &Value) -> R<lettre::AsyncSmtpTransport<lettre::Tokio1Executor>> {
    use lettre::transport::smtp::authentication::{Credentials, Mechanism};
    let host = s(&c["smtpHost"]);
    let port = c["smtpPort"].as_u64().or_else(|| s(&c["smtpPort"]).parse().ok()).unwrap_or(465) as u16;
    let b = if port == 465 {
        lettre::AsyncSmtpTransport::<lettre::Tokio1Executor>::relay(host)
    } else {
        lettre::AsyncSmtpTransport::<lettre::Tokio1Executor>::starttls_relay(host)
    }
    .map_err(|e| e.to_string())?
    .port(port)
    .timeout(Some(Duration::from_secs(20)));
    let b = match auth_of(c).await? {
        Auth::Pass(u, p) => b.credentials(Credentials::new(u, p)),
        Auth::OAuth(u, t) => b.credentials(Credentials::new(u, t)).authentication(vec![Mechanism::Xoauth2]),
    };
    Ok(b.build())
}

pub async fn test(cfg: &Value) -> Value {
    let c = candidate(cfg);
    let imap = {
        let _g = IMAP_LOCK.lock().await;
        match open(&c).await {
            Ok(mut sess) => {
                let r = sess.examine("INBOX").await.map(|_| ()).map_err(|e| e.to_string());
                close(sess).await;
                r
            }
            Err(e) => Err(e),
        }
    };
    let smtp = match transport(&c).await {
        Ok(t) => match t.test_connection().await {
            Ok(true) => Ok(()),
            Ok(false) => Err("Le serveur SMTP ne répond pas.".to_string()),
            Err(e) => Err(e.to_string()),
        },
        Err(e) => Err(e),
    };
    let f = |r: R<()>| match r {
        Ok(()) => json!("ok"),
        Err(e) => json!(human_error(&e)),
    };
    json!({ "imap": f(imap), "smtp": f(smtp) })
}

// ------------------------------------------------------------ dossiers
fn special(attrs: &[NameAttribute], path: &str) -> Option<&'static str> {
    for a in attrs {
        let v = match a {
            NameAttribute::Sent => "\\Sent",
            NameAttribute::Drafts => "\\Drafts",
            NameAttribute::Trash => "\\Trash",
            NameAttribute::Junk => "\\Junk",
            NameAttribute::Archive => "\\Archive",
            NameAttribute::Flagged => "\\Flagged",
            NameAttribute::All => "\\All",
            _ => continue,
        };
        return Some(v);
    }
    if path.eq_ignore_ascii_case("INBOX") { Some("\\Inbox") } else { None }
}
async fn list_folders(sess: &mut Sess) -> R<Vec<(String, String, Option<&'static str>, bool)>> {
    let names: Vec<_> = sess.list(Some(""), Some("*")).await.map_err(|e| e.to_string())?.try_collect().await.map_err(|e| e.to_string())?;
    Ok(names
        .iter()
        .map(|n| {
            let path = n.name().to_string();
            let short = n.delimiter().and_then(|d| path.rsplit(d).next()).unwrap_or(&path).to_string();
            let noselect = n.attributes().iter().any(|a| matches!(a, NameAttribute::NoSelect));
            (path.clone(), short, special(n.attributes(), &path), noselect)
        })
        .collect())
}
fn folder_fr(su: &str) -> &'static str {
    match su {
        "\\Inbox" => "Boîte de réception",
        "\\Sent" => "Envoyés",
        "\\Drafts" => "Brouillons",
        "\\Trash" => "Corbeille",
        "\\Junk" => "Indésirables",
        "\\Archive" => "Archives",
        "\\Flagged" => "Suivis",
        "\\All" => "Tous les messages",
        _ => "",
    }
}
pub async fn folders() -> R<Value> {
    let c = account()?;
    let _g = IMAP_LOCK.lock().await;
    let mut sess = open(&c).await?;
    let l = list_folders(&mut sess).await;
    close(sess).await;
    let order = ["\\Inbox", "\\Sent", "\\Drafts", "\\Archive", "\\Flagged", "\\Junk", "\\Trash", "\\All"];
    let mut v: Vec<(usize, String, Value)> = l?
        .into_iter()
        .filter(|f| !f.3)
        .map(|(path, short, su, _)| {
            let name = su.map(folder_fr).filter(|n| !n.is_empty()).map(String::from).unwrap_or(short);
            let rank = su.and_then(|x| order.iter().position(|o| *o == x)).unwrap_or(99);
            (rank, name.clone(), json!({ "path": path, "name": name, "specialUse": su }))
        })
        .collect();
    v.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    Ok(json!(v.into_iter().map(|x| x.2).collect::<Vec<_>>()))
}

// ------------------------------------------------------------ liste des messages
fn addr_list(a: Option<&mail_parser::Address>) -> Vec<Value> {
    a.map(|a| a.iter().map(|x| json!({ "name": x.name.as_deref().unwrap_or(""), "address": x.address.as_deref().unwrap_or("").to_lowercase() })).collect()).unwrap_or_default()
}
pub fn cached_list(folder: &str) -> Value {
    iris_store::read_json(&list_file(folder)).unwrap_or(json!({ "folder": folder, "messages": [], "syncedAt": null }))
}

pub async fn sync(folder: &str, limit: u32) -> R<Value> {
    let c = account()?;
    let (mut messages, total) = {
        let _g = IMAP_LOCK.lock().await;
        let mut sess = open(&c).await?;
        let r = async {
            let mb = sess.select(folder).await.map_err(|e| e.to_string())?;
            let total = mb.exists;
            let mut out = vec![];
            if total > 0 {
                let from = total.saturating_sub(limit).max(0) + 1;
                let fetches: Vec<_> = sess
                    .fetch(format!("{from}:*"), "(UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER])")
                    .await
                    .map_err(|e| e.to_string())?
                    .try_collect()
                    .await
                    .map_err(|e| e.to_string())?;
                let mixed = Regex::new(r"(?im)^content-type:\s*multipart/mixed").unwrap();
                for m in fetches {
                    let Some(uid) = m.uid else { continue };
                    let raw = m.header().unwrap_or(b"");
                    let p = MessageParser::default().parse_headers(raw);
                    let flags: Vec<Flag> = m.flags().collect();
                    let (date, ts) = p
                        .as_ref()
                        .and_then(|p| p.date())
                        .map(|d| (d.to_rfc3339(), d.to_timestamp()))
                        .or_else(|| m.internal_date().map(|d| (d.to_rfc3339(), d.timestamp())))
                        .unwrap_or_else(|| (chrono::Utc::now().to_rfc3339(), 0));
                    let subject = p.as_ref().and_then(|p| p.subject()).filter(|x| !x.is_empty()).unwrap_or("(sans objet)");
                    let from_l = addr_list(p.as_ref().and_then(|p| p.from()));
                    out.push((ts, json!({
                        "uid": uid,
                        "messageId": p.as_ref().and_then(|p| p.message_id()).map(|x| format!("<{x}>")),
                        "subject": subject,
                        "from": from_l.first().cloned(),
                        "to": addr_list(p.as_ref().and_then(|p| p.to())),
                        "date": date,
                        "seen": flags.contains(&Flag::Seen),
                        "flagged": flags.contains(&Flag::Flagged),
                        "answered": flags.contains(&Flag::Answered),
                        "size": m.size.unwrap_or(0),
                        "attachments": mixed.is_match(&String::from_utf8_lossy(raw)),
                    })));
                }
            }
            Ok::<_, String>((out, total))
        }
        .await;
        close(sess).await;
        r?
    };
    messages.sort_by(|a, b| b.0.cmp(&a.0));
    // conserve les extraits déjà connus
    let known: std::collections::HashMap<u64, Value> =
        cached_list(folder)["messages"].as_array().cloned().unwrap_or_default().into_iter().filter_map(|m| m["uid"].as_u64().map(|u| (u, m))).collect();
    let msgs: Vec<Value> = messages
        .into_iter()
        .map(|(_, mut m)| {
            if let Some(k) = m["uid"].as_u64().and_then(|u| known.get(&u)) {
                for f in ["snippet", "category"] {
                    if !k[f].is_null() {
                        m[f] = k[f].clone();
                    }
                }
            }
            m
        })
        .collect();
    let result = json!({ "folder": folder, "messages": msgs, "total": total, "syncedAt": chrono::Utc::now().to_rfc3339() });
    write(&list_file(folder), &result);
    Ok(result)
}

// ------------------------------------------------------------ corps des messages
pub fn read_body(folder: &str, uid: u32) -> Value {
    iris_store::read_json(&body_file(folder, uid)).unwrap_or(Value::Null)
}

fn html_to_text(h: &str) -> String {
    let h = Regex::new(r"(?is)<style.*?</style>").unwrap().replace_all(h, " ");
    let h = Regex::new(r"<[^>]+>").unwrap().replace_all(&h, " ");
    let h = http::dec(&h.replace("&nbsp;", " "));
    Regex::new(r"\s+").unwrap().replace_all(&h, " ").trim().to_string()
}

fn parse(source: &[u8]) -> R<Value> {
    use base64::engine::general_purpose::STANDARD;
    let p = MessageParser::default().parse(source).ok_or("Message illisible")?;
    let has_html = p.html_bodies().any(|b| b.content_type().and_then(|c| c.subtype()).is_some_and(|st| st.eq_ignore_ascii_case("html")));
    let orig_html = if has_html { p.body_html(0).map(|h| h.to_string()).unwrap_or_default() } else { String::new() };
    let text = p.body_text(0).map(|t| t.replace('\r', "").trim().to_string()).unwrap_or_default();
    let mut html = orig_html.clone();
    let mut atts = vec![];
    for (i, a) in p.attachments().enumerate() {
        let cid = a.content_id().unwrap_or("").trim_matches(['<', '>']).to_string();
        let ct = a.content_type().map(|c| format!("{}/{}", c.ctype(), c.subtype().unwrap_or("octet-stream"))).unwrap_or_else(|| "application/octet-stream".into());
        let inline_img = !cid.is_empty() && orig_html.contains(&format!("cid:{cid}"));
        if inline_img && a.len() < 3_000_000 {
            html = html.replace(&format!("cid:{cid}"), &format!("data:{ct};base64,{}", STANDARD.encode(a.contents())));
        }
        let is_att = a.content_disposition().is_some_and(|d| d.is_attachment());
        if is_att || !inline_img {
            atts.push(json!({ "index": i, "filename": a.attachment_name().map(String::from).unwrap_or_else(|| format!("piece-jointe-{}", i + 1)), "contentType": ct, "size": a.len() }));
        }
    }
    let plain = if text.is_empty() { html_to_text(&html) } else { text.clone() };
    let refs: Vec<String> = match p.references() {
        mail_parser::HeaderValue::Text(t) => vec![format!("<{t}>")],
        mail_parser::HeaderValue::TextList(l) => l.iter().map(|t| format!("<{t}>")).collect(),
        _ => vec![],
    };
    let snippet: String = Regex::new(r"\s+").unwrap().replace_all(&plain, " ").chars().take(220).collect();
    Ok(json!({
        "messageId": p.message_id().map(|x| format!("<{x}>")),
        "references": refs,
        "subject": p.subject().filter(|x| !x.is_empty()).unwrap_or("(sans objet)"),
        "from": addr_list(p.from()),
        "to": addr_list(p.to()),
        "cc": addr_list(p.cc()),
        "replyTo": addr_list(p.reply_to()),
        "date": p.date().map(|d| d.to_rfc3339()).unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
        "text": (if text.is_empty() { &plain } else { &text }).chars().take(60000).collect::<String>(),
        "html": if html.len() > 1_500_000 { String::new() } else { html },
        "snippet": snippet,
        "attachments": atts,
    }))
}

async fn fetch_source(sess: &mut Sess, uid: u32) -> R<Option<Vec<u8>>> {
    let f: Vec<_> = sess.uid_fetch(uid.to_string(), "BODY.PEEK[]").await.map_err(|e| e.to_string())?.try_collect().await.map_err(|e| e.to_string())?;
    Ok(f.iter().find_map(|m| m.body().map(|b| b.to_vec())))
}

/// Télécharge en arrière-plan le texte des messages récents (pour les extraits et l'analyse).
pub async fn prefetch(folder: &str, count: usize) -> R<Value> {
    let list = cached_list(folder);
    let todo: Vec<u32> = list["messages"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter(|m| m["size"].as_u64().unwrap_or(0) < 4_000_000)
        .filter_map(|m| m["uid"].as_u64().map(|u| u as u32))
        .filter(|u| !body_file(folder, *u).exists())
        .take(count)
        .collect();
    if todo.is_empty() {
        return Ok(list);
    }
    let c = account()?;
    {
        let _g = IMAP_LOCK.lock().await;
        let mut sess = open(&c).await?;
        let r = async {
            sess.select(folder).await.map_err(|e| e.to_string())?;
            for uid in todo {
                if let Some(src) = fetch_source(&mut sess, uid).await? {
                    if let Ok(b) = parse(&src) {
                        write(&body_file(folder, uid), &b);
                    }
                }
            }
            Ok::<_, String>(())
        }
        .await;
        close(sess).await;
        r?;
    }
    let mut fresh = cached_list(folder);
    if let Some(l) = fresh["messages"].as_array_mut() {
        for m in l {
            let b = m["uid"].as_u64().map(|u| read_body(folder, u as u32)).unwrap_or(Value::Null);
            if !b.is_null() {
                m["snippet"] = b["snippet"].clone();
            }
        }
    }
    write(&list_file(folder), &fresh);
    Ok(fresh)
}

fn patch_list(folder: &str, uid: u32, patch: Value) {
    let mut list = cached_list(folder);
    let mut changed = false;
    if let Some(l) = list["messages"].as_array_mut() {
        if let Some(m) = l.iter_mut().find(|m| m["uid"].as_u64() == Some(uid as u64)) {
            for (k, v) in patch.as_object().cloned().unwrap_or_default() {
                m[k] = v;
            }
            changed = true;
        }
    }
    if changed {
        write(&list_file(folder), &list);
    }
}

pub async fn get_message(folder: &str, uid: u32, mark_seen: bool) -> R<Value> {
    let mut body = read_body(folder, uid);
    if body.is_null() {
        let c = account()?;
        let _g = IMAP_LOCK.lock().await;
        let mut sess = open(&c).await?;
        let r = async {
            sess.select(folder).await.map_err(|e| e.to_string())?;
            let src = fetch_source(&mut sess, uid).await?.ok_or("Message introuvable (supprimé ?)")?;
            let b = parse(&src)?;
            write(&body_file(folder, uid), &b);
            if mark_seen {
                let _: Vec<_> = sess.uid_store(uid.to_string(), "+FLAGS (\\Seen)").await.map_err(|e| e.to_string())?.try_collect().await.map_err(|e| e.to_string())?;
            }
            Ok::<_, String>(b)
        }
        .await;
        close(sess).await;
        body = r?;
    } else if mark_seen {
        // déjà en cache : lisible même hors ligne, le « lu » est envoyé au serveur en arrière-plan
        let f = folder.to_string();
        tauri::async_runtime::spawn(async move {
            let _ = set_flag(&f, uid, "seen", true).await;
        });
    }
    if mark_seen {
        patch_list(folder, uid, json!({ "seen": true, "snippet": body["snippet"] }));
    }
    let mut out = json!({ "folder": folder, "uid": uid });
    for (k, v) in body.as_object().cloned().unwrap_or_default() {
        out[k] = v;
    }
    Ok(out)
}

pub async fn set_flag(folder: &str, uid: u32, flag: &str, value: bool) -> R<Value> {
    let f = match flag {
        "seen" => "\\Seen",
        "flagged" => "\\Flagged",
        _ => return Err(format!("Drapeau inconnu : {flag}")),
    };
    let c = account()?;
    {
        let _g = IMAP_LOCK.lock().await;
        let mut sess = open(&c).await?;
        let r = async {
            sess.select(folder).await.map_err(|e| e.to_string())?;
            let q = format!("{}FLAGS ({f})", if value { "+" } else { "-" });
            let _: Vec<_> = sess.uid_store(uid.to_string(), q).await.map_err(|e| e.to_string())?.try_collect().await.map_err(|e| e.to_string())?;
            Ok::<_, String>(())
        }
        .await;
        close(sess).await;
        r?;
    }
    patch_list(folder, uid, json!({ flag: value }));
    Ok(json!({ "ok": true }))
}

async fn delete_uid(sess: &mut Sess, uid: u32) -> R<()> {
    let _: Vec<_> = sess.uid_store(uid.to_string(), "+FLAGS (\\Deleted)").await.map_err(|e| e.to_string())?.try_collect().await.map_err(|e| e.to_string())?;
    let _: Vec<_> = sess.expunge().await.map_err(|e| e.to_string())?.try_collect().await.map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn trash(folder: &str, uid: u32) -> R<Value> {
    let c = account()?;
    {
        let _g = IMAP_LOCK.lock().await;
        let mut sess = open(&c).await?;
        let r = async {
            let trash = list_folders(&mut sess).await?.into_iter().find(|f| f.2 == Some("\\Trash")).map(|f| f.0);
            sess.select(folder).await.map_err(|e| e.to_string())?;
            match trash.filter(|t| t != folder) {
                Some(t) => {
                    let caps = sess.capabilities().await.map_err(|e| e.to_string())?;
                    if caps.has_str("MOVE") {
                        sess.uid_mv(uid.to_string(), &t).await.map_err(|e| e.to_string())?;
                    } else {
                        sess.uid_copy(uid.to_string(), &t).await.map_err(|e| e.to_string())?;
                        delete_uid(&mut sess, uid).await?;
                    }
                }
                None => delete_uid(&mut sess, uid).await?,
            }
            Ok::<_, String>(())
        }
        .await;
        close(sess).await;
        r?;
    }
    let mut list = cached_list(folder);
    if let Some(l) = list["messages"].as_array_mut() {
        l.retain(|m| m["uid"].as_u64() != Some(uid as u64));
    }
    write(&list_file(folder), &list);
    Ok(json!({ "ok": true }))
}

/// Pièce jointe n° `index` (même numérotation que `attachments` de `parse`).
pub async fn attachment(folder: &str, uid: u32, index: usize) -> R<(String, Vec<u8>)> {
    let c = account()?;
    let src = {
        let _g = IMAP_LOCK.lock().await;
        let mut sess = open(&c).await?;
        let r = async {
            sess.select(folder).await.map_err(|e| e.to_string())?;
            fetch_source(&mut sess, uid).await
        }
        .await;
        close(sess).await;
        r?.ok_or("Message introuvable")?
    };
    let p = MessageParser::default().parse(&src).ok_or("Message illisible")?;
    let a = p.attachments().nth(index).ok_or("Pièce jointe introuvable")?;
    let name = a.attachment_name().map(String::from).unwrap_or_else(|| format!("piece-jointe-{}", index + 1));
    Ok((name, a.contents().to_vec()))
}

// ------------------------------------------------------------ envoi
fn mime_of(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
        "pdf" => "application/pdf",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "txt" => "text/plain",
        "csv" => "text/csv",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "zip" => "application/zip",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}
fn addrs(v: &Value) -> Vec<String> {
    let raw = match v {
        Value::Array(l) => l.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(","),
        _ => s(v).to_string(),
    };
    raw.split([',', ';']).map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()
}

pub async fn send(m: &Value) -> R<Value> {
    use lettre::message::{header::ContentType, Attachment, Mailbox, MultiPart, SinglePart};
    use lettre::AsyncTransport;
    let c = load_account().filter(|c| !s(&c["smtpHost"]).is_empty()).ok_or("Aucun compte mail configuré.")?;
    let email = s(&c["email"]);
    let from: Mailbox = if s(&c["displayName"]).is_empty() {
        email.parse()
    } else {
        format!("\"{}\" <{email}>", s(&c["displayName"]).replace('"', "")).parse()
    }
    .map_err(|e| format!("Adresse d'expéditeur invalide : {e}"))?;
    let domain = email.rsplit('@').next().unwrap_or("irisprog.local");
    let mid = format!("<{}@{domain}>", rand::random::<[u8; 16]>().iter().map(|b| format!("{b:02x}")).collect::<String>());
    let mut b = lettre::Message::builder().from(from).subject(s(&m["subject"])).message_id(Some(mid.clone()));
    for a in addrs(&m["to"]) {
        b = b.to(a.parse::<Mailbox>().map_err(|e| format!("Destinataire invalide « {a} » : {e}"))?);
    }
    for a in addrs(&m["cc"]) {
        b = b.cc(a.parse::<Mailbox>().map_err(|e| format!("Copie invalide « {a} » : {e}"))?);
    }
    let irt = s(&m["inReplyTo"]).to_string();
    if !irt.is_empty() {
        b = b.in_reply_to(irt.clone());
    }
    let refs: Vec<String> = m["references"].as_array().map(|l| l.iter().filter_map(|x| x.as_str()).map(String::from).collect()).unwrap_or_default();
    if !refs.is_empty() {
        b = b.references(refs.join(" "));
    }
    let sig = s(&c["signature"]);
    let text = format!("{}{}", s(&m["text"]), if sig.is_empty() { String::new() } else { format!("\n\n-- \n{sig}") });
    let files: Vec<String> = m["attachments"].as_array().map(|l| l.iter().filter_map(|x| x.as_str()).map(String::from).collect()).unwrap_or_default();
    let msg = if files.is_empty() {
        b.header(ContentType::TEXT_PLAIN).body(text)
    } else {
        let mut mp = MultiPart::mixed().singlepart(SinglePart::plain(text));
        for f in &files {
            let bytes = std::fs::read(f).map_err(|e| format!("Pièce jointe illisible ({f}) : {e}"))?;
            let name = std::path::Path::new(f).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "fichier".into());
            mp = mp.singlepart(Attachment::new(name.clone()).body(bytes, ContentType::parse(mime_of(&name)).unwrap()));
        }
        b.multipart(mp)
    }
    .map_err(|e| e.to_string())?;
    transport(&c).await?.send(msg.clone()).await.map_err(|e| e.to_string())?;
    // copie dans « Envoyés » (Gmail le fait tout seul)
    if !s(&c["smtpHost"]).to_lowercase().ends_with("gmail.com") {
        let raw = msg.formatted();
        let _g = IMAP_LOCK.lock().await;
        if let Ok(mut sess) = open(&c).await {
            if let Ok(l) = list_folders(&mut sess).await {
                if let Some(sent) = l.into_iter().find(|f| f.2 == Some("\\Sent")) {
                    let _ = sess.append(&sent.0, Some("(\\Seen)"), None, &raw).await;
                }
            }
            close(sess).await;
        }
    }
    if !irt.is_empty() {
        let uid = cached_list("INBOX")["messages"].as_array().and_then(|l| l.iter().find(|x| s(&x["messageId"]) == irt).and_then(|x| x["uid"].as_u64()));
        if let Some(uid) = uid {
            let _g = IMAP_LOCK.lock().await;
            if let Ok(mut sess) = open(&c).await {
                if sess.select("INBOX").await.is_ok() {
                    if let Ok(st) = sess.uid_store(uid.to_string(), "+FLAGS (\\Answered)").await {
                        let _: Result<Vec<_>, _> = st.try_collect().await;
                    }
                }
                close(sess).await;
            }
            patch_list("INBOX", uid as u32, json!({ "answered": true }));
        }
    }
    Ok(json!({ "ok": true, "messageId": mid }))
}

#[cfg(test)]
mod tests {
    #[test]
    fn parse_simple() {
        let raw = b"From: Alice <ALICE@x.ch>\r\nTo: bob@y.ch\r\nSubject: =?UTF-8?B?w6l0w6k=?=\r\nMessage-ID: <a1@x.ch>\r\nDate: Tue, 10 Nov 2026 10:00:00 +0100\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nBonjour\r\n";
        let v = super::parse(raw).unwrap();
        assert_eq!(v["subject"], "été");
        assert_eq!(v["from"][0]["address"], "alice@x.ch");
        assert_eq!(v["messageId"], "<a1@x.ch>");
        assert_eq!(v["text"], "Bonjour");
        assert_eq!(v["html"], "");
    }
}
