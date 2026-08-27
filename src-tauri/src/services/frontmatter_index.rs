use crate::db;
use once_cell::sync::OnceCell;
use rusqlite::OpenFlags;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::SyncSender;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use log::error;

/// 索引任务消息
enum IndexTask {
    /// 扫描指定目录下所有 .md 文件
    ScanDirectory { path: String },
    /// 单文件变更：解析并更新
    FileChanged { path: String },
    /// 单文件删除：移除记录
    FileRemoved { path: String },
    /// 停止索引线程
    Shutdown,
}

/// 全局发送端，供外部提交任务（有界通道，容量 256，防止内存膨胀）
static INDEX_SENDER: OnceCell<SyncSender<IndexTask>> = OnceCell::new();

/// 每批处理文件数
const BATCH_SIZE: usize = 20;
/// 批次间休眠时间（毫秒）
const BATCH_INTERVAL_MS: u64 = 100;
/// 启动后延迟扫描时间（毫秒）
const STARTUP_DELAY_MS: u64 = 3000;

/// 启动索引子线程（使用独立数据库连接，避免与主线程竞争 Mutex）
pub fn start_index_thread(db_path: PathBuf, app_handle: AppHandle) {
    let (tx, rx) = std::sync::mpsc::sync_channel::<IndexTask>(256);
    INDEX_SENDER.set(tx).ok();

    // 优雅降级：线程创建失败时记录日志并返回，避免 panic 导致启动崩溃
    if let Err(e) = std::thread::Builder::new()
        .name("frontmatter-index".into())
        .spawn(move || {
            // 打开独立的数据库连接（WAL 模式下可并发读写）
            let conn = match rusqlite::Connection::open_with_flags(
                &db_path,
                OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
            ) {
                Ok(c) => c,
                Err(e) => {
                    error!("[frontmatter-index] Failed to open db: {}", e);
                    return;
                }
            };

            // 启用 WAL 模式以支持并发访问
            let _ = conn.pragma_update(None, "journal_mode", "WAL");
            // 索引线程仅做写入，降低 mmap 到 16MB
            let _ = conn.pragma_update(None, "mmap_size", 16777216);
            let _ = conn.pragma_update(None, "cache_size", -1000);
            // 与主线程保持一致，WAL 模式下 NORMAL 安全且性能更好
            let _ = conn.pragma_update(None, "synchronous", "NORMAL");

            let db_instance = db::Database {
                conn: std::sync::Mutex::new(conn),
            };

            // 启动后延迟，避免与 UI 初始化竞争
            std::thread::sleep(Duration::from_millis(STARTUP_DELAY_MS));

            // 启动时同步分类：补全缺失的父路径
            if let Err(e) = db::md_frontmatter::sync_all_categories_from_frontmatter(&db_instance) {
                error!("[frontmatter-index] Failed to sync categories on startup: {}", e);
            }

            while let Ok(task) = rx.recv() {
                match task {
                    IndexTask::ScanDirectory { path } => {
                        handle_scan_directory(&db_instance, &path, &app_handle);
                    }
                    IndexTask::FileChanged { path } => {
                        handle_file_changed(&db_instance, &path);
                    }
                    IndexTask::FileRemoved { path } => {
                        handle_file_removed(&db_instance, &path);
                    }
                    // 收到停止信号：退出循环，db_instance 在线程闭包作用域结束时自动 drop 连接
                    IndexTask::Shutdown => break,
                }
            }
        })
    {
        error!("[frontmatter-index] Failed to spawn index thread: {}", e);
    }
}

/// 提交索引任务的内部封装：通道满或断开时记录告警，不再静默丢弃。
fn submit_task(task: IndexTask, label: &str) {
    if let Some(tx) = INDEX_SENDER.get() {
        if let Err(e) = tx.try_send(task) {
            // Rust 1.94 起TrySendError 不再提供 is_full()，直接按变体匹配
            match e {
                std::sync::mpsc::TrySendError::Full(_) => {
                    error!("[frontmatter-index] channel full, dropped {} task", label);
                }
                std::sync::mpsc::TrySendError::Disconnected(_) => {
                    error!("[frontmatter-index] channel disconnected, dropped {} task", label);
                }
            }
        }
    }
}

/// 提交扫描任务（通道满时告警，不阻塞调用方）
pub fn submit_scan(path: String) {
    submit_task(IndexTask::ScanDirectory { path }, "scan");
}

/// 提交文件变更任务
pub fn submit_file_changed(path: String) {
    submit_task(IndexTask::FileChanged { path }, "file_changed");
}

/// 提交文件删除任务
pub fn submit_file_removed(path: String) {
    submit_task(IndexTask::FileRemoved { path }, "file_removed");
}

/// 停止索引线程：发送 Shutdown，线程退出释放连接
pub fn stop_index_thread() {
    if let Some(sender) = INDEX_SENDER.get() {
        // send 在通道满时会阻塞；Shutdown 为退出关键信号，阻塞投递可接受
        let _ = sender.send(IndexTask::Shutdown);
    }
}

