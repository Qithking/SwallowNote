/**
 * Rust backend commands for plugin management.
 *
 * Layout
 * ======
 *
 * Plugins live under `<app_data_dir>/plugins/<id>/`. As of Phase 9.2
 * every install is **versioned**:
 *
 * ```text
 * <app_data>/plugins/<id>/
 *   .versions/<semver>/       (full snapshot of one version)
 *   current                    (symlink → .versions/<active>/)
 *   .current_version           (plain text: "<active semver>" — fallback
 *                               for platforms where symlink creation
 *                               fails, e.g. Windows without Developer
 *                               Mode)
 *   storage.json               (live, never versioned)
 *   .disabled                  (marker, plugin is disabled)
 * ```
 *
 * Rollback swaps the `current` symlink to a previous `.versions/<v>/`.
 * Uninstall removes the whole `<id>/` tree.
 *
 * The companion `plugin_invoke` module implements the JSON-RPC
 * subprocess layer that powers `panel.invokeBackend(...)` on the
 * frontend. The TS side calls into it via
 * `invoke('plugin_<id>_<cmd>', args)`.
 *
 * All commands return `Result<_, PluginError>` — the `Display` impl
 * produces the same human-readable string the previous
 * `Result<_, String>` returned, so the TS-side `err.message` contract
 * is preserved. See [`crate::commands::error::PluginError`].
 *
 * Commands
 * --------
 * - `scan_plugins`              List installed plugins
 * - `install_plugin`            Install a user-provided zip (version = "upload")
 * - `uninstall_plugin`          Remove a plugin tree
 * - `toggle_plugin_enabled`     Persist enabled/disabled state
 * - `get_plugin_storage_path`   Resolve storage.json path
 * - `install_plugin_from_bytes` Marketplace install (zip bytes + ed25519 sig)
 * - `check_plugin_updates`      Diff local vs remote index
 * - `update_plugin`             Install new version, keep storage
 * - `rollback_plugin`           Swap `current` symlink to a previous version
 * - `list_plugin_versions`      Enumerate `.versions/<v>/` entries
 */

use crate::commands::error::PluginError;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
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
fn plugins_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("plugins")
}

/// Sentinel version used for ad-hoc `install_plugin` (user-uploaded zip).
/// Marketplace installs use a real semver from the index entry.
const UPLOAD_VERSION: &str = "upload";

/// Reject plugin identifiers that could be used to escape the
/// `<app_data>/plugins/` tree. The frontend treats `plugin_id` as
/// opaque, but the host uses it as a path component on every IPC
/// call. A naive `plugin_id = "../foo"` would resolve to
/// `<app_data>/plugins/../foo/...` and write outside the plugins
/// root. We allow only `[a-zA-Z0-9._-]`, length 1..=128, and reject
/// the boundary cases `.` / `..`.
fn validate_plugin_id(id: &str) -> Result<(), PluginError> {
    if id.is_empty() || id.len() > 128 {
        return Err(PluginError::InvalidInput(format!(
            "plugin id must be 1..=128 chars, got {}",
            id.len()
        )));
    }
    if id == "." || id == ".." {
        return Err(PluginError::InvalidInput(format!(
            "plugin id {:?} is reserved",
            id
        )));
    }
    for c in id.chars() {
        let ok = c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-';
        if !ok {
            return Err(PluginError::InvalidInput(format!(
                "plugin id {:?} contains illegal character {:?}",
                id, c
            )));
        }
    }
    Ok(())
}

/// Same as [`validate_plugin_id`] but for the `version` field, which
/// is semver-ish so we additionally allow `+` (build metadata).
fn validate_plugin_version(version: &str) -> Result<(), PluginError> {
    if version.is_empty() || version.len() > 64 {
        return Err(PluginError::InvalidInput(format!(
            "plugin version must be 1..=64 chars, got {}",
            version.len()
        )));
    }
    if version == "." || version == ".." {
        return Err(PluginError::InvalidInput(format!(
            "plugin version {:?} is reserved",
            version
        )));
    }
    for c in version.chars() {
        let ok = c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' || c == '+';
        if !ok {
            return Err(PluginError::InvalidInput(format!(
                "plugin version {:?} contains illegal character {:?}",
                version, c
            )));
        }
    }
    Ok(())
}

