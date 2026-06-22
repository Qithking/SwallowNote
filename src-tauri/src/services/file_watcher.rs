use notify::event::{EventKind, ModifyKind};
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, RecommendedCache};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

struct FileWatcherState {
    debouncer: Option<notify_debouncer_full::Debouncer<notify::RecommendedWatcher, RecommendedCache>>,
    watched_paths: Vec<PathBuf>,
}

impl FileWatcherState {
    #[allow(dead_code)]
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

    let debouncer = new_debouncer(
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
                            let path_str = path.to_string_lossy().to_string().replace('\\', "/");
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

/// 监听 plugins 目录下 storage.json 变更，发射 plugin-storage-changed 事件供前端同步存储大小。幂等。
pub fn watch_plugin_storage(app_handle: AppHandle) {
    // 复用 init_watcher 单例；未初始化时静默跳过。
    let mut guard = match FILE_WATCHER.lock() {
        Ok(g) => g,
        Err(e) => {
            eprintln!("[file_watcher] lock poisoned, skipping plugin watch: {e}");
            return;
        }
    };
    let state = match guard.as_mut() {
        Some(s) => s,
        None => return,
    };

    let app_data_dir = match app_handle.path().app_data_dir() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[file_watcher] failed to resolve app_data_dir: {e}");
            return;
        }
    };
    let plugins_root = app_data_dir.join("plugins");

    // Create the dir on the spot so the watcher can attach —
    // fresh installs (no plugins yet) would otherwise fail to
    // watch a non-existent path.
    if !plugins_root.exists() {
        if let Err(e) = std::fs::create_dir_all(&plugins_root) {
            eprintln!(
                "[file_watcher] failed to create {}: {e}",
                plugins_root.display()
            );
            return;
        }
    }

    // Skip if we already watch this root (idempotent across
    // `setup` re-runs, e.g. hot reload).
    if state.watched_paths.contains(&plugins_root) {
        return;
    }

    if let Some(ref mut debouncer) = state.debouncer {
        if let Err(e) = debouncer.watch(&plugins_root, RecursiveMode::Recursive) {
            eprintln!(
                "[file_watcher] failed to watch {}: {e}",
                plugins_root.display()
            );
            return;
        }
        state.watched_paths.push(plugins_root);
    } else {
        return;
    }

    // 安装第二个 debouncer 监听同一路径；notify 允许多 watcher 共存。
    drop(guard); // release the singleton lock before constructing the second watcher

    let app_handle_for_storage = app_handle.clone();
    let storage_debouncer = match new_debouncer(
        Duration::from_millis(500),
        None,
        move |res: DebounceEventResult| {
            let events = match res {
                Ok(events) => events,
                Err(errors) => {
                    for error in errors {
                        eprintln!("[file_watcher] plugin-storage error: {:?}", error);
                    }
                    return;
                }
            };

            for event in events {
                // 仅关注 storage.json 写入/删除事件。
                for path in &event.paths {
                    let Some(plugin_id) = extract_plugin_storage_id(path) else {
                        continue;
                    };
                    let size = match std::fs::metadata(path) {
                        Ok(meta) if meta.is_file() => meta.len(),
                        _ => 0,
                    };
                    let _ = app_handle_for_storage.emit(
                        "plugin-storage-changed",
                        serde_json::json!({
                            "pluginId": plugin_id,
                            "size": size,
                        }),
                    );
                }
            }
        },
    ) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[file_watcher] failed to start storage debouncer: {e:?}");
            return;
        }
    };

    // 用 OnceLock 持有第二个 debouncer 以避免结构体 schema 变更。
    PLUGIN_STORAGE_DEBOUNCER.set(storage_debouncer).ok();
}

/// 从 <app_data>/plugins/<pluginId>/storage.json 路径提取 pluginId；路径深度不符返回 None。
fn extract_plugin_storage_id(path: &Path) -> Option<String> {
    let components: Vec<&str> = path
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();
    let len = components.len();
    if len < 3 {
        return None;
    }
    if components[len - 1] != "storage.json" {
        return None;
    }
    let parent = components[len - 2];
    if parent.is_empty() || parent.starts_with('.') {
        return None;
    }
    Some(parent.to_string())
}

use once_cell::sync::OnceCell;
static PLUGIN_STORAGE_DEBOUNCER: OnceCell<
    notify_debouncer_full::Debouncer<notify::RecommendedWatcher, RecommendedCache>,
> = OnceCell::new();
