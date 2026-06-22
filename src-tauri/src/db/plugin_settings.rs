//! 插件设置存储：单表 plugin_settings，values 以 JSON blob 存储 + schema_version。

use rusqlite::{params, Connection, Result};

/// One field in a `settings.json` schema.
// 镜像 JS 侧 SettingsField；未知 type 在 install 时拒绝。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SettingsField {
    pub key: String,
    #[serde(rename = "type")]
    pub field_type: String,
    pub label: String,
    #[serde(default)]
    pub default: Option<serde_json::Value>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub secret: bool,
    #[serde(default)]
    pub placeholder: Option<String>,
    #[serde(default)]
    pub options: Option<Vec<SettingsFieldOption>>,
    // 可见性谓词，每次开弹窗重读。
    #[serde(default, rename = "visibleWhen")]
    pub visible_when: Option<VisibleWhen>,
}

// 字段可见性谓词：当前仅支持对另一字段值的精确相等判断。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VisibleWhen {
    pub key: String,
    pub equals: serde_json::Value,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SettingsFieldOption {
    pub value: serde_json::Value,
    pub label: String,
}

/// The `settings.json` body.
// settings.json body；version 必填。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SettingsSchema {
    pub version: u32,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub fields: Vec<SettingsField>,
}

impl SettingsSchema {
    /// Validate that every field has a recognised `type` and a
    /// non-empty `key`. We do this in Rust (and not just in the
    /// settings dialog) so a broken schema never makes it onto disk.
    pub fn validate(&self) -> Result<(), String> {
        const ALLOWED: &[&str] = &[
            "string",
            "string-multiline",
            "number",
            "boolean",
            "select",
            "color",
            "directory",
            "password",
        ];
        let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
        for f in &self.fields {
            if f.key.is_empty() {
                return Err("settings field missing `key`".into());
            }
            // 拒绝重复 key：避免 default 被覆盖及 renderer 竞争。
            if !seen.insert(f.key.as_str()) {
                return Err(format!(
                    "settings field `{}` declared more than once",
                    f.key
                ));
            }
            if !ALLOWED.contains(&f.field_type.as_str()) {
                return Err(format!(
                    "settings field `{}` has unknown type `{}`",
                    f.key, f.field_type
                ));
            }
            if f.field_type == "select" && f.options.as_ref().map(|o| o.is_empty()).unwrap_or(true) {
                return Err(format!("select field `{}` must define options", f.key));
            }
        }
        Ok(())
    }
}

/// One row in the `plugin_settings` table, decoded.
#[derive(Debug, Clone)]
pub struct SettingsRow {
    pub values: serde_json::Map<String, serde_json::Value>,
    pub schema_version: u32,
}

/// Make sure a row exists for `plugin_id` so a subsequent
/// `read_values` / `upsert_settings` call has something to update.
/// Idempotent: a no-op when the row already exists.
pub fn ensure_settings_row(conn: &Connection, plugin_id: &str) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO plugin_settings (plugin_id, values_json, schema_version)
         VALUES (?1, '{}', 0)",
        params![plugin_id],
    )?;
    Ok(())
}

/// Fetch the row for `plugin_id` if it exists. Returns `Ok(None)`
/// when the row is missing — callers use this to decide between
/// "first install" and "migration" branches.
pub fn read_settings_row(
    conn: &Connection,
    plugin_id: &str,
) -> Result<Option<SettingsRow>> {
    let mut stmt = conn.prepare(
        "SELECT values_json, schema_version FROM plugin_settings WHERE plugin_id = ?1",
    )?;
    let mut rows = stmt.query(params![plugin_id])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    let raw: String = row.get(0)?;
    let schema_version: i64 = row.get(1)?;
    let values = parse_values_map(plugin_id, &raw)?;
    Ok(Some(SettingsRow {
        values,
        schema_version: schema_version as u32,
    }))
}

