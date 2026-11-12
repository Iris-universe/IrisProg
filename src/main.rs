// IrisProg : logiciel de programmation de festival / d'événements (base d'artistes, propositions, timetable, mails).
// Rust + Tauri 2 ; l'interface (ui/) est en HTML/JS. Pilotable par Orbiz via iris-link (id `irisprog`).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod countries;
mod data;
mod http;
mod lookup;
mod mail;
mod owa;
mod secrets;
mod sources;
mod wv2;

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl};

type Res = Result<Value, String>;

/// Erreur -> `{ error }` lisible (comme `safe()` de l'ancienne version).
fn safe(r: Result<Value, String>) -> Value {
    r.unwrap_or_else(|e| json!({ "error": mail::human_error(&e) }))
}

pub fn open_external(url: &str) {
    let ok = ["http://", "https://", "mailto:", "tel:"].iter().any(|p| url.to_lowercase().starts_with(p));
    if ok {
        let _ = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn();
    }
}
fn clean_name(n: &str) -> String {
    n.chars().map(|c| if r#"\/:*?"<>|"#.contains(c) { '_' } else { c }).collect()
}

// ------------------------------------------------------------ données
#[tauri::command]
fn data_load() -> Value {
    data::load().unwrap_or(Value::Null)
}
#[tauri::command]
fn data_save(data: Value) -> Res {
    data::save(&data)
}
#[tauri::command]
fn migration_info(st: tauri::State<St>) -> Value {
    st.migrated.clone().unwrap_or(Value::Null)
}
#[tauri::command]
fn open_url(url: String) {
    open_external(&url);
}
#[tauri::command]
fn open_datafolder() {
    iris_store::open_path(&data::dir());
}

// ------------------------------------------------------------ fichiers (exports / imports)
async fn save_dialog(name: &str, ext: &str, dir: Option<PathBuf>) -> Option<PathBuf> {
    let mut d = rfd::AsyncFileDialog::new().set_file_name(name).add_filter(ext.to_uppercase(), &[ext]);
    if let Some(dir) = dir.or_else(dirs::document_dir) {
        d = d.set_directory(dir);
    }
    d.save_file().await.map(|f| f.path().to_path_buf())
}
#[tauri::command]
async fn export_text(text: String, name: String, ext: String) -> Value {
    let Some(p) = save_dialog(&name, &ext, None).await else { return json!({ "canceled": true }) };
    safe(std::fs::write(&p, text).map_err(|e| e.to_string()).map(|_| {
        iris_store::show_in_folder(&p);
        json!({ "ok": true, "path": p.to_string_lossy() })
    }))
}
#[tauri::command]
async fn import_text(exts: Vec<String>) -> Value {
    let e: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
    let Some(f) = rfd::AsyncFileDialog::new().add_filter("Fichiers", &e).pick_file().await else { return json!({ "canceled": true }) };
    safe(std::fs::read_to_string(f.path()).map_err(|e| e.to_string()).map(|t| json!({ "name": f.file_name(), "text": t.trim_start_matches('\u{feff}') })))
}

/// Export PDF : la page fournit un document HTML complet, imprimé dans une fenêtre cachée.
#[tauri::command]
async fn export_pdf(app: AppHandle, st: tauri::State<'_, St>, html: String, name: String) -> Result<Value, ()> {
    let Some(path) = save_dialog(&name, "pdf", None).await else { return Ok(json!({ "canceled": true })) };
    let landscape = html.contains("A4 landscape");
    let id = format!("doc{}", chrono::Utc::now().timestamp_millis());
    st.exports.lock().unwrap().insert(id.clone(), html);
    let r = async {
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        let tx = Mutex::new(Some(tx));
        let url: url::Url = format!("http://irisexport.localhost/{id}").parse().unwrap();
        let w = tauri::WebviewWindowBuilder::new(&app, &id, WebviewUrl::External(url))
            .visible(false)
            .inner_size(1200.0, 900.0)
            .on_page_load(move |_, p| {
                if p.event() == tauri::webview::PageLoadEvent::Finished {
                    if let Some(t) = tx.lock().unwrap().take() {
                        let _ = t.send(());
                    }
                }
            })
            .build()
            .map_err(|e| e.to_string())?;
        let _ = tokio::time::timeout(Duration::from_secs(20), rx).await;
        tokio::time::sleep(Duration::from_millis(600)).await; // laisse charger les images
        let wv = w.as_ref().clone();
        let r = wv2::print_pdf(&wv, &path, landscape).await;
        let _ = w.close();
        r
    }
    .await;
    st.exports.lock().unwrap().remove(&id);
    Ok(safe(r.map(|_| {
        iris_store::open_path(&path);
        json!({ "ok": true, "path": path.to_string_lossy() })
    })))
}

// ------------------------------------------------------------ recherche et enrichissement
#[tauri::command]
async fn lookup_artist(q: String) -> Value {
    lookup::lookup(&q).await
}
#[tauri::command]
async fn lookup_image(url: String) -> Value {
    lookup::image(&url).await
}
#[tauri::command]
fn keys_status() -> Value {
    sources::status()
}
#[tauri::command]
fn keys_get() -> Value {
    sources::masked_keys()
}
#[tauri::command]
fn keys_save(patch: Value) -> Value {
    sources::save_keys(&patch)
}
#[tauri::command]
async fn keys_test_spotify() -> Value {
    sources::test_spotify().await
}
#[tauri::command]
fn enrich_start(app: AppHandle, list: Vec<Value>) -> Value {
    sources::enrich_all(app, list)
}
#[tauri::command]
fn enrich_stop() -> Value {
    sources::stop_enrich()
}

// ------------------------------------------------------------ mails
#[tauri::command]
fn mail_presets() -> Value {
    mail::presets()
}
#[tauri::command]
fn mail_account() -> Value {
    mail::public_account()
}
#[tauri::command]
fn mail_save_account(cfg: Value) -> Value {
    mail::save_account(&cfg)
}
#[tauri::command]
fn mail_remove_account() -> Value {
    mail::remove_account()
}
#[tauri::command]
async fn mail_test(cfg: Value) -> Value {
    mail::test(&cfg).await
}
#[tauri::command]
async fn mail_ms_login(app: AppHandle, o: Value) -> Value {
    safe(mail::ms_login(&app, &o).await)
}
#[tauri::command]
async fn mail_folders() -> Value {
    safe(mail::folders().await)
}
#[tauri::command]
fn mail_cached(folder: Option<String>) -> Value {
    mail::cached_list(folder.as_deref().unwrap_or("INBOX"))
}
#[tauri::command]
async fn mail_sync(folder: Option<String>) -> Value {
    safe(mail::sync(folder.as_deref().unwrap_or("INBOX"), 300).await)
}
#[tauri::command]
async fn mail_prefetch(folder: Option<String>) -> Value {
    safe(mail::prefetch(folder.as_deref().unwrap_or("INBOX"), 40).await)
}
#[tauri::command]
async fn mail_get(folder: String, uid: u32, opts: Option<Value>) -> Value {
    let mark = opts.as_ref().and_then(|o| o["markSeen"].as_bool()).unwrap_or(true);
    safe(mail::get_message(&folder, uid, mark).await)
}
#[tauri::command]
fn mail_body(folder: String, uid: u32) -> Value {
    mail::read_body(&folder, uid)
}
#[tauri::command]
async fn mail_flag(folder: String, uid: u32, flag: String, value: bool) -> Value {
    safe(mail::set_flag(&folder, uid, &flag, value).await)
}
#[tauri::command]
async fn mail_trash(folder: String, uid: u32) -> Value {
    safe(mail::trash(&folder, uid).await)
}
#[tauri::command]
async fn mail_send(m: Value) -> Value {
    safe(mail::send(&m).await)
}
#[tauri::command]
async fn mail_attachment(folder: String, uid: u32, index: usize, mode: Option<String>) -> Value {
    let r = async {
        let (name, bytes) = mail::attachment(&folder, uid, index).await?;
        let clean = clean_name(&name);
        if mode.as_deref() == Some("save") {
            let ext = clean.rsplit('.').next().unwrap_or("").to_string();
            let mut d = rfd::AsyncFileDialog::new().set_file_name(&clean);
            if let Some(dl) = dirs::download_dir() {
                d = d.set_directory(dl);
            }
            if !ext.is_empty() && ext != clean {
                d = d.add_filter(ext.to_uppercase(), &[ext.as_str()]);
            }
            let Some(f) = d.save_file().await else { return Ok(json!({ "canceled": true })) };
            std::fs::write(f.path(), &bytes).map_err(|e| e.to_string())?;
            iris_store::show_in_folder(f.path());
            return Ok(json!({ "ok": true, "path": f.path().to_string_lossy() }));
        }
        let dir = std::env::temp_dir().join("irisprog-pj");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let p = dir.join(&clean);
        std::fs::write(&p, &bytes).map_err(|e| e.to_string())?;
        iris_store::open_path(&p);
        Ok(json!({ "ok": true }))
    }
    .await;
    safe(r)
}
#[tauri::command]
async fn mail_pick_files() -> Value {
    let files = rfd::AsyncFileDialog::new().pick_files().await.unwrap_or_default();
    json!(files
        .iter()
        .map(|f| json!({ "path": f.path().to_string_lossy(), "name": f.file_name(), "size": std::fs::metadata(f.path()).map(|m| m.len()).unwrap_or(0) }))
        .collect::<Vec<_>>())
}

// ------------------------------------------------------------ Outlook intégré
#[tauri::command]
fn owa_show(app: AppHandle, url: String, x: f64, y: f64, w: f64, h: f64) -> Value {
    safe(owa::show(&app, &url, x, y, w, h))
}
#[tauri::command]
fn owa_bounds(app: AppHandle, x: f64, y: f64, w: f64, h: f64) {
    owa::bounds(&app, x, y, w, h);
}
#[tauri::command]
fn owa_hide(app: AppHandle) {
    owa::hide(&app);
}
#[tauri::command]
fn owa_nav(app: AppHandle, action: String, url: Option<String>) -> Value {
    owa::nav(&app, &action, url.as_deref())
}
#[tauri::command]
async fn owa_read(app: AppHandle, js: String) -> Value {
    owa::read(&app, &js).await
}
#[tauri::command]
fn owa_clear(app: AppHandle, home: Option<String>) -> Value {
    owa::clear(&app, home.as_deref())
}

// ------------------------------------------------------------ fenêtre
#[tauri::command]
fn win_action(app: AppHandle, action: String) {
    let Some(w) = app.get_webview_window("main") else { return };
    match action.as_str() {
        "fullscreen" => {
            let f = w.is_fullscreen().unwrap_or(false);
            let _ = w.set_fullscreen(!f);
        }
        "devtools" => {
            if w.is_devtools_open() {
                w.close_devtools();
            } else {
                w.open_devtools();
            }
        }
        _ => {}
    }
}

// ------------------------------------------------------------ iris-link (Orbiz)
fn instructions() -> &'static str {
    let ed = data::edition();
    Box::leak(format!("Tu assistes le responsable de la programmation {ed} dans IrisProg, son logiciel de programmation de festival.
- Commence par get_state pour voir l'écran et les styles disponibles.
- Pour analyser des mails : list_emails puis read_email. Résume clairement (qui, quel artiste, style, origine, dates proposées, cachet demandé, conditions), en français, phrases courtes.
- Quand un mail propose un artiste, propose de créer la fiche (add_artist) avec les infos du mail, statut \"proposition\", source = l'expéditeur/agence ; puis link_email_to_artist.
- La base d'artistes est générale (tous les artistes suivis) ; les artistes proposés pour le festival sont dans une liste à part (propose_artist / unpropose_artist, statut = avancement du booking). N'ajoute à cette liste que si l'utilisateur le demande.
- Ne crée jamais de doublon : vérifie avec list_artists. N'invente pas de cachet : laisse vide si inconnu.
- Pour la présentation d'un artiste (bio), reste factuel ; si tu n'es pas sûr d'une info, dis-le.
- Tu n'envoies jamais de mail toi-même : draft_email ouvre un brouillon que l'utilisateur relit et envoie.").into_boxed_str())
}

pub struct St {
    exports: Mutex<HashMap<String, String>>,
    migrated: Option<Value>,
}

fn main() {
    let migrated = data::migrate();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .manage(St { exports: Mutex::new(HashMap::new()), migrated })
        .register_uri_scheme_protocol("irisexport", |ctx, req| {
            let id = req.uri().path().trim_start_matches('/').to_string();
            let html = ctx.app_handle().state::<St>().exports.lock().unwrap().get(&id).cloned().unwrap_or_default();
            tauri::http::Response::builder().header("Content-Type", "text/html; charset=utf-8").body(html.into_bytes()).unwrap()
        })
        .invoke_handler(tauri::generate_handler![
            data_load, data_save, migration_info, open_url, open_datafolder, export_text, import_text, export_pdf,
            lookup_artist, lookup_image, keys_status, keys_get, keys_save, keys_test_spotify, enrich_start, enrich_stop,
            mail_presets, mail_account, mail_save_account, mail_remove_account, mail_test, mail_ms_login, mail_folders, mail_cached,
            mail_sync, mail_prefetch, mail_get, mail_body, mail_flag, mail_trash, mail_send, mail_attachment, mail_pick_files,
            owa_show, owa_bounds, owa_hide, owa_nav, owa_read, owa_clear, win_action,
            iris_link::commands::assistant_ask, iris_link::commands::agent_reply
        ])
        .setup(|app| {
            let w = tauri::WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("IrisProg")
                .inner_size(1500.0, 940.0)
                .min_inner_size(1100.0, 680.0)
                .background_color(tauri::window::Color(10, 16, 32, 255))
                .visible(false)
                .on_navigation(|u| {
                    // liens externes : navigateur par défaut, jamais dans la fenêtre de l'app
                    let local = u.host_str().is_some_and(|h| h.ends_with("localhost"));
                    if !local && matches!(u.scheme(), "http" | "https" | "mailto" | "tel") {
                        open_external(u.as_str());
                        return false;
                    }
                    true
                })
                .on_new_window(|u, _| {
                    open_external(u.as_str());
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            let _ = w.maximize();
            let _ = w.show();
            let _ = w.set_focus();
            let tools: Value = serde_json::from_str(include_str!("tools.json")).expect("tools.json");
            let mut tools = tools.as_array().cloned().unwrap_or_default();
            tools.push(json!({ "name": "screenshot", "description": "Capture d'écran de l'app (PNG) ; renvoie le chemin du fichier.", "parameters": iris_link::obj(json!({}), json!([])) }));
            iris_link::start(
                app.handle(),
                iris_link::AppInfo {
                    id: "irisprog",
                    name: "IrisProg",
                    description: "Logiciel de programmation de festival : base d'artistes (styles, origine, présentation, tarifs, popularité), propositions et pipeline de booking, timetable, boîte mail intégrée.",
                    instructions: instructions(),
                    tools: json!(tools),
                },
            );
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("démarrage d'IrisProg");
}

#[cfg(test)]
mod live_tests {
    // tests sur internet / vraies données (lecture seule) : cargo test -- --ignored --nocapture
    #[test]
    #[ignore]
    fn old_secrets_readable() {
        let old = crate::data::import_source().expect("import-from.txt");
        let key = crate::secrets::electron_key(&old).expect("clé Electron");
        if let Some(acc) = iris_store::read_json(&old.join("mail").join("account.json")) {
            for k in ["passEnc", "refreshEnc"] {
                let v = acc[k].as_str().unwrap_or("");
                println!("compte {k}: chiffré={} déchiffré={} car.", v.len(), crate::secrets::electron_decrypt(&key, v).len());
            }
        } else {
            println!("pas de compte mail");
        }
        if let Some(serde_json::Value::Object(m)) = iris_store::read_json(&old.join("api-keys.json")) {
            for (k, v) in m {
                println!("clé {k}: déchiffrée={} car.", crate::secrets::electron_decrypt(&key, v.as_str().unwrap_or("")).len());
            }
        }
    }
    #[test]
    #[ignore]
    fn lookup_live() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let r = rt.block_on(crate::lookup::lookup("Dr. Peacock"));
        for k in ["spotify", "instagram", "soundcloud", "deezer"] {
            let l = r[k].as_array().cloned().unwrap_or_default();
            println!("{k}: {} -> {:?}", l.len(), l.iter().take(2).map(|x| (x["name"].clone(), x["stat"].clone())).collect::<Vec<_>>());
        }
        println!("extra: {}", r["extra"]);
    }
}
