//! 流式通知帧帮手：等价平移自 ai 插件 main.rs 的 `make_emit`。
//!
//! 通知帧（`swallow/stream`）与响应帧同管道交错输出，宿主
//! `plugin_invoke.rs` 按 `params.requestId`（即该次请求的 JSON-RPC id）
//! 路由到对应流式 Channel；`params.event` 仅接受 `chunk|done|error`
//! 白名单，其余帧被宿主丢弃。帧结构：
//!
//! `{"jsonrpc":"2.0","method":"swallow/stream","params":{"requestId":<请求id>,"event":"...","data":...}}`

use serde_json::Value;
use std::io::{self, Write};

/// 流式通知帧保留的 method 名（宿主 JsonRpcFrame::STREAM_METHOD 同值）。
pub const STREAM_METHOD: &str = "swallow/stream";

/// 构造一帧 `swallow/stream` 通知的 JSON 行文本（不含换行）。
/// 纯函数，便于单测；`make_emit` 内部也用它组装。
pub fn stream_frame(request_id: &Value, event: &str, data: &Value) -> String {
    serde_json::to_string(&serde_json::json!({
        "jsonrpc": "2.0",
        "method": STREAM_METHOD,
        "params": { "requestId": request_id, "event": event, "data": data },
    }))
    .unwrap()
}

/// 通知帧发送器（等价平移 ai `make_emit`）：返回闭包，每调用一次向
/// stdout 写一行通知帧并 flush。`event` 取 `chunk|done|error`；
/// `request_id` 传该次请求的 JSON-RPC id（宿主据此路由）。
pub fn make_emit(request_id: &Value) -> impl FnMut(&str, Value) {
    let id = request_id.clone();
    move |event: &str, data: Value| {
        let frame = stream_frame(&id, event, &data);
        let mut stdout = io::stdout();
        let _ = writeln!(stdout, "{}", frame);
        let _ = stdout.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 帧字段逐项核对：method 常量、jsonrpc、params{requestId,event,data}。
    #[test]
    fn stream_frame_fields() {
        assert_eq!(STREAM_METHOD, "swallow/stream");

        let frame: Value =
            serde_json::from_str(&stream_frame(&json!(7), "chunk", &json!({ "text": "你" })))
                .unwrap();
        assert_eq!(frame["jsonrpc"], "2.0");
        assert_eq!(frame["method"], "swallow/stream");
        assert_eq!(frame["params"]["requestId"], 7);
        assert_eq!(frame["params"]["event"], "chunk");
        assert_eq!(frame["params"]["data"]["text"], "你");
        // 通知帧不带 id 字段（宿主以 method 有无区分通知/响应）。
        assert!(frame.get("id").is_none());
    }

    /// 字符串 id 与 null data 同样成立（done 事件可无载荷语义）。
    #[test]
    fn stream_frame_string_id_and_null_data() {
        let frame: Value =
            serde_json::from_str(&stream_frame(&json!("req-1"), "done", &Value::Null)).unwrap();
        assert_eq!(frame["params"]["requestId"], "req-1");
        assert_eq!(frame["params"]["event"], "done");
        assert_eq!(frame["params"]["data"], Value::Null);
    }
}
