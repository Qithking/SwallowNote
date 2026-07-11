//! 全局状态管理：当前数据库连接、数据库文件路径解析。
//!
//! 数据库优先存放在应用数据目录中：
//!   `<app_data_dir>/plugin-data/<plugin_id>/secret.swl`
//!
//! 通过环境变量 `SWALLOWNOTE_APP_DATA_DIR` 获取应用数据目录，
//! 由宿主在启动后端子进程时设置。这样插件卸载时不会误删数据库。
//!
//! 如果环境变量不存在（向后兼容/独立测试模式），回退到通过
//! `current_exe()` 推导旧路径。

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
    /// 创建状态实例，解析数据库路径。
    /// 如果新路径没有数据库但旧路径有，自动迁移数据。
    pub fn new() -> Result<Self, String> {
        let db_path = resolve_db_path()?;

        // 数据迁移：如果新路径没有数据库但旧路径有，自动迁移
        if !db_path.exists() {
            if let Ok(old_path) = resolve_legacy_db_path() {
                if old_path.exists() {
                    std::fs::copy(&old_path, &db_path)
                        .map_err(|e| format!("迁移数据库失败: {}", e))?;
                    eprintln!("[secret-disk] 数据库已自动迁移到: {}", db_path.display());
                    // 保留旧文件作为备份，暂不删除
                }
            }
        }

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

/// 推导数据库文件路径。
///
/// 优先通过环境变量 `SWALLOWNOTE_APP_DATA_DIR`（由宿主设置）计算：
///   `<app_data_dir>/plugin-data/<plugin_id>/secret.swl`
///
/// 如果环境变量不存在，回退到通过 `current_exe()` 推导旧路径。
fn resolve_db_path() -> Result<PathBuf, String> {
    // 优先使用环境变量指定的应用数据目录
    if let Ok(app_data_dir) = std::env::var("SWALLOWNOTE_APP_DATA_DIR") {
        // 从命令行参数获取 plugin_id（宿主启动时传递的第一个参数）
        let plugin_id = std::env::args()
            .nth(1)
            .ok_or_else(|| "无法获取 plugin_id（命令行参数）".to_string())?;
        let data_dir = PathBuf::from(app_data_dir)
            .join("plugin-data")
            .join(&plugin_id);
        // 自动创建数据目录
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("无法创建数据目录: {}", e))?;
        return Ok(data_dir.join(DB_FILENAME));
    }

    // 回退：通过 current_exe() 推导旧路径（向后兼容）
    resolve_legacy_db_path()
}

/// 旧版路径推导：`<plugin_root>/secret.swl`。
/// 通过 `current_exe` 推导：
///   `<plugin_root>/<version>/backend/plugin_<id>`
///   → `parent() × 3` 得到 `<plugin_root>`
fn resolve_legacy_db_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("无法获取可执行文件路径: {}", e))?;
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
