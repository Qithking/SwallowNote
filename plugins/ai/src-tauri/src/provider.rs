//! 三家 LLM Provider 的流式请求载荷构造。
//!
//! 自主应用 `ai_proxy/handlers.rs` 平移（原实现零测试，本文件补齐单测）。
//! 与原实现的差异（P2.4 决策「systemPrompt 改走标准 system 消息」）：
//! system 内容从 messages 中的 role=system 消息提取，按 Provider 语义转换，
//! 不再读取非标 `systemPrompt` body 字段。

use serde_json::{json, Value};

/// Provider 端点配置。P2.2 阶段由 streamChat 请求参数直传；
/// P2.3 数据层就绪后改由后端从 ai_models / secureStorage 读取。
#[derive(Debug, Clone)]
pub struct ProviderConfig {
    /// "anthropic" | "google" | 其他值一律按 OpenAI 兼容协议处理（与内置实现一致）
    pub provider: String,
    pub model_id: String,
    /// 自定义 base_url；空串时按 Provider 回退默认地址
    pub base_url: String,
    pub api_key: String,
}

/// 构造完成的 HTTP 请求（URL + JSON body 字符串 + 请求头）。
#[derive(Debug, Clone, PartialEq)]
pub struct BuiltRequest {
    pub url: String,
    pub body: String,
    pub headers: Vec<(String, String)>,
}

/// 从消息 JSON 提取纯文本：兼容 AI SDK 的 parts 数组与字符串 content 两种形状。
fn extract_text(m: &Value) -> String {
    if let Some(parts) = m.get("parts").and_then(|p| p.as_array()) {
        return parts
            .iter()
            .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
            .collect();
    }
    m.get("content")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string()
}

/// 解析 base_url：自定义优先，空时按 Provider 回退默认地址（自 ai_proxy/mod.rs 平移）。
pub fn resolve_base_url(provider: &str, custom_url: &str) -> String {
    if !custom_url.is_empty() {
        return custom_url.trim_end_matches('/').to_string();
    }
    match provider {
        "openai" => "https://api.openai.com/v1".to_string(),
        "anthropic" => "https://api.anthropic.com/v1".to_string(),
        "google" => "https://generativelanguage.googleapis.com/v1beta".to_string(),
        "deepseek" => "https://api.deepseek.com/v1".to_string(),
        "ollama" => "http://localhost:11434/v1".to_string(),
        _ => String::new(),
    }
}

fn role_of(m: &Value) -> &str {
    m.get("role").and_then(|r| r.as_str()).unwrap_or("")
}