/// Return the directory that currently holds the active version of a
/// plugin. Prefers the `current` symlink; falls back to the `.current_version`
/// text marker when symlinks aren't available (Windows without
/// Developer Mode); finally falls back to scanning the version tree
/// for the most recent directory. Returns `None` if no version is
/// installed.
fn active_version_dir(plugin_dir: &Path) -> Option<PathBuf> {
    // 1) Symlink path (Unix + Windows w/ Developer Mode).
    let current_link = plugin_dir.join("current");
    if let Ok(target) = fs::read_link(&current_link) {
        if target.is_absolute() {
            return Some(target);
        }
        return Some(plugin_dir.join(target));
    }
    // `read_link` returns InvalidInput on a regular file/dir, so the
    // symlink path won't accidentally match `plugin_dir/current` when
    // it's a real directory.
    if current_link.is_dir() {
        return Some(current_link);
    }

    // 2) Text-marker fallback. The file holds the active semver; we
    //    resolve it relative to `.versions/`.
    let marker = plugin_dir.join(".current_version");
    if let Ok(ver) = fs::read_to_string(&marker) {
        let ver = ver.trim();
        if !ver.is_empty() {
            let candidate = plugin_dir.join(".versions").join(ver);
            if candidate.is_dir() {
                return Some(candidate);
            }
        }
    }

    // 3) Last resort: pick any version directory (used during scans
    //    after a partial install where the marker/symlink were never
    //    written). Sort lexicographically so the most recent semver
    //    wins when timestamps are equal.
    let versions_root = plugin_dir.join(".versions");
    if let Ok(read) = fs::read_dir(&versions_root) {
        let mut names: Vec<String> = read
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        if let Some(name) = names.last() {
            return Some(versions_root.join(name));
        }
    }

    None
}

/// Create the `current` symlink and write the `.current_version` text
/// marker. Symlink creation is best-effort: if it fails (e.g. Windows
/// without `SeCreateSymbolicLinkPrivilege`) we still write the marker
/// and rely on [`active_version_dir`] to fall back to the text path.
fn set_current_version(plugin_dir: &Path, version: &str) -> Result<(), PluginError> {
    let target = PathBuf::from(".versions").join(version);
    let link = plugin_dir.join("current");

    // Remove a stale entry before creating a new one. We must use
    // `symlink_metadata` to distinguish a symlink (use `remove_file`
    // so we delete the *link*, not the target) from a real directory
    // (use `remove_dir_all`). `remove_dir_all` follows symlinks,
    // which would nuke a still-valid version tree.
    match fs::symlink_metadata(&link) {
        Ok(m) if m.file_type().is_symlink() => {
            let _ = fs::remove_file(&link);
        }
        Ok(m) if m.is_dir() => {
            let _ = fs::remove_dir_all(&link);
        }
        Ok(_) => {
            let _ = fs::remove_file(&link);
        }
        Err(_) => {
            // Doesn't exist — nothing to do.
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        if let Err(e) = symlink(&target, &link) {
            // Non-fatal: text marker will carry the version.
            eprintln!("[plugin] symlink fallback ({}): {}", link.display(), e);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::symlink_dir;
        if let Err(e) = symlink_dir(&target, &link) {
            // Windows requires Developer Mode or admin for symlinks.
            // Fall back to the text marker.
            eprintln!("[plugin] symlink fallback ({}): {}", link.display(), e);
        }
    }

    fs::write(plugin_dir.join(".current_version"), version)
        .map_err(|e| PluginError::Io(format!("Failed to write .current_version: {}", e)))?;
    Ok(())
}

/// Read the metadata from a plugin's index.js.
/// The index.js should export a `manifest` object or have a JSON comment block.
/// We parse a special `// @swallow-manifest { ... }` comment at the top of the file.
fn parse_manifest_from_index_js(index_js_path: &Path) -> Option<PluginMetadataRust> {
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

/// Validate every entry in a zip archive against `dest_dir` and
/// extract. Returns an error if any entry:
/// - has no `enclosed_name` (absolute path or `..`)
/// - resolves outside `dest_dir` (zip slip)
/// - is a symlink
///
/// The archive handle is consumed by the call; the caller is expected
/// to have just opened it (single read cycle so the precheck and
/// extract share the same on-disk image of the file).
fn extract_zip_with_precheck<R: std::io::Read + std::io::Seek>(
    mut archive: zip::ZipArchive<R>,
    dest_dir: &Path,
) -> Result<(), PluginError> {
    // Precheck pass: walk every entry, validate, then rewind the
    // archive for the extract pass.
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| PluginError::Io(format!("Failed to read zip entry {}: {}", i, e)))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| PluginError::Security("Security: zip entry has unsafe name".to_string()))?;
        let candidate = dest_dir.join(enclosed);
        if candidate
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(PluginError::Security(format!(
                "Security: zip entry '{}' contains parent-dir reference",
                entry.name()
            )));
        }
        if !candidate.starts_with(dest_dir) {
            return Err(PluginError::Security(format!(
                "Security: zip entry '{}' escapes plugin dir",
                entry.name()
            )));
        }
        if entry.is_symlink() {
            return Err(PluginError::Security(format!(
                "Security: zip entry '{}' is a symlink (forbidden)",
                entry.name()
            )));
        }
    }

    if let Err(e) = archive.extract(dest_dir) {
        return Err(PluginError::Io(format!("Failed to extract zip: {}", e)));
    }
    Ok(())
}

