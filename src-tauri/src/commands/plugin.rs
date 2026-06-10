/**
 * Rust backend commands for plugin management.
 *
 * - scan_plugins:           Scan the plugins directory and return metadata
 * - install_plugin:         Install a plugin from a .zip file
 * - uninstall_plugin:       Remove a plugin directory
 * - toggle_plugin_enabled:  Toggle a plugin's enabled marker
 * - get_plugin_storage_path: Resolve a plugin's storage.json path
 *
 * The companion `plugin_invoke` module implements the JSON-RPC
 * subprocess layer that powers `panel.invokeBackend(...)` on the
 * frontend. The TS side calls into it via
 * `invoke('plugin_<id>_<cmd>', args)`.
 *
 * All five commands above return `Result<_, PluginError>` — the
 * `Display` impl produces the same human-readable string the previous
 * `Result<_, String>` returned, so the TS-side `err.message` contract
 * is preserved. See [`crate::commands::error::PluginError`].
 */

use crate::commands::error::PluginError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Metadata for a plugin package, returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginMetadataRust {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub published_at: String,
    pub icon_position: String,      // "sidebar" | "editorToolbar" | "titleBar"
    pub content_position: String,   // "leftPanel" | "rightPanel" | "fullPanel" | "editorArea"
    pub order: i32,
    pub enabled: bool,
    pub plugin_path: String,
    pub has_backend: bool,
}

/// Get the plugins directory path.
/// Located at <app_data_dir>/plugins/
fn plugins_dir(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("plugins")
}

/// Read the metadata from a plugin's index.js.
/// The index.js should export a `manifest` object or have a JSON comment block.
/// We parse a special `// @swallow-manifest { ... }` comment at the top of the file.
fn parse_manifest_from_index_js(index_js_path: &PathBuf) -> Option<PluginMetadataRust> {
    let content = fs::read_to_string(index_js_path).ok()?;

    // Look for the manifest JSON block in the first comment
    // Format: // @swallow-manifest { "id": "...", "name": "...", ... }
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("// @swallow-manifest") {
            let json_str = rest.trim();
            if let Ok(meta) = serde_json::from_str::<PluginMetadataRust>(json_str) {
                return Some(meta);
            }
        }
    }

    None
}

#[tauri::command]
pub fn scan_plugins(app_handle: tauri::AppHandle) -> Result<Vec<PluginMetadataRust>, PluginError> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to get app data dir: {}", e)))?;

    let plugins_root = plugins_dir(&app_data_dir);

    // Ensure plugins directory exists
    fs::create_dir_all(&plugins_root).map_err(|e| PluginError::Io(format!("Failed to create plugins dir: {}", e)))?;

    let mut plugins = Vec::new();

    let entries = fs::read_dir(&plugins_root).map_err(|e| PluginError::Io(format!("Failed to read plugins dir: {}", e)))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let index_js = path.join("index.js");
        if !index_js.exists() {
            continue;
        }

        let plugin_id = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let has_backend = path.join("backend").exists();
        // Read the disabled marker so toggling persists across scans.
        let enabled = !path.join(".disabled").exists();

        if let Some(mut meta) = parse_manifest_from_index_js(&index_js) {
            // Persisted enabled state takes precedence over the manifest value.
            meta.enabled = enabled;
            meta.plugin_path = path.to_string_lossy().to_string();
            meta.has_backend = has_backend;
            plugins.push(meta);
        } else {
            // Fallback: create minimal metadata from directory name
            plugins.push(PluginMetadataRust {
                id: plugin_id.clone(),
                name: plugin_id.clone(),
                description: String::new(),
                version: String::new(),
                author: String::new(),
                published_at: String::new(),
                icon_position: String::from("sidebar"),
                content_position: String::from("leftPanel"),
                order: 100,
                enabled,
                plugin_path: path.to_string_lossy().to_string(),
                has_backend,
            });
        }
    }

    Ok(plugins)
}

