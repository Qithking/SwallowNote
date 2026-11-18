use super::models::GitCredential;
use super::scan::get_remote_url;

// ===================== Keyring Credential Management =====================

pub const KEYRING_SERVICE: &str = "SwallowNote";

/// Save git credentials for a repository to the system keyring
/// The credential key is based on the repository's remote URL for uniqueness
#[tauri::command]
pub fn git_credential_save(repo_path: String, username: String, password: String) -> Result<(), String> {
    let key = build_credential_key(&repo_path)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    // Store as JSON: {"username": "...", "password": "..."}
    let credential = serde_json::json!({
        "username": username,
        "password": password,
    });

    entry.set_password(&credential.to_string())
        .map_err(|e| format!("Failed to save credential: {}", e))?;

    Ok(())
}

/// Get git credentials for a repository from the system keyring
#[tauri::command]
pub fn git_credential_get(repo_path: String) -> Result<Option<GitCredential>, String> {
    let key = build_credential_key(&repo_path)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    match entry.get_password() {
        Ok(json_str) => {
            let cred: GitCredential = serde_json::from_str(&json_str)
                .map_err(|e| format!("Failed to parse credential: {}", e))?;
            Ok(Some(cred))
        }
        Err(keyring::Error::NoEntry) => {
            // P2 修复（脱敏键兼容）：历史版本用原始 URL（可能内嵌 user:pass）作
            // keyring 键；改用脱敏键后旧条目读不到。回读旧键并迁移到新键，
            // 避免用户已保存凭证"静默失效"。
            if let Ok(Some(legacy_key)) = build_legacy_credential_key(&repo_path) {
                if legacy_key != key {
                    if let Ok(legacy_entry) = keyring::Entry::new(KEYRING_SERVICE, &legacy_key) {
                        if let Ok(json_str) = legacy_entry.get_password() {
                            // 迁移：写入脱敏键（旧条目保留，无法删除时也不影响功能）
                            let new_entry = keyring::Entry::new(KEYRING_SERVICE, &key)
                                .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
                            new_entry.set_password(&json_str)
                                .map_err(|e| format!("Failed to save credential: {}", e))?;
                            let cred: GitCredential = serde_json::from_str(&json_str)
                                .map_err(|e| format!("Failed to parse credential: {}", e))?;
                            return Ok(Some(cred));
                        }
                    }
                }
            }
            Ok(None)
        }
        Err(e) => Err(format!("Failed to get credential: {}", e)),
    }
}

/// Delete git credentials for a repository from the system keyring
#[tauri::command]
pub fn git_credential_delete(repo_path: String) -> Result<(), String> {
    let key = build_credential_key(&repo_path)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => {
            // P2 修复（脱敏键兼容）：新键无条目时尝试清理旧键（历史遗留）
            if let Ok(Some(legacy_key)) = build_legacy_credential_key(&repo_path) {
                if legacy_key != key {
                    if let Ok(legacy_entry) = keyring::Entry::new(KEYRING_SERVICE, &legacy_key) {
                        return legacy_entry.delete_credential()
                            .map_err(|e| format!("Failed to delete credential: {}", e));
                    }
                }
            }
            Ok(())
        }
        Err(e) => Err(format!("Failed to delete credential: {}", e)),
    }
}

/// Build a unique credential key based on the repository's remote URL
/// P2 修复：get_remote_url 已统一脱敏内嵌凭证，键不再含明文密码
/// （keyring 条目名在系统钥匙串 UI 中可见）
pub fn build_credential_key(repo_path: &str) -> Result<String, String> {
    // Use the remote URL as the key if available, otherwise use the repo path
    match get_remote_url(repo_path)? {
        Some(url) => Ok(format!("git:{}", url)),
        None => Ok(format!("git:path:{}", repo_path.replace('\\', "/"))),
    }
}

/// 构造历史版本的 keyring 键（原始未脱敏 URL）。
/// 仅用于脱敏键 NoEntry 时的迁移读取/清理；URL 无内嵌凭证（脱敏前后一致）
/// 时返回 None——此时新旧键相同，无需兼容。
fn build_legacy_credential_key(repo_path: &str) -> Result<Option<String>, String> {
    let remotes = super::runner::run_git(repo_path, &["remote"])?;
    if !remotes.lines().any(|r| r.trim() == "origin") {
        return Ok(None);
    }
    let output = super::runner::run_git(repo_path, &["remote", "get-url", "origin"])?;
    let raw_url = output.trim().to_string();
    if raw_url.is_empty() || super::scan::sanitize_remote_url(&raw_url) == raw_url {
        return Ok(None);
    }
    Ok(Some(format!("git:{}", raw_url)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_credential_key_format() {
        // build_credential_key calls get_remote_url which runs `git remote` in repo_path.
        // For a non-existent path, git cannot run and get_remote_url returns Err,
        // which build_credential_key propagates via `?`.
        //
        // The Ok case (key format "git:<url>" or "git:path:<normalized_path>")
        // requires a real git repo fixture: "git:path:<path>" needs a git repo without
        // origin remote, and "git:<url>" needs a git repo with origin configured.
        // Per task rules, pure tests must not touch the filesystem, so we only
        // verify the error-propagation behavior here.
        let result = build_credential_key("nonexistent_path_12345_xyz");
        assert!(result.is_err(), "build_credential_key should return Err for a non-existent path");
    }
}
