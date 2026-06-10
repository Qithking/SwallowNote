/**
 * Unified error type for the plugin IPC surface.
 *
 * All 6 Tauri commands exposed under the `plugin_*` family
 * ([`super::plugin::scan_plugins`], [`super::plugin::install_plugin`],
 * [`super::plugin::uninstall_plugin`], [`super::plugin::toggle_plugin_enabled`],
 * [`super::plugin::get_plugin_storage_path`],
 * [`super::plugin_invoke::invoke_plugin`]) return `Result<_, PluginError>`.
 *
 * Design goals
 * ============
 *
 * 1. **Categorical**: the variant conveys *what kind* of failure
 *    happened (NotFound / InvalidInput / Io / Process / Security /
 *    JsonRpc / Timeout / Other) so the host can log/branch on it
 *    without parsing the human-readable message.
 *
 * 2. **Stable TS contract**: the `Display` impl produces the **same**
 *    human-readable string the previous `Result<_, String>` returned,
 *    so the TypeScript `err.message` seen by `panel.invokeBackend`
 *    callers does not change. This was a hard requirement of the
 *    "A 方案" decision recorded in `.work/执行文档.md`.
 *
 * 3. **No protocol change**: Tauri serialises the error via
 *    `serde::Serialize`, and since `Result<_, PluginError>` is
 *    displayed as a `String` on the wire, the IPC payload remains
 *    `{ "message": "..." }` — no breaking change to the frontend.
 *
 * 4. **No extra dependencies on the hot path**: every variant is a
 *    thin wrapper around `String` (or a small struct for `Timeout`).
 *    Constructing one is a single move, no allocation beyond the
 *    string already produced by the underlying error.
 */
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PluginError {
    /// A plugin, file, or other resource was not found.
    ///
    /// Examples:
    /// - `PluginError::NotFound(format!("Plugin '{}' not found", id))`
    /// - `PluginError::NotFound(format!("plugin backend not found (plugin_id={})", id))`
    #[error("{0}")]
    NotFound(String),

    /// Caller-supplied argument failed validation.
    ///
    /// Examples:
    /// - empty `plugin_id` or `command` strings
    /// - a plugin zip that does not contain an `index.js`
    #[error("{0}")]
    InvalidInput(String),

    /// Filesystem / IO error.
    ///
    /// Examples: read/write/remove failures, dir creation, canonicalize.
    #[error("{0}")]
    Io(String),

    /// Child-process or path resolution error.
    ///
    /// Examples: spawn failure, stdin/stdout/stderr pipe unavailable,
    /// subprocess exited unexpectedly, write/flush to plugin stdin
    /// failed, backend binary path resolution issues.
    #[error("{0}")]
    Process(String),

    /// Security policy violation.
    ///
    /// Examples: zip-slip detected, symlink entry in plugin zip,
    /// attempted path traversal outside the plugins directory.
    /// These are reported as `Err(PluginError::Security(...))` so the
    /// host can flag the plugin as malicious even though the message
    /// reads the same as a regular `Io` error.
    #[error("{0}")]
    Security(String),

    /// Plugin subprocess violated the JSON-RPC protocol.
    ///
    /// Examples: malformed response line, request encoding failure,
    /// a JSON-RPC `error.message` returned by the plugin, response
    /// channel closed before delivery.
    #[error("{0}")]
    JsonRpc(String),

    /// Plugin subprocess did not respond within the per-call timeout.
    ///
    /// Carries structured fields so the host (and the diagnostic
    /// panel) can render a useful message without re-parsing the
    /// `Display` output. The `Display` impl matches the original
    /// `Result<_, String>` shape:
    /// `plugin backend timed out after {secs}s (plugin_id=..., command=...)`.
    #[error("plugin backend timed out after {secs}s (plugin_id={plugin_id}, command={command})")]
    Timeout {
        secs: u64,
        plugin_id: String,
        command: String,
    },

    /// Catch-all for errors that don't fit the categories above.
    ///
    /// Kept narrow on purpose: most new error sites should grow into
    /// a dedicated variant rather than route through `Other`.
    #[error("{0}")]
    Other(String),
}

impl PluginError {
    /// Cheap constructor for `PluginError::Io` from a `std::io::Error`.
    pub fn from_io(err: std::io::Error) -> Self {
        PluginError::Io(err.to_string())
    }

    /// Cheap constructor for `PluginError::JsonRpc` from a
    /// `serde_json::Error`.
    pub fn from_json(err: serde_json::Error) -> Self {
        PluginError::JsonRpc(err.to_string())
    }
}

impl From<std::io::Error> for PluginError {
    fn from(err: std::io::Error) -> Self {
        PluginError::Io(err.to_string())
    }
}

impl From<serde_json::Error> for PluginError {
    fn from(err: serde_json::Error) -> Self {
        PluginError::JsonRpc(err.to_string())
    }
}

/// `#[tauri::command]` requires the error type to be convertible into
/// `tauri::ipc::InvokeError`. We piggy-back on `InvokeError::from_error`
/// (which uses our `Display` impl) so the wire format the frontend sees
/// is exactly the same string the previous `Result<_, String>` returned.
impl From<PluginError> for tauri::ipc::InvokeError {
    fn from(err: PluginError) -> Self {
        tauri::ipc::InvokeError::from_error(err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_preserves_human_message() {
        // The TS-side `err.message` must not change.
        let e = PluginError::NotFound(format!("Plugin '{}' not found", "demo"));
        assert_eq!(e.to_string(), "Plugin 'demo' not found");
    }

    #[test]
    fn timeout_display_matches_legacy_string() {
        // Mirrors the message previously constructed inline in
        // `invoke_plugin` timeout branch.
        let e = PluginError::Timeout {
            secs: 30,
            plugin_id: "demo".into(),
            command: "ping".into(),
        };
        assert_eq!(
            e.to_string(),
            "plugin backend timed out after 30s (plugin_id=demo, command=ping)"
        );
    }

    #[test]
    fn from_io_and_from_json() {
        let io = std::io::Error::new(std::io::ErrorKind::NotFound, "missing");
        let e: PluginError = io.into();
        assert!(matches!(e, PluginError::Io(_)));
        assert_eq!(e.to_string(), "missing");

        // serde_json::Error is awkward to construct directly; just
        // exercise the From impl through parse failure.
        let bad: Result<serde_json::Value, _> = serde_json::from_str("not json");
        let e: PluginError = bad.unwrap_err().into();
        assert!(matches!(e, PluginError::JsonRpc(_)));
    }
}
