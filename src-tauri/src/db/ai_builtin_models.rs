use crate::ai_proxy::crypto;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;

const BUILTIN_XOR_KEY: &[u8] = b"SwallowNote-Builtin-2024";

const OBFUSCATED_API_KEY: &str = "IBxMCgoCBigEFQlJKRkEHQwBG15WQ0BTJAYLFBkZBjgMBwBaIwYKGx0fDFpVXEBQIQcE";

fn xor_decode(encoded: &str) -> String {
    let bytes = BASE64.decode(encoded).unwrap_or_default();
    let decoded: Vec<u8> = bytes
        .iter()
        .enumerate()
        .map(|(i, &b)| b ^ BUILTIN_XOR_KEY[i % BUILTIN_XOR_KEY.len()])
        .collect();
    String::from_utf8(decoded).unwrap_or_default()
}

#[derive(Debug, Serialize, Clone)]
pub struct BuiltinAiModel {
    pub id: String,
    pub name: String,
    pub category: String,
    pub provider: String,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub is_built_in: bool,
}

pub fn get_builtin_models() -> Vec<BuiltinAiModel> {
    let raw_key = xor_decode(OBFUSCATED_API_KEY);
    let encrypted_key = crypto::encrypt_api_key(&raw_key).unwrap_or_default();

    vec![
        BuiltinAiModel {
            id: "builtin-siliconflow-qwen3-8b".to_string(),
            name: "Qwen3-8B".to_string(),
            category: "api".to_string(),
            provider: "siliconflow".to_string(),
            api_key: encrypted_key,
            base_url: "https://api.siliconflow.cn/v1".to_string(),
            model: "Qwen/Qwen3-8B".to_string(),
            is_built_in: true,
        },
    ]
}
