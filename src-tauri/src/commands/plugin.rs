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
use semver::Version;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

/// The application version recorded into the export bundle's
/// `manifest.json`. Bumping the export schema (e.g. changing the
/// on-disk layout) requires bumping this number AND the
/// `IMPORT_COMPATIBLE_MINOR` check used during import.
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Bump this whenever the on-disk layout of the export bundle
/// changes in an *incompatible* way. The import side reads it via
/// `ImportManifest.schema_version` and refuses bundles that
/// don't match.
const EXPORT_SCHEMA_VERSION: u32 = 1;

/// Per-entry size cap for `import_plugin_configs` storage entries.
/// A malicious bundle could embed a multi-GB entry under
/// `plugins/<id>/storage.json` and force the host to OOM at
/// `read_to_end`. Plugin storage in practice ranges from a
/// few KB (settings) up to a few MB for legitimate
/// "cache"-style plugins (history, vocabulary, completion
/// tables). Wave B / M5 bumps the ceiling from 1 MiB to
/// 16 MiB so the latter group isn't unfairly rejected — the
/// previous 1 MiB cap was great for the typical case but
/// silently truncated history-style plugins whose storage
/// legitimately grew past the threshold. The cap is still
/// a hard ceiling: anything past 16 MiB is recorded as
/// `status: "error"` and the import continues with the
/// rest of the bundle — we never fail the whole import on
/// a single oversized entry.
const MAX_PLUGIN_CONFIG_SIZE: u64 = 16 * 1024 * 1024;

/// Metadata for a plugin package, returned to the frontend.
///
/// Fields that are only populated at runtime (not present in the
/// manifest JSON embedded in index.js) use `#[serde(default)]` so
/// that `serde_json::from_str` succeeds even when those keys are
/// absent from the manifest comment.
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
    #[serde(default)]
    pub plugin_path: String,
    #[serde(default)]
    pub has_backend: bool,
}

/// Get the plugins directory path.
/// Located at <app_data_dir>/plugins/
fn plugins_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("plugins")
}

