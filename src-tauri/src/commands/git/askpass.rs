/// RAII 守卫：Drop 时删除临时 askpass 脚本，防止明文凭证残留磁盘。
/// 拥有 PathBuf 所有权，可在创建作用域之外（如 clone 流程的 if-let 块）存活至函数末尾，
/// 确保所有 return / `?` 提前返回路径都执行清理。
pub struct TempScriptGuard(pub std::path::PathBuf);

impl Drop for TempScriptGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// 清理临时目录中残留的 askpass 脚本。
/// 应用启动时调用，删除因崩溃等异常退出而残留的 `swallownote_*_askpass_*.sh`（Windows 为 `.bat`）文件。
/// 删除时忽略错误，避免因单个文件锁定等问题中断整个清理流程。
pub fn cleanup_stale_askpass_scripts() {
    let temp_dir = std::env::temp_dir();
    let entries = match std::fs::read_dir(&temp_dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        // 匹配 swallownote_ 前缀且包含 _askpass_ 的脚本文件
        if !file_name.starts_with("swallownote_") || !file_name.contains("_askpass_") {
            continue;
        }
        // 平台相关的扩展名过滤
        #[cfg(target_os = "windows")]
        {
            if !file_name.ends_with(".bat") && !file_name.ends_with(".sh") {
                continue;
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            if !file_name.ends_with(".sh") {
                continue;
            }
        }
        // 删除残留脚本，忽略错误
        let _ = std::fs::remove_file(&path);
    }
}

/// 创建临时 askpass 脚本并返回路径与 RAII 守卫。
/// - Unix: 脚本内嵌凭证，权限 0600，RAII 自动清理。
/// - Windows: 脚本不含凭证，从环境变量 GIT_USERNAME/GIT_PASSWORD 读取，RAII 自动清理。
///   即使脚本残留也不会泄露凭证。
pub fn create_askpass_script(
    prefix: &str,
    _username: &str,
    _password: &str,
) -> Result<(String, TempScriptGuard), String> {
    let temp_dir = std::env::temp_dir();
    let unique_id = uuid::Uuid::new_v4().to_string();

    #[cfg(not(target_os = "windows"))]
    let askpass_script = temp_dir.join(format!("swallownote_{}_askpass_{}.sh", prefix, unique_id));
    #[cfg(target_os = "windows")]
    let askpass_script = temp_dir.join(format!("swallownote_{}_askpass_{}.bat", prefix, unique_id));

    #[cfg(not(target_os = "windows"))]
    let script_content = format!(
        "#!/bin/sh\nif echo \"$1\" | grep -qi 'username'; then\n  echo '{}'\nelse\n  echo '{}'\nfi",
        username.replace('\'', "'\\''"),
        password.replace('\'', "'\\''")
    );

    // Windows 下脚本不含凭证，从环境变量读取，残留也不泄露凭证
    #[cfg(target_os = "windows")]
    let script_content = "@echo off\nif echo %1 | findstr /i \"username\" >nul 2>&1 (\n  echo %GIT_USERNAME%\n) else (\n  echo %GIT_PASSWORD%\n)".to_string();

    std::fs::write(&askpass_script, &script_content)
        .map_err(|e| format!("Failed to create askpass script: {}", e))?;
    let guard = TempScriptGuard(askpass_script.clone());

    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&askpass_script)
            .map_err(|e| format!("Failed to read askpass script metadata: {}", e))?
            .permissions();
        perms.set_mode(0o600);
        std::fs::set_permissions(&askpass_script, perms)
            .map_err(|e| format!("Failed to set askpass script permissions: {}", e))?;
    }

    Ok((askpass_script.to_string_lossy().to_string(), guard))
}

/// 构建 askpass 相关环境变量。
/// Windows 下额外传入 GIT_USERNAME/GIT_PASSWORD，供通用 askpass 脚本读取。
pub fn build_askpass_env<'a>(
    askpass_path: &'a str,
    username: &'a str,
    password: &'a str,
) -> Vec<(&'a str, &'a str)> {
    // vars 仅在 Windows 下被 push，非 Windows 平台编译器会告警 unused_mut，故加 allow。
    #[allow(unused_mut)]
    let mut vars: Vec<(&'a str, &'a str)> = vec![
        ("GIT_ASKPASS", askpass_path),
        ("GIT_TERMINAL_PROMPT", "0"),
    ];
    #[cfg(target_os = "windows")]
    {
        vars.push(("GIT_USERNAME", username));
        vars.push(("GIT_PASSWORD", password));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (username, password);
    }
    vars
}

/// 前端可调用的清理残留 askpass 脚本命令
#[tauri::command]
pub fn cleanup_askpass_scripts() {
    cleanup_stale_askpass_scripts();
}