/// Read the values map for `plugin_id`. Returns an empty object when
/// the row does not exist (e.g. the plugin has no `settings.json`).
pub fn read_values(
    conn: &Connection,
    plugin_id: &str,
) -> Result<serde_json::Map<String, serde_json::Value>> {
    Ok(read_settings_row(conn, plugin_id)?
        .map(|r| r.values)
        .unwrap_or_default())
}

/// Insert or update the row for `plugin_id`. The `values_json` is
/// written verbatim, so JSON types are preserved on the round trip
/// (no text→number/string coercion like the previous design).
pub fn upsert_settings(
    conn: &Connection,
    plugin_id: &str,
    values: &serde_json::Map<String, serde_json::Value>,
    schema_version: u32,
) -> Result<()> {
    let json = serde_json::to_string(values)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    conn.execute(
        "INSERT INTO plugin_settings (plugin_id, values_json, schema_version, updated_at)
         VALUES (?1, ?2, ?3, datetime('now','localtime'))
         ON CONFLICT(plugin_id) DO UPDATE SET
            values_json = excluded.values_json,
            schema_version = excluded.schema_version,
            updated_at = datetime('now','localtime')",
        params![plugin_id, json, schema_version as i64],
    )?;
    Ok(())
}

/// Delete the row for `plugin_id`. Idempotent: missing rows are not
/// an error.
pub fn drop_settings_row(conn: &Connection, plugin_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM plugin_settings WHERE plugin_id = ?1",
        params![plugin_id],
    )?;
    Ok(())
}

