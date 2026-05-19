use notify::event::{EventKind, ModifyKind};
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, RecommendedCache};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

struct FileWatcherState {
    debouncer: Option<notify_debouncer_full::Debouncer<notify::RecommendedWatcher, RecommendedCache>>,
    watched_paths: Vec<PathBuf>,
}

impl FileWatcherState {
    fn new() -> Self {
        Self {
            debouncer: None,
            watched_paths: Vec::new(),
        }
    }
}

static FILE_WATCHER: Mutex<Option<FileWatcherState>> = Mutex::new(None);

pub fn init_watcher(app_handle: AppHandle) {
    let mut guard = FILE_WATCHER.lock().unwrap();
    if guard.is_some() {
        return;
    }

    let app_handle_clone = app_handle.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        None,
        move |res: DebounceEventResult| {
            match res {
                Ok(events) => {
                    for event in events {
                        let event_type = match event.kind {
                            EventKind::Modify(ModifyKind::Name(_)) => "renamed",
                            EventKind::Modify(_) => "modified",
                            EventKind::Create(_) => "created",
                            EventKind::Remove(_) => "removed",
                            _ => continue,
                        };

                        for path in &event.paths {
                            let path_str = path.to_string_lossy().to_string();
                            let _ = app_handle_clone.emit(
                                "file-watcher-event",
                                serde_json::json!({
                                    "type": event_type,
                                    "path": path_str,
                                }),
                            );
                        }
                    }
                }
                Err(errors) => {
                    for error in errors {
                        eprintln!("File watcher error: {:?}", error);
                    }
                }
            }
        },
    )
    .expect("Failed to create debouncer");

    *guard = Some(FileWatcherState {
        debouncer: Some(debouncer),
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

    if state.watched_paths.contains(&path_buf) {
        return Ok(());
    }

    if let Some(ref mut debouncer) = state.debouncer {
        debouncer
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

    if let Some(ref mut debouncer) = state.debouncer {
        debouncer
            .unwatch(&path_buf)
            .map_err(|e| format!("Failed to unwatch directory: {}", e))?;

        state.watched_paths.retain(|p| p != &path_buf);
        Ok(())
    } else {
        Err("Watcher not available".to_string())
    }
}
