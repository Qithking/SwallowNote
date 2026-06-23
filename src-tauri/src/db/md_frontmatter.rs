use crate::db::Database;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 标准前端 frontmatter 字段
const STANDARD_KEYS: &[&str] = &[
    "title", "created", "updated", "tags", "categories", "author", "status", "pinned",
];

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FrontmatterRecord {
    pub id: i64,
    pub file_path: String,
    pub title: Option<String>,
    pub created: Option<String>,
    pub updated: Option<String>,
    pub tags: Option<String>,
    pub categories: Option<String>,
    pub author: Option<String>,
    pub status: Option<String>,
    pub pinned: bool,
    pub extra_yaml: Option<String>,
    pub raw_yaml: Option<String>,
    pub modified_at: String,
    pub indexed_at: String,
}

pub fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS md_frontmatter (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path   TEXT UNIQUE NOT NULL,
            title       TEXT,
            created     TEXT,
            updated     TEXT,
            tags        TEXT,
            categories  TEXT,
            author      TEXT,
            status      TEXT,
            pinned      INTEGER DEFAULT 0,
            extra_yaml  TEXT,
            raw_yaml    TEXT,
            modified_at TEXT NOT NULL,
            indexed_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_md_frontmatter_file_path ON md_frontmatter(file_path)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_md_frontmatter_title ON md_frontmatter(title)",
        [],
    )?;

    Ok(())
}

/// 从 serde_yaml::Value 中提取 frontmatter 字段并 upsert 到数据库
pub fn upsert_frontmatter(
    db: &Database,
    file_path: &str,
    yaml_value: &serde_yaml::Value,
    raw_yaml: &str,
    modified_at: &str,
) -> Result<()> {
    let conn = db.conn.lock().unwrap();

    let title = yaml_value.get("title").and_then(|v| v.as_str()).map(|s| s.to_string());
    let created = yaml_value.get("created").and_then(|v| v.as_str()).map(|s| s.to_string());
    let updated = yaml_value.get("updated").and_then(|v| v.as_str()).map(|s| s.to_string());
    let author = yaml_value.get("author").and_then(|v| v.as_str()).map(|s| s.to_string());
    let status = yaml_value.get("status").and_then(|v| v.as_str()).map(|s| s.to_string());
    let pinned = yaml_value.get("pinned").and_then(|v| v.as_bool()).unwrap_or(false);

    // tags 和 categories 序列化为 JSON 数组字符串
    let tags = yaml_value.get("tags").map(|v| serde_json::to_string(v).unwrap_or_default());
    let categories = yaml_value.get("categories").map(|v| serde_json::to_string(v).unwrap_or_default());

    // 提取非标准字段为 extra_yaml JSON 对象
    let extra_yaml = {
        if let serde_yaml::Value::Mapping(map) = yaml_value {
            let mut extra = serde_json::Map::new();
            for (k, v) in map {
                if let serde_yaml::Value::String(key) = k {
                    if !STANDARD_KEYS.contains(&key.as_str()) {
                        let json_val = yaml_value_to_json(v);
                        extra.insert(key.clone(), json_val);
                    }
                }
            }
            if extra.is_empty() {
                None
            } else {
                Some(serde_json::Value::Object(extra).to_string())
            }
        } else {
            None
        }
    };

    conn.execute(
        "INSERT INTO md_frontmatter (file_path, title, created, updated, tags, categories, author, status, pinned, extra_yaml, raw_yaml, modified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(file_path) DO UPDATE SET
            title = excluded.title,
            created = excluded.created,
            updated = excluded.updated,
            tags = excluded.tags,
            categories = excluded.categories,
            author = excluded.author,
            status = excluded.status,
            pinned = excluded.pinned,
            extra_yaml = excluded.extra_yaml,
            raw_yaml = excluded.raw_yaml,
            modified_at = excluded.modified_at,
            indexed_at = datetime('now','localtime')",
        params![
            file_path,
            title,
            created,
            updated,
            tags,
            categories,
            author,
            status,
            pinned as i32,
            extra_yaml,
            raw_yaml,
            modified_at,
        ],
    )?;

    Ok(())
}

/// 删除单条记录（仅文件删除时调用）
pub fn delete_frontmatter(db: &Database, file_path: &str) -> Result<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "DELETE FROM md_frontmatter WHERE file_path = ?1",
        [file_path],
    )?;
    Ok(())
}