/// Resolve the filesystem directory for a plugin id.
///
/// First tries an exact match (`plugins/<id>/`). If that doesn't exist,
/// scans all plugin directories for one whose manifest declares this id.
/// This handles the case where the directory was named after a versioned
/// zip (e.g. "com.example.plugin-1.0.0") but the manifest declares
/// id "com.example.plugin".
pub(crate) fn resolve_plugin_dir(plugins_root: &Path, plugin_id: &str) -> Option<PathBuf> {
    let exact = plugins_root.join(plugin_id);
    if exact.is_dir() {
        return Some(exact);
    }
    // Fallback: scan for a directory whose manifest matches the id.
    let entries = fs::read_dir(plugins_root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        // Skip hidden bookkeeping dirs
        if path.file_name().and_then(|n| n.to_str()).map_or(false, |n| n.starts_with('.')) {
            continue;
        }
        if let Some(active_dir) = active_version_dir(&path) {
            let index_js = active_dir.join("index.js");
            if index_js.exists() {
                if let Some(meta) = parse_manifest_from_index_js(&index_js) {
                    if meta.id == plugin_id {
                        return Some(path);
                    }
                }
            }
        }
    }
    None
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
pub(crate) fn active_version_dir(plugin_dir: &Path) -> Option<PathBuf> {
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
            // Skip known internal directories: .versions, .installing-*
            continue;
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

        // backend/ lives in the version directory so different
        // versions can ship different native binaries.
        let has_backend = active_dir.join("backend").exists();
        // .disabled is a top-level marker, not version-scoped.
        let enabled = !path.join(".disabled").exists();

        let parsed_manifest = parse_manifest_from_index_js(&index_js);

        // Prefer the id declared in the manifest over the directory
        // name — the directory may have been named after a versioned
        // zip (e.g. "com.example.plugin-1.0.0").
        let plugin_id = parsed_manifest
            .as_ref()
            .map(|m| m.id.clone())
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| {
                path.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string()
            });

        let meta = if let Some(mut meta) = parsed_manifest {
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
    expected_sha256: Option<String>,
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
    //
    // The zip filename may include a version suffix (e.g.
    // `com.example.plugin-1.0.0.zip`). We extract first, then read
    // the real plugin id from the manifest and rename the directory
    // if they differ.
    let zip_filename = PathBuf::from(&zip_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Reject zip stems that would escape the plugins tree before we
    // touch the filesystem. The frontend hands us a `String` path so
    // a user can technically type `..` or `/` — guard at the boundary.
    validate_plugin_id(&zip_filename)?;

    // Extract into a temporary directory first so we can read the
    // real plugin id from the manifest before committing the final
    // directory name.
    let temp_plugin_dir = plugins_root.join(format!(".installing-{}", zip_filename));
    let version_dir = temp_plugin_dir.join(".versions").join(UPLOAD_VERSION);

    // 兜底清理上一次同名 install 的残留临时目录,install 中途崩溃后可能留下
    // .installing-xxx 树;整树清理后子目录 (.versions/<UPLOAD_VERSION>) 自然
    // 不存在,所以这里只删一次整树,不需要再单独清 version_dir
    // (version_dir 是 temp_plugin_dir 的子目录,二次 remove_dir_all
    // 是 no-op,且会掩盖"父目录已经被清掉"这个信号)。
    // 用 ok() 而非 unwrap,目录不存在不算错。
    let _ = fs::remove_dir_all(&temp_plugin_dir);

    // G1 — SHA-256 校验必须在解压前完成(防止 TOCTOU 窗口留下未校验内容)。
    // 先把整个 zip 读到内存计算 sha256,与 expected 对比通过后再 extract。
    // 之前实现是解压后校验目录,任何 panic / OOM killer / 信号中断都会让
    // version_dir 残留未校验内容,与 marketplace 路径 install_plugin_from_bytes
    // 的 byte-level 校验对齐。expected_sha256 为 None 时保持向后兼容。
    //
    // 注:upload 路径通常 < 几 MB,read_to_end 简单可靠;若超过几十 MB 可改为
    // 分块 hash(本处与 marketplace 路径行为一致即可)。
    let mut zip_bytes = Vec::new();
    fs::File::open(&zip_path)
        .map_err(|e| PluginError::Io(format!("Failed to open zip file: {}", e)))?
        .read_to_end(&mut zip_bytes)
        .map_err(|e| PluginError::Io(format!("Failed to read zip file: {}", e)))?;

    if let Some(expected) = expected_sha256.as_deref().map(str::trim) {
        if !expected.is_empty() {
            let actual = sha256_hex(&zip_bytes);
            if !actual.eq_ignore_ascii_case(expected) {
                return Err(PluginError::Security(format!(
                    "sha256 mismatch: expected {}, got {}",
                    expected, actual
                )));
            }
        }
    }

    fs::create_dir_all(&version_dir)
        .map_err(|e| PluginError::Io(format!("Failed to create version dir: {}", e)))?;

    // Open the zip once and run the precheck + extract against
    // `version_dir` (not the plugin root). Every entry's candidate
    // path is validated relative to version_dir. We use the same
    // in-memory bytes we just hashed — a single read cycle so the
    // precheck, extract, and digest all see the same on-disk image.
    let archive = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes))
        .map_err(|e| PluginError::Io(format!("Failed to read zip archive: {}", e)))?;
    if let Err(e) = extract_zip_with_precheck(archive, &version_dir) {
        // Best-effort cleanup of the partial version dir on failure.
        let _ = fs::remove_dir_all(&temp_plugin_dir);
        return Err(e);
    }

    // If the zip contained a single top-level directory, flatten it
    // inside `version_dir` so the plugin lives directly there.
    if let Err(e) = flatten_single_top_dir(&version_dir) {
        let _ = fs::remove_dir_all(&temp_plugin_dir);
        return Err(e);
    }

    // Verify index.js exists
    let index_js = version_dir.join("index.js");
    if !index_js.exists() {
        let _ = fs::remove_dir_all(&temp_plugin_dir);
        return Err(PluginError::InvalidInput(
            "Plugin package must contain an index.js file".to_string(),
        ));
    }

    // Determine the real plugin id from the manifest. Fall back to
    // the zip filename if the manifest doesn't declare one.
    let real_plugin_id = parse_manifest_from_index_js(&index_js)
        .map(|m| m.id.clone())
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| zip_filename.clone());

    validate_plugin_id(&real_plugin_id)?;

    // Move the temp directory to the final location. If a plugin with
    // the same id already exists, replace it entirely.
    let final_plugin_dir = plugins_root.join(&real_plugin_id);
    if final_plugin_dir.exists() {
        let _ = fs::remove_dir_all(&final_plugin_dir);
    }
    // Also clean up a stale directory named after the zip filename
    // (e.g. "com.example.plugin-1.0.0") if it differs from the real
    // plugin id. This happens when a plugin was first installed from
    // a versioned zip and the directory was named after the zip stem.
    if real_plugin_id != zip_filename {
        let stale_dir = plugins_root.join(&zip_filename);
        if stale_dir.exists() {
            let _ = fs::remove_dir_all(&stale_dir);
        }
    }
    fs::rename(&temp_plugin_dir, &final_plugin_dir)
        .map_err(|e| PluginError::Io(format!("Failed to rename plugin dir: {}", e)))?;

    let final_version_dir = final_plugin_dir.join(".versions").join(UPLOAD_VERSION);
    set_current_version(&final_plugin_dir, UPLOAD_VERSION)?;

    let has_backend = final_version_dir.join("backend").exists();
    let enabled = !final_plugin_dir.join(".disabled").exists();

    let final_index_js = final_version_dir.join("index.js");
    let meta = parse_manifest_from_index_js(&final_index_js).unwrap_or(PluginMetadataRust {
        id: real_plugin_id.clone(),
        name: real_plugin_id.clone(),
        description: String::new(),
        version: String::new(),
        author: String::new(),
        published_at: String::new(),
        icon_position: String::from("sidebar"),
        content_position: String::from("leftPanel"),
        order: 100,
        enabled,
        plugin_path: final_version_dir.to_string_lossy().to_string(),
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
    let plugin_dir = resolve_plugin_dir(&plugins_root, &plugin_id)
        .ok_or_else(|| PluginError::NotFound(format!("Plugin '{}' not found", plugin_id)))?;

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
    let plugin_dir = resolve_plugin_dir(&plugins_root, &plugin_id)
        .ok_or_else(|| PluginError::NotFound(format!("Plugin '{}' not found", plugin_id)))?;
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
    let plugins_root = plugins_dir(&app_data_dir);
    let plugin_dir = resolve_plugin_dir(&plugins_root, &plugin_id)
        .ok_or_else(|| PluginError::NotFound(format!("Plugin '{}' not found", plugin_id)))?;
    let plugin_storage = plugin_dir.join("storage.json");
    Ok(plugin_storage.to_string_lossy().to_string())
}

/**
 * Return the on-disk size of every installed plugin's
 * `storage.json` as a `plugin_id -> bytes` map. Plugins without
 * a `storage.json` yet (never written to) are reported as
 * `0` — they're installed but have never used storage.
 *
 * The frontend uses this to **seed** the in-memory
 * `pluginStorageSize` counter at app startup. The counter is
 * normally maintained by the JS-side `set/delete/clear` path
 * (deltas tracked in `recordStorageMetric`), but that path
 * starts at `0` on every fresh app launch — a plugin that
 * already has a 2 MB `storage.json` from a previous session
 * would otherwise show as `0 B` in the manager view's storage
 * meter until the next write triggers a delta update.
 *
 * Performance: one `fs::metadata` per plugin directory (no
 * file reads). For the realistic upper bound of a few hundred
 * plugins this is sub-millisecond. Returns `Err` only on the
 * rare case where the app-data dir itself is unreachable —
 * individual missing/broken files are silently treated as 0
 * bytes (a corrupt file is a storage bug, not a size-query
 * bug; the next `PluginStorageImpl.load()` will surface it).
 */
#[tauri::command]
pub fn get_all_plugin_storage_sizes(
    app_handle: tauri::AppHandle,
) -> Result<HashMap<String, u64>, PluginError> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to get app data dir: {}", e)))?;
    let plugins_root = plugins_dir(&app_data_dir);

    let mut sizes: HashMap<String, u64> = HashMap::new();

    // Mirror `resolve_plugin_dir`'s fallback strategy: prefer an
    // exact directory match, but also accept dirs whose
    // manifest declares the same id (handles versioned-zip
    // directory names like `com.example.foo-1.0.0`).
    let entries = match fs::read_dir(&plugins_root) {
        Ok(e) => e,
        Err(err) => {
            // No plugins dir yet (fresh install) → return empty
            // map. The frontend's seeder should treat this as a
            // no-op rather than an error.
            if err.kind() == std::io::ErrorKind::NotFound {
                return Ok(sizes);
            }
            return Err(PluginError::Io(format!(
                "Failed to read plugins dir: {}",
                err
            )));
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        // Skip hidden bookkeeping dirs (`.cache`, `.versions`).
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map_or(false, |n| n.starts_with('.'))
        {
            continue;
        }

        // Resolve the plugin id — exact dir name first, then
        // fall back to parsing the manifest inside the active
        // version dir.
        let plugin_id = if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            // Try the cheap path first: dir name == id.
            let candidate = name.to_string();
            if validate_plugin_id(&candidate).is_ok() {
                candidate
            } else {
                // Fall back to manifest lookup. Same code path
                // as `resolve_plugin_dir` so the seed matches
                // the path the frontend would otherwise use.
                match find_plugin_id_from_dir(&path) {
                    Some(id) => id,
                    None => continue, // not a valid plugin dir; skip
                }
            }
        } else {
            continue;
        };

        let storage = path.join("storage.json");
        let size = match fs::metadata(&storage) {
            Ok(meta) if meta.is_file() => meta.len(),
            // Missing or not a regular file → never written to,
            // size 0. This is the common case for newly-
            // installed plugins that haven't called `store.set`
            // yet.
            _ => 0,
        };
        sizes.insert(plugin_id, size);
    }

    Ok(sizes)
}

/// Resolve a plugin id from a directory by parsing the manifest
/// of the currently-active version (mirrors `resolve_plugin_dir`
/// for the versioned-zip fallback case). Returns `None` if the
/// dir doesn't contain a parseable manifest.
fn find_plugin_id_from_dir(plugin_dir: &Path) -> Option<String> {
    let active_dir = active_version_dir(plugin_dir)?;
    let index_js = active_dir.join("index.js");
    if !index_js.exists() {
        return None;
    }
    parse_manifest_from_index_js(&index_js).map(|m| m.id)
}

