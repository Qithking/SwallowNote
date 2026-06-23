use crate::db::Database;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 标准前端 frontmatter 字段
const STANDARD_KEYS: &[&str] = &[
    "title", "created", "updated", "tags", "categories", "author", "status", "pinned",
];

/// 分类树节点
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CategoryFile {
    pub file_path: String,
    pub title: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CategoryNode {
    /// 节点名称（如 "React"）
    pub name: String,
    /// 完整路径（如 "技术/前端/React"）
    pub path: String,
    /// 直接属于此分类的文件数
    pub count: usize,
    /// 子分类
    pub children: Vec<CategoryNode>,
    /// 直接属于此分类的文件列表
    pub files: Vec<CategoryFile>,
}

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

pub fn create_categories_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS categories (
            id    INTEGER PRIMARY KEY AUTOINCREMENT,
            path  TEXT UNIQUE NOT NULL
        )",
        [],
    )?;
    Ok(())
}

pub fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS md_frontmatter (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path   TEXT UNIQUE NOT NULL,
            title       TEXT,
            created     TEXT,
            updated     TEXT,
            tags        TEXT CHECK(json_valid(tags) OR tags IS NULL),
            categories  TEXT CHECK(json_valid(categories) OR categories IS NULL),
            author      TEXT,
            status      TEXT,
            pinned      INTEGER DEFAULT 0,
            extra_yaml  TEXT CHECK(json_valid(extra_yaml) OR extra_yaml IS NULL),
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

    // 为 categories 非空行建部分索引，加速 json_each 查询的 WHERE 过滤
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_md_frontmatter_categories_not_null ON md_frontmatter(categories) WHERE categories IS NOT NULL AND categories != '[]'",
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

    // tags 和 categories 序列化为 JSON 数组字符串（确保始终为数组格式）
    let tags = yaml_value.get("tags").and_then(|v| {
        if v.is_sequence() {
            serde_json::to_string(v).ok()
        } else if v.is_string() {
            // 将单个字符串包装为数组
            serde_json::to_string(&vec![v.as_str().unwrap_or("")]).ok()
        } else {
            None
        }
    });
    let categories = yaml_value.get("categories").and_then(|v| {
        if v.is_sequence() {
            serde_json::to_string(v).ok()
        } else if v.is_string() {
            // 将单个字符串包装为数组
            serde_json::to_string(&vec![v.as_str().unwrap_or("")]).ok()
        } else {
            None
        }
    });

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

    // 同步分类到 categories 表，确保分类表始终是最新数据源
    if let Some(ref cats) = categories {
        let _ = sync_categories_from_frontmatter(&conn, cats);
    }

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

/// 创建空分类（无文件关联的分类），持久化到 categories 表
pub fn create_category(db: &Database, path: &str) -> Result<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO categories (path) VALUES (?1)",
        params![path],
    )?;
    Ok(())
}

/// 将 frontmatter 中的分类路径同步到 categories 表
/// 在文件索引时调用，确保文件关联的分类也存在于 categories 表中
pub fn sync_categories_from_frontmatter(conn: &Connection, categories: &str) -> Result<()> {
    let cat_list: Vec<String> = match serde_json::from_str(categories) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[sync_categories] Failed to parse categories JSON: {}", e);
            return Ok(());
        }
    };
    for cat in &cat_list {
        // 插入分类路径及其所有中间路径
        let parts: Vec<&str> = cat.split('/').collect();
        for i in 1..=parts.len() {
            let sub_path = parts[..i].join("/");
            conn.execute(
                "INSERT OR IGNORE INTO categories (path) VALUES (?1)",
                params![sub_path],
            )?;
        }
    }
    Ok(())
}

