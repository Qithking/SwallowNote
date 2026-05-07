use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher, Event};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

struct FileWatcherState {
    watcher: Option<RecommendedWatcher>,
    watched_paths: Vec<PathBuf>,
}

impl FileWatcherState {
    fn new() -> Self {
        Self {
            watcher: None,
            watched_paths: Vec::new(),
        }
    }
}

// Global file watcher state
static FILE_WATCHER: Mutex<Option<FileWatcherState>> = Mutex::new(None);

pub fn init_watcher(app_handle: AppHandle) {
    let mut guard = FILE_WATCHER.lock().unwrap();
    if guard.is_some() {
        return; // Already initialized
    }

    let app_handle_clone = app_handle.clone();

    let watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                // Debounce: send event after a short delay
                // For now, emit immediately; can add debouncing later
                for path in &event.paths {
                    let _ = app_handle_clone.emit("file-changed", path.to_string_lossy().to_string());
                }
            }
        },
        Config::default().with_poll_interval(Duration::from_secs(2)),
    )
    .expect("Failed to create file watcher");

    *guard = Some(FileWatcherState {
        watcher: Some(watcher),
        watched_paths: Vec::new(),
    });
}

#[tauri::command]
pub fn watch_directory(path: String) -> Result<(), String> {
    let mut guard = FILE_WATCHER.lock().unwrap();
    let state = guard.as_mut().ok_or("File watcher not initialized")?;

    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    // Check if already watching this path
    if state.watched_paths.contains(&path_buf) {
        return Ok(());
    }

    if let Some(ref mut watcher) = state.watcher {
        watcher
            .watch(&path_buf, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch directory: {}", e))?;

        state.watched_paths.push(path_buf);
        Ok(())
    } else {
        Err("Watcher not available".to_string())
    }
}

#[tauri::command]
pub fn unwatch_directory(path: String) -> Result<(), String> {
    let mut guard = FILE_WATCHER.lock().unwrap();
    let state = guard.as_mut().ok_or("File watcher not initialized")?;

    let path_buf = PathBuf::from(&path);

    if let Some(ref mut watcher) = state.watcher {
        watcher
            .unwatch(&path_buf)
            .map_err(|e| format!("Failed to unwatch directory: {}", e))?;

        state.watched_paths.retain(|p| p != &path_buf);
        Ok(())
    } else {
        Err("Watcher not available".to_string())
    }
}
