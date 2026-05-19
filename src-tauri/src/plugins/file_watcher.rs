use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow};

struct FileWatcherStateInner {
    watcher: Option<notify_debouncer_mini::Debouncer<RecommendedWatcher>>,
    watched_paths: Vec<PathBuf>,
}

impl FileWatcherStateInner {
    fn new() -> Self {
        Self {
            watcher: None,
            watched_paths: Vec::new(),
        }
    }
}

pub type FileWatcherState = Mutex<FileWatcherStateInner>;

fn emit_event(app: &AppHandle, event_type: &str, path: &str) {
    let _ = app.emit("file-watcher-event", serde_json::json!({
        "type": event_type,
        "path": path,
    }));
}

#[tauri::command]
pub fn start_watching<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    state: State<'_, FileWatcherState>,
    paths: Vec<String>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;

    let path_bufs: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    state.watched_paths = path_bufs.clone();

    let app_clone = app.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        None,
        move |res: DebounceEventResult| {
            match res {
                Ok(events) => {
                    for event in events {
                        for path in event.paths {
                            let path_str = path.to_string_lossy().to_string();
                            match event.kind {
                                notify::EventKind::Modify(_) => {
                                    emit_event(&app_clone, "modified", &path_str);
                                }
                                notify::EventKind::Create(_) => {
                                    emit_event(&app_clone, "created", &path_str);
                                }
                                notify::EventKind::Remove(_) => {
                                    emit_event(&app_clone, "removed", &path_str);
                                }
                                notify::EventKind::Rename(_) => {
                                    emit_event(&app_clone, "renamed", &path_str);
                                }
                                _ => {}
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("File watcher error: {:?}", e);
                }
            }
        },
    )
    .map_err(|e| e.to_string())?;

    for path in &path_bufs {
        debouncer
            .watcher()
            .watch(path, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;
    }

    state.watcher = Some(debouncer);

    Ok(())
}

#[tauri::command]
pub fn stop_watching(state: State<'_, FileWatcherState>) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    state.watcher = None;
    state.watched_paths.clear();
    Ok(())
}

#[tauri::command]
pub fn add_watch_paths<R: Runtime>(
    state: State<'_, FileWatcherState>,
    paths: Vec<String>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;

    if let Some(ref mut watcher) = state.watcher {
        for path_str in &paths {
            let path = PathBuf::from(path_str);
            watcher
                .watcher()
                .watch(&path, RecursiveMode::Recursive)
                .map_err(|e| e.to_string())?;
            state.watched_paths.push(path);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn remove_watch_paths<R: Runtime>(
    state: State<'_, FileWatcherState>,
    paths: Vec<String>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;

    if let Some(ref mut watcher) = state.watcher {
        for path_str in &paths {
            let path = PathBuf::from(path_str);
            watcher
                .watcher()
                .unwatch(&path)
                .map_err(|e| e.to_string())?;
            state.watched_paths.retain(|p| p != &path);
        }
    }

    Ok(())
}

pub fn init() -> impl FnOnce(&mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    |app| {
        app.manage(FileWatcherState::new(FileWatcherStateInner::new()));
        Ok(())
    }
}