/// If `dest_dir` contains exactly one top-level subdirectory and that
/// subdir holds the actual plugin files (i.e. the zip was packaged
/// with an enclosing folder), promote the contents up so the plugin
/// lives directly in `dest_dir`. Returns silently otherwise.
fn flatten_single_top_dir(dest_dir: &Path) -> Result<(), PluginError> {
    let entries: Vec<_> = fs::read_dir(dest_dir)
        .map_err(|e| PluginError::Io(format!("Failed to read extracted dir: {}", e)))?
        .filter_map(|e| e.ok())
        .collect();
    if entries.len() != 1 || !entries[0].path().is_dir() {
        return Ok(());
    }
    let inner_dir = entries[0].path().clone();
    let temp_dir = dest_dir.with_extension("_tmp");
    fs::rename(&inner_dir, &temp_dir)
        .map_err(|e| PluginError::Io(format!("Failed to move inner dir: {}", e)))?;
    for entry in
        fs::read_dir(&temp_dir).map_err(|e| PluginError::Io(format!("Failed to read temp dir: {}", e)))?.flatten()
    {
        let dest = dest_dir.join(entry.file_name());
        fs::rename(entry.path(), dest)
            .map_err(|e| PluginError::Io(format!("Failed to move file: {}", e)))?;
    }
    fs::remove_dir_all(&temp_dir)
        .map_err(|e| PluginError::Io(format!("Failed to remove temp dir: {}", e)))?;
    Ok(())
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

        // Hidden bookkeeping directories under the plugin root — skip them
        // if they show up as bare entries (e.g. an unversioned install).
        if path.file_name().and_then(|n| n.to_str()).map_or(false, |n| n.starts_with('.')) {
            // Exception: a plugin whose entire name starts with `.` is unusual
            // but allowed; we only skip known metadata folders here.
            if matches!(path.file_name().and_then(|n| n.to_str()), Some(".versions")) {
                continue;
            }
        }

        // Resolve through the `current` symlink / text marker. If the
        // plugin has no version tree yet (e.g. partial install) we
        // skip it — scan only reports healthy plugins.
        let active_dir = match active_version_dir(&path) {
            Some(d) => d,
            None => continue,
        };

        let index_js = active_dir.join("index.js");
        if !index_js.exists() {
            continue;
        }

        let plugin_id = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        // backend/ lives in the version directory so different
        // versions can ship different native binaries.
        let has_backend = active_dir.join("backend").exists();
        // .disabled is a top-level marker, not version-scoped.
        let enabled = !path.join(".disabled").exists();

        let meta = if let Some(mut meta) = parse_manifest_from_index_js(&index_js) {
            // Persisted enabled state takes precedence over the manifest value.
            meta.enabled = enabled;
            meta.plugin_path = active_dir.to_string_lossy().to_string();
            meta.has_backend = has_backend;
            meta
        } else {
            // Fallback: create minimal metadata from directory name
            PluginMetadataRust {
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
                plugin_path: active_dir.to_string_lossy().to_string(),
                has_backend,
            }
        };
        plugins.push(meta);
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

    // User-uploaded zips get the sentinel `upload` version. The next
    // upload overwrites that bucket (delete-then-extract). Marketplace
    // installs go through `install_plugin_from_bytes` with a real semver.
    let zip_filename = PathBuf::from(&zip_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Reject zip stems that would escape the plugins tree before we
    // touch the filesystem. The frontend hands us a `String` path so
    // a user can technically type `..` or `/` — guard at the boundary.
    validate_plugin_id(&zip_filename)?;

    let plugin_dir = plugins_root.join(&zip_filename);
    let version_dir = plugin_dir.join(".versions").join(UPLOAD_VERSION);

    fs::create_dir_all(&version_dir)
        .map_err(|e| PluginError::Io(format!("Failed to create version dir: {}", e)))?;

    // Open the zip once and run the precheck + extract against
    // `version_dir` (not the plugin root). Every entry's candidate
    // path is validated relative to version_dir.
    let archive = zip::ZipArchive::new(fs::File::open(&zip_path)
        .map_err(|e| PluginError::Io(format!("Failed to open zip file: {}", e)))?)
        .map_err(|e| PluginError::Io(format!("Failed to read zip archive: {}", e)))?;
    if let Err(e) = extract_zip_with_precheck(archive, &version_dir) {
        // Best-effort cleanup of the partial version dir on failure.
        let _ = fs::remove_dir_all(&version_dir);
        return Err(e);
    }

    // If the zip contained a single top-level directory, flatten it
    // inside `version_dir` so the plugin lives directly there.
    if let Err(e) = flatten_single_top_dir(&version_dir) {
        let _ = fs::remove_dir_all(&version_dir);
        return Err(e);
    }

    // Verify index.js exists
    let index_js = version_dir.join("index.js");
    if !index_js.exists() {
        let _ = fs::remove_dir_all(&version_dir);
        return Err(PluginError::InvalidInput(
            "Plugin package must contain an index.js file".to_string(),
        ));
    }

    set_current_version(&plugin_dir, UPLOAD_VERSION)?;

    let has_backend = version_dir.join("backend").exists();
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
        plugin_path: version_dir.to_string_lossy().to_string(),
        has_backend,
    });

    Ok(meta)
}

