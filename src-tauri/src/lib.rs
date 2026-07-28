#![allow(unexpected_cfgs)] // objc macro generates cfg(cargo-clippy) internally
mod ai_proxy;
mod commands;
mod db;
mod i18n;
mod plugins;
mod services;

use plugins::mac_rounded_corners;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    path::BaseDirectory,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::MacosLauncher;
use log::{info, warn, error};

// 安全地记录窗口首次聚焦时刻；替代 run() 回调里不安全的 static mut。
static STARTUP_T0: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
static WINDOW_SHOWN_LOGGED: std::sync::Once = std::sync::Once::new();

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn log_startup_time(stage: &str, elapsed_ms: u64) {
    info!("[STARTUP-TIME] {} t={}", stage, elapsed_ms);
}

/// macOS Dock 图标可见性切换（Regular/Accessory 策略）。
#[tauri::command]
fn set_dock_icon_visibility(visible: bool) -> Result<(), String> {
    set_dock_icon_visibility_inner(visible)
}

/// Dock 图标可见性切换内部实现
#[cfg(target_os = "macos")]
#[allow(deprecated, unexpected_cfgs)]
fn set_dock_icon_visibility_inner(visible: bool) -> Result<(), String> {
    use objc::{msg_send, sel, sel_impl, runtime::Class};
    let result = std::panic::catch_unwind(|| unsafe {
        let ns_app_class = Class::get("NSApplication")
            .ok_or_else(|| "NSApplication class not found".to_string())?;
        let app: cocoa::base::id = msg_send![ns_app_class, sharedApplication];
        if app.is_null() {
            return Err("sharedApplication returned nil".to_string());
        }
        let policy: i64 = if visible { 0 } else { 1 };
        let _: () = msg_send![app, setActivationPolicy: policy];
        if visible {
            let current_icon: cocoa::base::id = msg_send![app, applicationIconImage];
            let _: () = msg_send![app, setApplicationIconImage: current_icon];
        }
        Ok(())
    });
    match result {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("panic in set_dock_icon_visibility".to_string()),
    }
}

#[cfg(not(target_os = "macos"))]
fn set_dock_icon_visibility_inner(_visible: bool) -> Result<(), String> {
    Ok(())
}

/// macOS 显示 Dock 图标，供托盘菜单/图标点击使用
/// 非 macOS 平台无操作
fn show_dock_icon() {
    let _ = set_dock_icon_visibility_inner(true);
}

