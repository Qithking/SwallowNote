//! JSON-RPC 2.0 线上协议结构：等价平移自现有 4 个插件 main.rs 的协议骨架
//! （secret-disk / wenyan / export / ai 的 `JsonRpc*` 结构逐字段一致）。
//!
//! - `id` 为 `serde_json::Value`：完整支持 JSON-RPC 2.0 id 空间
//!   （数字/字符串/null），并在响应中原样回显。
//! - `params` 带 `#[serde(default)]`：请求缺 params 时按 `Value::Null` 处理
//!   （宿主 invoke_plugin 总是发送 params，缺省仅作兜底）。
//! - `JsonRpcErrorDetail.data` 为可选字段，`None` 时不输出 `data` 键，
//!   与现有线上帧形态逐字节一致。

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---------- 标准错误码 ----------
//
// -32700 ~ -32603 为 JSON-RPC 2.0 标准区间；-32000 为插件通用错误
// （现有 secret-disk/ai 的命令失败与「未知方法」均用它）。
// 插件自定义应用码约定：-32000 保留为通用插件错误，业务错误码建议
// 放入 `JsonRpcErrorDetail.data`（宿主透传给前端），或沿用各插件
// 既有 code 值（如 export 的 1001/1002/1003），勿与标准区间冲突。

/// 解析错误（stdin 行不是合法 JSON）。
pub const PARSE_ERROR: i64 = -32700;
/// 方法不存在（wenyan/export 的「Method not found」用此码）。
pub const METHOD_NOT_FOUND: i64 = -32601;
/// 参数无效。
pub const INVALID_PARAMS: i64 = -32602;
/// 内部错误。
pub const INTERNAL_ERROR: i64 = -32603;
/// 插件通用错误（secret-disk/ai 的命令失败用此码）。
pub const PLUGIN_ERROR: i64 = -32000;

/// JSON-RPC 2.0 请求。`id` 为 `Value` 以支持数字/字符串/null。
#[derive(Deserialize)]
pub struct JsonRpcRequest {
    /// 协议版本，宿主恒发 `"2.0"`；反序列化要求该字段存在（与现有插件一致）。
    pub jsonrpc: String,
    /// 请求 id，响应帧原样回显。
    pub id: Value,
    /// 命令名。
    pub method: String,
    /// 命令参数；缺失按 `Value::Null`。
    #[serde(default)]
    pub params: Value,
}

/// JSON-RPC 2.0 成功响应。
#[derive(Serialize)]
pub struct JsonRpcSuccess {
    /// 恒为 `"2.0"`。
    pub jsonrpc: &'static str,
    /// 回显请求 id。
    pub id: Value,
    /// 命令结果。
    pub result: Value,
}

/// JSON-RPC 2.0 错误响应。解析错误时 `id` 为 `Value::Null`
/// （没看到合法请求，无从回显）。
#[derive(Serialize)]
pub struct JsonRpcError {
    /// 恒为 `"2.0"`。
    pub jsonrpc: &'static str,
    /// 回显请求 id（解析错误时为 null）。
    pub id: Value,
    /// 错误详情。
    pub error: JsonRpcErrorDetail,
}

/// JSON-RPC 2.0 错误详情：标准码（-32700/-32601/-32602/-32603）、
/// 插件通用码（-32000）或插件自定义应用码（如 export 的 1001~1003）。
#[derive(Serialize)]
pub struct JsonRpcErrorDetail {
    /// 错误码。
    pub code: i64,
    /// 错误消息（宿主只透传 message 给前端，自定义码可按插件惯例嵌入消息）。
    pub message: String,
    /// 可选结构化载荷（自定义应用码建议放这里）；`None` 时不输出该键。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// 插件命令错误：`PluginBackend::handle` 的错误返回值，
/// 由主循环转成 JSON-RPC 错误响应帧。
#[derive(Debug, Clone, Serialize)]
pub struct RpcError {
    /// 错误码（见模块级错误码约定）。
    pub code: i64,
    /// 错误消息。
    pub message: String,
    /// 可选结构化载荷；`None` 时不输出 `data` 键（保持现有帧形态）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    /// 任意错误码构造。
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    /// 插件错误区间构造（-32000 通用码或插件自定义应用码）。
    pub fn plugin(code: i64, message: impl Into<String>) -> Self {
        Self::new(code, message)
    }

