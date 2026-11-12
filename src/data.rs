// Données de l'app : %APPDATA%\IrisProg\data.json (+ une sauvegarde par jour, 30 gardées).
// Au premier lancement, reprise facultative des données d'une ancienne version Electron : le dossier à reprendre
// (nom dans %APPDATA% ou chemin complet) est écrit dans %APPDATA%\IrisProg\import-from.txt.
use crate::secrets;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const APP: &str = "IrisProg";

pub fn dir() -> PathBuf {
    iris_store::data_dir(APP)
}
pub fn data_file() -> PathBuf {
    dir().join("data.json")
}
fn backup_dir() -> PathBuf {
    dir().join("sauvegardes")
}
pub fn mail_dir() -> PathBuf {
    dir().join("mail")
}
pub fn keys_file() -> PathBuf {
    dir().join("api-keys.json")
}

pub fn load() -> Option<Value> {
    iris_store::read_json(&data_file())
}

pub fn save(v: &Value) -> Result<Value, String> {
    let f = data_file();
    // compact (comme avant) : le fichier peut contenir des photos en data URL
    std::fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
    let tmp = f.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string(v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &f).map_err(|e| e.to_string())?;
    let bd = backup_dir();
    let _ = std::fs::create_dir_all(&bd);
    let bk = bd.join(format!("irisprog-{}.json", chrono::Local::now().format("%Y-%m-%d")));
    if !bk.exists() {
        let _ = std::fs::copy(&f, &bk);
        let mut all: Vec<_> = std::fs::read_dir(&bd)
            .map(|r| r.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")).collect())
            .unwrap_or_default();
        all.sort();
        let n = all.len().saturating_sub(30);
        for p in &all[..n] {
            let _ = std::fs::remove_file(p);
        }
    }
    Ok(json!({ "ok": true }))
}

/// Nom de l'édition en cours (réglages), pour les textes donnés à l'assistant.
pub fn edition() -> String {
    load()
        .and_then(|d| d["settings"]["edition"].as_str().map(String::from))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "du festival".into())
}

// ------------------------------------------------------------ reprise de l'ancienne version
fn copy_dir(from: &Path, to: &Path) {
    let Ok(rd) = std::fs::read_dir(from) else { return };
    let _ = std::fs::create_dir_all(to);
    for e in rd.flatten() {
        let p = e.path();
        let t = to.join(e.file_name());
        if p.is_dir() {
            copy_dir(&p, &t);
        } else if !t.exists() {
            let _ = std::fs::copy(&p, &t);
        }
    }
}

/// Dossier de l'ancienne version à reprendre (`import-from.txt`), s'il existe.
pub fn import_source() -> Option<PathBuf> {
    let name = std::fs::read_to_string(dir().join("import-from.txt")).ok()?.trim().to_string();
    if name.is_empty() {
        return None;
    }
    let p = PathBuf::from(&name);
    let p = if p.is_absolute() { p } else { dirs::config_dir()?.join(name) };
    p.is_dir().then_some(p)
}

/// Renvoie un résumé de ce qui a été repris (None si rien à faire).
pub fn migrate() -> Option<Value> {
    if data_file().exists() {
        return None;
    }
    let old = import_source()?;
    // fichier de données de l'ancienne version : <nom>-data.json
    let old_data = std::fs::read_dir(&old).ok()?.flatten().map(|e| e.path()).find(|p| p.to_string_lossy().ends_with("-data.json"))?;
    let _ = std::fs::create_dir_all(dir());
    std::fs::copy(&old_data, data_file()).ok()?;
    copy_dir(&old.join("sauvegardes"), &backup_dir());
    copy_dir(&old.join("mail"), &mail_dir());
    let key = secrets::electron_key(&old);
    let dec = |v: &Value| -> String {
        match (&key, v.as_str()) {
            (Some(k), Some(s)) if !s.is_empty() => secrets::electron_decrypt(k, s),
            _ => String::new(),
        }
    };
    // compte mail : secrets rechiffrés
    let acc_f = mail_dir().join("account.json");
    let mut mail_ok = false;
    if let Some(mut acc) = iris_store::read_json(&acc_f) {
        let pass = dec(&acc["passEnc"]);
        let refresh = dec(&acc["refreshEnc"]);
        mail_ok = !pass.is_empty() || !refresh.is_empty();
        acc["passEnc"] = json!(secrets::protect(&pass));
        acc["refreshEnc"] = json!(secrets::protect(&refresh));
        let _ = iris_store::write_json(&acc_f, &acc);
    }
    // clés d'API
    let mut keys = 0;
    if let Some(Value::Object(m)) = iris_store::read_json(&old.join("api-keys.json")) {
        let out: serde_json::Map<String, Value> = m
            .iter()
            .map(|(k, v)| {
                let s = dec(v);
                if !s.is_empty() {
                    keys += 1;
                }
                (k.clone(), json!(secrets::protect(&s)))
            })
            .collect();
        let _ = iris_store::write_json(&keys_file(), &Value::Object(out));
    }
    Some(json!({ "from": old.to_string_lossy(), "mailSecrets": mail_ok, "apiKeys": keys }))
}
