mod commands;
mod db;
mod plugins;
mod services;

use plugins::mac_rounded_corners;
use db::Database;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
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
            commands::git::git_log,
            commands::git::scan_git_repos,
            commands::folder_history::save_folder_history,
            commands::folder_history::get_latest_folder,
            commands::folder_history::get_folder_history,
            services::file_watcher::watch_directory,
            services::file_watcher::unwatch_directory,
            mac_rounded_corners::enable_rounded_corners,
            mac_rounded_corners::enable_modern_window_style,
            mac_rounded_corners::reposition_traffic_lights,
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
            services::file_watcher::init_watcher(app_handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
