//! 全局状态管理：当前数据库连接、数据库文件路径解析。
//!
//! 后端通过 `std::env::current_exe()` 推导插件根目录：
//!   `<plugin_root>/<version>/backend/plugin_<id>`
//!   → `<plugin_root>/secret.swl`
//!
//! 数据库存放在插件根目录（版本目录的上一级），升级插件版本时数据库不丢失。

use std::path::PathBuf;
use std::sync::Mutex;

use crate::db::Database;

/// 数据库文件名。
const DB_FILENAME: &str = "secret.swl";

/// 全局状态：持有当前打开的数据库连接。
/// 使用 `Mutex<Option<Database>>` 而非 `RwLock`，因为 SQLCipher 连接
/// 不支持并发读，所有操作都需独占访问。
pub struct State {
    db: Mutex<Option<Database>>,
    /// 缓存的数据库文件路径，首次解析后复用。
    db_path: PathBuf,
}

impl State {
    /// 创建状态实例，解析数据库路径并清理 `.swl.bak` 残留。
    pub fn new() -> Result<Self, String> {
        let db_path = resolve_db_path()?;
        Ok(Self {
            db: Mutex::new(None),
            db_path,
        })
    }

    /// 数据库文件路径。
    pub fn db_path(&self) -> &PathBuf {
        &self.db_path
    }

    /// 检查数据库是否已初始化（.swl 文件存在）。
    pub fn is_initialized(&self) -> bool {
        self.db_path.exists()
    }

    /// 检查数据库是否已解锁（连接已建立）。
    pub fn is_unlocked(&self) -> bool {
        let guard = self.db.lock().expect("db mutex poisoned");
        guard.is_some()
    }

    /// 设置当前数据库连接（init/unlock 成功后调用）。
    pub fn set_db(&self, database: Database) {
        let mut guard = self.db.lock().expect("db mutex poisoned");
        *guard = Some(database);
    }

    /// 关闭当前数据库连接（lock 命令调用）。
    pub fn close_db(&self) {
        let mut guard = self.db.lock().expect("db mutex poisoned");
        *guard = None; // Database 的 drop 会关闭连接并清零缓冲区
    }

    /// 在闭包中访问数据库连接，未解锁时返回错误。
    /// 所有 CRUD 命令通过此方法获取连接。
    pub fn with_db<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&Database) -> Result<T, String>,
    {
        let guard = self.db.lock().expect("db mutex poisoned");
        match guard.as_ref() {
            Some(db) => f(db),
            None => Err("数据库未解锁".to_string()),
        }
    }
}

/// 推导数据库文件路径：`<plugin_root>/secret.swl`。
///
/// 通过 `current_exe` 推导：
///   `<plugin_root>/<version>/backend/plugin_<id>`
///   → `parent() × 3` 得到 `<plugin_root>`
fn resolve_db_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("无法获取可执行文件路径: {}", e))?;
    // exe = <plugin_root>/<version>/backend/plugin_<id>
    let backend_dir = exe
        .parent()
        .ok_or_else(|| "无法解析 backend 目录".to_string())?;
    let version_dir = backend_dir
        .parent()
        .ok_or_else(|| "无法解析版本目录".to_string())?;
    let plugin_root = version_dir
        .parent()
        .ok_or_else(|| "无法解析插件根目录".to_string())?;
    Ok(plugin_root.join(DB_FILENAME))
}
