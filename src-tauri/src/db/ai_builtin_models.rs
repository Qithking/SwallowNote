use crate::ai_proxy::crypto;
use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use once_cell::sync::OnceCell;
use serde::Serialize;
use sha2::{Digest, Sha256};

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

// 派生材料（3 个分散盐，组合后 SHA-256 派生 AES key）
// 由 examples/encrypt_builtin_key.rs 生成
const SALT_A: &[u8] = b"\xe1\xb7\xb8\x92M\x96A\x8f\x0e/\xb5\xd4\xce\x90\xc0\xbf";
const SALT_B: &[u8] = b"`\xaedQ\x91\xac|jA:\xdd\x90eyH\xab";
const SALT_C: &[u8] = b"\xa8n\x98V%\xeaL~\x92B\xa1\x0f_\x0cwf";

// AES-256-GCM 密文（base64 编码的 nonce[12] + ciphertext）
const ENCRYPTED_BUILTIN_KEY: &str = "hFsB4DnHLCWAoz5xL6YBBwzlANX6ZU1x43+9kfPSmLKqo3+ZI4hrVtdOSa5qwvoZ5T2fn4sfO0dUHsfGMXTRb7NXurhVfjxBV2mIYOK0PA==";

/// 缓存加密后的内置模型列表，避免每次调用都重新执行 AES 解密 + 加密。
static BUILTIN_MODELS: OnceCell<Vec<BuiltinAiModel>> = OnceCell::new();

fn derive_builtin_aes_key() -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(SALT_A);
    hasher.update(SALT_B);
    hasher.update(SALT_C);
    let result = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    key
}

/// 解密内置 key（AES-256-GCM，派生 key 从 3 个分散盐计算）。
/// 客户端持有 key 本质是混淆，非真正安全；逆向工程仍可提取。
/// 长期应迁移到服务端代理。
fn decrypt_builtin_key() -> Result<String, String> {
    let key = derive_builtin_aes_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;
    let combined = BASE64
        .decode(ENCRYPTED_BUILTIN_KEY)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;
    if combined.len() < 12 {
        return Err("Invalid encrypted data: too short".to_string());
    }
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))?;
    String::from_utf8(plaintext).map_err(|e| format!("UTF-8 decode failed: {}", e))
}

pub fn get_builtin_models() -> Vec<BuiltinAiModel> {
    BUILTIN_MODELS
        .get_or_init(|| {
            let raw_key = decrypt_builtin_key().unwrap_or_default();
            if raw_key.is_empty() {
                return vec![];
            }
            // 再用 machine-specific key 加密，与其他用户 key 格式一致
            let encrypted_key = crypto::encrypt_api_key(&raw_key).unwrap_or_default();

            // !!! 内置模型，禁止删除 !!!
            // 这是产品开箱即用的默认 AI 模型，删除会导致用户无法直接使用 AI 功能。
            // 如需调整内置模型列表，请联系维护者并更新 examples/encrypt_builtin_key.rs。
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decrypt_builtin_key_not_empty() {
        let key = decrypt_builtin_key();
        assert!(key.is_ok(), "decrypt_builtin_key should succeed: {:?}", key);
        assert!(!key.unwrap().is_empty(), "builtin key should not be empty");
    }
}
