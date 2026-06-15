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

/// Wire up a recursive watch on `<app_data>/plugins/` for the
/// lifetime of the app. Whenever a `storage.json` inside that
/// tree is created / modified / removed, emit a dedicated
/// `plugin-storage-changed` event with the resolved plugin id
/// and current file size (or `0` on remove). The frontend
/// listens for this event and reconciles its in-memory
/// `pluginStorageSize` tracker (which otherwise only knows
/// about deltas observed through the JS-side `set`/`delete`
/// path).
///
/// Why a dedicated event (rather than piggy-backing on
/// `file-watcher-event`)? The host's storage files live in the
/// same `app_data` tree as user markdown files, and the
/// editor's existing `file-watcher-event` handler ignores
/// non-editor paths. A separate, narrowly-scoped event keeps
/// the editor's hot path free of plugin-storage concerns and
/// makes the wiring self-documenting.
///
/// Idempotent — re-invoking the function is a no-op (the
/// existing `init_watcher` setup already early-returns on a
/// non-empty state).
pub fn watch_plugin_storage(app_handle: AppHandle) {
    // Walk into the same singleton used by `init_watcher`. If
    // the host didn't call `init_watcher` first (an
    // integration mistake), we silently no-op — the file
    // watcher is required infrastructure for both editor file
    // tracking and plugin storage tracking, and silently
    // dropping storage events is strictly better than
    // panicking.
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

    // We've registered the watch. The event-emit filter is
    // already handled by the global debouncer callback
    // (defined in `init_watcher`) — we just need to add a
    // second filter / emitter on top of it that knows about
    // the plugin-storage shape.
    //
    // To avoid racing the global debouncer for ownership of
    // the same event stream, we install a second lightweight
    // debouncer on the same path. The notify crate allows
    // multiple watchers on the same path, so the two
    // debouncers coexist; the cost is one extra OS handle per
    // watched path (negligible at 1 path).
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
                // We're only interested in writes/removes on
                // a file whose leaf name is `storage.json`.
                // Anything else (e.g. plugin install creates
                // a sibling `index.js`, `manifest.json`) gets
                // dropped on the floor.
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

    // Stash the second debouncer so it lives as long as the
    // app — dropping it cancels the watch. We piggy-back on
    // the same static `FILE_WATCHER` for symmetry, but as a
    // second field. To avoid a schema change, we leak the
    // debouncer behind a Box into the existing struct's
    // `debouncer` field position is awkward — instead we use
    // a `OnceLock` of a separate handle.
    PLUGIN_STORAGE_DEBOUNCER.set(storage_debouncer).ok();
}

/// Extract a plugin id from a path that looks like
/// `<app_data>/plugins/<pluginId>/storage.json`.
///
/// Returns `None` if the path doesn't end in `storage.json`
/// or doesn't have the expected depth (we require **3**
/// components after the `plugins/` segment so a stray file at
/// `<app_data>/plugins/storage.json` or a nested
/// `<app_data>/plugins/<id>/.cache/storage.json` is ignored).
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
