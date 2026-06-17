//! IPC commands for the plugin settings system.
//!
//! The host's frontend calls these directly from the settings dialog
//! and the install / update / uninstall lifecycle hooks. The
//! lifecycle hooks (see `commands/plugin.rs`) re-use the helper
//! functions here to materialise the row on disk and clean it up
//! when the plugin goes away.

use crate::db::plugin_settings as repo;
use crate::db::Database;
use rusqlite::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

/// Returned to the frontend as a structured object so the dialog can
/// render an empty state without guessing.
#[derive(Debug, Serialize)]
pub struct PluginSettingsView {
    pub exists: bool,
    pub values: serde_json::Map<String, serde_json::Value>,
    pub schema: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct WriteSettingsArgs {
    pub plugin_id: String,
    pub values: serde_json::Map<String, serde_json::Value>,
}

#[tauri::command]
pub fn read_plugin_settings(
    app: AppHandle,
    db: State<'_, Database>,
    plugin_id: String,
) -> Result<PluginSettingsView, String> {
    // IPC 边界路径遍历防护。
    crate::commands::plugin::validate_plugin_id(&plugin_id).map_err(|e| e.to_string())?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    // exists = SQLite 行是否存在；schema 来自磁盘 settings.json。
    let exists = repo::read_settings_row(&conn, &plugin_id)
        .map_err(|e| e.to_string())?
        .is_some();
    let values = repo::read_values(&conn, &plugin_id).map_err(|e| e.to_string())?;
    let schema = read_schema_for_plugin(&app, &plugin_id);
    Ok(PluginSettingsView {
        exists,
        values,
        schema,
    })
}

#[tauri::command]
pub fn write_plugin_settings(
    db: State<'_, Database>,
    args: WriteSettingsArgs,
) -> Result<(), String> {
    crate::commands::plugin::validate_plugin_id(&args.plugin_id).map_err(|e| e.to_string())?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    // Make sure the row exists so we can UPDATE/INSERT against it,
    // then preserve whatever schema version was previously recorded
    // (the user is editing values, not the schema).
    let prev_version = match repo::read_settings_row(&conn, &args.plugin_id)
        .map_err(|e| e.to_string())?
    {
        Some(row) => row.schema_version,
        None => {
            // No row yet — materialise one with version 0, then
            // overwrite with the user-supplied values. Reading the
            // version back after the ensure gives us the same row
            // semantics the migration path uses.
            repo::ensure_settings_row(&conn, &args.plugin_id).map_err(|e| e.to_string())?;
            0
        }
    };
    repo::upsert_settings(&conn, &args.plugin_id, &args.values, prev_version)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_plugin_settings(
    db: State<'_, Database>,
    plugin_id: String,
) -> Result<(), String> {
    crate::commands::plugin::validate_plugin_id(&plugin_id).map_err(|e| e.to_string())?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    repo::drop_settings_row(&conn, &plugin_id).map_err(|e| e.to_string())
}

// 从 active version dir 读取 settings.json 作为 schema sidecar。
pub fn read_schema_for_plugin(app: &AppHandle, plugin_id: &str) -> Option<serde_json::Value> {
    let active_dir = crate::commands::plugin::active_version_dir(&plugin_install_dir(app, plugin_id))?;
    let path = active_dir.join("settings.json");
    let text = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str::<serde_json::Value>(&text).ok()
}

pub fn plugin_install_dir(app: &AppHandle, plugin_id: &str) -> PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    base.join("plugins").join(plugin_id)
}

/// Public helper used by the install / update / uninstall flows.
/// Tries to load the on-disk schema and apply it (or migrate) the
/// stored row accordingly. Returns `Ok(None)` when the plugin ships
/// no `settings.json`.
pub fn apply_settings_schema_on_disk(
    app: &AppHandle,
    conn: &rusqlite::Connection,
    plugin_id: &str,
) -> Result<Option<ApplyOutcome>, String> {
    let Some(raw) = read_schema_for_plugin(app, plugin_id) else {
        return Ok(None);
    };
    let schema: repo::SettingsSchema =
        serde_json::from_value(raw).map_err(|e| format!("settings.json invalid: {e}"))?;
    schema.validate()?;
    match repo::read_settings_row(conn, plugin_id).map_err(|e| e.to_string())? {
        // No row yet — first install of this schema. Seed with the
        // schema's defaults and record the schema version.
        None => {
            let defaults = defaults_from_schema(&schema);
            repo::upsert_settings(conn, plugin_id, &defaults, schema.version)
                .map_err(|e| e.to_string())?;
            Ok(Some(ApplyOutcome::Installed { version: schema.version }))
        }
        // Same schema version — leave the user's values alone.
        Some(row) if row.schema_version == schema.version => {
            Ok(Some(ApplyOutcome::Unchanged { version: schema.version }))
        }
        // Schema 版本变化：按新 schema diff 旧值并写回。
        // 降级会丢弃新 schema 未声明的 key（破坏性，不警告）。
        Some(row) => {
            let prev_version = row.schema_version;
            let (new_values, changes) = migrate_values(&row.values, &schema);
            repo::upsert_settings(conn, plugin_id, &new_values, schema.version)
                .map_err(|e| e.to_string())?;
            Ok(Some(ApplyOutcome::Migrated {
                from: prev_version,
                to: schema.version,
                changes,
            }))
        }
    }
}

/// Drop the row for `plugin_id`. Idempotent.
pub fn drop_settings_table_for(app: &AppHandle, plugin_id: &str) -> Result<(), String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    repo::drop_settings_row(&conn, plugin_id).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
pub enum ApplyOutcome {
    Installed { version: u32 },
    Unchanged { version: u32 },
    Migrated {
        from: u32,
        to: u32,
        changes: Vec<String>,
    },
}

/// Build the seed map for a fresh install: one entry per field,
/// using the field's declared `default` (or `Null` when no default
/// is set). Used by [`apply_settings_schema_on_disk`] when there is
/// no existing row.
fn defaults_from_schema(
    schema: &repo::SettingsSchema,
) -> serde_json::Map<String, serde_json::Value> {
    let mut out = serde_json::Map::new();
    for f in &schema.fields {
        out.insert(
            f.key.clone(),
            f.default.clone().unwrap_or(serde_json::Value::Null),
        );
    }
    out
}

// 按新 schema diff 旧值：保留用户值或填默认，丢弃未声明 key，记录变更。
fn migrate_values(
    old_values: &serde_json::Map<String, serde_json::Value>,
    schema: &repo::SettingsSchema,
) -> (
    serde_json::Map<String, serde_json::Value>,
    Vec<String>,
) {
    let mut out = serde_json::Map::new();
    let mut changes = Vec::new();
    let new_keys: std::collections::BTreeMap<&str, &repo::SettingsField> = schema
        .fields
        .iter()
        .map(|f| (f.key.as_str(), f))
        .collect();

    // Pass 1: walk the new schema, picking up the user's value
    // (preserving type) or seeding the default.
    for f in &schema.fields {
        if let Some(existing) = old_values.get(&f.key) {
            // shape 漂移时记录 ~key 但保留用户值。
            if !same_shape(existing, f.default.as_ref().unwrap_or(&serde_json::Value::Null)) {
                changes.push(format!("~{}", f.key));
            }
            out.insert(f.key.clone(), existing.clone());
        } else {
            // seed 取 schema default 或 Null。
            let seed = f.default.clone().unwrap_or(serde_json::Value::Null);
            out.insert(f.key.clone(), seed);
            // 仅当 schema 声明了非 Null default 时才记录 +key。
            if !(f.default.is_none() || matches!(f.default.as_ref(), Some(serde_json::Value::Null))) {
                changes.push(format!("+{}", f.key));
            }
        }
    }

    // Pass 2: any old key not claimed by the new schema is dropped.
    for key in old_values.keys() {
        if !new_keys.contains_key(key.as_str()) {
            changes.push(format!("-{}", key));
        }
    }

    (out, changes)
}

/// Cheap shape comparison: a value and a "default" share a shape
/// when both are objects, both are arrays, both are numbers, or
/// both are strings. Booleans and nulls are their own shapes. Used
/// to flag `~key` changes — exact equality is not the goal.
fn same_shape(a: &serde_json::Value, b: &serde_json::Value) -> bool {
    matches!(
        (a, b),
        (serde_json::Value::Null, serde_json::Value::Null)
            | (serde_json::Value::Bool(_), serde_json::Value::Bool(_))
            | (serde_json::Value::Number(_), serde_json::Value::Number(_))
            | (serde_json::Value::String(_), serde_json::Value::String(_))
            | (serde_json::Value::Array(_), serde_json::Value::Array(_))
            | (serde_json::Value::Object(_), serde_json::Value::Object(_))
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn field(key: &str, field_type: &str, default: Option<serde_json::Value>) -> repo::SettingsField {
        repo::SettingsField {
            key: key.to_string(),
            field_type: field_type.to_string(),
            label: key.to_string(),
            default,
            required: false,
            secret: false,
            placeholder: None,
            options: None,
            visible_when: None,
        }
    }

    fn schema(version: u32, fields: Vec<repo::SettingsField>) -> repo::SettingsSchema {
        repo::SettingsSchema {
            version,
            title: None,
            description: None,
            fields,
        }
    }

    #[test]
    fn migrate_preserves_user_values() {
        // User has { apiKey: "user" }; new schema adds { region }.
        // The migration must keep apiKey, add region from the
        // default, and report the change.
        let mut old = serde_json::Map::new();
        old.insert("apiKey".into(), json!("user"));
        let s = schema(
            2,
            vec![
                field("apiKey", "string", Some(json!(""))),
                field("region", "string", Some(json!("cn"))),
            ],
        );
        let (out, changes) = migrate_values(&old, &s);
        assert_eq!(out.get("apiKey").unwrap(), &json!("user"));
        assert_eq!(out.get("region").unwrap(), &json!("cn"));
        assert!(changes.contains(&"+region".to_string()));
        assert!(!changes.iter().any(|c| c.starts_with('-') || c.starts_with('~')));
    }

    #[test]
    fn migrate_drops_field_not_in_new_schema() {
        let mut old = serde_json::Map::new();
        old.insert("keep".into(), json!("ok"));
        old.insert("legacy".into(), json!("dead"));
        let s = schema(2, vec![field("keep", "string", Some(json!("ok")))]);
        let (out, changes) = migrate_values(&old, &s);
        assert!(out.contains_key("keep"));
        assert!(!out.contains_key("legacy"));
        assert!(changes.contains(&"-legacy".to_string()));
    }

    #[test]
    fn migrate_uses_default_when_field_is_new() {
        let old = serde_json::Map::new(); // empty
        let s = schema(
            1,
            vec![field("provider", "string", Some(json!("smms")))],
        );
        let (out, changes) = migrate_values(&old, &s);
        assert_eq!(out.get("provider").unwrap(), &json!("smms"));
        assert_eq!(changes, vec!["+provider".to_string()]);
    }

    #[test]
    fn migrate_uses_null_when_no_default_declared() {
        let old = serde_json::Map::new();
        let s = schema(1, vec![field("token", "string", None)]);
        let (out, changes) = migrate_values(&old, &s);
        assert_eq!(out.get("token").unwrap(), &serde_json::Value::Null);
        // The schema declared no default for `token`, so the
        // seed is `Null`. Emitting a `+token` line for a
        // Null-seeded field is noise: the row will hold `Null`
        // either way and the user has nothing to react to. The
        // change list is therefore empty.
        assert!(
            changes.is_empty(),
            "Null-default fields must not appear in changes, got {:?}",
            changes,
        );
    }

    #[test]
    fn migrate_records_type_change_with_tilde() {
        // apiKey used to be a string; new schema declares it as a
        // number. The migration should record `~apiKey` and keep
        // the user's value (not overwrite with the default).
        let mut old = serde_json::Map::new();
        old.insert("apiKey".into(), json!("user-string"));
        let s = schema(2, vec![field("apiKey", "number", Some(json!(0)))]);
        let (out, changes) = migrate_values(&old, &s);
        assert_eq!(out.get("apiKey").unwrap(), &json!("user-string"));
        assert!(changes.contains(&"~apiKey".to_string()));
    }

    #[test]
    fn defaults_from_schema_includes_every_field() {
        let s = schema(
            1,
            vec![
                field("a", "string", Some(json!("x"))),
                field("b", "number", Some(json!(1))),
                field("c", "string", None),
            ],
        );
        let defaults = defaults_from_schema(&s);
        assert_eq!(defaults.get("a").unwrap(), &json!("x"));
        assert_eq!(defaults.get("b").unwrap(), &json!(1));
        assert_eq!(defaults.get("c").unwrap(), &serde_json::Value::Null);
    }

    #[test]
    fn same_shape_matches_matching_kinds() {
        assert!(same_shape(&json!(1), &json!(2)));
        assert!(same_shape(&json!("a"), &json!("b")));
        assert!(!same_shape(&json!(1), &json!("1")));
        assert!(!same_shape(&json!([1]), &json!({"a": 1})));
    }
}
