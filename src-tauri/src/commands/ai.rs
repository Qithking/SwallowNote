use crate::ai_proxy::crypto;
use crate::ai_proxy::server::{start_ai_proxy, AiProxyServer};
use crate::ai_proxy::AiSettings;
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct AiProxyStateHolder {
    pub server: Mutex<Option<AiProxyServer>>,
}

pub type SharedAiProxyState = Arc<AiProxyStateHolder>;

pub fn new_shared_ai_proxy_state() -> SharedAiProxyState {
    Arc::new(AiProxyStateHolder {
        server: Mutex::new(None),
    })
}

#[tauri::command]
pub fn encrypt_api_key(plaintext: String) -> Result<String, String> {
    crypto::encrypt_api_key(&plaintext)
}

#[tauri::command]
pub fn decrypt_api_key(encrypted: String) -> Result<String, String> {
    crypto::decrypt_api_key(&encrypted)
}

#[tauri::command]
pub async fn start_ai_proxy_cmd(
    holder: State<'_, SharedAiProxyState>,
    provider: String,
    api_key: String,
    base_url: String,
    model: String,
    port: u16,
) -> Result<u16, String> {
    let settings = AiSettings {
        provider,
        api_key,
        base_url,
        model,
        port,
    };

    let server = start_ai_proxy(settings).await?;

    let actual_port = server.port;
    let mut guard = holder.server.lock().unwrap();
    *guard = Some(server);

    Ok(actual_port)
}

#[tauri::command]
pub fn stop_ai_proxy(holder: State<'_, SharedAiProxyState>) -> Result<(), String> {
    let mut guard = holder.server.lock().unwrap();
    if let Some(server) = guard.take() {
        let _ = server.shutdown_tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn restart_ai_proxy_cmd(
    holder: State<'_, SharedAiProxyState>,
    provider: String,
    api_key: String,
    base_url: String,
    model: String,
    port: u16,
) -> Result<u16, String> {
    let old_server = {
        let mut guard = holder.server.lock().unwrap();
        guard.take()
    };
    if let Some(server) = old_server {
        let _ = server.shutdown_tx.send(());
        let _ = server.shutdown_handle.await;
    }

    let settings = AiSettings {
        provider,
        api_key,
        base_url,
        model,
        port,
    };

    let server = start_ai_proxy(settings).await?;

    let actual_port = server.port;
    let mut guard = holder.server.lock().unwrap();
    *guard = Some(server);

    Ok(actual_port)
}

#[tauri::command]
pub async fn test_ai_model_cmd(
    provider: String,
    api_key: String,
    base_url: String,
    model: String,
    port: u16,
) -> Result<String, String> {
    use reqwest::Client;
    use serde_json::json;

    let client = Client::new();
    let url = format!("http://127.0.0.1:{}/api/chat", port);

    let body = json!({
        "messages": [{"role": "user", "content": "Hi"}],
        "provider": provider,
        "apiKey": api_key,
        "baseUrl": base_url,
        "model": model,
    });

    let resp = client
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    if resp.status().is_success() {
        Ok("ok".to_string())
    } else {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(format!("HTTP {}: {}", status, text))
    }
}
