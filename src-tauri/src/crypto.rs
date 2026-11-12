//! 平台级加密模块：API key / 插件敏感数据的 AES-256-GCM 加解密与密钥派生。
//!
//! 自 `ai_proxy/crypto.rs` 迁出为平台模块（P1.5 / ADR-0003），确保未来
//! 删除内置 AI 后加密能力仍保留。两部分派生：
//! - legacy（内置 AI 存量密文兼容）：`SHA-256(APP_SALT + machine_id + "SwallowNote-v1")`，
//!   派生输入与密文格式**字节级不可变**，否则存量 AI key 无法解密；
//! - 插件 secureStorage（ADR-0003）：`SHA-256(SECURE_STORAGE_SALT + machine_id + pluginId)`，
//!   同 key 名在不同插件下密钥不同（隔离）；换机器后旧密文不可解（符合预期）。
//!   派生签名变更属平台 API 破坏性变更，需新 ADR。

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// legacy 派生盐（仅存量内置 AI 密文使用，不可变更）
const APP_SALT: &[u8] = b"SwallowNote-AI-Key-Encryption-Salt-v1";

/// 插件 secureStorage 派生盐（平台 API，ADR-0003；变更需新 ADR）
const SECURE_STORAGE_SALT: &[u8] = b"SwallowNote-Secure-Storage-Salt-v1";

/// 无系统 ID 时的回退：PID + 纳秒 + 随机数
fn fallback_machine_id() -> String {
    let pid = std::process::id();
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let rnd: u64 = rand::random();
    format!("swallownote-fallback-{}-{}-{}", pid, ts, rnd)
}

/// 获取应用数据目录（跨平台）
fn get_app_data_dir() -> Option<std::path::PathBuf> {
    dirs::data_dir().map(|d| d.join("SwallowNote"))
}

/// 持久化 fallback machine id，确保 API key 跨重启解密
fn get_or_create_fallback_machine_id() -> String {
    let app_data_dir = match get_app_data_dir() {
        Some(dir) => dir,
        // 取不到应用目录则回退到非持久化（不崩溃，但每次启动不同）
        None => return fallback_machine_id(),
    };
    let id_file = app_data_dir.join("swallownote-machine-id.txt");
    // 读取已持久化的 machine id
    if let Ok(content) = std::fs::read_to_string(&id_file) {
        let id = content.trim();
        if !id.is_empty() {
            return id.to_string();
        }
    }
    // 生成新 id 并尝试持久化
    let new_id = fallback_machine_id();
    if std::fs::create_dir_all(&app_data_dir).is_ok() {
        #[cfg(unix)]
        {
            if std::fs::write(&id_file, &new_id).is_ok() {
                // Unix 下设置文件权限为 0600（仅当前用户可读写），防止其他用户读取
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = std::fs::metadata(&id_file) {
                    let mut perms = meta.permissions();
                    perms.set_mode(0o600);
                    let _ = std::fs::set_permissions(&id_file, perms);
                }
                return new_id;
            }
        }
        #[cfg(not(unix))]
        {
            if std::fs::write(&id_file, &new_id).is_ok() {
                return new_id;
            }
        }
    }
    // 所有持久化尝试失败，回退到非持久化（每次启动不同，但不崩溃）
    fallback_machine_id()
}

/// machine_id 进程级缓存：machine_id 在进程生命周期内不变，避免每次加解密
/// spawn ioreg/sysctl 子进程；同时保证 fallback 随机 id 在多次调用间一致
/// （否则加密与解密各生成一个随机 id 时密文永远无法解出）。
static MACHINE_ID_CACHE: OnceLock<String> = OnceLock::new();

fn get_machine_id() -> String {
    MACHINE_ID_CACHE
        .get_or_init(get_machine_id_uncached)
        .clone()
}

fn get_machine_id_uncached() -> String {
    #[cfg(target_os = "macos")]
    {
        // 优先从 ioreg 获取 IOPlatformUUID
        if let Ok(output) = std::process::Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.contains("IOPlatformUUID") {
                    if let Some(uuid) = line.split('"').nth(3) {
                        return uuid.to_string();
                    }
                }
            }
        }
        // 回退：sysctl hw.uuid（macOS 硬件 UUID）
        if let Ok(output) = std::process::Command::new("sysctl")
            .args(["-n", "hw.uuid"])
            .output()
        {
            let uuid = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !uuid.is_empty() {
                return uuid;
            }
        }
        // 最终回退：持久化到 app_data_dir，确保跨重启可解密
        return get_or_create_fallback_machine_id();
    }
    #[cfg(target_os = "windows")]
    {
        // 从注册表读 MachineGuid，避免 wmic 弹窗
        match winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
            .open_subkey(r"SOFTWARE\Microsoft\Cryptography")
        {
            Ok(key) => match key.get_value::<String, _>("MachineGuid") {
                Ok(guid) => guid,
                Err(_) => get_or_create_fallback_machine_id(),
            },
            Err(_) => get_or_create_fallback_machine_id(),
        }
    }
    #[cfg(target_os = "linux")]
    {
        // 读取 /etc/machine-id 或 /var/lib/dbus/machine-id
        for path in &["/etc/machine-id", "/var/lib/dbus/machine-id"] {
            if let Ok(content) = std::fs::read_to_string(path) {
                let id = content.trim();
                if !id.is_empty() {
                    return id.to_string();
                }
            }
        }
        // 最终回退：持久化到 app_data_dir，确保跨重启可解密
        return get_or_create_fallback_machine_id();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        get_or_create_fallback_machine_id()
    }
}