#[tauri::command]
pub async fn uninstall_plugin(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::commands::plugin_invoke::SharedPluginProcessState>,
    plugin_id: String,
) -> Result<(), PluginError> {
    // Reject path-traversal ids before we touch the filesystem. The
    // canonicalize + starts_with check below would also catch it, but
    // failing fast at the boundary gives a cleaner error message.
    validate_plugin_id(&plugin_id)?;

    // 1) Kill the backend child *first* so the OS releases any open
    //    file handles on the plugin directory. Without this, a plugin
    //    uninstall would leave a long-lived subprocess around that
    //    could still respond to `invoke_plugin` calls — a security
    //    problem (an "uninstalled" plugin still has IPC reach) and a
    //    resource leak (FDs, memory, file handles).
    //
    //    Best-effort: even if the kill fails (e.g. no backend was
    //    ever spawned for this plugin), we proceed to the dir removal.
    if let Err(e) = crate::commands::plugin_invoke::kill_plugin_backend(
        state.inner(),
        &plugin_id,
    )
    .await
    {
        eprintln!(
            "[plugin] kill_plugin_backend for '{}' failed (continuing with uninstall): {}",
            plugin_id, e
        );
    }

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
pub async fn kill_plugin(
    state: tauri::State<'_, crate::commands::plugin_invoke::SharedPluginProcessState>,
    plugin_id: String,
) -> Result<bool, PluginError> {
    // The path-traversal guard runs *inside* `kill_plugin_backend`
    // (defence in depth), so any caller that re-exports this function
    // — including future Rust unit tests — gets the same validation
    // for free.
    crate::commands::plugin_invoke::kill_plugin_backend(state.inner(), &plugin_id).await
}

#[tauri::command]
pub fn toggle_plugin_enabled(
    app_handle: tauri::AppHandle,
    plugin_id: String,
    enabled: bool,
) -> Result<(), PluginError> {
    // Guard against path traversal before we touch the filesystem.
    validate_plugin_id(&plugin_id)?;

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
    // The returned path is used by the frontend to `readFile` /
    // `writeFile` directly. Validate to prevent `../` from leaking
    // out into the renderer.
    validate_plugin_id(&plugin_id)?;

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to get app data dir: {}", e)))?;
    let plugin_storage = plugins_dir(&app_data_dir)
        .join(&plugin_id)
        .join("storage.json");
    Ok(plugin_storage.to_string_lossy().to_string())
}

// ─── Marketplace / Phase 9.2 ────────────────────────────────────────────────────

/// One row in the remote plugin repository index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginIndexEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub download_url: String,
    pub sha256: String,
    /// Base64-encoded 32-byte ed25519 public key signature over the
    /// zip bytes. We keep this *per entry* (rather than per repo) so
    /// authors can rotate keys without breaking the global
    /// `pubkey.b64`.
    #[serde(default)]
    pub signature_b64: String,
    /// Base64-encoded 32-byte ed25519 verifying key for the entry.
    /// When empty, the repo-level key is used.
    #[serde(default)]
    pub pubkey_b64: String,
    /// Optional version history (most recent first). Each entry points
    /// to the same shape but allows the detail view to render a
    /// changelog.
    #[serde(default)]
    pub versions: Vec<PluginIndexEntryVersion>,
    #[serde(default)]
    pub dependencies: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginIndexEntryVersion {
    pub version: String,
    pub download_url: String,
    pub sha256: String,
    #[serde(default)]
    pub changelog: String,
    pub published_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginIndex {
    pub schema_version: u32,
    pub updated_at: String,
    /// Base64-encoded 32-byte ed25519 verifying key for the *whole*
    /// repository. Used as the default key for entries that don't ship
    /// their own `pubkey_b64`.
    pub pubkey_b64: String,
    pub plugins: Vec<PluginIndexEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginUpdateInfo {
    pub id: String,
    pub local_version: String,
    pub remote_version: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginVersionInfo {
    pub version: String,
    pub is_active: bool,
    pub size_bytes: u64,
    pub installed_at: String,
}

/// Verify an ed25519 signature over `message` with a base64-encoded
/// 32-byte public key. Returns `Ok(())` on match, `Err(Security)` on
/// mismatch / malformed key / signature.
fn verify_ed25519(message: &[u8], pubkey_b64: &str, signature_b64: &str) -> Result<(), PluginError> {
    use base64::Engine;

    let pk_bytes = base64::engine::general_purpose::STANDARD
        .decode(pubkey_b64.trim())
        .map_err(|e| PluginError::Security(format!("invalid base64 pubkey: {}", e)))?;
    if pk_bytes.len() != 32 {
        return Err(PluginError::Security(format!(
            "ed25519 pubkey must be 32 bytes (got {})",
            pk_bytes.len()
        )));
    }
    let mut pk_arr = [0u8; 32];
    pk_arr.copy_from_slice(&pk_bytes);

    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(signature_b64.trim())
        .map_err(|e| PluginError::Security(format!("invalid base64 signature: {}", e)))?;
    if sig_bytes.len() != 64 {
        return Err(PluginError::Security(format!(
            "ed25519 signature must be 64 bytes (got {})",
            sig_bytes.len()
        )));
    }
    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(&sig_bytes);

    let key = VerifyingKey::from_bytes(&pk_arr)
        .map_err(|e| PluginError::Security(format!("invalid ed25519 pubkey: {}", e)))?;
    let sig = Signature::from_bytes(&sig_arr);
    key.verify(message, &sig)
        .map_err(|_| PluginError::Security("plugin signature verification failed".to_string()))?;
    Ok(())
}

/// Compute the SHA-256 of a byte slice and return it as lowercase hex.
fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(64);
    for b in digest {
        use std::fmt::Write;
        let _ = write!(&mut out, "{:02x}", b);
    }
    out
}

/// Compute a directory's total size by walking all entries.
fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(read) = fs::read_dir(path) {
        for entry in read.flatten() {
            let p = entry.path();
            if let Ok(meta) = fs::symlink_metadata(&p) {
                if meta.is_dir() {
                    total += dir_size(&p);
                } else {
                    total += meta.len();
                }
            }
        }
    }
    total
}

/**
 * Marketplace install entry point.
 *
 * Unlike `install_plugin` (which reads a zip from disk and uses the
 * `upload` sentinel version), this command takes the zip bytes
 * directly, verifies a SHA-256 digest provided by the caller *and* an
 * ed25519 signature provided by the caller, then installs under
 * `.versions/<version>/`. The caller is responsible for downloading
 * the zip (and the `pubkey_b64` / `signature_b64`) from the
 * marketplace — this keeps the host offline-capable and lets the
 * frontend layer an IndexedDB cache on top.
 */
#[tauri::command]
pub async fn install_plugin_from_bytes(
    app_handle: tauri::AppHandle,
    plugin_id: String,
    version: String,
    bytes: Vec<u8>,
    sha256: String,
    pubkey_b64: String,
    signature_b64: String,
) -> Result<PluginMetadataRust, PluginError> {
    // Strict validation: plugin_id and version are joined onto the
    // filesystem path unconditionally, so we reject anything that
    // contains `..`, `/`, `\`, or other path-traversal characters
    // before doing *anything* else. The earlier empty-string check
    // is now subsumed by `validate_plugin_id`/`_version`.
    validate_plugin_id(&plugin_id)?;
    validate_plugin_version(&version)?;

    // 1) SHA-256 must match.
    let actual = sha256_hex(&bytes);
    if !actual.eq_ignore_ascii_case(sha256.trim()) {
        return Err(PluginError::Security(format!(
            "sha256 mismatch: expected {}, got {}",
            sha256, actual
        )));
    }

    // 2) Ed25519 signature must verify.
    verify_ed25519(&bytes, &pubkey_b64, &signature_b64)?;

    // 3) Lay out the version directory. We rewrite the zip into a
    //    `Cursor<Vec<u8>>` so the same bytes we just hashed / signed
    //    are the ones we extract.
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to get app data dir: {}", e)))?;
    let plugins_root = plugins_dir(&app_data_dir);
    fs::create_dir_all(&plugins_root)
        .map_err(|e| PluginError::Io(format!("Failed to create plugins dir: {}", e)))?;

    let plugin_dir = plugins_root.join(&plugin_id);
    let versions_root = plugin_dir.join(".versions");
    let version_dir = versions_root.join(&version);
    fs::create_dir_all(&version_dir)
        .map_err(|e| PluginError::Io(format!("Failed to create version dir: {}", e)))?;

    let cursor = std::io::Cursor::new(bytes);
    let archive = zip::ZipArchive::new(cursor)
        .map_err(|e| PluginError::Io(format!("Failed to read zip archive: {}", e)))?;
    if let Err(e) = extract_zip_with_precheck(archive, &version_dir) {
        let _ = fs::remove_dir_all(&version_dir);
        return Err(e);
    }
    if let Err(e) = flatten_single_top_dir(&version_dir) {
        let _ = fs::remove_dir_all(&version_dir);
        return Err(e);
    }

    let index_js = version_dir.join("index.js");
    if !index_js.exists() {
        let _ = fs::remove_dir_all(&version_dir);
        return Err(PluginError::InvalidInput(
            "Plugin package must contain an index.js file".to_string(),
        ));
    }

    set_current_version(&plugin_dir, &version)?;

    let has_backend = version_dir.join("backend").exists();
    let enabled = !plugin_dir.join(".disabled").exists();

    let meta = parse_manifest_from_index_js(&index_js).unwrap_or(PluginMetadataRust {
        id: plugin_id.clone(),
        name: plugin_id.clone(),
        description: String::new(),
        version: version.clone(),
        author: String::new(),
        published_at: String::new(),
        icon_position: String::from("sidebar"),
        content_position: String::from("leftPanel"),
        order: 100,
        enabled,
        plugin_path: version_dir.to_string_lossy().to_string(),
        has_backend,
    });

    Ok(meta)
}

/**
 * Compare the locally-installed version of each plugin with the
 * remote index and return the list of plugins that have an update.
 *
 * `repo_url` points to a JSON document with the [`PluginIndex`]
 * shape. We block on the fetch (via the synchronous `reqwest`
 * blocking client) because this is a user-initiated refresh, not a
 * background poll. A future async rewrite can move this to
 * `tokio::task::spawn_blocking`.
 */
#[tauri::command]
pub fn check_plugin_updates(
    app_handle: tauri::AppHandle,
    repo_url: String,
) -> Result<Vec<PluginUpdateInfo>, PluginError> {
    if repo_url.is_empty() {
        return Err(PluginError::InvalidInput("repo_url is required".to_string()));
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| PluginError::Io(format!("Failed to build http client: {}", e)))?;
    let response = client
        .get(&repo_url)
        .send()
        .map_err(|e| PluginError::Io(format!("Failed to fetch plugin index: {}", e)))?;
    let response = response
        .error_for_status()
        .map_err(|e| PluginError::Io(format!("Plugin index returned error: {}", e)))?;
    let index: PluginIndex = response
        .json()
        .map_err(|e| PluginError::Io(format!("Failed to parse plugin index: {}", e)))?;

    // Build a `plugin_id → active_version` map by walking the local
    // plugins dir. Plugins installed via the user-upload path
    // (version = "upload") or any plugin without a parsable manifest
    // are excluded — they can't be auto-updated.
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to get app data dir: {}", e)))?;
    let plugins_root = plugins_dir(&app_data_dir);
    let mut local_versions: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    if plugins_root.is_dir() {
        if let Ok(entries) = fs::read_dir(&plugins_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let Some(active_dir) = active_version_dir(&path) else {
                    continue;
                };
                let index_js = active_dir.join("index.js");
                let Some(meta) = parse_manifest_from_index_js(&index_js) else {
                    continue;
                };
                // Skip upload-sentinel installs — they have no real semver.
                if meta.version.is_empty() || meta.version == UPLOAD_VERSION {
                    continue;
                }
                local_versions.insert(meta.id, meta.version);
            }
        }
    }

    let mut updates = Vec::new();
    for entry in index.plugins {
        if entry.version.is_empty() {
            continue;
        }
        let local = local_versions.get(&entry.id).cloned().unwrap_or_default();
        // Naive semver-aware compare: if local is missing, treat as
        // "candidate for install" (still surface in the list so the
        // UI can show "Install" instead of "Update").
        if local.as_str() != entry.version.as_str() {
            updates.push(PluginUpdateInfo {
                id: entry.id.clone(),
                local_version: local,
                remote_version: entry.version.clone(),
                sha256: entry.sha256.clone(),
            });
        }
    }
    Ok(updates)
}

/**
 * Install `version` for `plugin_id` and point `current` at it.
 * `storage.json` is preserved across the swap.
 */
#[tauri::command]
pub async fn update_plugin(
    app_handle: tauri::AppHandle,
    plugin_id: String,
    version: String,
    bytes: Vec<u8>,
    sha256: String,
    pubkey_b64: String,
    signature_b64: String,
) -> Result<PluginMetadataRust, PluginError> {
    install_plugin_from_bytes(
        app_handle,
        plugin_id,
        version,
        bytes,
        sha256,
        pubkey_b64,
        signature_b64,
    )
    .await
}

/**
 * Swap the `current` symlink back to a previously-installed version
 * under `.versions/<version>/`. `storage.json` is untouched. Returns
 * the metadata of the now-active version.
 */
#[tauri::command]
pub fn rollback_plugin(
    app_handle: tauri::AppHandle,
    plugin_id: String,
    version: String,
) -> Result<PluginMetadataRust, PluginError> {
    // Validate both inputs strictly — `version` ends up in a symlink
    // target inside `.versions/<version>/`, which would otherwise
    // point outside the plugin dir for a malicious input.
    validate_plugin_id(&plugin_id)?;
    validate_plugin_version(&version)?;

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to get app data dir: {}", e)))?;
    let plugin_dir = plugins_dir(&app_data_dir).join(&plugin_id);
    let version_dir = plugin_dir.join(".versions").join(&version);
    if !version_dir.is_dir() {
        return Err(PluginError::NotFound(format!(
            "version '{}' not found for plugin '{}'",
            version, plugin_id
        )));
    }
    set_current_version(&plugin_dir, &version)?;

    let index_js = version_dir.join("index.js");
    let has_backend = version_dir.join("backend").exists();
    let enabled = !plugin_dir.join(".disabled").exists();
    let meta = parse_manifest_from_index_js(&index_js).unwrap_or(PluginMetadataRust {
        id: plugin_id.clone(),
        name: plugin_id.clone(),
        description: String::new(),
        version: version.clone(),
        author: String::new(),
        published_at: String::new(),
        icon_position: String::from("sidebar"),
        content_position: String::from("leftPanel"),
        order: 100,
        enabled,
        plugin_path: version_dir.to_string_lossy().to_string(),
        has_backend,
    });
    Ok(meta)
}

/**
 * Enumerate every `.versions/<v>/` directory for a plugin, marking
 * the one currently pointed at by `current` / `.current_version`.
 */
#[tauri::command]
pub fn list_plugin_versions(
    app_handle: tauri::AppHandle,
    plugin_id: String,
) -> Result<Vec<PluginVersionInfo>, PluginError> {
    validate_plugin_id(&plugin_id)?;

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to get app data dir: {}", e)))?;
    let plugin_dir = plugins_dir(&app_data_dir).join(&plugin_id);
    let versions_root = plugin_dir.join(".versions");
    if !versions_root.is_dir() {
        return Ok(Vec::new());
    }
    let active = fs::read_to_string(plugin_dir.join(".current_version"))
        .ok()
        .map(|s| s.trim().to_string());

    let mut out: Vec<PluginVersionInfo> = Vec::new();
    for entry in fs::read_dir(&versions_root)
        .map_err(|e| PluginError::Io(format!("Failed to read versions dir: {}", e)))?
        .flatten()
    {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = fs::symlink_metadata(&p)
            .map_err(|e| PluginError::Io(format!("Failed to stat version dir: {}", e)))?;
        let size = if meta.is_dir() { dir_size(&p) } else { 0 };
        let installed_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                chrono::DateTime::<chrono::Utc>::from_timestamp(d.as_secs() as i64, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        out.push(PluginVersionInfo {
            version: name.clone(),
            is_active: active.as_deref() == Some(name.as_str()),
            size_bytes: size,
            installed_at,
        });
    }
    // Sort: active first, then by version (lexicographic) descending.
    out.sort_by(|a, b| {
        b.is_active
            .cmp(&a.is_active)
            .then_with(|| b.version.cmp(&a.version))
    });
    Ok(out)
}
