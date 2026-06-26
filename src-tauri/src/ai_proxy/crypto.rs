use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

const APP_SALT: &[u8] = b"SwallowNote-AI-Key-Encryption-Salt-v1";

/// 获取不到系统唯一 ID 时的最终回退：用 PID + 纳秒时间戳 + 随机数生成临时 ID。
/// 避免所有用户共享同一常量密钥（旧实现固定返回 "swallownote-*-fallback"，
/// 会导致跨用户密钥相同，存在可预测风险）。
fn fallback_machine_id() -> String {
    let pid = std::process::id();
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let rnd: u64 = rand::random();
    format!("swallownote-fallback-{}-{}-{}", pid, ts, rnd)
}

/// 获取应用数据目录（跨平台）。
/// macOS: ~/Library/Application Support/SwallowNote
/// Windows: %APPDATA%/SwallowNote
/// Linux: ~/.local/share/SwallowNote
fn get_app_data_dir() -> Option<std::path::PathBuf> {
    dirs::data_dir().map(|d| d.join("SwallowNote"))
}

/// 获取或创建持久化的 fallback machine id。
/// 首次调用时生成新 id 并写入 app_data_dir 缓存文件，后续启动复用同一值，
/// 确保 API key 可跨重启解密。不同机器的 app_data_dir 路径不同，读不到对方文件，
/// 从而保证加密文件换机器不可解密。
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

fn derive_key() -> [u8; 32] {
    let machine_id = get_machine_id();
    let mut hasher = Sha256::new();
    hasher.update(APP_SALT);
    hasher.update(machine_id.as_bytes());
    hasher.update(b"SwallowNote-v1");
    let result = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    key
}

fn get_machine_id() -> String {
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
        // Read MachineGuid from Windows Registry instead of spawning `wmic`.
        // Spawning console processes like `wmic` creates visible console windows
        // even with CREATE_NO_WINDOW on some Windows configurations.
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

pub fn encrypt_api_key(plaintext: &str) -> Result<String, String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    let key = derive_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
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

pub fn decrypt_api_key(encrypted: &str) -> Result<String, String> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }
    let key = derive_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
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
