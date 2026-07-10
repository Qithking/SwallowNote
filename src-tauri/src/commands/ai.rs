use crate::ai_proxy::crypto;
use crate::ai_proxy::server::{start_ai_proxy, AiProxyServer};
use crate::ai_proxy::AiSettings;
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct AiProxyStateHolder {
    pub server: Mutex<Option<AiProxyServer>>,
    /// 共享的 reqwest::Client，供 test_ai_model_cmd 等命令复用，
    /// 避免每次连通性测试都新建 Client（含连接池/TLS 初始化开销）。
    /// reqwest::Client 内部基于 Arc，clone 廉价。
    pub client: reqwest::Client,
}

pub type SharedAiProxyState = Arc<AiProxyStateHolder>;

pub fn new_shared_ai_proxy_state() -> SharedAiProxyState {
    Arc::new(AiProxyStateHolder {
        server: Mutex::new(None),
        // 应用启动时构造一次共享 Client；reqwest::Client 内部基于 Arc，clone 廉价
        client: reqwest::Client::new(),
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
    let mut guard = holder.server.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(server);

    Ok(actual_port)
}

#[tauri::command]
pub fn stop_ai_proxy(holder: State<'_, SharedAiProxyState>) -> Result<(), String> {
    let mut guard = holder.server.lock().unwrap_or_else(|e| e.into_inner());
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
        let mut guard = holder.server.lock().unwrap_or_else(|e| e.into_inner());
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
    let mut guard = holder.server.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(server);

    Ok(actual_port)
}

#[tauri::command]
pub async fn test_ai_model_cmd(
    holder: State<'_, SharedAiProxyState>,
    provider: String,
    api_key: String,
    base_url: String,
    model: String,
    _port: u16,
) -> Result<String, String> {
    use crate::ai_proxy::get_provider_base_url;
    use serde_json::json;

    // 复用 state 中共享的 reqwest::Client，避免每次测试连通性都新建 Client
    // （reqwest::Client 内部基于 Arc，clone 廉价，可共享连接池）
    let client = holder.client.clone();
    let resolved_base = get_provider_base_url(&provider, &base_url);
    let test_message = "hi";

    // 根据不同 Provider 直接调用对应端点进行连通性测试，
    // 避免经过本地代理（代理仅持有当前激活的 settings，无法反映传入参数）。
    let (_url, request) = match provider.as_str() {
        "anthropic" => {
            let url = format!("{}/messages", resolved_base);
            let body = json!({
                "model": model,
                "max_tokens": 1,
                "messages": [{"role": "user", "content": test_message}],
            });
            (url.clone(), client.post(&url).header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&body))
        }
        "google" => {
            let url = format!(
                "{}/models/{}:generateContent",
                resolved_base, model
            );
            let body = json!({
                "contents": [{"parts": [{"text": test_message}]}],
            });
            (url.clone(), client.post(&url)
                .header("x-goog-api-key", &api_key)
                .header("content-type", "application/json")
                .json(&body))
        }
        _ => {
            // OpenAI 兼容协议（openai/deepseek/ollama/siliconflow/custom）
            let url = format!("{}/chat/completions", resolved_base);
            let body = json!({
                "model": model,
                "messages": [{"role": "user", "content": test_message}],
                "max_tokens": 1,
                "stream": false,
            });
            let mut builder = client.post(&url)
                .header("content-type", "application/json")
                .json(&body);
            if !api_key.is_empty() {
                builder = builder.header("Authorization", format!("Bearer {}", api_key));
            }
            (url, builder)
        }
    };

    let resp = request
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
