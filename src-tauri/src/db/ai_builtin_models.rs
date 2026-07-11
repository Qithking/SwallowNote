use crate::ai_proxy::crypto;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use once_cell::sync::OnceCell;
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

/// 缓存加密后的内置模型列表，避免每次调用都重新执行 xor_decode + AES 加密。
/// 加密 key 依赖 machine id，在进程生命周期内稳定，因此结果可安全缓存复用。
static BUILTIN_MODELS: OnceCell<Vec<BuiltinAiModel>> = OnceCell::new();

pub fn get_builtin_models() -> Vec<BuiltinAiModel> {
    BUILTIN_MODELS
        .get_or_init(|| {
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
        })
        .clone()
}
