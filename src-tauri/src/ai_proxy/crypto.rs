use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use sha2::{Digest, Sha256};

const APP_SALT: &[u8] = b"SwallowNote-AI-Key-Encryption-Salt-v1";

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
        match std::process::Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if line.contains("IOPlatformUUID") {
                        if let Some(uuid) = line.split('"').nth(3) {
                            return uuid.to_string();
                        }
                    }
                }
            }
            Err(_) => {}
        }
        "swallownote-mac-fallback".to_string()
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
                Err(_) => "swallownote-win-fallback".to_string(),
            },
            Err(_) => "swallownote-win-fallback".to_string(),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "swallownote-linux-fallback".to_string()
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
