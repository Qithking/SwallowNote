/// 重启当前应用。
/// 用于需要重新初始化窗口（如 DevTools 开关）的设置项。
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}