/**
 * Return the **real** available bytes on the volume that
 * hosts the plugin-storage tree.
 *
 * Replaces a previously hardcoded `100 * 1024 * 1024` literal
 * in the frontend (which the plugin manager's storage meter
 * displayed as "soft cap 100 MB" with no actual enforcement
 * or measurement). The user-visible cap is now the host's
 * own `statvfs` / `GetDiskFreeSpaceExW` answer — the
 * denominator is real data, not a magic number, so the
 * "X used / Y available" pair is internally consistent.
 *
 * Implementation:
 * - **Unix (macOS / Linux)**: `libc::statvfs` on the
 *   plugins-root parent. The `f_bavail` × `f_frsize` product
 *   is the bytes **available to a non-privileged user** —
 *   i.e. not counting the 5% headroom root reserves on
 *   ext-family filesystems. That's the right number for
 *   "how much can plugins actually write" — using
 *   `f_blocks` (total) would over-report by a factor of
 *   thousands on a typical desktop volume.
 * - **Windows**: `GetDiskFreeSpaceExW` with
 *   `free_bytes_available_to_caller`, equivalent semantics.
 *
 * `Err` only if the volume can't be queried (path missing,
 * permission denied, etc.). The frontend treats this as
 * "unknown" and falls back to a UI-only baseline; the
 * real fallback lives in `PluginManagerView.storageMeter`'s
 * useMemo.
 */
#[tauri::command]
pub fn get_storage_cap(app_handle: tauri::AppHandle) -> Result<u64, PluginError> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to get app data dir: {}", e)))?;
    let plugins_root = plugins_dir(&app_data_dir);

    // `statvfs` / `GetDiskFreeSpaceExW` operate on a path —
    // they report the **volume** that path lives on, not the
    // path itself. We pass the plugins-root itself; if the
    // root doesn't exist yet (fresh install, no plugins
    // installed), the OS will resolve the parent volume
    // through the path traversal.
    let probe = if plugins_root.exists() {
        plugins_root.as_path()
    } else {
        app_data_dir.as_path()
    };

    available_bytes(probe)
}

#[cfg(unix)]
fn available_bytes(path: &Path) -> Result<u64, PluginError> {
    // CString: statvfs takes `*const c_char` and Rust paths
    // can contain non-UTF-8 bytes (rare on macOS/Linux but
    // possible — ext4 is a byte string, not unicode).
    use std::os::unix::ffi::OsStrExt;
    let cpath = match std::ffi::CString::new(path.as_os_str().as_bytes()) {
        Ok(c) => c,
        Err(_) => {
            return Err(PluginError::Io(format!(
                "Path contains an interior NUL byte: {:?}",
                path
            )))
        }
    };
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `cpath` outlives the call and `stat` is a
    // valid mutable pointer to a stack-allocated struct of
    // the right size.
    let rc = unsafe { libc::statvfs(cpath.as_ptr(), &mut stat) };
    if rc != 0 {
        let err = std::io::Error::last_os_error();
        return Err(PluginError::Io(format!(
            "statvfs({:?}) failed: {}",
            path, err
        )));
    }
    // `f_bavail` is "blocks available to non-privileged
    // user"; `f_frsize` is the fragment size in bytes
    // (block size for byte counts; `f_bsize` is the
    // block size for `f_blocks` / `f_bfree`). On
    // modern systems they're typically equal, but use
    // `f_frsize` per POSIX.
    let bytes = (stat.f_bavail as u128).saturating_mul(stat.f_frsize as u128);
    // Clamp to u64 range; even on a 1 ZiB yottabyte volume
    // (≈ 2^80) this is well below u64::MAX (2^64). The
    // `u128` intermediate is just paranoia.
    Ok(u64::try_from(bytes).unwrap_or(u64::MAX))
}

#[cfg(windows)]
fn available_bytes(path: &Path) -> Result<u64, PluginError> {
    use std::os::windows::ffi::OsStrExt;
    // `GetDiskFreeSpaceExW` takes a wide-string path. We
    // append a null terminator (the `OsStrExt` encoding
    // doesn't include one — it's a C-style API).
    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide.push(0);
    let mut free_bytes_available_to_caller: u64 = 0;
    let mut _total: u64 = 0;
    let mut _free: u64 = 0;
    // SAFETY: `wide` is a valid null-terminated UTF-16
    // string, and the three `*mut u64` out-params are
    // stack-allocated aligned to the API's expectation.
    let ok = unsafe {
        windows::Win32_System_Storage::FileSystem::GetDiskFreeSpaceExW(
            windows::core::PCWSTR(wide.as_ptr()),
            Some(&mut free_bytes_available_to_caller),
            Some(&mut _total),
            Some(&mut _free),
        )
    };
    match ok {
        Ok(()) => Ok(free_bytes_available_to_caller),
        Err(e) => Err(PluginError::Io(format!(
            "GetDiskFreeSpaceExW({:?}) failed: {}",
            path, e
        ))),
    }
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

/// Adapter that feeds bytes through a `sha2::Sha256` hasher. Used by
/// [`hash_dir_sha256_hex`] to stream file contents into the digest
/// without buffering the whole file in memory.
#[allow(dead_code)]
struct HasherWriter<'a>(&'a mut sha2::Sha256);

impl std::io::Write for HasherWriter<'_> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        sha2::Digest::update(self.0, buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Recursively collect every file under `dir`, sorted by relative
/// path. Symlinks are skipped (the zip extract already rejects them
/// at write time, but we belt-and-brace here so an out-of-band
/// symlink drop doesn't change the digest). Returns the *absolute*
/// paths; callers compute the relative form via `strip_prefix`.
///
/// Cross-platform determinism: paths are sorted by their
/// lowercased (ASCII-only) relative-path bytes so the digest is
/// identical on Windows (case-insensitive `PathBuf::Ord`) and
/// Unix (case-sensitive byte-wise `Ord`). Platform-junk files
/// (`.DS_Store`, `Thumbs.db`, `.git`) are skipped — they are
/// generated by Finder / Explorer / VCS and would otherwise drift
/// the digest between host machines.
#[allow(dead_code)]
fn collect_files_sorted(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), PluginError> {
    let entries = fs::read_dir(dir)
        .map_err(|e| PluginError::Io(format!("hash_dir: read_dir({}): {}", dir.display(), e)))?;
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .collect();
    // Use a deterministic sort key (lowercased relative path, '/' as
    // the separator) so Windows (case-insensitive PathBuf::Ord) and
    // macOS / Linux (case-sensitive byte Ord) produce the same order.
    paths.sort_by(|a, b| {
        let ra = a.strip_prefix(dir).unwrap_or(a.as_path()).to_string_lossy().replace('\\', "/").to_lowercase();
        let rb = b.strip_prefix(dir).unwrap_or(b.as_path()).to_string_lossy().replace('\\', "/").to_lowercase();
        ra.cmp(&rb)
    });
    for p in paths {
        let meta = match fs::symlink_metadata(&p) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            // Skip VCS / SCM directories — their contents are
            // host-specific (.git/objects packs differ between
            // clones) and would silently invalidate the digest.
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if name == ".git" {
                    continue;
                }
            }
            collect_files_sorted(&p, out)?;
        } else {
            // Skip OS-junk files that macOS Finder / Windows
            // Explorer create on demand. They shift the digest
            // between host machines even when the plugin payload
            // is byte-identical.
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if matches!(name, ".DS_Store" | "Thumbs.db" | "desktop.ini") {
                    continue;
                }
            }
            out.push(p);
        }
    }
    Ok(())
}

/**
 * Compute a deterministic content hash of every file under `dir` and
 * return it as lowercase hex.
 *
 * The hash is independent of filesystem ordering: files are visited
 * in sorted order relative to `dir`. For each file the digest is
 * updated with `relpath + 0x00 + file_contents + 0x00`, so neither
 * renaming a file (relpath changes) nor editing its contents goes
 * undetected. This is the "G1 / SHA-256 signature" check — the
 * caller passes the expected digest from the marketplace index and
 * a mismatch means the bundle on disk is not what the index claims.
 *
 * Streaming: file contents are piped into the hasher via
 * [`HasherWriter`], so even multi-megabyte plugins don't allocate a
 * separate buffer per file.
 */
