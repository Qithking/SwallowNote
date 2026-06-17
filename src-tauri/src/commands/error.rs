//! Plugin IPC 统一错误类型；Display 输出与原 Result<_, String> 保持一致以维持前端 TS 契约。
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PluginError {
    /// 资源未找到（插件/文件/后端等）。
    #[error("{0}")]
    NotFound(String),

    /// 调用方参数校验失败。
    #[error("{0}")]
    InvalidInput(String),

    /// Filesystem / IO error.
    ///
    /// Examples: read/write/remove failures, dir creation, canonicalize.
    #[error("{0}")]
    Io(String),

    /// 子进程或路径解析错误。
    #[error("{0}")]
    Process(String),

    /// 安全策略违规（zip-slip / 符号链接 / 路径穿越）。
    #[error("{0}")]
    Security(String),

    /// 子进程违反 JSON-RPC 协议。
    #[error("{0}")]
    JsonRpc(String),

    /// 调用超时；携带结构化字段供诊断面板渲染。
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

/// 借助 InvokeError::from_error 保持前端 wire format 不变。
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
