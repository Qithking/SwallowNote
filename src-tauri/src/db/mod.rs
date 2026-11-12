pub mod conflict_repo;
pub mod folder_history;
pub mod legacy_ai_export;
pub mod market_sources;
pub mod md_frontmatter;
pub mod plugin_settings;
pub mod secure_storage;
pub mod session_state;

use rusqlite::{Connection, OpenFlags, Result};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    /// 获取数据库连接的 MutexGuard，处理 poison 错误
    pub fn conn_lock(&self) -> std::sync::MutexGuard<'_, rusqlite::Connection> {
        self.conn.lock().unwrap_or_else(|e| {
            log::error!("db conn lock poisoned: {}", e);
            e.into_inner()
        })
    }
}

pub fn init_db(app_data_dir: PathBuf) -> Result<Database> {
    let db_path = app_data_dir.join("swallownote.db");
    let mut conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE)?;

    // Enable WAL mode for better concurrent read performance and lower memory usage
    conn.pragma_update(None, "journal_mode", "WAL")?;
    // Reduce memory usage by limiting the WAL auto-checkpoint threshold
    conn.pragma_update(None, "wal_autocheckpoint", 1000)?;
    // Enable memory-mapped I/O for faster reads (64MB limit)
    conn.pragma_update(None, "mmap_size", 67108864)?;
    // Reduce page cache size to limit memory usage (2MB)
    conn.pragma_update(None, "cache_size", -2000)?;
    // WAL 模式下使用 NORMAL 同步级别，避免每次事务都 fsync（默认 FULL 极慢）
    conn.pragma_update(None, "synchronous", "NORMAL")?;

    // folder_history table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS folder_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;
    
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_opened_at ON folder_history(opened_at DESC)",
        [],
    )?;
    
    // session_state table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS session_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    // conflict_repos table
    conflict_repo::create_table(&conn)?;

    // md_frontmatter table
    md_frontmatter::create_table(&conn)?;

    // categories table (空分类持久化)
    md_frontmatter::create_categories_table(&conn)?;

    // plugin_market_sources table
    market_sources::create_table(&conn)?;

    // plugin_settings 单表设计：每插件一行，JSON blob 存值。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS plugin_settings (
            plugin_id TEXT PRIMARY KEY,
            values_json TEXT NOT NULL DEFAULT '{}',
            schema_version INTEGER NOT NULL DEFAULT 0,
            updated_at DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
        )",
        [],
    )?;

    // secure_storage 单表设计（P1.5 / ADR-0003）：每插件每键一行，密文
    // base64(nonce‖ct) 存储，明文永不落库。加解密见 crate::crypto。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS secure_storage (
            plugin_id TEXT NOT NULL,
            key TEXT NOT NULL,
            ciphertext TEXT NOT NULL,
            updated_at DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
            PRIMARY KEY (plugin_id, key)
        )",
        [],
    )?;

    // 清理历史遗留表（硬编码 allowlist 避免误匹配）；DROP IF EXISTS 容错。
    const LEGACY_TABLES: &[&str] = &[
        "plugin_settings_meta",
        // 动态生成的 plugin_settings_<id> 表无法静态枚举，故未列出。
    ];
    for table in LEGACY_TABLES {
        let _ = conn.execute(&format!("DROP TABLE IF EXISTS \"{}\"", table), []);
    }

    // 内置 AI 存量数据一次性导出（P3.1）：迁移文件落 plugin-data/，
    // 自配模型 key 双算法迁移直写 secure_storage，然后 drop 旧表/旧键。
    // 失败不 drop、下次启动重试。P3.2 已删除内置 AI 建表与种子：
    // 新装环境两表不存在，此调用自然为 no-op；老库升级仍会正常导出。
    legacy_ai_export::run_if_needed(&conn, &app_data_dir);

    Ok(Database {
        conn: Mutex::new(conn),
    })
}
