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
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get credential: {}", e)),
    }
}

/// Delete git credentials for a repository from the system keyring
#[tauri::command]
pub fn git_credential_delete(repo_path: String) -> Result<(), String> {
    let key = build_credential_key(&repo_path)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    entry.delete_credential()
        .map_err(|e| format!("Failed to delete credential: {}", e))?;

    Ok(())
}

/// Build a unique credential key based on the repository's remote URL
pub fn build_credential_key(repo_path: &str) -> Result<String, String> {
    // Use the remote URL as the key if available, otherwise use the repo path
    match get_remote_url(repo_path)? {
        Some(url) => Ok(format!("git:{}", url)),
        None => Ok(format!("git:path:{}", repo_path.replace('\\', "/"))),
    }
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
