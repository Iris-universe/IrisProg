// Appels WebView2 directs : exécuter un script et récupérer son résultat (Outlook intégré), imprimer en PDF (exports).
use serde_json::Value;
use std::time::Duration;
use tauri::Webview;
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::{ExecuteScriptCompletedHandler, PrintToPdfCompletedHandler};
use windows::core::{Interface, HSTRING};

/// Exécute `js` dans la webview et renvoie sa valeur (JSON). Les promesses ne sont pas attendues.
pub async fn eval(wv: &Webview, js: &str) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let js = js.to_string();
    wv.with_webview(move |p| unsafe {
        let run = || -> windows::core::Result<()> {
            let core = p.controller().CoreWebView2()?;
            let tx = std::sync::Mutex::new(Some(tx));
            core.ExecuteScript(
                &HSTRING::from(js),
                &ExecuteScriptCompletedHandler::create(Box::new(move |err, res| {
                    if let Some(t) = tx.lock().unwrap().take() {
                        let _ = t.send(err.map(|_| res).map_err(|e| e.message().to_string()));
                    }
                    Ok(())
                })),
            )
        };
        let _ = run();
    })
    .map_err(|e| e.to_string())?;
    let raw = tokio::time::timeout(Duration::from_secs(20), rx).await.map_err(|_| "La page ne répond pas.".to_string())?.map_err(|_| "Script interrompu.".to_string())??;
    Ok(serde_json::from_str(&raw).unwrap_or(Value::Null))
}

/// Imprime la page en PDF (A4, sans marges, avec les fonds).
pub async fn print_pdf(wv: &Webview, path: &std::path::Path, landscape: bool) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<bool, String>>();
    let path = path.to_string_lossy().to_string();
    wv.with_webview(move |p| unsafe {
        let tx = std::sync::Mutex::new(Some(tx));
        let run = || -> windows::core::Result<()> {
            let core: ICoreWebView2_7 = p.controller().CoreWebView2()?.cast()?;
            let env: ICoreWebView2Environment6 = p.environment().cast()?;
            let st = env.CreatePrintSettings()?;
            st.SetOrientation(if landscape { COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE } else { COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT })?;
            st.SetPageWidth(8.27)?;
            st.SetPageHeight(11.69)?;
            for f in [ICoreWebView2PrintSettings::SetMarginTop, ICoreWebView2PrintSettings::SetMarginBottom, ICoreWebView2PrintSettings::SetMarginLeft, ICoreWebView2PrintSettings::SetMarginRight] {
                f(&st, 0.0)?;
            }
            st.SetShouldPrintBackgrounds(true)?;
            st.SetShouldPrintHeaderAndFooter(false)?;
            let tx2 = std::sync::Mutex::new(tx.lock().unwrap().take());
            core.PrintToPdf(
                &HSTRING::from(path),
                &st,
                &PrintToPdfCompletedHandler::create(Box::new(move |err, ok| {
                    if let Some(t) = tx2.lock().unwrap().take() {
                        let _ = t.send(err.map(|_| ok).map_err(|e| e.message().to_string()));
                    }
                    Ok(())
                })),
            )
        };
        if let Err(e) = run() {
            if let Some(t) = tx.lock().unwrap().take() {
                let _ = t.send(Err(e.message().to_string()));
            }
        }
    })
    .map_err(|e| e.to_string())?;
    match tokio::time::timeout(Duration::from_secs(60), rx).await {
        Ok(Ok(Ok(true))) => Ok(()),
        Ok(Ok(Ok(false))) => Err("L'impression PDF a échoué.".into()),
        Ok(Ok(Err(e))) => Err(e),
        _ => Err("L'impression PDF ne répond pas.".into()),
    }
}