/// legacy 派生（内置 AI 存量密文）：输入顺序 salt ++ machine_id ++ 固定后缀
fn derive_key() -> [u8; 32] {
    let machine_id = get_machine_id();
    let mut hasher = Sha256::new();
    hasher.update(APP_SALT);
    hasher.update(machine_id.as_bytes());
    hasher.update(b"SwallowNote-v1");
    sha256_finalize(hasher)
}

/// 插件 secureStorage 派生（ADR-0003）：输入顺序 salt ++ machine_id ++ pluginId
fn derive_plugin_key(plugin_id: &str) -> [u8; 32] {
    let machine_id = get_machine_id();
    let mut hasher = Sha256::new();
    hasher.update(SECURE_STORAGE_SALT);
    hasher.update(machine_id.as_bytes());
    hasher.update(plugin_id.as_bytes());
    sha256_finalize(hasher)
}

/// 收尾公共段：finalize + 拷贝为 32 字节 key
fn sha256_finalize(hasher: Sha256) -> [u8; 32] {
    let result = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    key
}

/// 用给定 key 加密：nonce 取 UUID v4 前 12 字节，输出 base64(nonce ‖ ciphertext)
fn encrypt_with_key(key: &[u8; 32], plaintext: &str) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    let nonce_bytes = uuid::Uuid::new_v4();
    let nonce = Nonce::from_slice(&nonce_bytes.as_bytes()[..12]);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes.as_bytes()[..12]);
    combined.extend_from_slice(&ciphertext);

    Ok(BASE64.encode(&combined))
}

/// 用给定 key 解密 base64(nonce ‖ ciphertext) 格式密文
fn decrypt_with_key(key: &[u8; 32], encrypted: &str) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    let combined = BASE64
        .decode(encrypted)
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

/// legacy：内置 AI API key 加密（存量密文兼容，派生输入不可变更）
pub fn encrypt_api_key(plaintext: &str) -> Result<String, String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    let key = derive_key();
    encrypt_with_key(&key, plaintext)
}

/// legacy：内置 AI API key 解密（存量密文兼容，派生输入不可变更）
pub fn decrypt_api_key(encrypted: &str) -> Result<String, String> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }
    let key = derive_key();
    decrypt_with_key(&key, encrypted)
}

/// 插件 secureStorage 加密（ADR-0003）：按 pluginId 派生独立密钥
pub fn encrypt_plugin_secret(plugin_id: &str, plaintext: &str) -> Result<String, String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    let key = derive_plugin_key(plugin_id);
    encrypt_with_key(&key, plaintext)
}

/// 插件 secureStorage 解密：与写入插件不匹配（或换机器）时解密失败
pub fn decrypt_plugin_secret(plugin_id: &str, encrypted: &str) -> Result<String, String> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }
    let key = derive_plugin_key(plugin_id);
    decrypt_with_key(&key, encrypted)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "sk-test-密钥-123!@#";

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let encrypted = encrypt_plugin_secret("test-plugin", SECRET).unwrap();
        assert_ne!(encrypted, SECRET);
        let decrypted = decrypt_plugin_secret("test-plugin", &encrypted).unwrap();
        assert_eq!(decrypted, SECRET);
    }

    #[test]
    fn test_empty_secret_passthrough() {
        assert_eq!(encrypt_plugin_secret("test-plugin", "").unwrap(), "");
        assert_eq!(decrypt_plugin_secret("test-plugin", "").unwrap(), "");
    }

    #[test]
    fn test_invalid_ciphertext_rejected() {
        // 非 base64
        assert!(decrypt_plugin_secret("test-plugin", "!!!not-base64!!!").is_err());
        // base64 但过短（不足 12 字节 nonce）
        let short = BASE64.encode(b"abc");
        assert!(decrypt_plugin_secret("test-plugin", &short).is_err());
    }

    #[test]
    fn test_cross_plugin_isolation() {
        // 插件 A 加密的密文无法用插件 B 的密钥解密（同 key 名隔离）
        let encrypted = encrypt_plugin_secret("plugin-a", SECRET).unwrap();
        assert!(decrypt_plugin_secret("plugin-b", &encrypted).is_err());
    }

    #[test]
    fn test_plugin_key_differs_from_legacy() {
        // 新旧盐不同 ⇒ 派生密钥必然不同（存量 legacy 密文不受影响）
        assert_ne!(derive_plugin_key("x"), derive_key());
        // 同 pluginId 派生稳定
        assert_eq!(derive_plugin_key("stable"), derive_plugin_key("stable"));
    }

    #[test]
    fn test_legacy_roundtrip() {
        // legacy 派生 + 格式迁移后仍可往返（字节级兼容自证）
        let encrypted = encrypt_api_key(SECRET).unwrap();
        assert_eq!(decrypt_api_key(&encrypted).unwrap(), SECRET);
    }
}
