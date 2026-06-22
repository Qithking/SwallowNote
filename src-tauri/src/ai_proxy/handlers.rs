use axum::{
    extract::State,
    response::{
        sse::{Event, KeepAlive},
        IntoResponse, Sse,
    },
    Json,
};
use futures::stream::StreamExt;
use serde_json::{json, Value};
use std::convert::Infallible;
use std::sync::Arc;

use crate::ai_proxy::{
    get_provider_base_url, get_provider_models, AiProxyState, ModelInfo,
};

pub async fn chat_handler(
    State(state): State<Arc<AiProxyState>>,
    Json(req): Json<Value>,
) -> impl IntoResponse {
    let settings = state.settings.read().await.clone();

    if settings.provider.is_empty() {
        let stream = futures::stream::once(async move {
            Ok(Event::default().data(json!({"type":"error","errorText":"AI provider not configured"}).to_string()))
        }).boxed();
        return Sse::new(stream).keep_alive(KeepAlive::default());
    }

    let base_url = get_provider_base_url(&settings.provider, &settings.base_url);

    let messages_val = req.get("messages").cloned().unwrap_or(json!([]));
    let model_from_req = req.get("model").and_then(|m| m.as_str());
    let system_prompt = req.get("systemPrompt").and_then(|s| s.as_str()).unwrap_or("").to_string();

    let model = model_from_req
        .map(|s| s.to_string())
        .unwrap_or(settings.model.clone());

    let msg_id = uuid::Uuid::new_v4().to_string();

    let (url, payload, auth_header) = match settings.provider.as_str() {
        "anthropic" => {
            let url = format!("{}/messages", base_url);
            let messages: Vec<Value> = messages_val
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter(|m| m.get("role").and_then(|r| r.as_str()) != Some("system"))
                        .map(|m| json!({"role": m["role"], "content": m["content"]}))
                        .collect()
                })
                .unwrap_or_default();
            let mut system_msg: Vec<Value> = messages_val
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter(|m| m.get("role").and_then(|r| r.as_str()) == Some("system"))
                        .map(|m| json!({"type": "text", "text": m["content"]}))
                        .collect()
                })
                .unwrap_or_default();
            // Inject systemPrompt from request body if present
            if !system_prompt.is_empty() {
                system_msg.insert(0, json!({"type": "text", "text": system_prompt}));
            }
            let mut payload = json!({
                "model": model,
                "messages": messages,
                "stream": true,
                "max_tokens": 8192,
            });
            if !system_msg.is_empty() {
                payload["system"] = json!(system_msg);
            }
            (url, payload, format!("x-api-key: {}", settings.api_key))
        }
        "google" => {
            let url = format!(
                "{}/models/{}:streamGenerateContent?alt=sse",
                base_url, model
            );
            let contents: Vec<Value> = messages_val
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .map(|m| {
                            let role = if m.get("role").and_then(|r| r.as_str()) == Some("assistant") {
                                "model"
                            } else {
                                "user"
                            };
                            let text = m.get("parts")
                                .and_then(|p| p.as_array())
                                .map(|parts| {
                                    parts.iter()
                                        .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                                        .collect::<Vec<_>>()
                                        .join("")
                                })
                                .unwrap_or_else(|| {
                                    m.get("content").and_then(|c| c.as_str()).unwrap_or("").to_string()
                                });
                            json!({
                                "role": role,
                                "parts": [{"text": text}]
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            let mut payload = json!({"contents": contents});
            // Inject systemPrompt from request body if present
            if !system_prompt.is_empty() {
                payload["systemInstruction"] = json!({"parts": [{"text": system_prompt}]});
            }
            (
                url,
                payload,
                format!("x-goog-api-key: {}", settings.api_key),
            )
        }
        _ => {
            let url = format!("{}/chat/completions", base_url);
            let mut messages: Vec<Value> = messages_val
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .map(|m| {
                            let content = m.get("parts")
                                .and_then(|p| p.as_array())
                                .map(|parts| {
                                    parts.iter()
                                        .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                                        .collect::<Vec<_>>()
                                        .join("")
                                })
                                .unwrap_or_else(|| {
                                    m.get("content").and_then(|c| c.as_str()).unwrap_or("").to_string()
                                });
                            json!({"role": m["role"], "content": content})
                        })
                        .collect()
                })
                .unwrap_or_default();
            // Inject systemPrompt from request body if present
            if !system_prompt.is_empty() {
                messages.insert(0, json!({"role": "system", "content": system_prompt}));
            }
            let payload = json!({
                "model": model,
                "messages": messages,
                "stream": true,
            });
            (
                url,
                payload,
                format!("Authorization: Bearer {}", settings.api_key),
            )
        }
    };

    let client = state.client.clone();
    let mut request_builder = client.post(&url).json(&payload);

    let parts: Vec<&str> = auth_header.splitn(2, ": ").collect();
    if parts.len() == 2 {
        request_builder = request_builder.header(parts[0], parts[1]);
    }

    if settings.provider == "anthropic" {
        request_builder = request_builder
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json");
    }

    let response = match request_builder.send().await {
        Ok(r) => r,
        Err(e) => {
            let stream = futures::stream::once(async move {
                Ok(Event::default().data(json!({"type":"error","errorText":format!("Request failed: {}", e)}).to_string()))
            }).boxed();
            return Sse::new(stream).keep_alive(KeepAlive::default());
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let stream = futures::stream::once(async move {
            Ok(Event::default().data(json!({"type":"error","errorText":format!("API error {}: {}", status, body)}).to_string()))
        }).boxed();
        return Sse::new(stream).keep_alive(KeepAlive::default());
    }

    let provider = settings.provider.clone();
    let text_id = msg_id;
    let mut started = false;
    let mut finished = false;

    let stream = response.bytes_stream().map(move |chunk_result| {
        let chunk = match chunk_result {
            Ok(c) => c,
            Err(e) => {
                let err_data = json!({"type":"error","errorText": e.to_string()}).to_string();
                return vec![Ok::<_, Infallible>(Event::default().data(err_data))];
            }
        };

        let text = String::from_utf8_lossy(&chunk);
        let mut events: Vec<Result<Event, Infallible>> = Vec::new();

        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || !line.starts_with("data:") {
                continue;
            }
            let data = line.strip_prefix("data:").unwrap().trim();

            if data == "[DONE]" {
                if !finished {
                    events.push(Ok(Event::default().data(json!({"type":"text-end","id":text_id}).to_string())));
                    events.push(Ok(Event::default().data(json!({"type":"finish","finishReason":"stop"}).to_string())));
                    finished = true;
                }
                continue;
            }

            let parsed: Result<Value, _> = serde_json::from_str(data);
            if let Ok(json_val) = parsed {
                if !started {
                    events.push(Ok(Event::default().data(json!({"type":"start","messageId":text_id}).to_string())));
                    events.push(Ok(Event::default().data(json!({"type":"text-start","id":text_id}).to_string())));
                    started = true;
                }

                let delta_text = match provider.as_str() {
                    "anthropic" => extract_anthropic_delta(&json_val),
                    "google" => extract_google_delta(&json_val),
                    _ => extract_openai_delta(&json_val),
                };

                if let Some(delta) = delta_text {
                    if !delta.is_empty() {
                        events.push(Ok(Event::default().data(json!({"type":"text-delta","id":text_id,"delta":delta}).to_string())));
                    }
                }

                let is_stop = match provider.as_str() {
                    "anthropic" => json_val.get("type").and_then(|t| t.as_str()) == Some("message_stop"),
                    "google" => json_val.pointer("/candidates/0/finishReason").is_some(),
                    _ => json_val.get("choices")
                        .and_then(|c| c.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|c| c.get("finish_reason"))
                        .and_then(|r| r.as_str())
                        .map(|r| r != "null" && !r.is_empty())
                        .unwrap_or(false),
                };

                if is_stop && !finished {
                    events.push(Ok(Event::default().data(json!({"type":"text-end","id":text_id}).to_string())));
                    events.push(Ok(Event::default().data(json!({"type":"finish","finishReason":"stop"}).to_string())));
                    finished = true;
                }
            }
        }

        events
    }).flat_map(futures::stream::iter).boxed();

    Sse::new(stream).keep_alive(KeepAlive::default())
}