/// 发射索引进度事件
fn emit_progress(app_handle: &AppHandle, current: usize, total: usize) {
    let _ = app_handle.emit(
        "frontmatter-index-progress",
        serde_json::json!({
            "current": current,
            "total": total,
        }),
    );
}

/// 发射索引完成事件
fn emit_complete(app_handle: &AppHandle) {
    let _ = app_handle.emit(
        "frontmatter-index-progress",
        serde_json::json!({
            "current": 0,
            "total": 0,
            "done": true,
        }),
    );
}

/// 处理目录扫描：分批比对 + 增量 upsert + 清理孤立记录
fn handle_scan_directory(db: &db::Database, dir_path: &str, app_handle: &AppHandle) {
    let root = Path::new(dir_path);
    if !root.exists() || !root.is_dir() {
        return;
    }

    // 第一遍：遍历目录收集所有 .md 文件路径（同时完成计数，替代原 count_md_files）
    let mut all_paths: Vec<String> = Vec::new();
    for entry_result in jwalk::WalkDir::new(root) {
        let entry = match entry_result {
            Ok(e) => e,
            Err(_) => continue,
        };
        if entry.file_type().is_dir() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        let lower_name = file_name.to_lowercase();
        if !lower_name.ends_with(".md") && !lower_name.ends_with(".markdown") {
            continue;
        }
        if file_name.starts_with('.') {
            continue;
        }
        let path_str = entry.path().to_string_lossy().to_string().replace('\\', "/");
        all_paths.push(path_str);
    }

    let total = all_paths.len();
    if total == 0 {
        emit_complete(app_handle);
        return;
    }

    // 按需分批查询 modified_at（替代全表加载）
    let modified_map: HashMap<String, String> =
        crate::db::md_frontmatter::get_modified_at_for_paths(db, &all_paths).unwrap_or_default();

    // 第二遍：遍历路径列表 + 增量处理
    let mut processed: usize = 0;
    let mut batch_count: usize = 0;

    for path_str in &all_paths {
        let modified_at = match std::fs::metadata(Path::new(path_str.as_str())) {
            Ok(meta) => format_mtime(meta.modified()),
            Err(_) => continue,
        };

        // 增量判断：HashMap 查找替代逐条数据库查询
        if let Some(db_modified) = modified_map.get(path_str.as_str()) {
            if *db_modified == modified_at {
                processed += 1;
                if processed.is_multiple_of(BATCH_SIZE) || processed == total {
                    emit_progress(app_handle, processed, total);
                }
                continue;
            }
        }

        // 解析并 upsert
        parse_and_upsert(db, path_str.as_str(), &modified_at);

        processed += 1;

        // 每 20 个文件发射一次进度
        if processed.is_multiple_of(BATCH_SIZE) || processed == total {
            emit_progress(app_handle, processed, total);
        }

        // 分批限流
        batch_count += 1;
        if batch_count >= BATCH_SIZE {
            batch_count = 0;
            std::thread::sleep(Duration::from_millis(BATCH_INTERVAL_MS));
        }
    }

    // 扫描后对账清理孤立记录，应对原子保存残留
    let valid_paths: HashSet<String> = all_paths.iter().cloned().collect();
    {
        // 优雅降级：mutex 中毒时不 panic，记录日志后继续使用 guard
        let conn = db.conn.lock().unwrap_or_else(|e| {
            error!("[frontmatter-index] mutex poisoned: {}", e);
            e.into_inner()
        });
        // 按 dir_prefix 限定清理范围，避免误删其他工作区
        // 归一化为正斜杠，与 all_paths 及数据库存储格式保持一致（Windows 兼容）
        let normalized_dir = dir_path.replace('\\', "/");
        if let Err(e) = crate::db::md_frontmatter::purge_orphan_records(&conn, &valid_paths, &normalized_dir) {
            error!("[frontmatter_index] purge_orphan_records failed: {}", e);
        }
    }

    emit_complete(app_handle);
}

/// 处理单文件变更
fn handle_file_changed(db: &db::Database, file_path: &str) {
    let path = Path::new(file_path);
    if !path.exists() || !path.is_file() {
        return;
    }

    let modified_at = match std::fs::metadata(path) {
        Ok(meta) => format_mtime(meta.modified()),
        Err(_) => return,
    };

    // 增量判断
    if let Ok(Some(db_modified)) = crate::db::md_frontmatter::get_modified_at(db, file_path) {
        if db_modified == modified_at {
            return;
        }
    }

    parse_and_upsert(db, file_path, &modified_at);
}

/// 文件仍存在时跳过删除（应对 rename target）
fn handle_file_removed(db: &db::Database, file_path: &str) {
    if Path::new(file_path).exists() {
        return;
    }
    let _ = crate::db::md_frontmatter::delete_frontmatter(db, file_path);
}

