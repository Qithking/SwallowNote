mod ai_proxy;
mod commands;
mod db;
mod i18n;
mod plugins;
mod services;

use plugins::mac_rounded_corners;
use db::Database;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    path::BaseDirectory,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent,
};
use tauri_plugin_autostart::MacosLauncher;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Set Dock icon visibility on macOS
/// When visible=true: NSApplicationActivationPolicyRegular (shows in Dock)
/// When visible=false: NSApplicationActivationPolicyAccessory (hides from Dock)
#[tauri::command]
fn set_dock_icon_visibility(visible: bool) -> Result<(), String> {
    set_dock_icon_visibility_inner(visible)
}

/// Inner implementation for setting Dock icon visibility
#[cfg(target_os = "macos")]
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
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
            commands::git::git_force_pull,
            commands::git::git_credential_save,
            commands::git::git_credential_get,
            commands::git::git_credential_delete,
            commands::git::git_commit_and_push,
            commands::git::git_auto_commit,
            commands::git::git_log,
            commands::git::git_file_log,
            commands::git::git_show_diff,
            commands::git::git_clone,
            commands::git::git_clone_with_credentials,
            commands::git::scan_git_repos,
            commands::folder_history::save_folder_history,
            commands::folder_history::get_latest_folder,
            commands::folder_history::get_folder_history,
            commands::folder_history::remove_folder_history,
            commands::folder_history::clear_other_folder_history,
            commands::session_state::save_session_state,
            commands::session_state::get_session_state,
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
            commands::ai_builtin_models::get_builtin_ai_models,
        ])
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).ok();

            // Initialize backend i18n translations
            crate::i18n::init_translations();

            match db::init_db(app_data_dir.clone()) {
                Ok(db) => {
                    app.handle().manage(db);
                }
                Err(e) => {
                    eprintln!("Failed to initialize database: {}", e);
                }
            }


            let app_handle = app.handle().clone();
            services::file_watcher::init_watcher(app_handle.clone());

            app.handle().manage(commands::ai::new_shared_ai_proxy_state());

            let ai_holder = app.handle().state::<commands::ai::SharedAiProxyState>().inner().clone();
            let db = app.handle().state::<db::Database>().inner();
            let ai_settings = {
                let conn = db.conn.lock().unwrap();
                let mut stmt = conn.prepare("SELECT key, value FROM session_state WHERE key LIKE 'settings.ai%'").unwrap();
                let rows: std::collections::HashMap<String, String> = stmt.query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                }).unwrap().filter_map(|r| r.ok()).collect();
                drop(stmt);
                drop(conn);

                let get = |key: &str| rows.get(key).cloned().unwrap_or_default();
                crate::ai_proxy::AiSettings {
                    provider: get("settings.aiProvider"),
                    api_key: {
                        let encrypted = get("settings.aiApiKey");
                        if !encrypted.is_empty() {
                            crate::ai_proxy::crypto::decrypt_api_key(&encrypted).unwrap_or_default()
                        } else {
                            String::new()
                        }
                    },
                    base_url: get("settings.aiBaseUrl"),
                    model: get("settings.aiModel"),
                    port: get("settings.aiPort").parse::<u16>().unwrap_or(4017),
                }
            };

            if !ai_settings.provider.is_empty() {
                let holder = ai_holder.clone();
                tauri::async_runtime::spawn(async move {
                    match crate::ai_proxy::server::start_ai_proxy(ai_settings).await {
                        Ok(server) => {
                            let mut guard = holder.server.lock().unwrap();
                            *guard = Some(server);
                        }
                        Err(e) => {
                            eprintln!("Failed to start AI proxy: {}", e);
                        }
                    }
                });
            }

            let show_item = MenuItemBuilder::with_id("show", crate::i18n::t("tray.showWindow")).build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", crate::i18n::t("tray.quit")).build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let tray_icon = if let Ok(tray_icon_path) = app.path().resolve("icons/tray-icon.png", BaseDirectory::Resource) {
                Image::from_path(&tray_icon_path).unwrap_or_else(|_| app.default_window_icon().unwrap().clone())
            } else {
                app.default_window_icon().unwrap().clone()
            };

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .tooltip("SwallowNote")
                .menu(&menu)
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