/// 查询单条记录
pub fn get_frontmatter(db: &Database, file_path: &str) -> Result<Option<FrontmatterRecord>> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, file_path, title, created, updated, tags, categories, author, status, pinned, extra_yaml, raw_yaml, modified_at, indexed_at
         FROM md_frontmatter WHERE file_path = ?1",
    )?;

    let mut rows = stmt.query([file_path])?;
    if let Some(row) = rows.next()? {
        Ok(Some(FrontmatterRecord {
            id: row.get(0)?,
            file_path: row.get(1)?,
            title: row.get(2)?,
            created: row.get(3)?,
            updated: row.get(4)?,
            tags: row.get(5)?,
            categories: row.get(6)?,
            author: row.get(7)?,
            status: row.get(8)?,
            pinned: row.get::<_, i32>(9)? != 0,
            extra_yaml: row.get(10)?,
            raw_yaml: row.get(11)?,
            modified_at: row.get(12)?,
            indexed_at: row.get(13)?,
        }))
    } else {
        Ok(None)
    }
}

/// 按标签查询
pub fn query_by_tag(db: &Database, tag: &str) -> Result<Vec<FrontmatterRecord>> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, file_path, title, created, updated, tags, categories, author, status, pinned, extra_yaml, raw_yaml, modified_at, indexed_at
         FROM md_frontmatter WHERE tags LIKE ?1",
    )?;

    let pattern = format!("%\"{}\"%", tag);
    let rows = stmt.query_map([&pattern], |row| {
        Ok(FrontmatterRecord {
            id: row.get(0)?,
            file_path: row.get(1)?,
            title: row.get(2)?,
            created: row.get(3)?,
            updated: row.get(4)?,
            tags: row.get(5)?,
            categories: row.get(6)?,
            author: row.get(7)?,
            status: row.get(8)?,
            pinned: row.get::<_, i32>(9)? != 0,
            extra_yaml: row.get(10)?,
            raw_yaml: row.get(11)?,
            modified_at: row.get(12)?,
            indexed_at: row.get(13)?,
        })
    })?;

    let mut records = Vec::new();
    for record in rows {
        records.push(record?);
    }
    Ok(records)
}

/// 按路径前缀查询（用于获取当前工作区下的所有记录）
pub fn query_by_prefix(db: &Database, path_prefix: &str) -> Result<Vec<FrontmatterRecord>> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, file_path, title, created, updated, tags, categories, author, status, pinned, extra_yaml, raw_yaml, modified_at, indexed_at
         FROM md_frontmatter WHERE file_path LIKE ?1",
    )?;

    let pattern = format!("{}%", path_prefix.trim_end_matches('/'));
    let rows = stmt.query_map([&pattern], |row| {
        Ok(FrontmatterRecord {
            id: row.get(0)?,
            file_path: row.get(1)?,
            title: row.get(2)?,
            created: row.get(3)?,
            updated: row.get(4)?,
            tags: row.get(5)?,
            categories: row.get(6)?,
            author: row.get(7)?,
            status: row.get(8)?,
            pinned: row.get::<_, i32>(9)? != 0,
            extra_yaml: row.get(10)?,
            raw_yaml: row.get(11)?,
            modified_at: row.get(12)?,
            indexed_at: row.get(13)?,
        })
    })?;

    let mut records = Vec::new();
    for record in rows {
        records.push(record?);
    }
    Ok(records)
}

/// 获取单条记录的修改时间（用于增量判断）
pub fn get_modified_at(db: &Database, file_path: &str) -> Result<Option<String>> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT modified_at FROM md_frontmatter WHERE file_path = ?1",
    )?;
    let mut rows = stmt.query([file_path])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

/// 一次性获取所有记录的 file_path -> modified_at 映射（用于批量增量判断，避免逐条查询）
pub fn get_all_modified_at(db: &Database) -> Result<HashMap<String, String>> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare("SELECT file_path, modified_at FROM md_frontmatter")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut map = HashMap::new();
    for row in rows {
        let (path, modified) = row?;
        map.insert(path, modified);
    }
    Ok(map)
}

/// 将 serde_yaml::Value 转换为 serde_json::Value
fn yaml_value_to_json(val: &serde_yaml::Value) -> serde_json::Value {
    match val {
        serde_yaml::Value::Null => serde_json::Value::Null,
        serde_yaml::Value::Bool(b) => serde_json::Value::Bool(*b),
        serde_yaml::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                serde_json::Value::Number(i.into())
            } else if let Some(f) = n.as_f64() {
                serde_json::Value::Number(serde_json::Number::from_f64(f).unwrap_or(0.into()))
            } else {
                serde_json::Value::Null
            }
        }
        serde_yaml::Value::String(s) => serde_json::Value::String(s.clone()),
        serde_yaml::Value::Sequence(seq) => {
            serde_json::Value::Array(seq.iter().map(yaml_value_to_json).collect())
        }
        serde_yaml::Value::Mapping(map) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in map {
                if let serde_yaml::Value::String(key) = k {
                    obj.insert(key.clone(), yaml_value_to_json(v));
                }
            }
            serde_json::Value::Object(obj)
        }
        serde_yaml::Value::Tagged(t) => yaml_value_to_json(&t.value),
    }
}
