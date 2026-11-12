//! 协议等价性集成测试：模拟 stdin 多行输入（含坏行），断言 stdout
//! 响应序列与现有插件 main.rs 行为一致；并 spawn `examples/echo`
//! 走真实管道做端到端验证。

use serde_json::Value;
use std::io::Write;
use std::process::{Command, Stdio};
use swallow_plugin_rpc::{process_line, PluginBackend, RpcError, PLUGIN_ERROR};

/// 同步 echo 后端（与 examples/echo.rs 行为一致）。
struct EchoBackend;
impl PluginBackend for EchoBackend {
    fn handle(&mut self, method: &str, params: &Value) -> Result<Value, RpcError> {
        match method {
            "ping" => Ok(serde_json::json!({ "pong": true })),
            "echo" => Ok(params.clone()),
            _ => Err(RpcError::plugin(PLUGIN_ERROR, format!("未知方法: {}", method))),
        }
    }
}

/// 模拟 stdin 逐行喂入 → 收集 stdout 行（None 行丢弃，等价主循环不写帧）。
fn feed(lines: &[&str]) -> Vec<String> {
    let mut b = EchoBackend;
    lines
        .iter()
        .filter_map(|l| process_line(&mut b, l))
        .collect()
}

/// 请求序列覆盖：成功、参数回显、坏行（-32700）、空行跳过、
/// 未知方法（-32000）、字符串 id 回显、缺 params。
#[test]
fn request_sequence_matches_existing_plugin_behavior() {
    let out = feed(&[
        r#"{"jsonrpc":"2.0","id":1,"method":"ping","params":null}"#,
        "",                                  // 空行：跳过，无输出
        r#"{"jsonrpc":"2.0","id":2,"method":"echo","params":{"a":1}}"#,
        "not json",                          // 坏行：-32700，id=null
        r#"{"jsonrpc":"2.0","id":3,"method":"nope"}"#,
        r#"{"jsonrpc":"2.0","id":"req-4","method":"echo","params":{"x":"字"}}"#,
    ]);

    assert_eq!(out.len(), 5, "空行不应产生输出：{:?}", out);
    assert_eq!(
        out[0], r#"{"jsonrpc":"2.0","id":1,"result":{"pong":true}}"#,
        "成功帧字段序与现有插件一致"
    );
    assert_eq!(
        out[1], r#"{"jsonrpc":"2.0","id":2,"result":{"a":1}}"#
    );

    // -32700 帧：id=null、错误码、消息前缀（serde 错误文案不锁死）。
    let v: Value = serde_json::from_str(&out[2]).unwrap();
    assert_eq!(v["jsonrpc"], "2.0");
    assert_eq!(v["id"], Value::Null);
    assert_eq!(v["error"]["code"], -32700);
    assert!(v["error"]["message"].as_str().unwrap().starts_with("解析错误: "));

    assert_eq!(
        out[3], r#"{"jsonrpc":"2.0","id":3,"error":{"code":-32000,"message":"未知方法: nope"}}"#
    );
    assert_eq!(
        out[4], r#"{"jsonrpc":"2.0","id":"req-4","result":{"x":"字"}}"#
    );
}

/// 端到端：spawn examples/echo（cargo test 会编译 examples），
/// 写入请求行、关闭 stdin 触发 EOF，断言 stdout 全部响应行。
#[test]
#[cfg(unix)]
fn end_to_end_via_real_pipe() {
    let exe = concat!(env!("CARGO_MANIFEST_DIR"), "/target/debug/examples/echo");
    assert!(
        std::path::Path::new(exe).exists(),
        "examples/echo 未构建（先 cargo test / cargo build --examples）"
    );

    let mut child = Command::new(exe)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn echo 示例失败");

    let mut stdin = child.stdin.take().unwrap();
    writeln!(stdin, r#"{{"jsonrpc":"2.0","id":1,"method":"ping","params":null}}"#).unwrap();
    writeln!(stdin, "garbage").unwrap();
    writeln!(stdin, r#"{{"jsonrpc":"2.0","id":2,"method":"nope"}}"#).unwrap();
    // flush + drop 触发 EOF，主循环自然退出。
    stdin.flush().unwrap();
    drop(stdin);

    let output = child.wait_with_output().expect("等待 echo 退出");
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let lines: Vec<&str> = stdout.lines().collect();

    assert_eq!(lines.len(), 3, "实际输出: {:?}", lines);
    assert_eq!(lines[0], r#"{"jsonrpc":"2.0","id":1,"result":{"pong":true}}"#);
    assert!(lines[1].contains(r#""code":-32700"#), "实际: {}", lines[1]);
    assert_eq!(
        lines[2], r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"未知方法: nope"}}"#
    );
}
