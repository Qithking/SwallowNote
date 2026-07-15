/// Windows 开机自启动实现
///
/// 不使用 tauri-plugin-autostart 的 enable/disable，因为底层 auto-launch v0.5.0
/// 不给 exe 路径加引号（format!("{} {}", app_path, args.join(" "))），
/// 安装路径含空格时（如 C:\Program Files\...）Windows Run 键会把空格后的部分
/// 当作参数，导致自启动失败。
///
/// 本模块直接用 winreg 操作注册表，正确引用 exe 路径。
use tauri::AppHandle;

const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const APP_NAME: &str = "SwallowNote";

#[tauri::command]
#[cfg(target_os = "windows")]
pub async fn enable_autostart(_app: AppHandle) -> Result<(), String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe_path.display().to_string();

    // 引用 exe 路径以正确处理空格
    let value = format!("\"{}\"", exe_str);

    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(RUN_KEY)
        .map_err(|e| format!("Failed to open Run key: {}", e))?;

    key.set_value(APP_NAME, &value)
        .map_err(|e| format!("Failed to set registry value: {}", e))?;

    Ok(())
}

#[tauri::command]
#[cfg(target_os = "windows")]
pub async fn disable_autostart(_app: AppHandle) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)
        .map_err(|e| format!("Failed to open Run key: {}", e))?;

    match key.delete_value(APP_NAME) {
        Ok(_) => Ok(()),
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Failed to delete registry value: {}", e)),
    }
}

#[tauri::command]
#[cfg(target_os = "windows")]
pub async fn is_autostart_enabled(_app: AppHandle) -> Result<bool, String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey(RUN_KEY)
        .map_err(|e| format!("Failed to open Run key: {}", e))?;

    Ok(key.get_value::<String, _>(APP_NAME).is_ok())
}

// 非 Windows 平台提供空实现，保持 invoke_handler 统一注册
#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn enable_autostart(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn disable_autostart(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn is_autostart_enabled(_app: AppHandle) -> Result<bool, String> {
    Ok(false)
}