/// 启动时全量同步：遍历 md_frontmatter 中所有已有记录，
/// 将其分类路径及父路径补全到 categories 表中。
/// 用于修复历史数据不完整的情况。
pub fn sync_all_categories_from_frontmatter(db: &Database) -> Result<()> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT categories FROM md_frontmatter WHERE categories IS NOT NULL AND categories != '[]'",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    for cats in rows.flatten() {
        let _ = sync_categories_from_frontmatter(&conn, &cats);
    }
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
         FROM md_frontmatter WHERE EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?1)",
    )?;

    let rows = stmt.query_map([tag], |row| {
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

/// 通用 YAML 属性搜索 frontmatter 记录
/// filters: key-value 对，key 为 YAML 属性名，value 为匹配值
/// - 标准字段（title/tags/categories/status/author）：走列匹配
/// - 自定义字段：使用 json_extract(extra_yaml, '$.key') 匹配
///   匹配规则：
/// - title: LIKE 模糊匹配
/// - tags: 逗号分隔，任一匹配
/// - categories: 前缀匹配
/// - status/author: 精确匹配
/// - 其他字段: LIKE 模糊匹配
pub fn search_frontmatter(
    db: &Database,
    filters: HashMap<String, String>,
) -> Result<Vec<FrontmatterRecord>> {
    // Phase 1: 锁外构建 SQL（纯字符串操作，无需持锁）
    let mut conditions: Vec<String> = Vec::new();
    let mut param_values: Vec<String> = Vec::new();
    let mut param_idx = 1;

    for (key, val) in &filters {
        if val.is_empty() {
            continue;
        }

        match key.as_str() {
            "title" => {
                conditions.push(format!("title LIKE ?{}", param_idx));
                param_values.push(format!("%{}%", val));
                param_idx += 1;
            }
            "tags" => {
                let tag_list: Vec<&str> = val.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
                let mut tag_conds = Vec::new();
                for tag in tag_list {
                    tag_conds.push(format!("EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?{})", param_idx));
                    param_values.push(tag.to_string());
                    param_idx += 1;
                }
                if !tag_conds.is_empty() {
                    conditions.push(format!("({})", tag_conds.join(" OR ")));
                }
            }
            "categories" => {
                let cat_list: Vec<&str> = val.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
                let mut cat_conds = Vec::new();
                for cat in cat_list {
                    cat_conds.push(format!("EXISTS (SELECT 1 FROM json_each(categories) WHERE value LIKE ?{})", param_idx));
                    param_values.push(format!("{}%", cat));
                    param_idx += 1;
                }
                if !cat_conds.is_empty() {
                    conditions.push(format!("({})", cat_conds.join(" OR ")));
                }
            }
            "status" => {
                conditions.push(format!("status = ?{}", param_idx));
                param_values.push(val.to_string());
                param_idx += 1;
            }
            "author" => {
                conditions.push(format!("author = ?{}", param_idx));
                param_values.push(val.to_string());
                param_idx += 1;
            }
            _ => {
                if !key.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '/') {
                    continue;
                }
                conditions.push(format!("CAST(json_extract(extra_yaml, '$.{}') AS TEXT) LIKE ?{}", key, param_idx));
                param_values.push(format!("%{}%", val));
                param_idx += 1;
            }
        }
    }

    let sql = if conditions.is_empty() {
        "SELECT id, file_path, title, created, updated, tags, categories, author, status, pinned, extra_yaml, raw_yaml, modified_at, indexed_at
         FROM md_frontmatter".to_string()
    } else {
        format!(
            "SELECT id, file_path, title, created, updated, tags, categories, author, status, pinned, extra_yaml, raw_yaml, modified_at, indexed_at
         FROM md_frontmatter WHERE {}",
            conditions.join(" AND ")
        )
    };

    // Phase 2: 锁内执行查询并收集原始数据
    let raw_rows = {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> = param_values.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        let rows = stmt.query_map(params.as_slice(), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, i32>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, String>(12)?,
                row.get::<_, String>(13)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    }; // ← 锁释放

    // Phase 3: 锁外构建 FrontmatterRecord 对象
    let records = raw_rows.into_iter().map(|(id, file_path, title, created, updated, tags, categories, author, status, pinned, extra_yaml, raw_yaml, modified_at, indexed_at)| {
        FrontmatterRecord {
            id,
            file_path,
            title,
            created,
            updated,
            tags,
            categories,
            author,
            status,
            pinned: pinned != 0,
            extra_yaml,
            raw_yaml,
            modified_at,
            indexed_at,
        }
    }).collect();

    Ok(records)
}

/// 获取分类树：以 categories 表为主数据源构建树形结构，从 md_frontmatter 获取文件关联
pub fn get_category_tree(db: &Database) -> Result<Vec<CategoryNode>> {
    // Phase 1: 在锁内查询原始数据，锁外构建树
    let (all_paths_set, file_associations) = {
        let conn = db.conn.lock().unwrap();

        // 从 categories 表获取所有分类路径
        let mut cat_stmt = conn.prepare("SELECT path FROM categories ORDER BY path")?;
        let cat_rows = cat_stmt.query_map([], |row| row.get::<_, String>(0))?;

        let mut all_paths_set: std::collections::HashSet<String> = std::collections::HashSet::new();
        for cat_path in cat_rows.flatten() {
            all_paths_set.insert(cat_path);
        }

        if all_paths_set.is_empty() {
            return Ok(Vec::new());
        }

        // 从 md_frontmatter 获取文件关联
        let mut stmt = conn.prepare("SELECT categories, file_path, title FROM md_frontmatter WHERE categories IS NOT NULL AND categories != '[]'")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?;

        let mut file_associations: Vec<(String, String, Option<String>)> = Vec::new();
        for v in rows.flatten() {
            file_associations.push(v);
        }

        (all_paths_set, file_associations)
    }; // ← 锁在这里释放

    // Phase 2: 在锁外构建树（纯内存操作，无需数据库访问）
    let mut category_counts: HashMap<String, usize> = HashMap::new();
    let mut category_files: HashMap<String, Vec<CategoryFile>> = HashMap::new();

    for (categories_str, file_path, title) in file_associations {
        let categories: Vec<String> = match serde_json::from_str(&categories_str) {
            Ok(v) => v,
            Err(_) => continue,
        };

        for cat in &categories {
            *category_counts.entry(cat.clone()).or_insert(0) += 1;
            category_files.entry(cat.clone()).or_default().push(CategoryFile {
                file_path: file_path.clone(),
                title: title.clone(),
            });
        }
    }

    // 构建树
    let mut all_paths: Vec<String> = all_paths_set.into_iter().collect();
    all_paths.sort();

    let mut node_map: HashMap<String, CategoryNode> = HashMap::new();
    for path in &all_paths {
        let name = path.rsplit('/').next().unwrap_or(path).to_string();
        let count = category_counts.get(path).copied().unwrap_or(0);
        let files = category_files.remove(path).unwrap_or_default();
        node_map.insert(
            path.clone(),
            CategoryNode {
                name,
                path: path.clone(),
                count,
                children: Vec::new(),
                files,
            },
        );
    }

    // 构建父子关系：从最深层开始，将子节点挂到父节点上
    all_paths.sort_by_key(|b| std::cmp::Reverse(b.matches('/').count()));

    let mut root_nodes: Vec<CategoryNode> = Vec::new();
    for path in &all_paths {
        if let Some(last_slash) = path.rfind('/') {
            let parent_path = &path[..last_slash];
            if let Some(child) = node_map.remove(path) {
                if let Some(parent) = node_map.get_mut(parent_path) {
                    parent.children.push(child);
                } else {
                    root_nodes.push(child);
                }
            }
        } else {
            if let Some(node) = node_map.remove(path) {
                root_nodes.push(node);
            }
        }
    }

    // 处理剩余的节点
    for (_, node) in node_map {
        root_nodes.push(node);
    }

    // 对子节点排序
    fn sort_children(nodes: &mut Vec<CategoryNode>) {
        nodes.sort_by(|a, b| a.name.cmp(&b.name));
        for node in nodes {
            sort_children(&mut node.children);
        }
    }
    sort_children(&mut root_nodes);

    Ok(root_nodes)
}

/// 重命名分类：将所有记录中包含 old_path 的 categories 更新为 new_path
pub fn rename_category(db: &Database, old_path: &str, new_path: &str) -> Result<usize> {
    // Phase 1: 锁内查询匹配行
    let rows_data = {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, categories FROM md_frontmatter WHERE EXISTS (SELECT 1 FROM json_each(categories) WHERE value = ?1 OR value LIKE ?2)",
        )?;
        let prefix_pattern = format!("{}/%", old_path);
        let rows = stmt.query_map(params![old_path, prefix_pattern], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    }; // ← 锁释放

    // Phase 2: 锁外解析 JSON + 修改分类路径
    let mut updates: Vec<(String, i64)> = Vec::new();
    for (id, categories_str) in rows_data {
        let mut categories: Vec<String> = match serde_json::from_str(&categories_str) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let mut changed = false;
        for cat in &mut categories {
            if cat == old_path {
                *cat = new_path.to_string();
                changed = true;
            } else if let Some(stripped) = cat.strip_prefix(&format!("{}/", old_path)) {
                *cat = format!("{}/{}", new_path, stripped);
                changed = true;
            }
        }

        if changed {
            let new_categories_str = serde_json::to_string(&categories).unwrap_or_default();
            updates.push((new_categories_str, id));
        }
    }

    // Phase 3: 锁内批量 UPDATE
    if updates.is_empty() { return Ok(0); }
    let conn = db.conn.lock().unwrap();
    for (new_categories_str, id) in &updates {
        conn.execute(
            "UPDATE md_frontmatter SET categories = ?1 WHERE id = ?2",
            params![new_categories_str, id],
        )?;
    }
    Ok(updates.len())
}

/// 删除分类：从所有记录的 categories 中移除该分类路径，并从 categories 表中删除
pub fn delete_category(db: &Database, path: &str) -> Result<usize> {
    // Phase 1: 锁内查询匹配行
    let rows_data = {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, categories FROM md_frontmatter WHERE EXISTS (SELECT 1 FROM json_each(categories) WHERE value = ?1 OR value LIKE ?2)",
        )?;
        let prefix_pattern = format!("{}/%", path);
        let rows = stmt.query_map(params![path, prefix_pattern], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    }; // ← 锁释放

    // Phase 2: 锁外解析 JSON + 移除分类
    let mut updates: Vec<(Option<String>, i64)> = Vec::new();
    for (id, categories_str) in rows_data {
        let mut categories: Vec<String> = match serde_json::from_str(&categories_str) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let original_len = categories.len();
        categories.retain(|cat| cat != path && !cat.starts_with(&format!("{}/", path)));

        if categories.len() != original_len {
            if categories.is_empty() {
                updates.push((None, id));
            } else {
                let new_categories_str = serde_json::to_string(&categories).unwrap_or_default();
                updates.push((Some(new_categories_str), id));
            }
        }
    }

    // Phase 3: 锁内批量 UPDATE + DELETE
    let conn = db.conn.lock().unwrap();
    for (new_categories_opt, id) in &updates {
        if let Some(ref new_categories_str) = new_categories_opt {
            conn.execute(
                "UPDATE md_frontmatter SET categories = ?1 WHERE id = ?2",
                params![new_categories_str, id],
            )?;
        } else {
            conn.execute(
                "UPDATE md_frontmatter SET categories = NULL WHERE id = ?1",
                params![id],
            )?;
        }
    }
    // 从 categories 表中删除该分类及其子分类
    conn.execute("DELETE FROM categories WHERE path = ?1 OR path LIKE ?2", params![path, format!("{}/%", path)])?;

    Ok(updates.len())
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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn create_test_db() -> Database {
        let conn = Connection::open_in_memory().unwrap();
        create_table(&conn).unwrap();
        create_categories_table(&conn).unwrap();
        Database {
            conn: std::sync::Mutex::new(conn),
        }
    }

    #[test]
    fn test_upsert_frontmatter_stores_categories() {
        let db = create_test_db();

        // 模拟索引线程解析出的 YAML 值
        let yaml_str = r#"
title: "测试文件"
categories:
  - "ssddd"
  - "测试/技术"
tags:
  - "tag1"
"#;
        let yaml_value: serde_yaml::Value = serde_yaml::from_str(yaml_str).unwrap();

        let result = upsert_frontmatter(&db, "/test/file.md", &yaml_value, "", "12345");
        assert!(result.is_ok());

        // 验证 categories 被正确存储
        let conn = db.conn.lock().unwrap();
        let categories: String = conn.query_row(
            "SELECT categories FROM md_frontmatter WHERE file_path = ?1",
            ["/test/file.md"],
            |row| row.get(0),
        ).unwrap();
        drop(conn);

        // categories 应该是 JSON 数组格式
        assert!(!categories.is_empty(), "categories should not be empty");
        assert!(categories.contains("ssddd"), "categories should contain 'ssddd', got: {}", categories);
    }

    #[test]
    fn test_serde_yaml_to_json_categories() {
        // 验证 serde_json::to_string 对 serde_yaml::Value 的序列化
        let yaml_str = r#"
categories:
  - "ssddd"
  - "测试/技术"
"#;
        let yaml_value: serde_yaml::Value = serde_yaml::from_str(yaml_str).unwrap();
        let categories = yaml_value.get("categories").unwrap();

        let json_str = serde_json::to_string(categories).unwrap();
        assert!(json_str.starts_with('['), "Expected JSON array, got: {}", json_str);
        assert!(json_str.contains("ssddd"), "Should contain 'ssddd', got: {}", json_str);
    }

    #[test]
    fn test_upsert_with_real_frontmatter_content() {
        // 模拟实际文件的 frontmatter 格式（带引号的键名）
        let db = create_test_db();

        let yaml_str = r#""title": "0000000111"
"updated": "2026-06-23T06:47:46.608Z"
"pinned": true
"tags":
  - "666"
"categories":
  - "ssddd"
  - "测试/技术"
"55": "45"
"#;
        let yaml_value: serde_yaml::Value = serde_yaml::from_str(yaml_str).unwrap();

        let result = upsert_frontmatter(&db, "/test/file.md", &yaml_value, "", "12345");
        assert!(result.is_ok());

        // 验证 categories 被正确存储
        let conn = db.conn.lock().unwrap();
        let categories: String = conn.query_row(
            "SELECT categories FROM md_frontmatter WHERE file_path = ?1",
            ["/test/file.md"],
            |row| row.get(0),
        ).unwrap();
        drop(conn);

        assert!(!categories.is_empty(), "categories should not be empty, got empty string");
        assert!(categories.contains("ssddd"), "categories should contain 'ssddd', got: {}", categories);
    }

    #[test]
    fn test_get_category_tree_normal_hierarchy() {
        // 验证正常层级分类树构建正确
        let db = create_test_db();
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO categories (path) VALUES (?1), (?2), (?3), (?4)",
            params!["技术", "技术/前端", "技术/前端/React", "技术/后端"],
        ).unwrap();
        conn.execute(
            "INSERT INTO md_frontmatter (file_path, categories, modified_at) VALUES (?1, ?2, ?3), (?4, ?5, ?6), (?7, ?8, ?9)",
            params![
                "/test/react.md", "[\"技术/前端/React\"]", "2026-06-23T00:00:00Z",
                "/test/frontend.md", "[\"技术/前端\"]", "2026-06-23T00:00:00Z",
                "/test/backend.md", "[\"技术/后端\"]", "2026-06-23T00:00:00Z",
            ],
        ).unwrap();
        drop(conn);

        let tree = get_category_tree(&db).unwrap();
        assert_eq!(tree.len(), 1, "应只有一个根节点");
        assert_eq!(tree[0].path, "技术");
        assert_eq!(tree[0].children.len(), 2, "技术下应有 前端 和 后端");

        // 子节点按名称排序（前 < 后）
        assert_eq!(tree[0].children[0].path, "技术/前端");
        assert_eq!(tree[0].children[0].count, 1);
        assert_eq!(tree[0].children[0].children.len(), 1);
        assert_eq!(tree[0].children[0].children[0].path, "技术/前端/React");
        assert_eq!(tree[0].children[0].children[0].count, 1);
        assert_eq!(tree[0].children[1].path, "技术/后端");
        assert_eq!(tree[0].children[1].count, 1);
    }

    #[test]
    fn test_get_category_tree_orphan_nodes_not_lost() {
        // 验证父路径缺失时，子分类作为孤立根节点保留，不会丢失
        let db = create_test_db();
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO categories (path) VALUES (?1), (?2), (?3)",
            params!["技术/前端/React", "笔记", "其他/A/B"],
        ).unwrap();
        conn.execute(
            "INSERT INTO md_frontmatter (file_path, categories, modified_at) VALUES (?1, ?2, ?3), (?4, ?5, ?6), (?7, ?8, ?9)",
            params![
                "/test/react.md", "[\"技术/前端/React\"]", "2026-06-23T00:00:00Z",
                "/test/note.md", "[\"笔记\"]", "2026-06-23T00:00:00Z",
                "/test/ab.md", "[\"其他/A/B\"]", "2026-06-23T00:00:00Z",
            ],
        ).unwrap();
        drop(conn);

        let tree = get_category_tree(&db).unwrap();
        // 所有分类都缺少父路径，应全部作为根节点保留
        assert_eq!(tree.len(), 3, "孤立节点应作为根节点保留，不应丢失");

        let paths: Vec<String> = tree.iter().map(|n| n.path.clone()).collect();
        assert!(paths.contains(&"技术/前端/React".to_string()));
        assert!(paths.contains(&"笔记".to_string()));
        assert!(paths.contains(&"其他/A/B".to_string()));

        // 验证文件关联未丢失
        let react = tree.iter().find(|n| n.path == "技术/前端/React").unwrap();
        assert_eq!(react.count, 1);
        assert_eq!(react.files.len(), 1);
        assert_eq!(react.files[0].file_path, "/test/react.md");
    }
}