/// tray 图标加载失败的 1x1 透明兜底
fn default_tray_icon() -> tauri::image::Image<'static> {
    let rgba = vec![0u8, 0, 0, 0]; // 透明 1x1
    tauri::image::Image::new_owned(rgba, 1, 1)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .level({
                    // LOG_LEVEL 环境变量覆盖 > dev/release 默认
                    match std::env::var("LOG_LEVEL").ok().as_deref() {
                        Some("trace") => log::LevelFilter::Trace,
                        Some("debug") => log::LevelFilter::Debug,
                        Some("info") => log::LevelFilter::Info,
                        Some("warn") => log::LevelFilter::Warn,
                        Some("error") => log::LevelFilter::Error,
                        _ => {
                            if cfg!(debug_assertions) {
                                log::LevelFilter::Debug
                            } else {
                                log::LevelFilter::Info
                            }
                        }
                    }
                })
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .max_file_size(5 * 1024 * 1024)
                .targets({
                    // 日志目录：SWALLOWNOTE_LOG_DIR 环境变量 > exe 父目录/logs > ./logs
                    let log_dir = resolve_log_dir(
                        std::env::current_exe().ok().as_deref(),
                        std::env::var("SWALLOWNOTE_LOG_DIR").ok().as_deref(),
                    );
                    [
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                            path: log_dir,
                            file_name: Some("app.log".to_string()),
                        }),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                    ]
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 第二实例启动时聚焦已有窗口
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                show_dock_icon();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::app::restart_app,
            log_startup_time,
            commands::file::path_exists,
            commands::file::get_file_metadata,
            commands::file::list_directory,
            commands::file::list_directories_batch,
            commands::file::read_file,
            commands::file::write_file,
            commands::file::write_binary_file,
            commands::file::get_home_dir,
            commands::file::create_file,
            commands::file::delete_file,
            commands::file::rename_file,
            commands::file::copy_file,
            commands::file::copy_file_to_clipboard,
            commands::file::read_clipboard_file_paths,
            commands::file::open_in_finder,
            commands::file::search_in_files,
            commands::image_downloader::download_remote_images,
            commands::git::git_is_repo,
            commands::git::git_init,
            commands::git::git_status,
            commands::git::git_diff,
            commands::git::git_commit,
            commands::git::git_pull,
            commands::git::git_pull_with_credentials,
            commands::git::git_push,
            commands::git::git_push_with_credentials,
            commands::git::git_force_push,
            commands::git::git_force_push_with_credentials,
            commands::git::git_force_pull,
            commands::git::git_force_pull_with_credentials,
            commands::git::git_credential_save,
            commands::git::git_credential_get,
            commands::git::git_credential_delete,
            commands::git::git_commit_and_push,
            commands::git::git_auto_commit,
            commands::git::git_log,
            commands::git::git_file_log,
            commands::git::git_show_diff,
            commands::git::git_show_file_content,
            commands::git::git_pull_file_latest,
            commands::git::git_force_upload_file,
            commands::git::git_clone,
            commands::git::git_clone_with_credentials,
            commands::git::git_clone_cancel,
            commands::git::git_clone_status,
            commands::git::cleanup_askpass_scripts,
            commands::git::scan_git_repos,
            commands::git::git_get_conflict_files,
            commands::git::git_get_conflict_local_content,
            commands::git::git_get_conflict_remote_content,
            commands::git::git_resolve_conflict_file,
            commands::git::git_save_conflict_file_content,
            commands::git::git_abort_conflict,
            commands::git::compute_word_diff,
            commands::git::get_conflict_repo_records,
            commands::git::remove_conflict_repo_record,
            commands::git::sync_conflict_repo_records,
            commands::git::check_and_update_conflict_repo,
            commands::folder_history::save_folder_history,
            commands::folder_history::get_latest_folder,
            commands::folder_history::get_folder_history,
            commands::folder_history::remove_folder_history,
            commands::folder_history::clear_other_folder_history,
            commands::session_state::save_session_state,
            commands::session_state::get_session_state,
            commands::upgrade::check_latest_version,
