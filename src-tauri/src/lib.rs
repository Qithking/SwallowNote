mod commands;
mod db;
mod plugins;
mod services;

use plugins::mac_rounded_corners;
use db::Database;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
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
    #[cfg(target_os = "macos")]
    {
        let result = std::panic::catch_unwind(|| {
            unsafe { mac_rounded_corners::set_dock_icon_visibility_impl(visible) }
        });
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(e),
            Err(_) => return Err("panic in set_dock_icon_visibility".to_string()),
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = visible;
    Ok(())
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
            commands::file::list_directory,
            commands::file::read_file,
            commands::file::write_file,
            commands::file::create_file,
            commands::file::delete_file,
            commands::file::rename_file,
            commands::file::copy_file,
            commands::file::copy_file_to_clipboard,
            commands::file::open_in_finder,
            commands::file::search_in_files,
            commands::git::git_is_repo,
            commands::git::git_init,
            commands::git::git_status,
            commands::git::git_diff,
            commands::git::git_commit,
            commands::git::git_push,
            commands::git::git_commit_and_push,
            commands::git::git_auto_commit,
            commands::git::git_log,
            commands::git::git_file_log,
            commands::git::git_show_diff,
            commands::git::git_clone,
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
            commands::upgrade::get_platform_extension,
            commands::upgrade::get_download_dir,
            services::file_watcher::watch_directory,
            services::file_watcher::unwatch_directory,
            mac_rounded_corners::enable_rounded_corners,
            mac_rounded_corners::enable_modern_window_style,
            mac_rounded_corners::reposition_traffic_lights,
            set_dock_icon_visibility,
        ])
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).ok();

            match db::init_db(app_data_dir) {
                Ok(db) => {
                    app.handle().manage(db);
                }
                Err(e) => {
                    eprintln!("Failed to initialize database: {}", e);
                }
            }

            let app_handle = app.handle().clone();
            services::file_watcher::init_watcher(app_handle.clone());

            let show_item = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("SwallowNote")
                .menu(&menu)
                .on_menu_event(move |app: &AppHandle, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        #[cfg(target_os = "macos")]
                        {
                            let _ = std::panic::catch_unwind(|| unsafe { crate::plugins::mac_rounded_corners::set_dock_icon_visibility_impl(true) });
                        }
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
                        #[cfg(target_os = "macos")]
                        {
                            let _ = std::panic::catch_unwind(|| unsafe { crate::plugins::mac_rounded_corners::set_dock_icon_visibility_impl(true) });
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