#[tauri::command]
pub fn install_plugin(
    app_handle: tauri::AppHandle,
    zip_path: String,
) -> Result<PluginMetadataRust, PluginError> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to get app data dir: {}", e)))?;

    let plugins_root = plugins_dir(&app_data_dir);
    fs::create_dir_all(&plugins_root).map_err(|e| PluginError::Io(format!("Failed to create plugins dir: {}", e)))?;

    // Determine the plugin id from the top-level directory in the zip
    // or from the zip filename
    let zip_filename = PathBuf::from(&zip_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let plugin_dir = plugins_root.join(&zip_filename);

    // Remove existing plugin if it exists
    if plugin_dir.exists() {
        fs::remove_dir_all(&plugin_dir)
            .map_err(|e| PluginError::Io(format!("Failed to remove existing plugin: {}", e)))?;
    }

    // Pre-extract validation: walk every entry's name and reject anything
    // that resolves outside plugin_dir (zip slip / absolute paths / symlinks).
    // This runs BEFORE extract so the directory is never polluted with
    // malicious files. zip 2.x already rejects `..` and absolute paths via
    // the `unsafe` path restriction, but this explicit check makes the
    // invariant clear and survives future zip upgrades.
    //
    // We open the ZipArchive once, do all the precheck, and then reuse the
    // same handle for extract. This avoids a redundant File::open and any
    // platform-specific double-handle races (e.g. Windows share-mode).
    let mut archive = zip::ZipArchive::new(fs::File::open(&zip_path)
        .map_err(|e| PluginError::Io(format!("Failed to open zip file: {}", e)))?)
        .map_err(|e| PluginError::Io(format!("Failed to read zip archive: {}", e)))?;
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| PluginError::Io(format!("Failed to read zip entry {}: {}", i, e)))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| PluginError::Security("Security: zip entry has unsafe name".to_string()))?;
        let candidate = plugin_dir.join(enclosed);
        // Reject absolute paths or anything escaping plugin_dir.
        if candidate
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(PluginError::Security(format!(
                "Security: zip entry '{}' contains parent-dir reference",
                entry.name()
            )));
        }
        if !candidate.starts_with(&plugin_dir) {
            return Err(PluginError::Security(format!(
                "Security: zip entry '{}' escapes plugin dir",
                entry.name()
            )));
        }
        // Reject symlinks (Unix external-attribute high nibble = 0120000).
        // zip stores symlink targets as the file content; on extract the
        // target would be written to disk and the symlink would resolve
        // at access time, letting a malicious zip point inside plugin_dir
        // to /etc or ~. We refuse to extract any entry that's not a
        // regular file or directory.
        if entry.is_symlink() {
            return Err(PluginError::Security(format!(
                "Security: zip entry '{}' is a symlink (forbidden)",
                entry.name()
            )));
        }
    }

    // Extract the archive using the same handle we just prechecked.
    if let Err(e) = archive.extract(&plugin_dir) {
        // Clean up any partial extraction before propagating the error.
        let _ = fs::remove_dir_all(&plugin_dir);
        return Err(PluginError::Io(format!("Failed to extract zip: {}", e)));
    }

    // If the zip contained a single top-level directory, flatten it
    let entries: Vec<_> = fs::read_dir(&plugin_dir)
        .map_err(|e| PluginError::Io(format!("Failed to read extracted dir: {}", e)))?
        .filter_map(|e| e.ok())
        .collect();

    if entries.len() == 1 && entries[0].path().is_dir() {
        let inner_dir = entries[0].path().clone();
        // Move contents up
        let temp_dir = plugin_dir.with_extension("_tmp");
        fs::rename(&inner_dir, &temp_dir)
            .map_err(|e| PluginError::Io(format!("Failed to move inner dir: {}", e)))?;
        for entry in fs::read_dir(&temp_dir).map_err(|e| PluginError::Io(format!("Failed to read temp dir: {}", e)))?.flatten() {
            let dest = plugin_dir.join(entry.file_name());
            fs::rename(entry.path(), dest).map_err(|e| PluginError::Io(format!("Failed to move file: {}", e)))?;
        }
        fs::remove_dir_all(&temp_dir).map_err(|e| PluginError::Io(format!("Failed to remove temp dir: {}", e)))?;
    }

    // Verify index.js exists
    let index_js = plugin_dir.join("index.js");
    if !index_js.exists() {
        fs::remove_dir_all(&plugin_dir).ok();
        return Err(PluginError::InvalidInput("Plugin package must contain an index.js file".to_string()));
    }

    let has_backend = plugin_dir.join("backend").exists();
    // Newly installed plugins are enabled by default; the .disabled marker
    // is created by toggle_plugin_enabled when the user disables it.
    let enabled = !plugin_dir.join(".disabled").exists();

    let meta = parse_manifest_from_index_js(&index_js).unwrap_or(PluginMetadataRust {
        id: zip_filename.clone(),
        name: zip_filename.clone(),
        description: String::new(),
        version: String::new(),
        author: String::new(),
        published_at: String::new(),
        icon_position: String::from("sidebar"),
        content_position: String::from("leftPanel"),
        order: 100,
        enabled,
        plugin_path: plugin_dir.to_string_lossy().to_string(),
        has_backend,
    });

    Ok(meta)
}

