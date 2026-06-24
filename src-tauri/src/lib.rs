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
    AppHandle, Manager,
};
use tauri_plugin_autostart::MacosLauncher;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// macOS Dock 图标可见性切换（Regular/Accessory 策略）。
#[tauri::command]
fn set_dock_icon_visibility(visible: bool) -> Result<(), String> {
    set_dock_icon_visibility_inner(visible)
}

/// Inner implementation for setting Dock icon visibility
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

/// Show Dock icon on macOS - used by tray menu/tray icon click
/// This function is a no-op on non-macOS platforms
fn show_dock_icon() {
    let _ = set_dock_icon_visibility_inner(true);
}

/// 1x1 透明 RGBA 图标，用作 tray 图标加载失败时的兜底，避免在
/// `tauri.conf.json` 缺 `bundle.icon` 等场景下 panic 整应用。
fn default_tray_icon() -> tauri::image::Image<'static> {
    let rgba = vec![0u8, 0, 0, 0]; // 透明 1x1
    tauri::image::Image::new_owned(rgba, 1, 1)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance is launched, focus the existing window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                show_dock_icon();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            greet,
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
        ])
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).ok();

            // Initialize backend i18n translations
            crate::i18n::init_translations();

            match db::init_db(app_data_dir.clone()) {
                Ok(db) => {
                    // 启动时同步分类：补全历史数据中缺失的父路径
                    if let Err(e) = db::md_frontmatter::sync_all_categories_from_frontmatter(&db) {
                        eprintln!("Failed to sync categories on startup: {}", e);
                    }
                    app.handle().manage(db);
                    // 启动 frontmatter 索引子线程（使用独立数据库连接）
                    let index_db_path = app_data_dir.join("swallownote.db");
                    services::frontmatter_index::start_index_thread(index_db_path, app.handle().clone());
                }
                Err(e) => {
                    eprintln!("Failed to initialize database: {}", e);
                }
            }


            let app_handle = app.handle().clone();
            services::file_watcher::init_watcher(app_handle.clone());
            // 监听 plugins 树，外部 storage.json 变更时通知前端。幂等。
            services::file_watcher::watch_plugin_storage(app_handle.clone());

            app.handle().manage(commands::git::new_clone_pid_state());
            app.handle().manage(commands::ai::new_shared_ai_proxy_state());
            // 每插件后端子进程状态；启动为空，首次 invoke_plugin 时懒加载。
            app.handle().manage(commands::plugin_invoke::new_shared_plugin_process_state());

            // AI proxy is no longer auto-started on launch to save memory.
            // It will be started on-demand when the user opens the AI panel.

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
                        app.exit(0);
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