// 解码 values_json：空/空白→{}；解析失败→空 map（不报错，避免 host 崩溃）。
fn parse_values_map(
    plugin_id: &str,
    raw: &str,
) -> Result<serde_json::Map<String, serde_json::Value>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(serde_json::Map::new());
    }
    let value: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(e) => {
            eprintln!(
                "[plugin_settings] values_json for {} is corrupt: {}; treating as empty",
                plugin_id, e
            );
            return Ok(serde_json::Map::new());
        }
    };
    match value {
        serde_json::Value::Object(map) => Ok(map),
        // A plugin that somehow persisted a non-object (e.g. an
        // array) — treat as empty rather than crash the host. The
        // next write will normalise the row back to an object.
        _ => Ok(serde_json::Map::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Build an in-memory connection with the `plugin_settings`
    /// table created. Mirrors the production DDL so tests exercise
    /// the same column types / defaults the host uses.
    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE plugin_settings (
                plugin_id TEXT PRIMARY KEY,
                values_json TEXT NOT NULL DEFAULT '{}',
                schema_version INTEGER NOT NULL DEFAULT 0,
                updated_at DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
            )",
        )
        .unwrap();
        c
    }

    /// Build a `values_json` body from a `Vec<(key, value)>`. Saves
    /// the boilerplate of typing `serde_json::json!` per test.
    fn values_of(pairs: Vec<(&str, serde_json::Value)>) -> serde_json::Map<String, serde_json::Value> {
        let mut m = serde_json::Map::new();
        for (k, v) in pairs {
            m.insert(k.to_string(), v);
        }
        m
    }

    #[test]
    fn ensure_creates_row_with_empty_json() {
        let c = conn();
        ensure_settings_row(&c, "com.example.x").unwrap();
        let row = read_settings_row(&c, "com.example.x").unwrap();
        assert!(row.is_some(), "ensure must materialise a row");
        let row = row.unwrap();
        assert!(row.values.is_empty(), "new row must start with empty values map");
        assert_eq!(row.schema_version, 0, "new row must start at schema_version=0");
    }

    #[test]
    fn upsert_and_read_round_trip() {
        let c = conn();
        ensure_settings_row(&c, "com.example.x").unwrap();
        let values = values_of(vec![
            ("a", serde_json::json!(1)),
            ("b", serde_json::json!("x")),
            ("c", serde_json::json!(true)),
        ]);
        upsert_settings(&c, "com.example.x", &values, 2).unwrap();
        let row = read_settings_row(&c, "com.example.x").unwrap().unwrap();
        assert_eq!(row.schema_version, 2);
        // JSON round-trip 保留整数类型。
        assert_eq!(row.values.get("a").unwrap(), &serde_json::json!(1));
        assert_eq!(row.values.get("b").unwrap(), &serde_json::json!("x"));
        assert_eq!(row.values.get("c").unwrap(), &serde_json::json!(true));
    }

    #[test]
    fn write_number_one_reads_back_as_int() {
        // 旧 TEXT 设计会把 1 round-trip 成 1.0；新设计保持整数。
        let c = conn();
        ensure_settings_row(&c, "com.example.x").unwrap();
        let mut values = serde_json::Map::new();
        values.insert("n".to_string(), serde_json::json!(1));
        upsert_settings(&c, "com.example.x", &values, 1).unwrap();
        let out = read_values(&c, "com.example.x").unwrap();
        let n = out.get("n").unwrap();
        assert!(n.is_i64(), "expected integer, got {}", n);
        assert_eq!(n.as_i64().unwrap(), 1);
        assert!(
            n.as_f64().map(|f| f == 1.0).unwrap_or(false),
            "value must equal 1 (was {})",
            n,
        );
    }

    #[test]
    fn migrate_adds_new_field_with_default() {
        // Old row: { a: 1 } at version 1, schema declares { a, b }.
        // Migration should produce { a: 1, b: <default> } and bump
        // the recorded version.
        let c = conn();
        upsert_settings(
            &c,
            "com.example.x",
            &values_of(vec![("a", serde_json::json!(1))]),
            1,
        )
        .unwrap();
        // Simulate the migrate_values() side-effect: caller
        // computes the new map, then writes it back. The db layer
        // just stores whatever the caller hands it.
        let new_values = values_of(vec![
            ("a", serde_json::json!(1)),
            ("b", serde_json::json!("default-b")),
        ]);
        upsert_settings(&c, "com.example.x", &new_values, 2).unwrap();
        let row = read_settings_row(&c, "com.example.x").unwrap().unwrap();
        assert_eq!(row.schema_version, 2);
        assert_eq!(row.values.get("a").unwrap(), &serde_json::json!(1));
        assert_eq!(row.values.get("b").unwrap(), &serde_json::json!("default-b"));
    }

    #[test]
    fn migrate_drops_field_not_in_new_schema() {
        // Old row carries a key the new schema no longer declares;
        // migration must drop it from the written-back map.
        let c = conn();
        upsert_settings(
            &c,
            "com.example.x",
            &values_of(vec![
                ("keep", serde_json::json!("ok")),
                ("legacy", serde_json::json!("dead")),
            ]),
            1,
        )
        .unwrap();
        let new_values = values_of(vec![("keep", serde_json::json!("ok"))]);
        upsert_settings(&c, "com.example.x", &new_values, 2).unwrap();
        let row = read_settings_row(&c, "com.example.x").unwrap().unwrap();
        assert_eq!(row.schema_version, 2);
        assert!(row.values.contains_key("keep"));
        assert!(!row.values.contains_key("legacy"), "legacy key must be dropped");
    }

    #[test]
    fn migrate_preserves_user_values() {
        // A user-edited value must survive the schema bump.
        let c = conn();
        upsert_settings(
            &c,
            "com.example.x",
            &values_of(vec![("apiKey", serde_json::json!("user-secret"))]),
            1,
        )
        .unwrap();
        // Migration adds a new field; the user's apiKey must be
        // preserved.
        let new_values = values_of(vec![
            ("apiKey", serde_json::json!("user-secret")),
            ("region", serde_json::json!("cn")),
        ]);
        upsert_settings(&c, "com.example.x", &new_values, 2).unwrap();
        let row = read_settings_row(&c, "com.example.x").unwrap().unwrap();
        assert_eq!(row.values.get("apiKey").unwrap(), &serde_json::json!("user-secret"));
    }

    #[test]
    fn migrate_no_op_when_version_unchanged() {
        // 同版本 re-apply 会覆盖整 map（预期）；保护由调用方 short-circuit。
        let c = conn();
        upsert_settings(
            &c,
            "com.example.x",
            &values_of(vec![("n", serde_json::json!(1))]),
            1,
        )
        .unwrap();
        // 用户编辑后同版本 re-apply 会覆盖（预期）。
        upsert_settings(
            &c,
            "com.example.x",
            &values_of(vec![("n", serde_json::json!(42))]),
            1,
        )
        .unwrap();
        let row = read_settings_row(&c, "com.example.x").unwrap().unwrap();
        assert_eq!(row.schema_version, 1);
        assert_eq!(row.values.get("n").unwrap(), &serde_json::json!(42));
    }

    #[test]
    fn drop_row_removes_data() {
        let c = conn();
        upsert_settings(
            &c,
            "com.example.x",
            &values_of(vec![("k", serde_json::json!("v"))]),
            1,
        )
        .unwrap();
        drop_settings_row(&c, "com.example.x").unwrap();
        // read_settings_row -> None; read_values -> empty map.
        let row = read_settings_row(&c, "com.example.x").unwrap();
        assert!(row.is_none());
        let out = read_values(&c, "com.example.x").unwrap();
        assert!(out.is_empty());
    }

    #[test]
    fn read_values_returns_empty_for_unknown_plugin() {
        let c = conn();
        // No ensure_settings_row call — the plugin was never
        // seen by the host. read_values must return an empty
        // map, not error.
        let out = read_values(&c, "com.example.unseen").unwrap();
        assert!(out.is_empty());
    }

    #[test]
    fn drop_row_is_idempotent() {
        let c = conn();
        // Dropping a row that doesn't exist is not an error.
        drop_settings_row(&c, "com.example.unseen").unwrap();
    }

    fn schema_with_keys(keys: &[&str]) -> SettingsSchema {
        SettingsSchema {
            version: 1,
            title: None,
            description: None,
            fields: keys
                .iter()
                .map(|k| SettingsField {
                    key: (*k).to_string(),
                    field_type: "string".to_string(),
                    label: (*k).to_string(),
                    default: None,
                    required: false,
                    secret: false,
                    placeholder: None,
                    options: None,
                    visible_when: None,
                })
                .collect(),
        }
    }

    #[test]
    fn rejects_duplicate_field_keys() {
        // 重复 key 会导致 default shadow 及 renderer 同 id 输入。
        let s = schema_with_keys(&["apiKey", "region", "apiKey"]);
        let err = s.validate().expect_err("duplicate key must be rejected");
        assert!(
            err.contains("settings field `apiKey` declared more than once"),
            "unexpected error: {}",
            err,
        );
    }

    #[test]
    fn parse_values_map_handles_corrupt_json() {
        // 不可解析 body 必须 soft-fail 为空 map。
        let out = parse_values_map("com.example.bad", "not-json-at-all").unwrap();
        assert!(out.is_empty(), "corrupt body must decode to empty map");

        // Truncated mid-object also soft-fails (parses as
        // `expected value` at the trailing `,`).
        let out = parse_values_map("com.example.bad", "{\"a\": 1,").unwrap();
        assert!(out.is_empty(), "truncated body must decode to empty map");

        // Empty / whitespace bodies are the historical forward-
        // compat path and must continue to yield an empty map
        // (not even log a warning).
        let out = parse_values_map("com.example.empty", "").unwrap();
        assert!(out.is_empty());
        let out = parse_values_map("com.example.empty", "   \n\t").unwrap();
        assert!(out.is_empty());

        // A non-object JSON (array / scalar) is also treated as
        // empty — the old soft-fail for `_ =>` — but it does
        // not go through the corrupt-JSON branch.
        let out = parse_values_map("com.example.arr", "[1,2,3]").unwrap();
        assert!(out.is_empty());
    }
}
