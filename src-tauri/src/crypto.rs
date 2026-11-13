//! 平台级加密模块：API key / 插件敏感数据的 AES-256-GCM 加解密与密钥派生。
//!
//! 自 `ai_proxy/crypto.rs` 迁出为平台模块（P1.5 / ADR-0003），确保未来
//! 删除内置 AI 后加密能力仍保留。三部分派生：
//! - legacy（内置 AI 存量密文兼容）：`SHA-256(APP_SALT + machine_id + "SwallowNote-v1")`，
//!   派生输入与密文格式**字节级不可变**，否则存量 AI key 无法解密；
//! - 插件 secureStorage legacy（存量密文）：`SHA-256(SECURE_STORAGE_SALT + machine_id + pluginId)`，
//!   machine_id 本机任意进程可读，属 B3 已知弱派生，仅用于存量密文解密兜底；
//! - 插件 secureStorage v2（B3）：`SHA-256(master_key + SALT_V2 + pluginId)`，
//!   master_key 为 32 字节随机数存 OS keyring（与 git 凭证同机制），不再依赖 machine_id。
//!   keyring 不可用时回退 legacy 派生（不差于旧行为）；旧密文由读路径双试 +
//!   启动迁移（plugin_secure_storage::migrate_secure_storage_to_keyring）覆盖。

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

/// 插件 secureStorage legacy 派生盐（存量密文兜底解密；新写入已不再使用）
const SECURE_STORAGE_SALT: &[u8] = b"SwallowNote-Secure-Storage-Salt-v1";

/// 插件 secureStorage v2 派生盐（B3）：与 legacy 盐不同，保证新旧派生密钥互异
const SECURE_STORAGE_SALT_V2: &[u8] = b"SwallowNote-Secure-Storage-Salt-v2-keyring";

/// master key 在 keyring 中的条目名（service 与 git 凭证一致，见 credentials.rs）
const MASTER_KEYRING_USER: &str = "secure-storage:master-v1";
const MASTER_KEYRING_SERVICE: &str = "SwallowNote";

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

/// master key 进程级缓存：None 表示 keyring 不可用（进程内不再重试）。
static MASTER_KEY_CACHE: OnceLock<Option<[u8; 32]>> = OnceLock::new();

/// 取 secureStorage 主密钥（进程内缓存）。keyring 不可用 / 条目内容非法时返回 None，
/// 调用方回退 legacy 派生。keyring 条目损坏时重新生成覆盖（旧密文本就无法解开）。
pub(crate) fn get_master_key() -> Option<[u8; 32]> {
    *MASTER_KEY_CACHE.get_or_init(|| {
        let entry = keyring::Entry::new(MASTER_KEYRING_SERVICE, MASTER_KEYRING_USER).ok()?;
        match entry.get_password() {
            Ok(secret) => match decode_hex_32(&secret) {
                Some(key) => Some(key),
                None => regenerate_master_key(&entry),
            },
            Err(keyring::Error::NoEntry) => regenerate_master_key(&entry),
            Err(_) => None,
        }
    })
}

/// 生成新主密钥并写 keyring，写失败返回 None（回退 legacy 派生）
fn regenerate_master_key(entry: &keyring::Entry) -> Option<[u8; 32]> {
    let key: [u8; 32] = (0..32)
        .map(|_| rand::random::<u8>())
        .collect::<Vec<_>>()
        .try_into()
        .ok()?;
    entry.set_password(&encode_hex(&key)).ok()?;
    Some(key)
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 解析 64 位 hex 字符串为 32 字节；非法输入返回 None
fn decode_hex_32(s: &str) -> Option<[u8; 32]> {
    if s.len() != 64 || !s.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

/// 插件 secureStorage v2 派生（B3）：master_key ‖ salt_v2 ‖ pluginId
fn derive_plugin_key_v2(plugin_id: &str, master_key: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(master_key);
    hasher.update(SECURE_STORAGE_SALT_V2);
    hasher.update(plugin_id.as_bytes());
    sha256_finalize(hasher)
}

/// 插件 secureStorage legacy 派生（存量密文兜底）：salt ‖ machine_id ‖ pluginId
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

/// 插件 secureStorage 加密（B3）：master key 可用走 v2 派生，否则回退 legacy 派生
pub fn encrypt_plugin_secret(plugin_id: &str, plaintext: &str) -> Result<String, String> {
    encrypt_plugin_secret_inner(plugin_id, get_master_key().as_ref(), plaintext)
}

/// 用显式 master key 加密（迁移 / 测试注入用）
pub(crate) fn encrypt_plugin_secret_with_master(
    plugin_id: &str,
    master_key: &[u8; 32],
    plaintext: &str,
) -> Result<String, String> {
    encrypt_plugin_secret_inner(plugin_id, Some(master_key), plaintext)
}

fn encrypt_plugin_secret_inner(
    plugin_id: &str,
    master_key: Option<&[u8; 32]>,
    plaintext: &str,
) -> Result<String, String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    let key = match master_key {
        Some(mk) => derive_plugin_key_v2(plugin_id, mk),
        // keyring 不可用：回退 legacy 派生（等价旧行为，不更差）
        None => derive_plugin_key(plugin_id),
    };
    encrypt_with_key(&key, plaintext)
}

/// 插件 secureStorage 解密：双试——v2 派生优先（master key 可用时），
/// 失败回退 legacy 派生（存量未迁移密文 / keyring 不可用时代写入的密文）。
pub fn decrypt_plugin_secret(plugin_id: &str, encrypted: &str) -> Result<String, String> {
    decrypt_plugin_secret_inner(plugin_id, get_master_key().as_ref(), encrypted)
}

/// 纯 v2 解密（迁移判定用：无回退。v2 可解 ⇒ 已是迁移后密文）。
pub(crate) fn decrypt_plugin_secret_v2_only(
    plugin_id: &str,
    master_key: &[u8; 32],
    encrypted: &str,
) -> Result<String, String> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }
    decrypt_with_key(&derive_plugin_key_v2(plugin_id, master_key), encrypted)
}