/// 按三家协议构造流式请求载荷。未知 provider 一律走 OpenAI 兼容分支（与内置实现一致）。
pub fn build_request(cfg: &ProviderConfig, messages: &[Value]) -> BuiltRequest {
    let base = resolve_base_url(&cfg.provider, &cfg.base_url);
    match cfg.provider.as_str() {
        "anthropic" => {
            // system 消息提取为 text 块（保持出现顺序），其余消息过滤透传
            let mut system: Vec<Value> = Vec::new();
            let mut chat: Vec<Value> = Vec::new();
            for m in messages {
                if role_of(m) == "system" {
                    system.push(json!({"type": "text", "text": extract_text(m)}));
                } else {
                    chat.push(json!({"role": m["role"], "content": extract_text(m)}));
                }
            }
            let mut payload = json!({
                "model": cfg.model_id,
                "messages": chat,
                "stream": true,
                "max_tokens": 8192,
            });
            if !system.is_empty() {
                payload["system"] = json!(system);
            }
            BuiltRequest {
                url: format!("{}/messages", base),
                body: serde_json::to_string(&payload).unwrap(),
                headers: vec![
                    ("x-api-key".to_string(), cfg.api_key.clone()),
                    ("anthropic-version".to_string(), "2023-06-01".to_string()),
                    ("content-type".to_string(), "application/json".to_string()),
                ],
            }
        }
        "google" => {
            // system 消息合并为单条 systemInstruction；assistant 映射为 model 角色
            let mut system_texts: Vec<String> = Vec::new();
            let mut contents: Vec<Value> = Vec::new();
            for m in messages {
                let text = extract_text(m);
                if role_of(m) == "system" {
                    system_texts.push(text);
                } else {
                    let role = if role_of(m) == "assistant" { "model" } else { "user" };
                    contents.push(json!({"role": role, "parts": [{"text": text}]}));
                }
            }
            let mut payload = json!({ "contents": contents });
            if !system_texts.is_empty() {
                payload["systemInstruction"] = json!({"parts": [{"text": system_texts.join("\n\n")}]});
            }
            BuiltRequest {
                url: format!("{}/models/{}:streamGenerateContent?alt=sse", base, cfg.model_id),
                body: serde_json::to_string(&payload).unwrap(),
                headers: vec![("x-goog-api-key".to_string(), cfg.api_key.clone())],
            }
        }
        _ => {
            // OpenAI 兼容协议：system 消息原位保留在 messages 数组中
            let msgs: Vec<Value> = messages
                .iter()
                .map(|m| json!({"role": m["role"], "content": extract_text(m)}))
                .collect();
            let payload = json!({
                "model": cfg.model_id,
                "messages": msgs,
                "stream": true,
            });
            BuiltRequest {
                url: format!("{}/chat/completions", base),
                body: serde_json::to_string(&payload).unwrap(),
                headers: vec![(
                    "Authorization".to_string(),
                    format!("Bearer {}", cfg.api_key),
                )],
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(provider: &str) -> ProviderConfig {
        ProviderConfig {
            provider: provider.into(),
            model_id: "test-model".into(),
            base_url: String::new(),
            api_key: "sk-test".into(),
        }
    }

    /// system 消息提取为 system 块（保持出现顺序）、非 system 消息过滤透传、
    /// max_tokens/stream/认证头齐备；无 system 消息时 body 不含 system 键。
    #[test]
    fn anthropic_extracts_system_and_filters_messages() {
        let messages = vec![
            json!({"role": "system", "content": "全局提示"}),
            json!({"role": "system", "content": "角色提示"}),
            json!({"role": "user", "content": "你好"}),
            json!({"role": "assistant", "content": "回复"}),
        ];
        let req = build_request(&cfg("anthropic"), &messages);
        assert_eq!(req.url, "https://api.anthropic.com/v1/messages");

        let body: Value = serde_json::from_str(&req.body).unwrap();
        assert_eq!(body["model"], "test-model");
        assert_eq!(body["stream"], true);
        assert_eq!(body["max_tokens"], 8192);
        assert_eq!(
            body["system"],
            json!([
                {"type": "text", "text": "全局提示"},
                {"type": "text", "text": "角色提示"},
            ])
        );
        assert_eq!(
            body["messages"],
            json!([
                {"role": "user", "content": "你好"},
                {"role": "assistant", "content": "回复"},
            ])
        );

        assert!(req.headers.contains(&("x-api-key".into(), "sk-test".into())));
        assert!(req.headers.contains(&("anthropic-version".into(), "2023-06-01".into())));
    }

    /// parts 数组形状的 content 也能正确提取；自定义 base_url 生效（尾斜杠去除）。
    #[test]
    fn anthropic_supports_parts_and_custom_base_url() {
        let mut c = cfg("anthropic");
        c.base_url = "https://relay.example.com/v1/".into();
        let messages = vec![
            json!({"role": "user", "parts": [
                {"type": "text", "text": "第一段"},
                {"type": "text", "text": "第二段"},
            ]}),
        ];
        let req = build_request(&c, &messages);
        assert_eq!(req.url, "https://relay.example.com/v1/messages");
        let body: Value = serde_json::from_str(&req.body).unwrap();
        assert_eq!(body["messages"][0]["content"], "第一段第二段");
        assert!(body.get("system").is_none());
    }

    /// assistant → model 角色映射、system 消息提取进 systemInstruction（多条合并）、认证头。
    #[test]
    fn google_maps_roles_and_system_instruction() {
        let messages = vec![
            json!({"role": "system", "content": "全局提示"}),
            json!({"role": "system", "content": "角色提示"}),
            json!({"role": "user", "content": "你好"}),
            json!({"role": "assistant", "content": "回复"}),
        ];
        let req = build_request(&cfg("google"), &messages);
        assert_eq!(
            req.url,
            "https://generativelanguage.googleapis.com/v1beta/models/test-model:streamGenerateContent?alt=sse"
        );
        let body: Value = serde_json::from_str(&req.body).unwrap();
        assert_eq!(
            body["contents"],
            json!([
                {"role": "user", "parts": [{"text": "你好"}]},
                {"role": "model", "parts": [{"text": "回复"}]},
            ])
        );
        assert_eq!(
            body["systemInstruction"],
            json!({"parts": [{"text": "全局提示\n\n角色提示"}]})
        );
        assert!(req.headers.contains(&("x-goog-api-key".into(), "sk-test".into())));
    }

    /// OpenAI 兼容分支：system 消息原位保留、parts 归一为 content、Bearer 认证。
    #[test]
    fn openai_compatible_keeps_system_inline() {
        let messages = vec![
            json!({"role": "system", "content": "全局提示"}),
            json!({"role": "user", "parts": [{"type": "text", "text": "你好"}]}),
        ];
        let req = build_request(&cfg("openai"), &messages);
        assert_eq!(req.url, "https://api.openai.com/v1/chat/completions");
        let body: Value = serde_json::from_str(&req.body).unwrap();
        assert_eq!(body["stream"], true);
        assert_eq!(
            body["messages"],
            json!([
                {"role": "system", "content": "全局提示"},
                {"role": "user", "content": "你好"},
            ])
        );
        assert!(req
            .headers
            .contains(&("Authorization".into(), "Bearer sk-test".into())));
    }

    /// 未知 provider（deepseek/ollama/custom 等）走 OpenAI 兼容协议与对应默认地址。
    #[test]
    fn unknown_provider_falls_back_to_openai_compatible() {
        let req = build_request(&cfg("deepseek"), &[json!({"role": "user", "content": "hi"})]);
        assert_eq!(req.url, "https://api.deepseek.com/v1/chat/completions");
        assert!(req
            .headers
            .contains(&("Authorization".into(), "Bearer sk-test".into())));
    }

    /// 默认地址表 + 自定义地址覆盖 + 尾斜杠裁剪。
    #[test]
    fn resolve_base_url_defaults_and_custom() {
        assert_eq!(resolve_base_url("openai", ""), "https://api.openai.com/v1");
        assert_eq!(resolve_base_url("anthropic", ""), "https://api.anthropic.com/v1");
        assert_eq!(
            resolve_base_url("google", ""),
            "https://generativelanguage.googleapis.com/v1beta"
        );
        assert_eq!(resolve_base_url("ollama", ""), "http://localhost:11434/v1");
        assert_eq!(resolve_base_url("openai", "https://x.io/v1/"), "https://x.io/v1");
        // custom / 未知 provider：无默认地址，custom_url 原样（去尾斜杠）
        assert_eq!(resolve_base_url("custom", "https://y.io/v1/"), "https://y.io/v1");
    }
}
