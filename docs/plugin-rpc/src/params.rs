//! 参数提取帮手：等价平移自 ai 插件 main.rs 的 `s_field` / `opt_field` /
//! `meta_field`，供各插件命令处理函数复用。

use serde_json::Value;

/// 取字符串参数（缺失或非字符串按空串）。
pub fn s_field(p: &Value, key: &str) -> String {
    p.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// 可选字符串参数（缺失或空串 → None）。
pub fn opt_field(p: &Value, key: &str) -> Option<String> {
    match p.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// metaJson 兼容：字符串直取；对象/数组序列化为字符串
/// （对齐 ai_messages.meta_json 的存储形态）。
pub fn meta_field(p: &Value, key: &str) -> Option<String> {
    match p.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(v @ (Value::Object(_) | Value::Array(_))) => Some(v.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// s_field：存在取值、缺失按空串、非字符串按空串。
    #[test]
    fn s_field_variants() {
        let p = json!({ "a": "x", "b": 1 });
        assert_eq!(s_field(&p, "a"), "x");
        assert_eq!(s_field(&p, "missing"), "");
        assert_eq!(s_field(&p, "b"), "");
        assert_eq!(s_field(&p, "c"), "");
    }

    /// opt_field：缺失/空串/非字符串 → None；非空字符串 → Some。
    #[test]
    fn opt_field_variants() {
        let p = json!({ "a": "x", "b": "", "c": 1 });
        assert_eq!(opt_field(&p, "a"), Some("x".to_string()));
        assert_eq!(opt_field(&p, "b"), None);
        assert_eq!(opt_field(&p, "c"), None);
        assert_eq!(opt_field(&p, "missing"), None);
    }

    /// meta_field：字符串直取、对象/数组序列化、其余 None。
    #[test]
    fn meta_field_variants() {
        let p = json!({
            "s": "raw",
            "o": { "k": "v" },
            "arr": [1, 2],
            "empty": "",
            "n": 1
        });
        assert_eq!(meta_field(&p, "s"), Some("raw".to_string()));
        assert_eq!(meta_field(&p, "o"), Some(r#"{"k":"v"}"#.to_string()));
        assert_eq!(meta_field(&p, "arr"), Some("[1,2]".to_string()));
        assert_eq!(meta_field(&p, "empty"), None);
        assert_eq!(meta_field(&p, "n"), None);
        assert_eq!(meta_field(&p, "missing"), None);
    }
}