/// 纯 legacy 派生解密（迁移判定用：legacy 可解 ⇒ 是待迁移密文）
pub(crate) fn decrypt_plugin_secret_legacy(plugin_id: &str, encrypted: &str) -> Result<String, String> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }
    decrypt_with_key(&derive_plugin_key(plugin_id), encrypted)
}

fn decrypt_plugin_secret_inner(
    plugin_id: &str,
    master_key: Option<&[u8; 32]>,
    encrypted: &str,
) -> Result<String, String> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }
    if let Some(mk) = master_key {
        if let Ok(plaintext) = decrypt_with_key(&derive_plugin_key_v2(plugin_id, mk), encrypted) {
            return Ok(plaintext);
        }
    }
    decrypt_with_key(&derive_plugin_key(plugin_id), encrypted)
}

/// 测试注入：固定 master key 写入进程缓存，避免测试触碰真实 keyring。
/// 并行测试重复 set 时后者失败但值一致，静默忽略。
#[cfg(test)]
pub(crate) const TEST_MASTER_KEY: [u8; 32] = [0x42; 32];

#[cfg(test)]
pub(crate) fn test_init_master_key() {
    let _ = MASTER_KEY_CACHE.set(Some(TEST_MASTER_KEY));
}

/// 测试辅助：用 legacy 派生加密任意明文（模拟存量密文）。
#[cfg(test)]
pub(crate) fn encrypt_plugin_secret_legacy_placeholder(plugin_id: &str, plaintext: &str) -> String {
    let key = derive_plugin_key(plugin_id);
    encrypt_with_key(&key, plaintext).expect("legacy encrypt for test")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "sk-test-密钥-123!@#";

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        test_init_master_key();
        let encrypted = encrypt_plugin_secret("test-plugin", SECRET).unwrap();
        assert_ne!(encrypted, SECRET);
        let decrypted = decrypt_plugin_secret("test-plugin", &encrypted).unwrap();
        assert_eq!(decrypted, SECRET);
    }

    #[test]
    fn test_empty_secret_passthrough() {
        test_init_master_key();
        assert_eq!(encrypt_plugin_secret("test-plugin", "").unwrap(), "");
        assert_eq!(decrypt_plugin_secret("test-plugin", "").unwrap(), "");
    }

    #[test]
    fn test_invalid_ciphertext_rejected() {
        test_init_master_key();
        // 非 base64
        assert!(decrypt_plugin_secret("test-plugin", "!!!not-base64!!!").is_err());
        // base64 但过短（不足 12 字节 nonce）
        let short = BASE64.encode(b"abc");
        assert!(decrypt_plugin_secret("test-plugin", &short).is_err());
    }

    #[test]
    fn test_cross_plugin_isolation() {
        test_init_master_key();
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

    // ===== B3：v2 派生与双试解密 =====

    #[test]
    fn test_v2_roundtrip_with_explicit_master_key() {
        let mk = [0x11u8; 32];
        let encrypted = encrypt_plugin_secret_with_master("test-plugin", &mk, SECRET).unwrap();
        assert_eq!(
            decrypt_plugin_secret_v2_only("test-plugin", &mk, &encrypted).unwrap(),
            SECRET
        );
    }

    #[test]
    fn test_v2_key_differs_from_legacy_and_master_sensitive() {
        // 同 pluginId：master key 不同 ⇒ 派生不同；v2 与 legacy 不同
        assert_ne!(
            derive_plugin_key_v2("p", &[0x01u8; 32]),
            derive_plugin_key_v2("p", &[0x02u8; 32])
        );
        assert_ne!(derive_plugin_key_v2("p", &[0x01u8; 32]), derive_plugin_key("p"));
    }

    #[test]
    fn test_legacy_ciphertext_still_decryptable_via_dual_try() {
        test_init_master_key();
        // 旧派生（machine_id）加密的存量密文：公开解密入口双试后仍可解
        let legacy_ct = encrypt_with_key(&derive_plugin_key("test-plugin"), SECRET).unwrap();
        assert_eq!(decrypt_plugin_secret("test-plugin", &legacy_ct).unwrap(), SECRET);
    }

    #[test]
    fn test_encrypt_fallback_uses_legacy_derive_when_no_master() {
        // master key 不可用：新加密回退 legacy 派生（密文可用 legacy 解开）
        let ct = encrypt_plugin_secret_inner("test-plugin", None, SECRET).unwrap();
        assert_eq!(decrypt_plugin_secret_legacy("test-plugin", &ct).unwrap(), SECRET);
    }

    #[test]
    fn test_master_key_hex_roundtrip_and_invalid_rejected() {
        let key = [0xabu8; 32];
        assert_eq!(decode_hex_32(&encode_hex(&key)), Some(key));
        assert_eq!(decode_hex_32(""), None);
        assert_eq!(decode_hex_32("zz"), None);
        assert_eq!(decode_hex_32(&"ab".repeat(31)), None); // 长度不足
    }
}
