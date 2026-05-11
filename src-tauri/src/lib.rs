mod commands;
mod services;

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
            commands::git::git_is_repo,
            commands::git::git_init,
            commands::git::git_status,
            commands::git::git_diff,
            commands::git::git_commit,
            commands::git::git_log,
            services::file_watcher::watch_directory,
            services::file_watcher::unwatch_directory,
        ])
        .setup(|app| {
            // Initialize file watcher service
            let app_handle = app.handle().clone();
            services::file_watcher::init_watcher(app_handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