#[tauri::command]
pub fn uninstall_plugin(app_handle: tauri::AppHandle, plugin_id: String) -> Result<(), PluginError> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to get app data dir: {}", e)))?;

    let plugins_root = plugins_dir(&app_data_dir);
    let plugin_dir = plugins_root.join(&plugin_id);

    if !plugin_dir.exists() {
        return Err(PluginError::NotFound(format!("Plugin '{}' not found", plugin_id)));
    }

    // Security check: ensure we're only deleting within the plugins directory
    let canonical_plugins = plugins_root
        .canonicalize()
        .map_err(|e| PluginError::Io(format!("Failed to resolve plugins path: {}", e)))?;
    let canonical_plugin = plugin_dir
        .canonicalize()
        .map_err(|e| PluginError::Io(format!("Failed to resolve plugin path: {}", e)))?;

    if !canonical_plugin.starts_with(&canonical_plugins) {
        return Err(PluginError::Security("Security: attempted to delete outside plugins directory".to_string()));
    }

    fs::remove_dir_all(&plugin_dir).map_err(|e| PluginError::Io(format!("Failed to remove plugin: {}", e)))?;

    Ok(())
}

#[tauri::command]
pub fn toggle_plugin_enabled(
    app_handle: tauri::AppHandle,
    plugin_id: String,
    enabled: bool,
) -> Result<(), PluginError> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to get app data dir: {}", e)))?;

    let plugins_root = plugins_dir(&app_data_dir);
    let plugin_dir = plugins_root.join(&plugin_id);
    let disabled_marker = plugin_dir.join(".disabled");

    if enabled {
        // Remove the disabled marker
        if disabled_marker.exists() {
            fs::remove_file(&disabled_marker).map_err(|e| PluginError::Io(format!("Failed to enable plugin: {}", e)))?;
        }
    } else {
        // Create the disabled marker
        fs::write(&disabled_marker, "").map_err(|e| PluginError::Io(format!("Failed to disable plugin: {}", e)))?;
    }

    Ok(())
}

/**
 * Return the absolute path to a plugin's JSON storage file.
 *
 * The path is `<app_data_dir>/plugins/<plugin_id>/storage.json` and is
 * where the frontend (src/lib/plugin-host.ts) persists plugin
 * key/value state. Returning the path from the host keeps the cross-
 * platform app-data location logic in one place.
 */
#[tauri::command]
pub fn get_plugin_storage_path(
    app_handle: tauri::AppHandle,
    plugin_id: String,
) -> Result<String, PluginError> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to get app data dir: {}", e)))?;
    let plugin_storage = plugins_dir(&app_data_dir)
        .join(&plugin_id)
        .join("storage.json");
    Ok(plugin_storage.to_string_lossy().to_string())
}
