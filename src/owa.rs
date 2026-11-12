// Outlook intégré : Outlook Web dans une webview enfant de la fenêtre principale (session gardée dans %APPDATA%\IrisProg\outlook).
// L'interface envoie la position de son cadre (#owa-frame) ; la webview est cachée quand une fenêtre de l'app passe par-dessus.
use crate::data;
use regex::Regex;
use serde_json::{json, Value};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Rect, Webview, WebviewUrl};

const LABEL: &str = "owa";

fn ms_host(u: &url::Url) -> bool {
    let h = u.host_str().unwrap_or("");
    Regex::new(r"(?i)(^|\.)(microsoft|microsoftonline|office|office365|live|outlook|msauth|msftauth|msauthimages|sharepoint|onedrive|windows|azure|bing|skype|msidentity|aadcdn)\.(com|net)$|(^|\.)cloud\.microsoft$")
        .unwrap()
        .is_match(h)
}

fn get(app: &AppHandle) -> Option<Webview> {
    app.get_webview(LABEL)
}
fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
    Rect { position: LogicalPosition::new(x, y).into(), size: LogicalSize::new(w.max(1.0), h.max(1.0)).into() }
}

pub fn show(app: &AppHandle, url: &str, x: f64, y: f64, w: f64, h: f64) -> Result<Value, String> {
    if let Some(wv) = get(app) {
        let _ = wv.set_bounds(rect(x, y, w, h));
        let _ = wv.show();
        return Ok(json!({ "ok": true }));
    }
    let win = app.get_window("main").ok_or("fenêtre fermée")?;
    let u: url::Url = url.parse().map_err(|_| "Adresse Outlook invalide")?;
    let b = tauri::webview::WebviewBuilder::new(LABEL, WebviewUrl::External(u))
        .data_directory(data::dir().join("outlook"))
        .on_new_window(|u, _| {
            if u.as_str() == "about:blank" || ms_host(&u) {
                tauri::webview::NewWindowResponse::Allow
            } else {
                if matches!(u.scheme(), "http" | "https" | "mailto" | "tel") {
                    crate::open_external(u.as_str());
                }
                tauri::webview::NewWindowResponse::Deny
            }
        });
    win.add_child(b, LogicalPosition::new(x, y), LogicalSize::new(w.max(1.0), h.max(1.0))).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

pub fn bounds(app: &AppHandle, x: f64, y: f64, w: f64, h: f64) {
    if let Some(wv) = get(app) {
        let _ = wv.set_bounds(rect(x, y, w, h));
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(wv) = get(app) {
        let _ = wv.hide();
    }
}

pub fn nav(app: &AppHandle, action: &str, url: Option<&str>) -> Value {
    let Some(wv) = get(app) else { return json!({ "error": "Outlook n'est pas ouvert." }) };
    match action {
        "back" => {
            let _ = wv.eval("history.back()");
        }
        "reload" => {
            let _ = wv.reload();
        }
        _ => {
            if let Some(u) = url.and_then(|u| u.parse().ok()) {
                let _ = wv.navigate(u);
            }
        }
    }
    json!({ "ok": true })
}

/// Exécute un script dans Outlook et renvoie sa valeur.
pub async fn read(app: &AppHandle, js: &str) -> Value {
    let Some(wv) = get(app) else { return json!({ "error": "Outlook n'est pas ouvert." }) };
    match crate::wv2::eval(&wv, js).await {
        Ok(v) => json!({ "value": v }),
        Err(e) => json!({ "error": format!("Impossible de lire Outlook : {e}") }),
    }
}

pub fn clear(app: &AppHandle, home: Option<&str>) -> Value {
    if let Some(wv) = get(app) {
        let _ = wv.clear_all_browsing_data();
        if let Some(u) = home.and_then(|u| u.parse().ok()) {
            let _ = wv.navigate(u);
        }
    } else {
        let _ = std::fs::remove_dir_all(data::dir().join("outlook"));
    }
    json!({ "ok": true })
}