    /// 解析错误（-32700）。
    pub fn parse(message: impl Into<String>) -> Self {
        Self::new(PARSE_ERROR, message)
    }

    /// 方法不存在（-32601，wenyan/export 惯例）。
    pub fn method_not_found(message: impl Into<String>) -> Self {
        Self::new(METHOD_NOT_FOUND, message)
    }

    /// 参数无效（-32602）。
    pub fn invalid_params(message: impl Into<String>) -> Self {
        Self::new(INVALID_PARAMS, message)
    }

    /// 内部错误（-32603）。
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(INTERNAL_ERROR, message)
    }

    /// 附带结构化载荷（链式）。
    pub fn with_data(mut self, data: Value) -> Self {
        self.data = Some(data);
        self
    }
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "#{}: {}", self.code, self.message)
    }
}

impl std::error::Error for RpcError {}

impl From<RpcError> for JsonRpcErrorDetail {
    fn from(e: RpcError) -> Self {
        Self {
            code: e.code,
            message: e.message,
            data: e.data,
        }
    }
}

impl JsonRpcSuccess {
    /// 构造成功响应帧。
    pub fn new(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result,
        }
    }
}

impl JsonRpcError {
    /// 构造错误响应帧。
    pub fn new(id: Value, err: RpcError) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            error: err.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 标准错误码常量值。
    #[test]
    fn error_code_constants() {
        assert_eq!(PARSE_ERROR, -32700);
        assert_eq!(METHOD_NOT_FOUND, -32601);
        assert_eq!(INVALID_PARAMS, -32602);
        assert_eq!(INTERNAL_ERROR, -32603);
        assert_eq!(PLUGIN_ERROR, -32000);
    }

    /// 错误响应帧形态与现有插件一致：jsonrpc/id/error{code,message}；
    /// data 为 None 时不输出 data 键，Some 时输出。
    #[test]
    fn error_frame_shape_and_optional_data() {
        let plain = serde_json::to_value(JsonRpcError::new(
            Value::Null,
            RpcError::parse("解析错误: bad"),
        ))
        .unwrap();
        assert_eq!(
            plain,
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": null,
                "error": { "code": -32700, "message": "解析错误: bad" }
            })
        );
        // 序列化键顺序与现有 struct 声明序一致（jsonrpc, id, error）。
        let line = serde_json::to_string(
            &JsonRpcError::new(Value::from(7), RpcError::plugin(PLUGIN_ERROR, "x")),
        )
        .unwrap();
        assert_eq!(
            line,
            r#"{"jsonrpc":"2.0","id":7,"error":{"code":-32000,"message":"x"}}"#
        );

        // data=Some 时输出 data 键（应用码建议放 data 的约定）。
        let with_data = serde_json::to_value(JsonRpcError::new(
            Value::from(1),
            RpcError::plugin(1001, "too large").with_data(serde_json::json!({ "max": 10 })),
        ))
        .unwrap();
        assert_eq!(with_data["error"]["data"]["max"], 10);
    }

    /// 便捷构造器的码值与 Display。
    #[test]
    fn rpc_error_helpers() {
        assert_eq!(RpcError::internal("boom").code, INTERNAL_ERROR);
        assert_eq!(RpcError::invalid_params("p").code, INVALID_PARAMS);
        assert_eq!(RpcError::method_not_found("m").code, METHOD_NOT_FOUND);
        assert_eq!(RpcError::plugin(1002, "gen").code, 1002);
        assert_eq!(RpcError::new(-32000, "m").to_string(), "#-32000: m");
    }
}