fn extract_openai_delta(val: &Value) -> Option<String> {
    val.get("choices")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|c| c.get("delta"))
        .and_then(|d| d.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
}

fn extract_anthropic_delta(val: &Value) -> Option<String> {
    match val.get("type").and_then(|t| t.as_str()) {
        Some("content_block_delta") => {
            val.pointer("/delta/text")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
        }
        _ => None,
    }
}

fn extract_google_delta(val: &Value) -> Option<String> {
    val.pointer("/candidates/0/content/parts/0/text")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
}

pub async fn models_handler(
    State(state): State<Arc<AiProxyState>>,
) -> Json<Vec<ModelInfo>> {
    let settings = state.settings.read().await;
    let models = get_provider_models(&settings.provider);
    Json(models)
}

pub async fn settings_handler(
    State(state): State<Arc<AiProxyState>>,
    Json(update): Json<crate::ai_proxy::AiSettingsUpdate>,
) -> Json<Value> {
    let mut settings = state.settings.write().await;
    if let Some(provider) = update.provider {
        settings.provider = provider;
    }
    if let Some(api_key) = update.api_key {
        settings.api_key = api_key;
    }
    if let Some(base_url) = update.base_url {
        settings.base_url = base_url;
    }
    if let Some(model) = update.model {
        settings.model = model;
    }
    if let Some(port) = update.port {
        settings.port = port;
    }
    Json(json!({"success": true}))
}
