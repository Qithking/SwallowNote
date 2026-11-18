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
/// P2 修复（凭证注入面收编）：脚本改为【静态内容】，凭证一律经环境变量
/// GIT_USERNAME/GIT_PASSWORD 传入——此前 Unix 脚本把凭证字符串拼接进脚本体，
/// 密码含单引号/换行/反斜杠时转义复杂且易出错（引号被 escape 后 shell
/// 语义改变可能导致认证失败甚至命令注入）；Windows bat 的 `%VAR%` 展开对
/// 含 `& | < > ^` 的密码会破坏命令结构。env 方式下脚本零凭证、零注入面。
/// - Unix: 静态脚本，权限 0700（需 x 位供 git 作为 GIT_ASKPASS 执行），RAII 自动清理。
/// - Windows: 静态脚本，delayed expansion 读取环境变量（特殊字符安全），RAII 自动清理。
#[allow(unused_variables)]
pub fn create_askpass_script(
    prefix: &str,
    username: &str,
    password: &str,
) -> Result<(String, TempScriptGuard), String> {
    let temp_dir = std::env::temp_dir();
    let unique_id = uuid::Uuid::new_v4().to_string();

    #[cfg(not(target_os = "windows"))]
    let askpass_script = temp_dir.join(format!("swallownote_{}_askpass_{}.sh", prefix, unique_id));
    #[cfg(target_os = "windows")]
    let askpass_script = temp_dir.join(format!("swallownote_{}_askpass_{}.bat", prefix, unique_id));

    // P2 修复：锚定提示语前缀 ^Username for——git 的密码提示是
    // "Password for 'https://<user>@host':"，若用户名含 "username" 子串，
    // 无锚定 grep 会把密码提示误判为用户名提示 → 永远回传用户名当密码，认证必败。
    // 脚本为静态内容：不含任何凭证，凭证经 GIT_USERNAME/GIT_PASSWORD 环境变量传入。
    // Unix 用 printf '%s\n' 而非 echo——echo 对以 '-' 开头的值会被当作选项。
    #[cfg(not(target_os = "windows"))]
    let script_content = "#!/bin/sh\nif printf '%s' \"$1\" | grep -qi '^Username for'; then\n  printf '%s\\n' \"$GIT_USERNAME\"\nelse\n  printf '%s\\n' \"$GIT_PASSWORD\"\nfi".to_string();

    // Windows：setlocal enabledelayedexpansion + !VAR! 展开发生在解析之后，
    // 值中的 & | < > ( ) ^ 等特殊字符不会被重新解析（!VAR! 形式）；
    //（/b = 行首匹配，同 Unix 侧锚定修复）
    // P1 修复（code review）：bat 的 if 只接受 ERRORLEVEL/==/EXIST/DEFINED 条件，
    // 旧写法 `if echo %1 | findstr ...` 是非法语法，cmd 直接报错致 askpass 失效。
    // 改为先执行 findstr 以退出码判定（0=命中 Username 提示）。
    #[cfg(target_os = "windows")]
    let script_content = "@echo off\nsetlocal enabledelayedexpansion\necho %1 | findstr /b /i \"Username for\" >nul 2>&1\nif %errorlevel%==0 (\n  echo(!GIT_USERNAME!\n) else (\n  echo(!GIT_PASSWORD!\n)".to_string();

    #[cfg(not(target_os = "windows"))]
    {
        // 原子创建：以 0700 权限一次性创建，避免"先宽权限落盘再收紧"的可读窗口。
        // 必须含执行位（x）：GIT_ASKPASS 指向的脚本需要被 git exec，0600 会导致
        // "Permission denied"，进而被误判为 AUTH_REQUIRED。
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o700)
            .open(&askpass_script)
            .and_then(|mut f| f.write_all(script_content.as_bytes()))
            .map_err(|e| format!("Failed to create askpass script: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    std::fs::write(&askpass_script, &script_content)
        .map_err(|e| format!("Failed to create askpass script: {}", e))?;

    let guard = TempScriptGuard(askpass_script.clone());

    Ok((askpass_script.to_string_lossy().to_string(), guard))
}

/// 构建 askpass 相关环境变量。
/// P2 修复：凭证一律经 GIT_USERNAME/GIT_PASSWORD 传入（Unix 与 Windows 统一），
/// askpass 脚本为静态内容，杜绝凭证字符串拼接进脚本体的转义/注入问题。
pub fn build_askpass_env<'a>(
    askpass_path: &'a str,
    username: &'a str,
    password: &'a str,
) -> Vec<(&'a str, &'a str)> {
    vec![
        ("GIT_ASKPASS", askpass_path),
        ("GIT_TERMINAL_PROMPT", "0"),
        ("GIT_USERNAME", username),
        ("GIT_PASSWORD", password),
    ]
}

/// 前端可调用的清理残留 askpass 脚本命令
#[tauri::command]
pub fn cleanup_askpass_scripts() {
    cleanup_stale_askpass_scripts();
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn askpass_script_should_be_owner_executable() {
        use std::os::unix::fs::PermissionsExt;
        let (path, guard) = create_askpass_script("test", "user", "pass").unwrap();

        // 权限必须为 0700：0600 缺执行位会导致 git exec GIT_ASKPASS 失败
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o700);

        // RAII 守卫 drop 后脚本应被清理，不残留明文凭证
        let path_buf = guard.0.clone();
        drop(guard);
        assert!(!path_buf.exists());
    }

    /// P2 回归：askpass 提示语判定必须锚定 ^Username for——
    /// 密码提示 "Password for 'https://<user>@host':" 中若用户名含 "username"
    /// 子串（如 myusername01），旧的无锚定 grep 会把密码提示误判为用户名提示，
    /// 密码永远回传成用户名 → 认证必败
    #[test]
    fn askpass_script_should_anchor_username_prompt() {
        let (path, guard) = create_askpass_script("test", "myusername01", "secret").unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("grep -qi '^Username for'"),
            "username prompt match must be anchored to prompt prefix, got: {}", content);
        assert!(!content.contains("grep -qi 'username'"),
            "unanchored substring match must be removed, got: {}", content);
        drop(guard);
    }

    /// P2 回归：脚本必须为静态内容——凭证不得拼接进脚本体。含单引号/换行/
    /// shell 特殊字符的密码若走字符串拼接会破坏脚本语义（转义地狱）甚至构成
    /// 命令注入；凭证一律经 GIT_USERNAME/GIT_PASSWORD 环境变量传入
    #[test]
    fn askpass_script_should_not_embed_credentials() {
        let (path, guard) =
            create_askpass_script("test", "we'ird-user", "p'ass\nline&x;rm").unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(!content.contains("p'ass"), "password must not be embedded in script: {}", content);
        assert!(!content.contains("we'ird"), "username must not be embedded in script: {}", content);
        assert!(content.contains("$GIT_USERNAME") && content.contains("$GIT_PASSWORD"),
            "script must read credentials from env vars, got: {}", content);
        drop(guard);
    }

    /// 功能回归：脚本在真实 sh 下按提示类型返回用户名/密码，
    /// 密码含单引号/& 等特殊字符时也必须原样返回（旧拼接实现会在此损坏）
    #[test]
    fn askpass_script_functional_username_and_password() {
        let (path, guard) = create_askpass_script("test", "u1", "p&x'z").unwrap();
        let out_user = std::process::Command::new("sh")
            .arg(&path)
            .arg("Username for 'https://github.com': ")
            .env("GIT_USERNAME", "u1")
            .env("GIT_PASSWORD", "p&x'z")
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&out_user.stdout).trim(), "u1");
        let out_pass = std::process::Command::new("sh")
            .arg(&path)
            .arg("Password for 'https://u1@github.com': ")
            .env("GIT_USERNAME", "u1")
            .env("GIT_PASSWORD", "p&x'z")
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&out_pass.stdout).trim(), "p&x'z");
        drop(guard);
    }

    /// build_askpass_env 必须始终携带 GIT_USERNAME/GIT_PASSWORD
    /// （Unix 与 Windows 脚本统一从环境变量取凭证）
    #[test]
    fn askpass_env_should_include_credentials() {
        let vars = build_askpass_env("/tmp/askpass.sh", "u", "p");
        assert!(vars.contains(&("GIT_USERNAME", "u")));
        assert!(vars.contains(&("GIT_PASSWORD", "p")));
        assert!(vars.contains(&("GIT_ASKPASS", "/tmp/askpass.sh")));
        assert!(vars.contains(&("GIT_TERMINAL_PROMPT", "0")));
    }
}
