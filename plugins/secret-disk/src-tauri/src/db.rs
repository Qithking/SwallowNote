//! 数据库连接管理：SQLCipher v4 全库加密。
//!
//! 关键安全措施：
//! - `PRAGMA key` 设置加密密钥（密码作为派生密钥的输入）
//! - `PRAGMA cipher_memory_security = ON` 启用 SQLCipher 内部缓冲区清零
//! - `PRAGMA mmap_size = 0` 禁止内存映射，避免明文页进入内核态
//! - `PRAGMA journal_mode = WAL` 提升并发性能
//! - 文件权限 0600（在 `init`/`import_db`/`backup` 命令中处理）

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::security;

/// 加密数据库句柄。drop 时自动关闭连接（SQLCipher 内部缓冲区由
/// `cipher_memory_security = ON` 负责清零）。
pub struct Database {
    conn: Connection,
    path: PathBuf,
}

impl Database {
    /// 用密码打开已存在的加密数据库。
    /// 调用方负责 `validate_password_length` 后再传入。
    pub fn open(path: &Path, password: &str) -> Result<Self, String> {
        if !path.exists() {
            return Err("数据库文件不存在".to_string());
        }
        let conn = Connection::open(path).map_err(|e| format!("打开数据库失败: {}", e))?;
        apply_pragmas(&conn, password)?;
        Ok(Self { conn, path: path.to_path_buf() })
    }

    /// 创建新的加密数据库并建表。
    /// 调用方负责 `validate_password_length` 后再传入。
    pub fn create(path: &Path, password: &str) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("创建数据库失败: {}", e))?;
        apply_pragmas(&conn, password)?;
        create_schema(&conn)?;
        // 创建后立即设置 0600 权限。
        security::set_secure_permissions(path)
            .map_err(|e| format!("设置文件权限失败: {}", e))?;
        Ok(Self { conn, path: path.to_path_buf() })
    }

    /// 获取数据库连接的不可变引用（供 commands 模块执行查询）。
    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    /// 数据库文件路径。
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// 执行 `PRAGMA wal_checkpoint(TRUNCATE)`，将 WAL 刷入主库。
    /// 用于 `backup` 命令确保文件一致性。
    pub fn wal_checkpoint_truncate(&self) -> Result<(), String> {
        self.conn
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| format!("WAL checkpoint 失败: {}", e))
    }

    /// 执行 `PRAGMA wal_checkpoint(PASSIVE)`，触发 WAL 回收（不阻塞）。
    /// 用于 `delete_item` 删除后回收空间。
    pub fn wal_checkpoint_passive(&self) -> Result<(), String> {
        self.conn
            .execute_batch("PRAGMA wal_checkpoint(PASSIVE);")
            .map_err(|e| format!("WAL checkpoint 失败: {}", e))
    }

    /// 执行 `PRAGMA rekey` 更换加密密钥。
    /// 调用方需先用当前密码 unlock，再调用此方法。
    pub fn rekey(&self, new_password: &str) -> Result<(), String> {
        // SQLCipher 接受原始密码字符串作为 rekey 参数，内部会做 PBKDF2 派生。
        let sql = format!("PRAGMA rekey = '{}';", escape_sql_string(new_password));
        self.conn
            .execute_batch(&sql)
            .map_err(|e| format!("rekey 失败: {}", e))
    }
}

impl Drop for Database {
    fn drop(&mut self) {
        // Connection 的 drop 会关闭数据库句柄；cipher_memory_security = ON
        // 会在关闭时清零 SQLCipher 内部密钥派生缓冲区。
        // 这里显式执行一次 wal_checkpoint(TRUNCATE) 以确保 WAL 内容写回主库。
        let _ = self.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }
}

/// 应用 SQLCipher v4 加密 PRAGMA。
///
/// 顺序很重要：先 `key` 解密/设置密钥，再设置其他安全 PRAGMA。
fn apply_pragmas(conn: &Connection, password: &str) -> Result<(), String> {
    // PRAGMA key 接受原始密码，SQLCipher 内部用 PBKDF2-HMAC-SHA512 × 256000 轮派生。
    let key_sql = format!("PRAGMA key = '{}';", escape_sql_string(password));
    conn.execute_batch(&key_sql)
        .map_err(|e| format!("PRAGMA key 失败（密码可能错误）: {}", e))?;

    // 验证密码正确性：执行一个简单查询，密码错误时会报错。
    conn.execute_batch("SELECT count(*) FROM sqlite_master;")
        .map_err(|_| "密码错误".to_string())?;

    // 安全加固 PRAGMA。
    conn.execute_batch("PRAGMA cipher_memory_security = ON;")
        .map_err(|e| format!("设置 cipher_memory_security 失败: {}", e))?;
    conn.execute_batch("PRAGMA mmap_size = 0;")
        .map_err(|e| format!("设置 mmap_size 失败: {}", e))?;

    // 使用 WAL 模式提升并发性能。
    conn.execute_batch("PRAGMA journal_mode = WAL;")
        .map_err(|e| format!("设置 journal_mode 失败: {}", e))?;

    Ok(())
}

/// 转义 SQL 字符串字面量中的单引号（`'` → `''`）。
/// 用于 `PRAGMA key` / `PRAGMA rekey` 的参数构造。
fn escape_sql_string(s: &str) -> String {
    s.replace('\'', "''")
}

/// 创建数据库 schema：`notes` 表 + 索引。
fn create_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            parent_id TEXT,
            title TEXT NOT NULL,
            content TEXT DEFAULT '',
            type TEXT NOT NULL CHECK(type IN ('file', 'folder')),
            sort_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_notes_parent ON notes(parent_id);
        "#,
    )
    .map_err(|e| format!("建表失败: {}", e))
}