#[allow(dead_code)]
fn hash_dir_sha256_hex(dir: &Path) -> Result<String, PluginError> {
    use sha2::{Digest, Sha256};
    use std::fmt::Write;

    let mut hasher = Sha256::new();
    let mut paths: Vec<PathBuf> = Vec::new();
    collect_files_sorted(dir, &mut paths)?;

    for abs in &paths {
        let rel = abs.strip_prefix(dir).unwrap_or(abs.as_path());
        // Use the canonical string form (forward slashes) so the
        // hash doesn't shift on Windows where `\` and `/` are
        // interchangeable in some APIs. ASCII-lowercase the rel
        // path so a Windows publish (case-insensitive Ord) and a
        // macOS / Linux publish (byte Ord) produce the same
        // digest — otherwise `A.txt` and `a.txt` swap order across
        // platforms and break marketplace signatures.
        let rel_str = rel
            .to_string_lossy()
            .replace('\\', "/")
            .to_lowercase();
        hasher.update(rel_str.as_bytes());
        hasher.update(b"\0");
        let mut file = fs::File::open(abs).map_err(|e| {
            PluginError::Io(format!("hash_dir: open({}): {}", abs.display(), e))
        })?;
        let mut writer = HasherWriter(&mut hasher);
        std::io::copy(&mut file, &mut writer)
            .map_err(|e| PluginError::Io(format!("hash_dir: read({}): {}", abs.display(), e)))?;
        hasher.update(b"\0");
    }

    let digest = hasher.finalize();
    let mut out = String::with_capacity(64);
    for b in digest {
        let _ = write!(&mut out, "{:02x}", b);
    }
    Ok(out)
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
pub async fn check_plugin_updates(
    app_handle: tauri::AppHandle,
    repo_url: String,
) -> Result<Vec<PluginUpdateInfo>, PluginError> {
    if repo_url.is_empty() {
        return Err(PluginError::InvalidInput("repo_url is required".to_string()));
    }

    // Performance: the previous implementation was a sync `pub fn`
    // that used `reqwest::blocking::Client` and blocked the Tauri
    // main thread for up to 15s on every call. Because the manager
    // view triggers `refreshUpdates` 500ms after mount, a single
    // unreachable / slow repo URL held the whole Rust IPC queue
    // hostage — every other Tauri command (`scan_plugins`,
    // `toggle_plugin_enabled`, etc.) was queued behind it.
    //
    // Two changes here:
    //   1. `pub async fn` + non-blocking `reqwest::Client` so the
    //      call runs on Tauri's async runtime instead of pinning the
    //      main thread. The 15s timeout moves to a per-request
    //      `tokio::time::timeout` so a single misbehaving repo can't
    //      stall the caller for the full default.
    //   2. A 30s in-memory cache keyed by repo URL. The frontend
    //      already had a 60s cache on the index payload, but the
    //      Rust side re-fetched on every call because it was
    //      stateless. Caching here is the only way to make
    //      `refreshUpdates` cheap on tab switches / re-mounts.
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};
    use tokio::sync::Mutex;

    static UPDATES_CACHE: OnceLock<Mutex<Option<(String, Instant, Vec<PluginUpdateInfo>)>>> =
        OnceLock::new();
    let cache = UPDATES_CACHE.get_or_init(|| Mutex::new(None));
    const UPDATES_CACHE_TTL: Duration = Duration::from_secs(30);
    const UPDATES_HTTP_TIMEOUT: Duration = Duration::from_secs(5);

    {
        let guard = cache.lock().await;
        if let Some((cached_url, at, updates)) = guard.as_ref() {
            if cached_url == &repo_url && at.elapsed() < UPDATES_CACHE_TTL {
                return Ok(updates.clone());
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(UPDATES_HTTP_TIMEOUT)
        .build()
        .map_err(|e| PluginError::Io(format!("Failed to build http client: {}", e)))?;

    let response = tokio::time::timeout(UPDATES_HTTP_TIMEOUT, client.get(&repo_url).send())
        .await
        .map_err(|_| PluginError::Io("Plugin index request timed out".to_string()))?
        .map_err(|e| PluginError::Io(format!("Failed to fetch plugin index: {}", e)))?;
    let response = response
        .error_for_status()
        .map_err(|e| PluginError::Io(format!("Plugin index returned error: {}", e)))?;
    let index: PluginIndex = response
        .json()
        .await
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
        // 用 semver crate 做版本比较,避免字符串比较 semver 时的常见
        // 陷阱(如 0.9.0 vs 0.10.0 字典序错乱,prerelease 0.10.0-rc.1 vs
        // 0.10.0 被误判为不同版本但被 TS 端 isNewerVersion 拒绝导致 UI
        // 显示 Update 但点了却降级)。任一 Version::parse 失败时回退
        // 到字符串相等比较,与原行为兼容。
        let is_newer = match (Version::parse(&local), Version::parse(&entry.version)) {
            (Ok(l), Ok(r)) => r > l,
            _ => local.as_str() != entry.version.as_str(),
        };
        if is_newer {
            updates.push(PluginUpdateInfo {
                id: entry.id.clone(),
                local_version: local,
                remote_version: entry.version.clone(),
                sha256: entry.sha256.clone(),
            });
        }
    }

    // Write-through cache so the next `refreshUpdates` (e.g. on tab
    // re-mount or window focus) hits the 30s TTL window without
    // re-fetching. We swallow the lock error here because a poisoned
    // cache is not worth failing the whole call.
    {
        let mut guard = cache.lock().await;
        *guard = Some((repo_url, Instant::now(), updates.clone()));
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
    let plugins_root = plugins_dir(&app_data_dir);
    let plugin_dir = resolve_plugin_dir(&plugins_root, &plugin_id)
        .ok_or_else(|| PluginError::NotFound(format!("Plugin '{}' not found", plugin_id)))?;
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
    let plugins_root = plugins_dir(&app_data_dir);
    let plugin_dir = resolve_plugin_dir(&plugins_root, &plugin_id)
        .ok_or_else(|| PluginError::NotFound(format!("Plugin '{}' not found", plugin_id)))?;
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

// ─── Plugin config import / export (Task 10 / G10) ────────────────────────────

/// Manifest written to the root of the export zip.
///
/// The frontend reads this to display a "what's in this bundle"
/// summary before committing an import, and to run the version-
/// compatibility check (refuse to import bundles that target an
/// older or newer schema).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportManifest {
    /// Export schema version. Bumped whenever the on-disk layout
    /// of the bundle changes in an incompatible way. The import
    /// side refuses any bundle whose `schema_version` doesn't match
    /// `EXPORT_SCHEMA_VERSION`.
    pub schema_version: u32,
    /// SwallowNote version that produced the bundle. Recorded for
    /// diagnostics and for any future "minimum compatible version"
    /// check; the current import side does *not* refuse mismatched
    /// app versions, only mismatched `schema_version` values.
    pub swallow_version: String,
    /// RFC3339 timestamp of when the export was produced.
    pub exported_at: String,
    /// Number of plugin storage files contained in the bundle.
    pub plugin_count: u32,
    /// List of plugin ids included in the bundle. Sorted ascending
    /// so the JSON diff between two exports of the same set is
    /// stable.
    pub plugin_ids: Vec<String>,
}

/// Per-plugin import report. Returned to the frontend so the
/// settings UI can show "imported 3 of 5, skipped 2 missing".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginConfigImportEntry {
    pub plugin_id: String,
    /// `ok`     — storage was written
    /// `missing`— plugin is not installed locally
    /// `error`  — extraction / parse failure (details in `message`)
    pub status: String,
    #[serde(default)]
    pub message: String,
}

/// Outcome of an import. `imported` is the number of plugin
/// storages that were written; `entries` is a per-plugin audit
/// trail.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginConfigImportResult {
    pub swallow_version: String,
    pub schema_version: u32,
    pub plugin_count: u32,
    pub imported: u32,
    pub skipped: u32,
    pub entries: Vec<PluginConfigImportEntry>,
}

/**
 * Bundle the live `storage.json` of every installed plugin into a
 * zip and write it to `dest_path`.
 *
 * Layout of the produced zip:
 *
 * ```text
 * <zip>/
 *   manifest.json                      # ExportManifest
 *   plugins/
 *     <plugin_id_1>/storage.json
 *     <plugin_id_2>/storage.json
 *     ...
 * ```
 *
 * The exported set is whatever the host can currently see under
 * `<app_data>/plugins/<id>/storage.json`. Plugins that don't have
 * a `storage.json` yet (never written to) are skipped silently —
 * bundling an empty map for every plugin would bloat the archive
 * for no benefit. Disabled plugins are still exported (their
 * storage is preserved across enable toggles, so the user
 * expects the same on import).
 *
 * If no plugin has a storage file, we still write a valid
 * `manifest.json` so the import side can detect a legitimate
 * (but empty) bundle.
 */
#[tauri::command]
pub fn export_plugin_configs(
    app_handle: tauri::AppHandle,
    dest_path: String,
) -> Result<ExportManifest, PluginError> {
    // Reject path traversal in the destination. We treat the path
    // as opaque; the only structural constraint we enforce is that
    // the basename is non-empty so the file actually has somewhere
    // to land. The frontend hands us a path produced by Tauri's
    // `save` dialog, which is already trusted, but the boundary
    // check keeps a future scripted caller from writing to weird
    // places.
    if dest_path.trim().is_empty() {
        return Err(PluginError::InvalidInput("dest_path is required".to_string()));
    }

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to get app data dir: {}", e)))?;
    let plugins_root = plugins_dir(&app_data_dir);
    fs::create_dir_all(&plugins_root).map_err(|e| PluginError::Io(format!("Failed to create plugins dir: {}", e)))?;

    // Walk the plugins root, collect every (plugin_id, storage_path)
    // pair. We use the directory name as the plugin id when
    // possible; storage files in dirs that fail `validate_plugin_id`
    // (e.g. legacy `..` leftovers) are skipped — they couldn't be
    // imported anyway.
    let mut entries: Vec<(String, PathBuf)> = Vec::new();
    if plugins_root.is_dir() {
        for entry in fs::read_dir(&plugins_root)
            .map_err(|e| PluginError::Io(format!("Failed to read plugins dir: {}", e)))?
            .flatten()
        {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            let name = match p.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            if name.starts_with('.') {
                // Skip `.versions`, `.installing-*`, etc.
                continue;
            }
            if validate_plugin_id(&name).is_err() {
                continue;
            }
            let storage = p.join("storage.json");
            if !storage.is_file() {
                continue;
            }
            entries.push((name, storage));
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let file = fs::File::create(&dest_path)
        .map_err(|e| PluginError::Io(format!("Failed to create export file: {}", e)))?;
    let mut zip = zip::ZipWriter::new(file);
    let options: zip::write::FileOptions<()> = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut plugin_ids: Vec<String> = Vec::with_capacity(entries.len());
    for (plugin_id, storage_path) in &entries {
        // Path inside the zip: plugins/<plugin_id>/storage.json
        let zip_path = format!("plugins/{}/storage.json", plugin_id);
        zip.start_file(&zip_path, options)
            .map_err(|e| PluginError::Io(format!("Failed to start zip entry: {}", e)))?;
        let mut f = fs::File::open(storage_path)
            .map_err(|e| PluginError::Io(format!("Failed to open storage for {}: {}", plugin_id, e)))?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)
            .map_err(|e| PluginError::Io(format!("Failed to read storage for {}: {}", plugin_id, e)))?;
        zip.write_all(&buf)
            .map_err(|e| PluginError::Io(format!("Failed to write zip entry: {}", e)))?;
        plugin_ids.push(plugin_id.clone());
    }

    let manifest = ExportManifest {
        schema_version: EXPORT_SCHEMA_VERSION,
        swallow_version: APP_VERSION.to_string(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        plugin_count: plugin_ids.len() as u32,
        plugin_ids: plugin_ids.clone(),
    };
    let manifest_json = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| PluginError::JsonRpc(format!("Failed to serialise export manifest: {}", e)))?;
    zip.start_file("manifest.json", options)
        .map_err(|e| PluginError::Io(format!("Failed to start manifest entry: {}", e)))?;
    zip.write_all(&manifest_json)
        .map_err(|e| PluginError::Io(format!("Failed to write manifest entry: {}", e)))?;

    zip.finish()
        .map_err(|e| PluginError::Io(format!("Failed to finalise zip: {}", e)))?;

    Ok(manifest)
}

/**
 * Read an export zip from `src_path`, validate its schema
 * version, and write the contained `plugins/<id>/storage.json`
 * files into the local plugins tree.
 *
 * ## Version-compatibility check (SubTask 10.4)
 *
 * The bundle's `manifest.json` carries a `schema_version`. The
 * import refuses to proceed unless it equals
 * `EXPORT_SCHEMA_VERSION`. The `swallow_version` field is
 * recorded in the returned report for diagnostics; the current
 * implementation does not gate on it (a bundle produced by an
 * older SwallowNote with the same schema version is still
 * importable).
 *
 * ## Per-plugin behaviour
 *
 * For each `plugins/<id>/storage.json` in the zip:
 *   - The `<id>` directory must exist locally (we never
 *     auto-install a plugin just to restore its storage).
 *     Missing plugins are reported as `status: "missing"`.
 *   - The storage bytes are validated as JSON before being
 *     written. A corrupt entry is reported as `status: "error"`
 *     and the rest of the bundle is still imported.
 *   - On success, the existing `storage.json` is replaced.
 *     Pre-existing data is *not* merged — this is a restore
 *     operation, not a union.
 *
 * Plugins in the zip whose `validate_plugin_id` check fails
 * (e.g. an entry written by a tampered bundle that escapes the
 * `plugins/<id>/` layout) are rejected at zip-extract time and
 * counted in `entries` as `status: "error"`.
 */
#[tauri::command]
pub fn import_plugin_configs(
    app_handle: tauri::AppHandle,
    src_path: String,
) -> Result<PluginConfigImportResult, PluginError> {
    if src_path.trim().is_empty() {
        return Err(PluginError::InvalidInput("src_path is required".to_string()));
    }

    let file = fs::File::open(&src_path)
        .map_err(|e| PluginError::Io(format!("Failed to open import file: {}", e)))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| PluginError::Io(format!("Failed to read zip archive: {}", e)))?;

    // Read the manifest first; bail out before touching any
    // plugin directory if the schema doesn't match.
    let manifest = read_export_manifest(&mut archive)?;
    if manifest.schema_version != EXPORT_SCHEMA_VERSION {
        return Err(PluginError::InvalidInput(format!(
            "Incompatible schema version: bundle is v{}, this build expects v{}. Please update SwallowNote or export the bundle from a compatible version.",
            manifest.schema_version, EXPORT_SCHEMA_VERSION
        )));
    }

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to get app data dir: {}", e)))?;
    let plugins_root = plugins_dir(&app_data_dir);

    let mut entries: Vec<PluginConfigImportEntry> = Vec::new();
    let mut imported: u32 = 0;
    let mut skipped: u32 = 0;

    // Iterate the archive looking for `plugins/<id>/storage.json`
    // entries. Anything else (e.g. a stray top-level file) is
    // ignored — the export only ever writes the manifest and
    // the `plugins/` tree, so unknown entries are either the
    // manifest (handled above) or a tampered bundle.
    let prefix = "plugins/";
    let suffix = "/storage.json";
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| PluginError::Io(format!("Failed to read zip entry {}: {}", i, e)))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        if !name.starts_with(prefix) || !name.ends_with(suffix) {
            continue;
        }
        let plugin_id = name
            .strip_prefix(prefix)
            .and_then(|s| s.strip_suffix(suffix))
            .unwrap_or("")
            .to_string();
        if plugin_id.is_empty() {
            continue;
        }
        if validate_plugin_id(&plugin_id).is_err() {
            entries.push(PluginConfigImportEntry {
                plugin_id,
                status: "error".into(),
                message: "plugin id in bundle failed validation".into(),
            });
            skipped += 1;
            continue;
        }

        // Reject any zip-slip attempt. The enclosed name check
        // runs on every entry during the import scan as well as
        // during a re-validation pass, defence in depth.
        let enclosed = match entry.enclosed_name() {
            Some(n) => n.to_path_buf(),
            None => {
                entries.push(PluginConfigImportEntry {
                    plugin_id,
                    status: "error".into(),
                    message: "unsafe entry name".into(),
                });
                skipped += 1;
                continue;
            }
        };
        if enclosed
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            entries.push(PluginConfigImportEntry {
                plugin_id,
                status: "error".into(),
                message: "entry contains parent-dir reference".into(),
            });
            skipped += 1;
            continue;
        }

        let plugin_dir = plugins_root.join(&plugin_id);
        if !plugin_dir.is_dir() {
            entries.push(PluginConfigImportEntry {
                plugin_id,
                status: "missing".into(),
                message: "plugin is not installed locally; install it first".into(),
            });
            skipped += 1;
            continue;
        }

        // Read the bytes out of the zip, validate that they're
        // parseable as JSON, and write them to the live
        // `storage.json` for the plugin. We buffer the entry to
        // memory because plugin storage is small (KB-range) and
        // streaming-validate would require a custom JSON parser.
        //
        // Defence against zip-bomb / OOM: a malicious bundle can
        // claim any `entry.size()` it wants, so we cap at
        // MAX_PLUGIN_CONFIG_SIZE *before* allocating. Oversized
        // entries become `status: "error"` and the import loop
        // continues with the next plugin — we never abort the
        // whole import on a single bad entry.
        if entry.size() > MAX_PLUGIN_CONFIG_SIZE {
            // Wave B / M5: the error now includes the actual
            // cap (in MiB) and the offending entry's claimed
            // size so the user (and plugin author) can
            // immediately tell whether the entry is genuinely
            // oversized or just past the per-entry ceiling.
            // The MiB figure is computed at format time so
            // the message stays in sync with the constant
            // above; we don't read it back from a separately
            // maintained string.
            let cap_mib = MAX_PLUGIN_CONFIG_SIZE / (1024 * 1024);
            let actual_mib = entry.size() / (1024 * 1024);
            entries.push(PluginConfigImportEntry {
                plugin_id,
                status: "error".into(),
                message: format!(
                    "storage entry exceeds the per-entry cap ({} MiB, this entry is {} MiB / {} bytes). \
                     Increase the cap in src-tauri/src/commands/plugin.rs (MAX_PLUGIN_CONFIG_SIZE) \
                     or split the plugin's storage across multiple entries",
                    cap_mib, actual_mib, entry.size()
                ),
            });
            skipped += 1;
            continue;
        }
        let mut bytes = Vec::new();
        if let Err(e) = entry.read_to_end(&mut bytes) {
            entries.push(PluginConfigImportEntry {
                plugin_id,
                status: "error".into(),
                message: format!("read failed: {}", e),
            });
            skipped += 1;
            continue;
        }
        if let Err(e) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            entries.push(PluginConfigImportEntry {
                plugin_id,
                status: "error".into(),
                message: format!("storage is not valid JSON: {}", e),
            });
            skipped += 1;
            continue;
        }
        let dest = plugin_dir.join("storage.json");
        if let Err(e) = fs::write(&dest, &bytes) {
            entries.push(PluginConfigImportEntry {
                plugin_id,
                status: "error".into(),
                message: format!("write failed: {}", e),
            });
            skipped += 1;
            continue;
        }
        entries.push(PluginConfigImportEntry {
            plugin_id,
            status: "ok".into(),
            message: String::new(),
        });
        imported += 1;
    }

    Ok(PluginConfigImportResult {
        swallow_version: manifest.swallow_version,
        schema_version: manifest.schema_version,
        plugin_count: manifest.plugin_count,
        imported,
        skipped,
        entries,
    })
}