commands::upgrade::download_latest_release,
            commands::upgrade::open_installer,
            commands::upgrade::install_and_restart,
            commands::upgrade::get_platform_extension,
            commands::upgrade::get_download_dir,
            commands::upgrade::cancel_download,
            services::file_watcher::watch_directory,
            services::file_watcher::unwatch_directory,
            mac_rounded_corners::enable_rounded_corners,
            mac_rounded_corners::enable_modern_window_style,
            mac_rounded_corners::reposition_traffic_lights,
            set_dock_icon_visibility,
            i18n::set_app_locale,
            commands::ai::encrypt_api_key,
            commands::ai::decrypt_api_key,
            commands::ai::start_ai_proxy_cmd,
            commands::ai::stop_ai_proxy,
            commands::ai::restart_ai_proxy_cmd,
            commands::ai::test_ai_model_cmd,
            commands::ai_chat::save_ai_message,
            commands::ai_chat::load_ai_messages,
            commands::ai_chat::clear_ai_messages,
            commands::ai_role_prompts::load_ai_role_prompts,
            commands::ai_role_prompts::get_ai_role_prompt,
            commands::ai_role_prompts::update_ai_role_prompt,
            commands::ai_role_prompts::add_ai_role_prompt,
            commands::ai_role_prompts::delete_ai_role_prompt,
            commands::ai_role_prompts::update_ai_role_prompt_name,
            commands::ai_role_prompts::reset_ai_role_prompt,
            commands::ai_builtin_models::get_builtin_ai_models,
            commands::plugin::scan_plugins,
            commands::plugin::install_plugin,
            commands::plugin::uninstall_plugin,
            commands::plugin::toggle_plugin_enabled,
            commands::plugin::get_plugin_storage_path,
            commands::plugin::get_all_plugin_storage_sizes,
            commands::plugin::get_storage_cap,
            commands::plugin::install_plugin_from_bytes,
            commands::plugin::check_plugin_updates,
            commands::plugin::update_plugin,
            commands::plugin::rollback_plugin,
            commands::plugin::list_plugin_versions,
            commands::plugin::kill_plugin,
            commands::plugin::export_plugin_configs,
            commands::plugin::import_plugin_configs,
            commands::plugin_invoke::invoke_plugin,
            commands::plugin_settings::read_plugin_settings,
            commands::plugin_settings::write_plugin_settings,
            commands::plugin_settings::delete_plugin_settings,
            commands::market_sources::list_market_sources,
            commands::market_sources::add_market_source,
            commands::market_sources::remove_market_source,
            commands::market_sources::set_active_market_source,
            commands::market_sources::get_active_market_source,
            commands::frontmatter::query_frontmatter,
            commands::frontmatter::query_frontmatter_by_tag,
            commands::frontmatter::query_frontmatter_by_prefix,
            commands::frontmatter::trigger_frontmatter_scan,
            commands::frontmatter::index_saved_file,
            commands::frontmatter::search_frontmatter,
            commands::frontmatter::get_category_tree,
            commands::frontmatter::rename_category,
            commands::frontmatter::delete_category,
            commands::frontmatter::create_category,
            commands::autostart::enable_autostart,
            commands::autostart::disable_autostart,
            commands::autostart::is_autostart_enabled,
        ])
        .setup(|app| {
            let startup_t0 = std::time::Instant::now();
            info!("[STARTUP-TIME] setup_begin t=0");
            // 获取 app_data_dir；测量模式下可通过 SWALLOWNOTE_DATA_DIR 覆盖，避免污染/锁定生产数据
            let app_data_dir = if let Ok(dir) = std::env::var("SWALLOWNOTE_DATA_DIR") {
                let p = std::path::PathBuf::from(dir);
                info!("[STARTUP-TIME] app_data_dir_override path={}", p.display());
                p
            } else {
                match app.path().app_data_dir() {
                    Ok(d) => d,
                    Err(e) => {
                        error!("Failed to get app data dir, skipping DB init: {}", e);
                        std::path::PathBuf::new()
                    }
                }
            };
            if let Err(e) = std::fs::create_dir_all(&app_data_dir) {
                warn!("create_dir_all failed: {}", e);
            }
            info!("[STARTUP-TIME] app_data_dir_ready t={}", startup_t0.elapsed().as_millis());

            // 应用启动时清理上次崩溃可能残留的 askpass 脚本，防止明文凭证泄露
            commands::git::cleanup_stale_askpass_scripts();
            info!("[STARTUP-TIME] askpass_cleanup_done t={}", startup_t0.elapsed().as_millis());

            // 初始化后端 i18n 翻译
            crate::i18n::init_translations();
            info!("[STARTUP-TIME] i18n_init_done t={}", startup_t0.elapsed().as_millis());

            // 仅在成功获取 app_data_dir 时初始化 DB
            let developer_mode = if !app_data_dir.as_os_str().is_empty() {
                match db::init_db(app_data_dir.clone()) {
                    Ok(db) => {
                        // 读取开发者模式设置，用于控制是否启用 DevTools（F12）
                        let developer_mode = match crate::db::session_state::get_session_state(&db) {
                            Ok(states) => states
                                .get("settings.developerMode")
                                .map(|v| v.trim().eq_ignore_ascii_case("true"))
                                .unwrap_or(false),
                            Err(e) => {
                                warn!("Failed to read developerMode setting: {}", e);
                                false
                            }
                        };

                        app.handle().manage(db);
                        info!("[STARTUP-TIME] db_init_done t={}", startup_t0.elapsed().as_millis());
                        // 启动 frontmatter 索引子线程（使用独立数据库连接）
                        let index_db_path = app_data_dir.join("swallownote.db");
                        services::frontmatter_index::start_index_thread(index_db_path, app.handle().clone());
                        info!("[STARTUP-TIME] frontmatter_thread_started t={}", startup_t0.elapsed().as_millis());

                        developer_mode
                    }
                    Err(e) => {
                        error!("Failed to initialize database: {}", e);
                        false
                    }
                }
            } else {
                false
            };

            // 根据开发者模式设置动态创建主窗口，控制 DevTools（F12）是否可用。
            // 配置文件中的 app.windows 已移除，防止 Tauri 自动创建默认窗口。
            // 显式设置 256x256 窗口图标，避免 Tauri 默认从 bundle.icon 数组取第一个 PNG（32x32.png）
            // 导致任务栏图标在高 DPI 屏幕上显示过小。
            let _main_window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("SwallowNote")
                .inner_size(1200.0, 800.0)
                .min_inner_size(1000.0, 700.0)
                .resizable(true)
                .fullscreen(false)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .visible(false)
                .devtools(developer_mode)
                .icon(
                    tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png"))
                        .expect("Failed to load window icon"),
                )?
                .build()
                .map_err(|e| format!("Failed to create main window: {}", e))?;
            info!("[STARTUP-TIME] main_window_created devtools={} t={}", developer_mode, startup_t0.elapsed().as_millis());

            let app_handle = app.handle().clone();
            services::file_watcher::init_watcher(app_handle.clone());
            // 监听 plugins 树，外部 storage.json 变更时通知前端。幂等。
            services::file_watcher::watch_plugin_storage(app_handle.clone());
            info!("[STARTUP-TIME] file_watcher_ready t={}", startup_t0.elapsed().as_millis());

            app.handle().manage(commands::git::new_clone_pid_state());
            app.handle().manage(commands::ai::new_shared_ai_proxy_state());
            // 每插件后端子进程状态；启动为空，首次 invoke_plugin 时懒加载。
            let plugin_process_state = commands::plugin_invoke::new_shared_plugin_process_state();
            // 启动空闲回收定时器：每 5 分钟扫描，kill 超过 10 分钟未用的插件后端进程
            commands::plugin_invoke::start_idle_reaper(plugin_process_state.clone());
            app.handle().manage(plugin_process_state);
            info!("[STARTUP-TIME] plugin_state_ready t={}", startup_t0.elapsed().as_millis());

            // AI 代理按需启动以节省内存

            let show_item = MenuItemBuilder::with_id("show", crate::i18n::t("tray.showWindow")).build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", crate::i18n::t("tray.quit")).build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let tray_icon = if let Ok(tray_icon_path) = app.path().resolve("icons/tray-icon.png", BaseDirectory::Resource) {
                Image::from_path(&tray_icon_path).unwrap_or_else(|_| {
                    app.default_window_icon()
                        .cloned()
                        .map(|img| img.to_owned())
                        .unwrap_or_else(default_tray_icon)
                })
            } else {
                app.default_window_icon()
                    .cloned()
                    .map(|img| img.to_owned())
                    .unwrap_or_else(default_tray_icon)
            };

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .tooltip("SwallowNote")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app: &AppHandle, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        show_dock_icon();
                    }
                    "quit" => {
                        // 先 emit 事件让前端设置 forceQuit 标志（跳过 closeWithoutExit 的 hide 分支），
                        // 再立即 window.close() 触发 close-requested。
                        // emit 是同步派发到 webview，close 触发的 close-requested 时 forceQuit 已设置。
                        // close-requested handler 使用 onCloseRequested（await async handler），
                        // 确保 saveSessionStateNow 等 async 保存逻辑完成后再 destroy。
                        let _ = app.emit("tray-quit-requested", ());
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.close();
                        } else {
                            // 窗口不存在时回退到直接退出
                            app.exit(0);
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app: &AppHandle = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        show_dock_icon();
                    }
                })
                .build(app)?;
            info!("[STARTUP-TIME] tray_ready t={}", startup_t0.elapsed().as_millis());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 使用 OnceLock / Once 替代 static mut，避免 unsafe 与潜在竞态。
            // 第一次进入 run 循环时记录 t0，窗口首次聚焦时用它输出耗时。
            let t0 = STARTUP_T0.get_or_init(std::time::Instant::now);

            // 记录窗口首次可见/可交互，作为 Rust 侧能观测到的最近似“窗口已显示”时刻
            if let tauri::RunEvent::WindowEvent { event: tauri::WindowEvent::Focused(true), .. } = &event {
                WINDOW_SHOWN_LOGGED.call_once(|| {
                    info!("[STARTUP-TIME] rust_window_focused t={}", t0.elapsed().as_millis());
                });
            }

            // 应用退出请求时：停止 frontmatter 索引线程，释放独立数据库连接
            if let tauri::RunEvent::ExitRequested { .. } = event {
                services::frontmatter_index::stop_index_thread();
                // 退出前执行 PRAGMA optimize，优化 SQLite 查询计划
                if let Some(db) = app_handle.try_state::<crate::db::Database>() {
                    if let Ok(conn) = db.conn.lock() {
                        if let Err(e) = conn.execute_batch("PRAGMA optimize;") {
                            error!("[lib] PRAGMA optimize failed: {}", e);
                        }
                    }
                }
                // 发送 shutdown 信号停止 AI 代理
                if let Some(holder) =
                    app_handle.try_state::<commands::ai::SharedAiProxyState>()
                {
                    let mut guard = holder
                        .server
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    if let Some(server) = guard.take() {
                        let _ = server.shutdown_tx.send(());
                    }
                }
            }
        });
}

