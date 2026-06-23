use crate::db;
use once_cell::sync::OnceCell;
use rusqlite::OpenFlags;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::SyncSender;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// 索引任务消息
enum IndexTask {
    /// 扫描指定目录下所有 .md 文件
    ScanDirectory { path: String },
    /// 单文件变更：解析并更新
    FileChanged { path: String },
    /// 单文件删除：移除记录
    FileRemoved { path: String },
    /// 停止子线程
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

    std::thread::Builder::new()
        .name("frontmatter-index".into())
        .spawn(move || {
            // 打开独立的数据库连接（WAL 模式下可并发读写）
            let conn = match rusqlite::Connection::open_with_flags(
                &db_path,
                OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
            ) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[frontmatter-index] Failed to open db: {}", e);
                    return;
                }
            };

            // 启用 WAL 模式以支持并发访问
            let _ = conn.pragma_update(None, "journal_mode", "WAL");
            // 索引线程仅做写入，降低 mmap 到 16MB
            let _ = conn.pragma_update(None, "mmap_size", 16777216);
            let _ = conn.pragma_update(None, "cache_size", -1000);

            let db_instance = db::Database {
                conn: std::sync::Mutex::new(conn),
            };

            // 启动后延迟，避免与 UI 初始化竞争
            std::thread::sleep(Duration::from_millis(STARTUP_DELAY_MS));

            loop {
                match rx.recv() {
                    Ok(task) => match task {
                        IndexTask::ScanDirectory { path } => {
                            handle_scan_directory(&db_instance, &path, &app_handle);
                        }
                        IndexTask::FileChanged { path } => {
                            handle_file_changed(&db_instance, &path);
                        }
                        IndexTask::FileRemoved { path } => {
                            handle_file_removed(&db_instance, &path);
                        }
                        IndexTask::Shutdown => {
                            break;
                        }
                    },
                    Err(_) => {
                        // 通道关闭，退出线程
                        break;
                    }
                }
            }
        })
        .expect("Failed to spawn frontmatter-index thread");
}

/// 提交扫描任务（通道满时静默丢弃，避免阻塞调用方）
pub fn submit_scan(path: String) {
    if let Some(tx) = INDEX_SENDER.get() {
        let _ = tx.try_send(IndexTask::ScanDirectory { path });
    }
}

/// 提交文件变更任务
pub fn submit_file_changed(path: String) {
    if let Some(tx) = INDEX_SENDER.get() {
        let _ = tx.try_send(IndexTask::FileChanged { path });
    }
}

/// 提交文件删除任务
pub fn submit_file_removed(path: String) {
    if let Some(tx) = INDEX_SENDER.get() {
        let _ = tx.try_send(IndexTask::FileRemoved { path });
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

/// 处理目录扫描：流式遍历 + 批量 modified_at 比对 + 增量 upsert
fn handle_scan_directory(db: &db::Database, dir_path: &str, app_handle: &AppHandle) {
    let root = Path::new(dir_path);
    if !root.exists() || !root.is_dir() {
        return;
    }

    // 第一遍：快速计数 .md 文件总数（不存路径，内存最优）
    let total = count_md_files(root);
    if total == 0 {
        emit_complete(app_handle);
        return;
    }

    // 一次性加载所有 modified_at 到 HashMap（一次查询替代 N 次逐条查询）
    let modified_map: HashMap<String, String> =
        crate::db::md_frontmatter::get_all_modified_at(db).unwrap_or_default();

    // 第二遍：流式遍历 + 增量处理
    let mut processed: usize = 0;
    let mut batch_count: usize = 0;

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

        let modified_at = match entry.metadata() {
            Ok(meta) => format_mtime(meta.modified()),
            Err(_) => continue,
        };

        // 增量判断：HashMap 查找替代逐条数据库查询
        if let Some(db_modified) = modified_map.get(&path_str) {
            if *db_modified == modified_at {
                processed += 1;
                if processed % BATCH_SIZE == 0 || processed == total {
                    emit_progress(app_handle, processed, total);
                }
                continue;
            }
        }

        // 解析并 upsert
        parse_and_upsert(db, &path_str, &modified_at);

        processed += 1;

        // 每 20 个文件发射一次进度
        if processed % BATCH_SIZE == 0 || processed == total {
            emit_progress(app_handle, processed, total);
        }

        // 分批限流
        batch_count += 1;
        if batch_count >= BATCH_SIZE {
            batch_count = 0;
            std::thread::sleep(Duration::from_millis(BATCH_INTERVAL_MS));
        }
    }

    emit_complete(app_handle);
}

/// 快速计数目录下 .md 文件数量（不存储路径，内存最优）
fn count_md_files(root: &Path) -> usize {
    let mut count: usize = 0;
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

        count += 1;
    }
    count
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

/// 处理单文件删除
/// 注意：原子保存（先写 .tmp 再 rename）会触发 rename 事件，新路径对应的文件仍然存在。
/// 如果文件依旧存在，说明是 rename target，不应删除 frontmatter，避免覆盖同步保存结果。
fn handle_file_removed(db: &db::Database, file_path: &str) {
    if Path::new(file_path).exists() {
        return;
    }
    let _ = crate::db::md_frontmatter::delete_frontmatter(db, file_path);
}

/// 读取文件、解析 frontmatter 并 upsert 到数据库
fn parse_and_upsert(db: &db::Database, file_path: &str, modified_at: &str) {
    let content = match std::fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[frontmatter-index] Failed to read {}: {}", file_path, e);
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
        eprintln!("[frontmatter-index] Failed to upsert {}: {}", file_path, e);
    }
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
            let at_line_start = if pos == yaml_start {
                true
            } else if pos >= 1 && bytes[pos - 1] == b'\n' {
                true
            } else if pos >= 2 && bytes[pos - 2] == b'\n' && bytes[pos - 1] == b'\r' {
                true
            } else {
                false
            };

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
            eprintln!("[frontmatter-index] YAML parse error: {}", e);
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