/// 读取文件、解析 frontmatter 并 upsert 到数据库
fn parse_and_upsert(db: &db::Database, file_path: &str, modified_at: &str) {
    // 流式读取：仅读到 frontmatter 结束（第二个 ---），避免一次性读入整个大文件
    let content = match read_frontmatter_only(file_path) {
        Ok(c) => c,
        Err(e) => {
            error!("[frontmatter-index] Failed to read {}: {}", file_path, e);
            return;
        }
    };

    let (yaml_value, raw_yaml) = parse_frontmatter_from_content(&content);

    if let Err(e) = crate::db::md_frontmatter::upsert_frontmatter(
        db,
        file_path,
        &yaml_value,
        &raw_yaml,
        modified_at,
    ) {
        error!("[frontmatter-index] Failed to upsert {}: {}", file_path, e);
    }
}

/// 流式读取 frontmatter 区域，避免全量读大文件
fn read_frontmatter_only(file_path: &str) -> std::io::Result<String> {
    use std::io::BufRead;
    let file = std::fs::File::open(file_path)?;
    let reader = std::io::BufReader::new(file);
    let mut buf = String::new();
    let mut is_first_line = true;
    for line in reader.lines() {
        let mut line = line?;
        if is_first_line {
            // 首行去除 UTF-8 BOM（保持行为一致）
            if let Some(stripped) = line.strip_prefix('\u{FEFF}') {
                line = stripped.to_string();
            }
            // 首行不以 --- 开头：无 frontmatter，立即返回，避免读入整个大文件
            if !line.starts_with("---") {
                buf.push_str(&line);
                buf.push('\n');
                return Ok(buf);
            }
            is_first_line = false;
        } else if line.trim_end() == "---" {
            // 闭合 --- 停止；trim_end 兼容 CRLF
            buf.push_str(&line);
            buf.push('\n');
            break;
        }
        buf.push_str(&line);
        buf.push('\n');
    }
    Ok(buf)
}

/// 从 Markdown 内容中提取 YAML frontmatter
/// 返回 (serde_yaml::Value, 原始YAML文本)
/// 优化：不做全文 CRLF 替换，仅在 frontmatter 区域内逐行处理
pub fn parse_frontmatter_from_content(content: &str) -> (serde_yaml::Value, String) {
    // Strip UTF-8 BOM
    let content = content.strip_prefix('\u{FEFF}').unwrap_or(content);

    if !content.starts_with("---") {
        return (serde_yaml::Value::Null, String::new());
    }

    // 逐行查找 frontmatter 边界（避免全文 CRLF 替换）
    let bytes = content.as_bytes();
    let mut pos = 3; // skip opening ---

    // 跳过 opening --- 后的换行
    if pos < bytes.len() && bytes[pos] == b'\r' {
        pos += 1;
    }
    if pos < bytes.len() && bytes[pos] == b'\n' {
        pos += 1;
    }

    // 查找闭合 ---
    let yaml_start = pos;
    let mut yaml_end: Option<usize> = None;

    while pos < bytes.len() {
        // 检查是否在行首且以 --- 开头
        if bytes[pos] == b'-' && pos + 2 < bytes.len() && bytes[pos + 1] == b'-' && bytes[pos + 2] == b'-' {
            // 确认是行首（按优先级顺序检查，避免边界访问错误）
            let at_line_start = pos == yaml_start
                || (pos >= 1 && bytes[pos - 1] == b'\n')
                || (pos >= 2 && bytes[pos - 2] == b'\n' && bytes[pos - 1] == b'\r');

            if at_line_start {
                // 确认 --- 后是换行或文件结束
                let after = pos + 3;
                let is_end = after >= bytes.len()
                    || bytes[after] == b'\n'
                    || (bytes[after] == b'\r' && after + 1 < bytes.len() && bytes[after + 1] == b'\n');
                if is_end {
                    yaml_end = Some(pos);
                    break;
                }
            }
        }

        // 跳到下一行
        while pos < bytes.len() && bytes[pos] != b'\n' {
            pos += 1;
        }
        if pos < bytes.len() {
            pos += 1; // skip \n
        }
    }

    let yaml_end = match yaml_end {
        Some(i) => i,
        None => return (serde_yaml::Value::Null, String::new()),
    };

    // 提取 YAML 文本（仅在 frontmatter 区域内处理 CRLF）
    let raw_yaml = content[yaml_start..yaml_end].replace("\r\n", "\n");
    let yaml_str = raw_yaml.trim();

    if yaml_str.is_empty() {
        return (serde_yaml::Value::Null, raw_yaml);
    }

    match serde_yaml::from_str(yaml_str) {
        Ok(value) => (value, raw_yaml),
        Err(e) => {
            error!("[frontmatter-index] YAML parse error: {}", e);
            (serde_yaml::Value::Null, raw_yaml)
        }
    }
}

/// 格式化文件修改时间为毫秒级时间戳字符串
fn format_mtime(modified: Result<std::time::SystemTime, std::io::Error>) -> String {
    match modified {
        Ok(time) => {
            let duration = time
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default();
            format!("{}", duration.as_millis())
        }
        Err(_) => String::new(),
    }
}