/// 计算日志目录路径（纯函数，便于测试）。
///
/// 优先级：
/// 1. `SWALLOWNOTE_LOG_DIR` 环境变量（测试/自定义覆盖）
/// 2. exe 父目录下的 `logs/` 子目录（应用安装目录）
/// 3. 当前工作目录下的 `logs/`（兜底）
fn resolve_log_dir(exe_path: Option<&std::path::Path>, env_override: Option<&str>) -> std::path::PathBuf {
    // 1. 环境变量覆盖（测试/自定义）
    if let Some(dir) = env_override {
        return std::path::PathBuf::from(dir);
    }
    // 2. exe 父目录下的 logs/ 子目录（应用安装目录）
    if let Some(exe) = exe_path {
        if let Some(parent) = exe.parent() {
            return parent.join("logs");
        }
    }
    // 3. 兜底：当前工作目录下的 logs/
    std::path::PathBuf::from("logs")
}

#[cfg(test)]
mod tests {
    use super::resolve_log_dir;
    use std::path::{Path, PathBuf};

    #[test]
    fn resolve_log_dir_uses_exe_parent_logs_subdir() {
        let exe = Path::new("/usr/local/app/swallownote.exe");
        let dir = resolve_log_dir(Some(exe), None);
        assert_eq!(dir, PathBuf::from("/usr/local/app/logs"));
    }

    #[test]
    fn resolve_log_dir_env_override_wins() {
        let exe = Path::new("/usr/local/app/swallownote.exe");
        let dir = resolve_log_dir(Some(exe), Some("/custom/logs"));
        assert_eq!(dir, PathBuf::from("/custom/logs"));
    }

    #[test]
    fn resolve_log_dir_no_exe_falls_back_to_cwd_logs() {
        let dir = resolve_log_dir(None, None);
        assert_eq!(dir, PathBuf::from("logs"));
    }

    #[test]
    fn resolve_log_dir_env_override_without_exe() {
        let dir = resolve_log_dir(None, Some("/var/log/swallownote"));
        assert_eq!(dir, PathBuf::from("/var/log/swallownote"));
    }
}