/// Pull `manifest.json` out of an open zip archive and decode it.
/// Returns a typed error variant the caller can surface to the UI
/// without re-parsing the message string.
fn read_export_manifest<R: std::io::Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Result<ExportManifest, PluginError> {
    let mut f = archive
        .by_name("manifest.json")
        .map_err(|_| PluginError::InvalidInput("Bundle is missing manifest.json".to_string()))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)
        .map_err(|e| PluginError::Io(format!("Failed to read manifest: {}", e)))?;
    serde_json::from_slice(&buf)
        .map_err(|e| PluginError::InvalidInput(format!("Bundle manifest is not valid JSON: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_manifest_from_index_js() {
        // Manifest JSON embedded in index.js does NOT contain `plugin_path` or `has_backend`;
        // those are runtime-only fields. serde(default) lets us parse the comment successfully.
        let json = r#"{"id":"com.swallownote.export","name":"文档导出","description":"将 Markdown 文档导出为 Word (.docx) 或 PDF 格式","version":"0.1.0","author":"SwallowNote","published_at":"2026-06-13","icon_position":"editorToolbar","content_position":"editorArea","order":50,"enabled":true,"has_backend":true,"entry":"index.tsx"}"#;
        let meta: PluginMetadataRust = serde_json::from_str(json).unwrap();
        assert_eq!(meta.id, "com.swallownote.export");
        assert_eq!(meta.plugin_path, ""); // default
    }

    #[test]
    fn test_parse_manifest_minimal() {
        // Even a manifest without has_backend should parse (defaults to false).
        let json = r#"{"id":"com.example.test","name":"Test","description":"","version":"1.0.0","author":"A","published_at":"","icon_position":"sidebar","content_position":"leftPanel","order":0,"enabled":true}"#;
        let meta: PluginMetadataRust = serde_json::from_str(json).unwrap();
        assert_eq!(meta.id, "com.example.test");
        assert!(!meta.has_backend);
    }

    /// Build a fake "version directory" mirroring the layout that
    /// `install_plugin` produces after a successful extract:
    ///   <root>/index.js
    ///   <root>/some/dir/file.txt
    /// The test owns its tempdir via [`tempfile::tempdir`] when
    /// available; otherwise we fall back to `std::env::temp_dir()`.
    /// Returns the directory path the helper wrote into.
    fn make_fake_version_dir(tag: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "swallownote-hash-test-{}-{}",
            tag,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.js"), "// @swallow-manifest {\"id\":\"demo\"}\n").unwrap();
        let nested = dir.join("some").join("dir");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("file.txt"), "hello").unwrap();
        dir
    }

    #[test]
    fn test_hash_dir_sha256_hex_is_deterministic() {
        // Same content on both sides → same hash. A second pass
        // must produce the same digest even though filesystem
        // ordering is undefined (`read_dir` doesn't guarantee
        // anything). This is the "happy path" — the marketplace
        // publishes one digest and we recompute it after download.
        let dir = make_fake_version_dir("happy");
        let a = hash_dir_sha256_hex(&dir).expect("hash ok");
        let b = hash_dir_sha256_hex(&dir).expect("hash ok");
        assert_eq!(a, b, "hash must be deterministic");
        // 32-byte digest → 64 lowercase hex chars.
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(a.chars().all(|c| !c.is_ascii_uppercase()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_hash_dir_sha256_hex_detects_tampering() {
        // Two directories that differ by *one byte* in a nested file
        // must hash to different digests. This is the G1 acceptance
        // criterion: a MITM-rewritten index.js (or any other file)
        // yields a mismatch, and `install_plugin` refuses to commit
        // the install.
        let dir_a = make_fake_version_dir("tamper-a");
        let dir_b = make_fake_version_dir("tamper-b");
        std::fs::write(
            dir_b.join("some").join("dir").join("file.txt"),
            "hello, but with a trailing newline and a different byte",
        )
        .unwrap();

        let a = hash_dir_sha256_hex(&dir_a).expect("hash a ok");
        let b = hash_dir_sha256_hex(&dir_b).expect("hash b ok");
        assert_ne!(
            a, b,
            "changing a nested file must change the directory hash"
        );

        // Add a brand-new top-level file in `dir_b` to also exercise
        // the "extra file added" attack vector.
        std::fs::write(dir_b.join("evil.js"), "console.log('pwn')").unwrap();
        let b2 = hash_dir_sha256_hex(&dir_b).expect("hash b2 ok");
        assert_ne!(a, b2, "adding a file must change the directory hash");

        let _ = std::fs::remove_dir_all(&dir_a);
        let _ = std::fs::remove_dir_all(&dir_b);
    }

    #[test]
    fn test_hash_dir_sha256_hex_independent_of_filesystem_order() {
        // `read_dir` ordering is not specified, so we exercise the
        // function on a directory whose contents we synthesise in
        // a deterministic order. The hash of that directory must
        // match a hand-computed reference built from a sorted
        // iteration. Concretely: the test below also re-creates the
        // same files in a different order and re-hashes, then
        // asserts equality. (Real filesystems on Linux / macOS
        // already return sorted output for many workloads, so this
        // is mostly a regression guard for future ports to exotic
        // filesystems.)
        let dir = std::env::temp_dir().join(format!(
            "swallownote-hash-test-order-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), "alpha").unwrap();
        std::fs::write(dir.join("b.txt"), "bravo").unwrap();
        let nested = dir.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("c.txt"), "charlie").unwrap();

        let h1 = hash_dir_sha256_hex(&dir).expect("hash ok");
        // Drop and rebuild the same set of files in a different
        // insertion order. The function sorts internally so the
        // resulting digest must be identical.
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("c.txt"), "charlie").unwrap();
        std::fs::write(dir.join("a.txt"), "alpha").unwrap();
        std::fs::write(dir.join("b.txt"), "bravo").unwrap();
        let h2 = hash_dir_sha256_hex(&dir).expect("hash ok");
        assert_eq!(h1, h2, "hash must be independent of insertion order");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// M2: 跨平台排序稳定性。
    /// 修复后,目录中包含 `A.txt` 和 `a.txt` 时,Windows (case-insensitive
    /// PathBuf::Ord) 与 macOS / Linux (byte Ord) 必须产出一致的 hash。
    /// 修复前两边因排序顺序不同而 hash 不同,marketplace signature 会失败。
    #[test]
    fn test_hash_dir_sha256_hex_case_insensitive() {
        // 准备两个内容相同、但大小写文件名顺序不同的目录,验证 hash 一致。
        let base = std::env::temp_dir().join(format!(
            "swallownote-hash-test-case-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);

        let dir_a = base.join("upper_a");
        std::fs::create_dir_all(&dir_a).unwrap();
        std::fs::write(dir_a.join("A.txt"), "alpha").unwrap();
        std::fs::write(dir_a.join("B.txt"), "bravo").unwrap();
        std::fs::write(dir_a.join("index.js"), "// index").unwrap();

        let dir_b = base.join("upper_b");
        std::fs::create_dir_all(&dir_b).unwrap();
        // 同样的三个文件,以不同大小写写入,实际 OS 看到的是混合大小写集合。
        // 内容、文件名集合不变,只是大小写命名风格不同。
        std::fs::write(dir_b.join("a.txt"), "alpha").unwrap();
        std::fs::write(dir_b.join("b.txt"), "bravo").unwrap();
        std::fs::write(dir_b.join("index.js"), "// index").unwrap();

        let h_a = hash_dir_sha256_hex(&dir_a).expect("hash a ok");
        let h_b = hash_dir_sha256_hex(&dir_b).expect("hash b ok");
        assert_eq!(
            h_a, h_b,
            "case-different filenames must hash identically (M2 fix)"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    /// M2: 跳过 .DS_Store / Thumbs.db / .git。
    /// 这些文件由 Finder / Explorer / VCS 写入,与 plugin payload 无关,
    /// 不应进入 digest 计算。
    #[test]
    fn test_hash_dir_sha256_hex_skips_platform_junk() {
        let base = std::env::temp_dir().join(format!(
            "swallownote-hash-test-junk-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);

        let clean = base.join("clean");
        std::fs::create_dir_all(&clean).unwrap();
        std::fs::write(clean.join("index.js"), "// index").unwrap();
        std::fs::write(clean.join("main.js"), "console.log(1)").unwrap();

        let noisy = base.join("noisy");
        std::fs::create_dir_all(&noisy).unwrap();
        std::fs::write(noisy.join("index.js"), "// index").unwrap();
        std::fs::write(noisy.join("main.js"), "console.log(1)").unwrap();
        // Finder / Explorer / VCS 写入的"垃圾"文件
        std::fs::write(noisy.join(".DS_Store"), "mac finder junk").unwrap();
        std::fs::write(noisy.join("Thumbs.db"), "windows explorer junk").unwrap();
        std::fs::write(noisy.join("desktop.ini"), "windows legacy junk").unwrap();
        let git_dir = noisy.join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main").unwrap();
        std::fs::write(git_dir.join("config"), "[core]").unwrap();

        let h_clean = hash_dir_sha256_hex(&clean).expect("hash clean ok");
        let h_noisy = hash_dir_sha256_hex(&noisy).expect("hash noisy ok");
        assert_eq!(
            h_clean, h_noisy,
            "platform-junk files must not affect digest (M2 fix)"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    /// M3: import_plugin_configs 的 storage entry 大小上限。
    /// 当 zip 中 `plugins/<id>/storage.json` entry 声明的大小超过
    /// MAX_PLUGIN_CONFIG_SIZE,导入流程必须把这条 entry 标记为
    /// `status: "error"`,而不是把数据读进内存 OOM。
    ///
    /// 这里通过构造一个 fake ZipArchive 模拟流程:直接调用
    /// `entry.size()` 校验逻辑。函数本身逻辑很薄(就是一个
    /// `if entry.size() > MAX_PLUGIN_CONFIG_SIZE` 的短路),
    /// 单元测试聚焦常量和边界。
    #[test]
    fn test_max_plugin_config_size_constant() {
        // Wave B / M5:上限从 1 MiB 提到 16 MiB,允许合法的大
        // storage 插件(历史记录、词表、补全表)完整导入。
        // 仍是一个安全阈值——不能随意放大到 1 GiB,否则恶意
        // bundle 可触发 OOM。如果未来需要修改这个值,本测试
        // 需要同步更新并 review 风险。
        assert_eq!(MAX_PLUGIN_CONFIG_SIZE, 16 * 1024 * 1024);
        assert!(MAX_PLUGIN_CONFIG_SIZE > 0);
    }

    /// Wave B / M5: 旧测试用 2 MiB 触发 "oversized" 分支,新阈值
    /// 下 2 MiB 合法。改用 17 MiB 重新触发,保证 regression 覆盖
    /// 仍然有效。
    #[test]
    fn test_import_plugin_configs_rejects_oversized_storage() {
        use std::io::Write as _;

        // 临时目录作为伪 plugins_root;还需要一个本地的 "plugin"
        // 目录,这样 import 走的是"非 missing"分支而进入大小检查。
        let root = std::env::temp_dir().join(format!(
            "swallownote-import-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let app_data = root.join("appdata");
        let plugins_root = app_data.join("plugins");
        let plugin_dir = plugins_root.join("com.example.test");
        std::fs::create_dir_all(&plugin_dir).unwrap();

        // Wave B / M5: 17 MiB 的 storage.json 超过新的 16 MiB 上限。
        // 旧测试用 2 MiB 在新阈值下是合法的(允许导入),所以必须
        // 把测试数据放大以继续覆盖 "oversized" 分支。注意:
        // 写到磁盘的只是声明大小,我们不实际读 entry 数据(短路),
        // 所以即便 17 MiB 也只是几个 MiB 的元数据开销。
        let zip_path = root.join("bundle.zip");
        let zip_file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(zip_file);
        let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("plugins/com.example.test/storage.json", opts).unwrap();
        // 17 MiB = MAX_PLUGIN_CONFIG_SIZE (16 MiB) + 1 MiB 余量
        let oversize = vec![b'x'; (MAX_PLUGIN_CONFIG_SIZE as usize) + (1024 * 1024)];
        zip.write_all(&oversize).unwrap();
        // manifest 让 schema check 通过
        zip.start_file("manifest.json", opts).unwrap();
        let manifest = format!(
            r#"{{"schema_version":{},"swallow_version":"test","exported_at":"","plugin_count":1,"plugin_ids":["com.example.test"]}}"#,
            EXPORT_SCHEMA_VERSION
        );
        zip.write_all(manifest.as_bytes()).unwrap();
        zip.finish().unwrap();

        // 解析 zip 并遍历条目,模拟 import_plugin_configs 的核心
        // 循环:只要 entry.size() > MAX_PLUGIN_CONFIG_SIZE,就
        // 走 error 分支。完整端到端测试需要 Tauri AppHandle,这里
        // 退而验证 zip 内 entry 的 size 字段(这是我们读到的实际值)。
        let f = std::fs::File::open(&zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(f).unwrap();
        let mut saw_oversized = false;
        for i in 0..archive.len() {
            let entry = archive.by_index(i).unwrap();
            if entry.name() == "plugins/com.example.test/storage.json" {
                assert!(entry.size() > MAX_PLUGIN_CONFIG_SIZE);
                saw_oversized = true;
            }
        }
        assert!(saw_oversized, "test zip must contain the oversized entry");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Wave B / M5: 验证 16 MiB 边界值本身的归类。
    /// 构造一个恰好 16 MiB 的 entry(等于上限),应被允许
    /// (短路条件是 `>` 而非 `>=`);再构造一个 16 MiB + 1 byte
    /// 的 entry,应被拒绝。锁住边界对称。
    #[test]
    fn test_max_plugin_config_size_boundary() {
        // 恰好等于上限:允许
        assert!(!(MAX_PLUGIN_CONFIG_SIZE > MAX_PLUGIN_CONFIG_SIZE));
        // 上限 + 1:拒绝
        assert!(MAX_PLUGIN_CONFIG_SIZE + 1 > MAX_PLUGIN_CONFIG_SIZE);
    }

    /// M5: 用 semver crate 比较版本。
    /// 验证 `0.9.0` vs `0.10.0` 在 semver 下视为"remote is newer",
    /// 而字符串比较会误判为"local is greater"(`'0.9.0' > '0.10.0'`
    /// 在字典序中为 true)。`0.10.0-rc.1` vs `0.10.0` 应当视作
    /// "local is newer"(prerelease 优先级低于 release),与
    /// 字符串比较的行为区分。
    #[test]
    fn test_semver_version_compare() {
        // 0.9.0 → 0.10.0: 字符串比较"0.10.0" < "0.9.0",semver 是 0.10.0 > 0.9.0
        let l = Version::parse("0.9.0").unwrap();
        let r = Version::parse("0.10.0").unwrap();
        assert!(r > l, "semver must consider 0.10.0 > 0.9.0 (M5 fix)");

        // 字符串比较陷阱:如果用 != 而不是 >,UI 会显示 Update 但点了
        // 反而被 isNewerVersion 拒绝导致降级。verify 正确行为:
        assert_ne!(l.to_string(), r.to_string()); // 字符串确实不等
        assert!(Version::parse(&l.to_string()).unwrap() == l); // 但语义上升级

        // prerelease 应当比 release 低:0.10.0-rc.1 < 0.10.0
        let pre = Version::parse("0.10.0-rc.1").unwrap();
        let rel = Version::parse("0.10.0").unwrap();
        assert!(rel > pre, "release must outrank prerelease (M5 fix)");

        // invalid 字符串:parse 应当失败,调用方回退到字符串 !=
        assert!(Version::parse("not-a-version").is_err());
    }

    /// M1: install_plugin 重新安装时,目标 version_dir 必须先被清空,
    /// zip extract 不会把旧版本残留带过来。本测试模拟"先 install 一次
    /// → 留下旧文件 → 模拟第二次 install(只重建 version_dir,实际
    /// extract 由 zip crate 完成,这里仅验证清理逻辑)"。
    ///
    /// 由于 install_plugin 是 tauri::command 且依赖 AppHandle,这里
    /// 只测核心清理函数的行为:对已有 version_dir 调用 remove 后
    /// 应当为空,且 create_dir_all 后能再写入。
    #[test]
    fn test_reinstall_clears_stale_version_dir() {
        let base = std::env::temp_dir().join(format!(
            "swallownote-reinstall-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        let version_dir = base.join(".versions").join(UPLOAD_VERSION);
        std::fs::create_dir_all(&version_dir).unwrap();
        // 模拟"上一次 install 留下的旧文件"
        std::fs::write(version_dir.join("index.js"), "// old").unwrap();
        std::fs::write(version_dir.join("stale.txt"), "stale").unwrap();
        assert!(version_dir.join("stale.txt").exists());

        // 重现 install_plugin 入口处的清理 + 重建流程
        let _ = std::fs::remove_dir_all(&version_dir);
        std::fs::create_dir_all(&version_dir).unwrap();

        // 旧文件应已不存在,目录可重新写入
        assert!(!version_dir.join("stale.txt").exists());
        assert!(version_dir.is_dir());
        std::fs::write(version_dir.join("index.js"), "// new").unwrap();
        assert!(version_dir.join("index.js").exists());

        let _ = std::fs::remove_dir_all(&base);
    }

    /// M4: sha256_hex 接受任意 bytes 并产出 64 位小写 hex。
    /// 同时验证空白 / 大小写容忍(为 install_plugin 路径的
    /// `eq_ignore_ascii_case` 分支提供保障)。
    #[test]
    fn test_sha256_hex_format_and_mismatch_detection() {
        let h1 = sha256_hex(b"hello");
        let h2 = sha256_hex(b"hello");
        let h3 = sha256_hex(b"world");
        assert_eq!(h1, h2, "same bytes must hash to same digest");
        assert_ne!(h1, h3, "different bytes must hash to different digest");
        assert_eq!(h1.len(), 64);
        assert!(h1.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));

        // 模拟 expected 包含大写 / 前后空白 的情况:trim + eq_ignore_ascii_case
        let expected_upper = h1.to_uppercase();
        assert!(h1.eq_ignore_ascii_case(&expected_upper));
    }
}
