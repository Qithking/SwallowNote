use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;
use uuid::Uuid;
use log::{debug, error};

// 路径白名单校验统一收编到 services::fs_guard（架构审计候选 2）
use crate::services::fs_guard::{check_path_in_roots, ensure_path_allowed};

/// 搜索代际号：每次 search_in_files 调用自增。visitor 检测到代际不匹配
/// 立即退出遍历（即时搜索下连续输入时，旧批次不再全量跑完占用 CPU）
static SEARCH_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[derive(Serialize)]
pub struct FileMetadata {
    pub modified_time: String,
    pub file_size: u64,
}

#[tauri::command]
pub async fn get_file_metadata(
    app: tauri::AppHandle,
    workspace_root: Option<String>,
    path: String,
) -> Result<FileMetadata, String> {
    ensure_path_allowed(&app, workspace_root.as_deref(), Path::new(&path))?;
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }
    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to read metadata: {}", e))?;
    let modified = metadata.modified()
        .map_err(|e| format!("Failed to get modification time: {}", e))?;
    let modified_time: chrono::DateTime<chrono::Local> = modified.into();
    Ok(FileMetadata {
        modified_time: modified_time.format("%Y/%m/%d %H:%M:%S").to_string(),
        file_size: metadata.len(),
    })
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::process::Command as StdCommand;

#[derive(Serialize, Clone)]
pub struct FileNode {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Option<Vec<FileNode>>,
}

#[derive(Deserialize)]
pub struct CreateFileRequest {
    pub path: String,
    pub is_directory: bool,
}

#[derive(Deserialize)]
pub struct RenameFileRequest {
    pub old_path: String,
    pub new_path: String,
}

#[derive(Deserialize)]
pub struct SearchRequest {
    pub query: String,
    /// 搜索根列表（folder 模式 1 个，workspace 模式多根）。
    /// 多根合并为一次调用：取消粒度=批次，避免多根并发时互相误取消。
    pub roots: Vec<String>,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub use_regex: bool,
}

#[derive(Serialize, Clone)]
pub struct SearchResult {
    pub file_path: String,
    pub file_name: String,
    pub line_matches: Vec<LineMatch>,
}

#[derive(Serialize, Clone)]
pub struct LineMatch {
    pub line_number: usize,
    pub content: String,
    pub start_col: usize,
    pub end_col: usize,
}

/// 只读存在性探测，豁免 fs_guard 白名单校验（见 services/fs_guard.rs 豁免登记表）：
/// 启动/最近记录流程需探测尚未打开的工作区路径是否存在。
#[tauri::command]
pub async fn path_exists(path: String) -> bool {
    PathBuf::from(&path).exists()
}

#[tauri::command]
pub async fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .ok_or_else(|| "Failed to get home directory".to_string())
}

#[cfg(target_os = "macos")]
fn is_hidden_macos(metadata: &std::fs::Metadata) -> bool {
    // Note: dot-prefix check is done by the caller before calling this function
    const UF_HIDDEN: u32 = 0x00008000;
    use std::os::darwin::fs::MetadataExt;
    metadata.st_flags() & UF_HIDDEN != 0
}

#[cfg(target_os = "windows")]
fn is_hidden_windows(metadata: &std::fs::Metadata) -> bool {
    // Note: dot-prefix check is done by the caller before calling this function
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x00000002;
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}

/// 同步目录列表逻辑，供 spawn_blocking 调用
fn list_directory_inner(path: &Path, show_all_files: bool, markdown_only: bool) -> Result<Vec<FileNode>, String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", path.display()));
    }

    // jwalk 并行预取；显式关闭 hidden 过滤交由应用层处理
    let mut nodes: Vec<FileNode> = Vec::new();

    for entry_result in jwalk::WalkDir::new(path)
        .max_depth(1)
        .sort(true)
        .skip_hidden(false)
    {
        let entry = match entry_result {
            Ok(e) => e,
            // 该 entry 被跳过（可能是权限不足或符号链接失效），debug 级别记录方便排查。
            // 显式输出失败 entry 的路径；jwalk 部分错误（read_dir 迭代错误）不带路径，回退为根目录
            Err(e) => {
                debug!("list_directory: skipping unreadable entry {:?} under {}: {}",
                    e.path().unwrap_or(path), path.display(), e);
                continue;
            }
        };

        // Skip the root directory itself (jwalk yields the root as the first entry)
        if entry.depth() == 0 {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();

        // Filter hidden files and special directories
        if !show_all_files {
            // Check dot-prefix fast path (common across all platforms)
            if file_name.starts_with('.') {
                continue;
            }
            if file_name == "node_modules" || file_name == ".swallownote" {
                continue;
            }
            // Platform-specific hidden check using pre-fetched metadata
            #[cfg(target_os = "macos")]
            {
                if let Ok(metadata) = entry.metadata() {
                    if is_hidden_macos(&metadata) {
                        continue;
                    }
                }
            }
            #[cfg(target_os = "windows")]
            {
                if let Ok(metadata) = entry.metadata() {
                    if is_hidden_windows(&metadata) {
                        continue;
                    }
                }
            }
            // Linux: dot-prefix check above already handles hidden files
        }

        let is_directory = entry
            .file_type()
            .is_dir();

        if markdown_only && !is_directory {
            let lower_name = file_name.to_lowercase();
            if !lower_name.ends_with(".md") && !lower_name.ends_with(".markdown") {
                continue;
            }
        }

        // Normalize path separators to forward slashes for cross-platform consistency
        let entry_path = entry.path();
        let path_str = entry_path.to_string_lossy().to_string().replace('\\', "/");
        nodes.push(FileNode {
            id: Uuid::new_v4().to_string(),
            name: file_name,
            path: path_str,
            is_directory,
            children: None,
        });
    }

    // jwalk 仅按名排序，需手动实现目录优先
    nodes.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(nodes)
}

#[tauri::command]
pub async fn list_directory(
    app: tauri::AppHandle,
    workspace_root: Option<String>,
    path: String,
    show_all_files: Option<bool>,
    markdown_only: Option<bool>,
) -> Result<Vec<FileNode>, String> {
    ensure_path_allowed(&app, workspace_root.as_deref(), Path::new(&path))?;
    let path = PathBuf::from(&path);
    let show_all_files = show_all_files.unwrap_or(false);
    let markdown_only = markdown_only.unwrap_or(false);

    // 同步 FS I/O 移到 blocking 线程，避免阻塞 Tokio
    tokio::task::spawn_blocking(move || list_directory_inner(&path, show_all_files, markdown_only))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

// 批量列出多个目录：blocking 线程池并行扫描，一次 IPC 返回全部结果。
#[derive(Serialize)]
pub struct BatchDirResult {
    pub path: String,
    pub children: Vec<FileNode>,
}

#[tauri::command]
pub async fn list_directories_batch(
    app: tauri::AppHandle,
    workspace_root: Option<String>,
    paths: Vec<String>,
    show_all_files: Option<bool>,
    markdown_only: Option<bool>,
) -> Result<Vec<BatchDirResult>, String> {
    // 批量目录逐个过闸，任一路径越界即整体拒绝
    for p in &paths {
        ensure_path_allowed(&app, workspace_root.as_deref(), Path::new(p))?;
    }
    let show_all_files = show_all_files.unwrap_or(false);
    let markdown_only = markdown_only.unwrap_or(false);

    // 每目录一个 spawn_blocking 并行执行
    let handles: Vec<_> = paths
        .into_iter()
        .map(|p| {
            let path = PathBuf::from(&p);
            let show = show_all_files;
            let md_only = markdown_only;
            tokio::task::spawn_blocking(move || {
                let children = list_directory_inner(&path, show, md_only)?;
                Ok::<BatchDirResult, String>(BatchDirResult { path: p, children })
            })
        })
        .collect();

    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        let result = handle
            .await
            .map_err(|e| format!("Task join error: {}", e))??;
        results.push(result);
    }

    Ok(results)
}

/// 运行期把工作区目录加入 asset protocol 允许列表（笔记内本地图片显示需要）。
/// 豁免 fs_guard 白名单校验（见 services/fs_guard.rs 豁免登记表）：
/// 授权型命令，path 即新授权对象而非读写目标，调用点均为工作区打开流程。
/// 配合 tauri.conf.json 中 assetProtocol 静态白名单收敛为 $APPDATA：
/// 用户工作区路径运行期才确定，只能动态注册（审计 B4）。
#[tauri::command]
pub fn register_asset_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(&path, true)
        .map_err(|e| format!("Failed to allow asset scope for {}: {}", path, e))
}

/// 导出文本（日志等）到用户经系统保存对话框选择的路径。
/// 豁免 fs_guard 白名单校验（见 services/fs_guard.rs 豁免登记表）：
/// 路径来自前端 save dialog，供 LogViewer 导出日志等合法工作区外写场景使用。
#[tauri::command]
pub async fn export_text_file(path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }
    tokio::fs::write(&path, &content)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))
}

/// C21：唯一 tmp 文件名（原文件名 + pid + 原子计数 + 纳秒时间戳）。
/// 与目标同目录（保证 rename 同盘原子性）；并发写同一文件互不踩踏；
/// 点前缀命名，文件树按隐藏文件过滤不显示。
fn unique_tmp_path(path: &Path) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static TMP_SEQ: AtomicU64 = AtomicU64::new(0);
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    path.with_file_name(format!(
        ".{}.{}.{}.{}.tmp",
        file_name,
        std::process::id(),
        seq,
        nanos
    ))
}

#[tauri::command]
pub async fn read_file(
    app: tauri::AppHandle,
    workspace_root: Option<String>,
    path: String,
) -> Result<String, String> {
    ensure_path_allowed(&app, workspace_root.as_deref(), Path::new(&path))?;
    let path = PathBuf::from(&path);

    if !path.exists() {
        return Err(format!("File does not exist: {}", path.display()));
    }

    if !path.is_file() {
        return Err(format!("Path is not a file: {}", path.display()));
    }

    // 读取前检查文件大小，超过 10MB 拒绝读取，避免一次性读入大文件导致内存峰值
    const MAX_READ_SIZE: u64 = 10 * 1024 * 1024; // 10MB
    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to read metadata: {}", e))?;
    if metadata.len() > MAX_READ_SIZE {
        return Err(format!(
            "File too large ({} bytes, max {} bytes): {}",
            metadata.len(),
            MAX_READ_SIZE,
            path.display()
        ));
    }

    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub async fn write_file(
    app: tauri::AppHandle,
    workspace_root: Option<String>,
    path: String,
    content: String,
) -> Result<(), String> {
    ensure_path_allowed(&app, workspace_root.as_deref(), Path::new(&path))?;
    let path = PathBuf::from(&path);

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }

    // Windows 直接写避免 tab 误关；其他平台用原子写
    #[cfg(target_os = "windows")]
    {
        tokio::fs::write(&path, &content)
            .await
            .map_err(|e| format!("Failed to write file: {}", e))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Atomic write: write to unique temp file first, then rename (C21)
        let temp_path = unique_tmp_path(&path);
        tokio::fs::write(&temp_path, &content)
            .await
            .map_err(|e| format!("Failed to write temporary file: {}", e))?;

        if let Err(e) = tokio::fs::rename(&temp_path, &path).await {
            // C21：rename 失败清理 tmp，避免残留 .tmp 垃圾文件
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(format!("Failed to rename temporary file: {}", e));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn write_binary_file(
    app: tauri::AppHandle,
    workspace_root: Option<String>,
    path: String,
    data: String,
) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    ensure_path_allowed(&app, workspace_root.as_deref(), Path::new(&path))?;
    let path = PathBuf::from(&path);

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }

    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| format!("Failed to write binary file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn create_file(
    app: tauri::AppHandle,
    workspace_root: Option<String>,
    req: CreateFileRequest,
) -> Result<String, String> {
    ensure_path_allowed(&app, workspace_root.as_deref(), Path::new(&req.path))?;
    let path = PathBuf::from(&req.path);

    if path.exists() {
        return Err(format!("Path already exists: {}", path.display()));
    }

    if req.is_directory {
        tokio::fs::create_dir_all(&path)
            .await
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    } else {
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }

        tokio::fs::write(&path, "")
            .await
            .map_err(|e| format!("Failed to create file: {}", e))?;
    }

    Ok(path.to_string_lossy().to_string().replace('\\', "/"))
}

#[tauri::command]
pub async fn delete_file(
    app: tauri::AppHandle,
    workspace_root: Option<String>,
    path: String,
) -> Result<(), String> {
    ensure_path_allowed(&app, workspace_root.as_deref(), Path::new(&path))?;
    let path = PathBuf::from(&path);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    if path.is_dir() {
        tokio::fs::remove_dir_all(&path)
            .await
            .map_err(|e| format!("Failed to delete directory: {}", e))?;
    } else {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|e| format!("Failed to delete file: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn rename_file(
    app: tauri::AppHandle,
    workspace_root: Option<String>,
    req: RenameFileRequest,
) -> Result<(), String> {
    ensure_path_allowed(&app, workspace_root.as_deref(), Path::new(&req.old_path))?;
    ensure_path_allowed(&app, workspace_root.as_deref(), Path::new(&req.new_path))?;
    let old_path = PathBuf::from(&req.old_path);
    let new_path = PathBuf::from(&req.new_path);

    if !old_path.exists() {
        return Err(format!("Old path does not exist: {}", old_path.display()));
    }

    if new_path.exists() {
        return Err(format!("New path already exists: {}", new_path.display()));
    }

    tokio::fs::rename(&old_path, &new_path)
        .await
        .map_err(|e| format!("Failed to rename: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn copy_file(
    app: tauri::AppHandle,
    workspace_root: Option<String>,
    req: RenameFileRequest,
) -> Result<(), String> {
    ensure_path_allowed(&app, workspace_root.as_deref(), Path::new(&req.old_path))?;
    ensure_path_allowed(&app, workspace_root.as_deref(), Path::new(&req.new_path))?;
    let old_path = PathBuf::from(&req.old_path);
    let new_path = PathBuf::from(&req.new_path);

    if !old_path.exists() {
        return Err(format!("Source path does not exist: {}", old_path.display()));
    }

    if new_path.exists() {
        return Err(format!("Destination path already exists: {}", new_path.display()));
    }

    if old_path.is_dir() {
        // Copy directory recursively
        copy_dir_all(&old_path, &new_path).await
            .map_err(|e| format!("Failed to copy directory: {}", e))?;
    } else {
        tokio::fs::copy(&old_path, &new_path)
            .await
            .map_err(|e| format!("Failed to copy file: {}", e))?;
    }

    Ok(())
}

async fn copy_dir_all(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    tokio::fs::create_dir_all(dst).await?;
    let mut entries = tokio::fs::read_dir(src).await?;

    while let Some(entry) = entries.next_entry().await? {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            Box::pin(copy_dir_all(&src_path, &dst_path)).await?;
        } else {
            tokio::fs::copy(&src_path, &dst_path).await?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn copy_file_to_clipboard(
    app: tauri::AppHandle,
    workspace_root: Option<String>,
    path: String,
) -> Result<(), String> {
    ensure_path_allowed(&app, workspace_root.as_deref(), Path::new(&path))?;
    let path = PathBuf::from(&path);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    #[cfg(target_os = "macos")]
    {
        // 用 Cocoa bridge 调 NSPasteboard，避免 JXA 抖动
        let escaped_path = path.display().to_string()
            .replace('\\', "\\\\")
            .replace('"', "\\\"");

        let output = StdCommand::new("osascript")
            .arg("-e")
            .arg("use framework \"Foundation\"")
            .arg("-e")
            .arg("use framework \"AppKit\"")
            .arg("-e")
            .arg("set pb to current application's NSPasteboard's generalPasteboard()")
            .arg("-e")
            .arg("pb's clearContents()")
            .arg("-e")
            .arg(format!(
                "set fileURL to current application's NSURL's fileURLWithPath:\"{}\"",
                escaped_path
            ))
            .arg("-e")
            .arg("pb's writeObjects:{fileURL}")
            .output()
            .map_err(|e| format!("Failed to execute osascript: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(format!(
                "Copy to clipboard failed: stderr={}, stdout={}",
                stderr, stdout
            ));
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Use PowerShell to copy file path to clipboard in a format Explorer understands.
        // 使用单引号字符串避免 $(...) 子表达式扩展（命令注入风险）。
        let escaped_path = path.display().to_string().replace('\'', "''");
        let ps_command = format!(
            r#"Add-Type -AssemblyName System.Windows.Forms;
[System.Windows.Forms.Clipboard]::SetFileDropList(@('{}'));"#,
            escaped_path
        );
        super::create_command("powershell")
            .arg("-command")
            .arg(&ps_command)
            .output()
            .map_err(|e| format!("Failed to copy to clipboard: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // On Linux, use xclip to copy file path
        // Note: This provides file manager compatible clipboard
        let escaped_path = path.display().to_string()
            .replace('\'', "'\\''");
        StdCommand::new("sh")
            .arg("-c")
            .arg(format!(
                "printf '%s' '{}' | xclip -selection clipboard -t text/uri-list",
                format!("file://{}", escaped_path)
            ))
            .output()
            .map_err(|e| format!("Failed to copy to clipboard: {}", e))?;
    }

    Ok(())
}

/// Reads file paths from the system clipboard (e.g., files copied in Finder/Explorer).
/// Returns a list of absolute file paths if the clipboard contains file references.
#[tauri::command]
pub async fn read_clipboard_file_paths() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        // osascript 读 NSPasteboard，用 linefeed 分隔避免逗号歧义
        let output = StdCommand::new("osascript")
            .arg("-e")
            .arg("use framework \"Foundation\"")
            .arg("-e")
            .arg("use framework \"AppKit\"")
            .arg("-e")
            .arg("use scripting additions")
            .arg("-e")
            .arg("set pb to current application's NSPasteboard's generalPasteboard()")
            .arg("-e")
            .arg("set theClasses to pb's types()")
            .arg("-e")
            .arg("if (theClasses's containsObject:\"public.file-url\") as boolean then")
            .arg("-e")
            .arg("set theObjects to pb's readObjectsForClasses:{current application's NSURL} options:(missing value)")
            .arg("-e")
            .arg("set outputPaths to {}")
            .arg("-e")
            .arg("repeat with anURL in theObjects")
            .arg("-e")
            .arg("if (anURL's isFileURL()) as boolean then")
            .arg("-e")
            .arg("set end of outputPaths to (anURL's |path|()) as text")
            .arg("-e")
            .arg("end if")
            .arg("-e")
            .arg("end repeat")
            .arg("-e")
            .arg("set AppleScript's text item delimiters to linefeed")
            .arg("-e")
            .arg("return outputPaths as text")
            .arg("-e")
            .arg("else")
            .arg("-e")
            .arg("return \"\"")
            .arg("-e")
            .arg("end if")
            .output()
            .map_err(|e| format!("Failed to execute osascript: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Read clipboard file paths failed: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let result = stdout.trim();

        if result.is_empty() {
            return Ok(Vec::new());
        }

        // Split by linefeed which won't conflict with commas in paths
        let paths: Vec<String> = result
            .split('\n')
            .filter_map(|s| {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    return None;
                }
                // Verify path exists and is a file (skip directories)
                let path = PathBuf::from(trimmed);
                if path.is_file() {
                    Some(path.to_string_lossy().to_string().replace('\\', "/"))
                } else {
                    None
                }
            })
            .collect();

        Ok(paths)
    }

    #[cfg(target_os = "windows")]
    {
        // Use PowerShell to read file drop list from clipboard
        let ps_command = r#"
Add-Type -AssemblyName System.Windows.Forms;
$files = [System.Windows.Forms.Clipboard]::GetFileDropList();
if ($files) { $files -join '|' } else { '' }
"#;
        let output = super::create_command("powershell")
            .arg("-command")
            .arg(ps_command)
            .output()
            .map_err(|e| format!("Failed to read clipboard: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Read clipboard file paths failed: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let result = stdout.trim();

        if result.is_empty() {
            return Ok(Vec::new());
        }

        let paths: Vec<String> = result
            .split('|')
            .filter_map(|s| {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    return None;
                }
                let path = PathBuf::from(trimmed);
                if path.is_file() {
                    Some(path.to_string_lossy().to_string().replace('\\', "/"))
                } else {
                    None
                }
            })
            .collect();

        Ok(paths)
    }

    #[cfg(target_os = "linux")]
    {
        // Use xclip to read file URLs from clipboard
        let output = StdCommand::new("sh")
            .arg("-c")
            .arg("xclip -selection clipboard -t text/uri-list -o 2>/dev/null")
            .output()
            .map_err(|e| format!("Failed to read clipboard: {}", e))?;

        if !output.status.success() {
            return Ok(Vec::new());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let paths: Vec<String> = stdout
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    return None;
                }
                // Remove file:// prefix and decode URI
                let path_str = if trimmed.starts_with("file://") {
                    // percent-decode 用 from_utf8 保护多字节字符
                    let uri = &trimmed[7..];
                    let src = uri.as_bytes();
                    let mut bytes: Vec<u8> = Vec::with_capacity(src.len());
                    let mut i = 0;
                    while i < src.len() {
                        if src[i] == b'%' && i + 2 < src.len() {
                            let hex = &src[i + 1..i + 3];
                            if let Ok(s) = std::str::from_utf8(hex) {
                                if let Ok(b) = u8::from_str_radix(s, 16) {
                                    bytes.push(b);
                                    i += 3;
                                    continue;
                                }
                            }
                        }
                        bytes.push(src[i]);
                        i += 1;
                    }
                    String::from_utf8(bytes).unwrap_or_else(|_| trimmed.to_string())
                } else {
                    trimmed.to_string()
                };
                let path = PathBuf::from(&path_str);
                if path.is_file() {
                    Some(path.to_string_lossy().to_string().replace('\\', "/"))
                } else {
                    None
                }
            })
            .collect();

        Ok(paths)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub async fn open_in_finder(
    app: tauri::AppHandle,
    workspace_root: Option<String>,
    path: String,
) -> Result<(), String> {
    ensure_path_allowed(&app, workspace_root.as_deref(), Path::new(&path))?;
    let path = PathBuf::from(&path);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    // 每个平台块各自独立、自包含，避免跨 cfg 的变量引用导致未使用变量警告。

    #[cfg(target_os = "macos")]
    {
        // open -R <file>  → 在 Finder 中定位并选中该文件
        // open    <dir>   → 在 Finder 中打开该目录
        let mut cmd = super::create_command("open");
        if path.is_file() {
            cmd.arg("-R");
        }
        cmd.arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        // explorer /select 定位文件；canonicalize 去前缀+双引号包裹
        let abs_path = std::fs::canonicalize(&path)
            .map_err(|e| format!("Failed to get absolute path: {}", e))?;
        let path_str = abs_path.to_string_lossy().to_string();
        // 去掉 Windows canonicalize 产生的扩展长度前缀：
        //   \\?\C:\...     →  C:\...
        //   \\?\UNC\...    →  \\...
        let clean_path = if let Some(rest) = path_str.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{}", rest)
        } else if let Some(rest) = path_str.strip_prefix(r"\\?\") {
            rest.to_string()
        } else {
            path_str
        };

        let mut cmd = super::create_command("explorer");
        if path.is_file() {
            cmd.raw_arg(format!(r#"/select,"{}""#, clean_path));
        } else {
            cmd.raw_arg(format!(r#""{}""#, clean_path));
        }
        cmd.spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // xdg-open 只能打开目录，无法选中文件。
        // 对于文件，打开其所在父目录；对于目录，直接打开。
        let target = if path.is_dir() {
            path.clone()
        } else {
            path.parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| path.clone())
        };
        super::create_command("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        return Err("Unsupported platform: open in file explorer is only supported on macOS, Windows, and Linux".to_string());
    }

    Ok(())
}

/// 搜索载荷上限（间歇性「输入卡死、结果卡住不显示」根因修复）：
/// 行内容全量返回 + 每匹配克隆整行 + 无总量上限 → 广泛查询（常见词/短词）
/// 产生 MB 级 IPC JSON，webview 主线程解析冻结 → 输入卡死、结果迟迟不显示。
/// 概率性来源：载荷大小取决于查询广泛度与文件行长度。
const LINE_WINDOW_HALF: usize = 150;        // 超长行截断窗口：命中前后各保留的字符数
const MAX_TOTAL_LINE_MATCHES: usize = 5000; // 单次搜索全局匹配行总数上限

/// 超长行窗口截断：行内容超过 2×LINE_WINDOW_HALF 时，只保留首个命中附近的窗口，
/// start_col/end_col 同步换算为窗口内偏移（字节偏移 → 字符偏移换算，保证 UTF-8 安全）
fn truncate_line_window(line: &str, mat_start: usize, mat_end: usize) -> (String, usize, usize) {
    if line.chars().count() <= LINE_WINDOW_HALF * 2 {
        return (line.to_string(), mat_start, mat_end);
    }
    let chars: Vec<char> = line.chars().collect();
    let cs = line[..mat_start].chars().count(); // 命中起点字符偏移
    let ce = line[..mat_end].chars().count();   // 命中终点字符偏移
    let s = cs.saturating_sub(LINE_WINDOW_HALF);
    let e = (ce + LINE_WINDOW_HALF).min(chars.len());
    (chars[s..e].iter().collect(), cs - s, ce - s)
}

/// 搜索遍历线程数：CPU 占用约束（用户要求 ≤50% 甚至更低）。
/// 逻辑核数一半且硬上限 2：4 核→2（50%）、8 核→2（25%）、更多核占用更低；
/// 1-2 核机器退化为单线程。资源约束优先于搜索速度。
fn search_thread_count() -> usize {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2);
    (cores / 2).clamp(1, 2)
}

/// 并行遍历 roots 并按 regex 逐行匹配（search_in_files 核心逻辑，独立于
/// AppHandle 以便单测）。my_gen 为本批次代际号：visitor 检测到全局代际
/// 变化立即退出遍历（即时搜索下旧批次不再占用 CPU）。
fn walk_and_match(
    roots: &[PathBuf],
    regex: &regex::Regex,
    my_gen: u64,
) -> std::collections::HashMap<String, Vec<LineMatch>> {
    use std::collections::HashMap;
    use std::io::{BufRead, BufReader};
    use std::sync::atomic::Ordering;
    use std::sync::{Arc, Mutex};
    use ignore::{WalkBuilder, WalkState};
    use ignore::overrides::OverrideBuilder;

    // 资源控制：遍历线程受 search_thread_count 约束（CPU 占用 ≤50% 甚至更低）；
    // 单文件 5MB 上限防超大文件拖慢；间隙零占用（无后台常驻）
    const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024;

    let matches: Arc<Mutex<HashMap<String, Vec<LineMatch>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    // 全局匹配行计数（跨遍历线程共享）：达到上限立即截停，载荷有界
    let total = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    for root in roots {
        let mut builder = WalkBuilder::new(root);
        builder
            .hidden(true)               // 点前缀文件/目录排除（等价旧 starts_with('.')）
            .git_ignore(true)           // git 仓库内遵循 .gitignore（ripgrep 同款行为）
            .follow_links(false)        // symlink 防环：不跟随符号链接
            .threads(search_thread_count())
            .max_filesize(Some(MAX_FILE_SIZE));
        // 显式复刻旧实现的 8 目录排除清单（固定字符串 glob 不会编译失败）
        let mut ov_builder = OverrideBuilder::new(root);
        for dir in ["node_modules", "target", "dist", "build", ".swallownote", "__pycache__", ".next", ".nuxt"] {
            let _ = ov_builder.add(&format!("!{dir}"));
        }
        if let Ok(ov) = ov_builder.build() {
            builder.overrides(ov);
        }

        let matches_clone = matches.clone();
        let total_clone = total.clone();
        builder.build_parallel().run(|| {
            // Regex 内部 Arc 结构，每线程 clone 零成本
            let re = regex.clone();
            let matches_clone = matches_clone.clone();
            let total = total_clone.clone();
            Box::new(move |entry: Result<ignore::DirEntry, ignore::Error>| {
                // 新批次已发起：本批遍历立即退出，不再占用 CPU
                if SEARCH_GENERATION.load(Ordering::Relaxed) != my_gen {
                    return WalkState::Quit;
                }
                // 匹配行总数已达上限：立即截停（载荷有界，防广泛查询冻结前端）
                if total.load(Ordering::Relaxed) >= MAX_TOTAL_LINE_MATCHES {
                    return WalkState::Quit;
                }
                let Ok(entry) = entry else { return WalkState::Continue };
                if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    return WalkState::Continue;
                }
                let path = entry.path();
                // 二进制扩展黑名单（与旧实现一致）
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    let ext_lower = ext.to_lowercase();
                    if matches!(ext_lower.as_str(),
                        "png" | "jpg" | "jpeg" | "gif" | "ico" | "svg" | "webp"
                        | "pdf" | "zip" | "tar" | "gz" | "rar" | "7z"
                        | "exe" | "dll" | "so" | "dylib" | "a" | "o" | "obj"
                        | "woff" | "woff2" | "ttf" | "eot" | "otf"
                        | "mp3" | "mp4" | "wav" | "avi" | "mov" | "webm"
                        | "wasm" | "pyc" | "class"
                    ) {
                        return WalkState::Continue;
                    }
                }

                let path_str = path.to_string_lossy().to_string().replace('\\', "/");

                if let Ok(file) = std::fs::File::open(path) {
                    let reader = BufReader::new(file);
                    // 流式逐行读取：每行仅取首个命中（与旧去重语义一致）+ 超长行窗口截断；
                    // enumerate 天然行号升序，前端展示顺序确定
                    let mut line_matches: Vec<LineMatch> = Vec::new();
                    for (idx, line) in reader.lines().enumerate() {
                        // 行级检查：取消信号尽早响应（逐行而非逐文件）+ 总量封顶
                        if SEARCH_GENERATION.load(Ordering::Relaxed) != my_gen {
                            return WalkState::Quit;
                        }
                        if total.load(Ordering::Relaxed) >= MAX_TOTAL_LINE_MATCHES {
                            return WalkState::Quit;
                        }
                        let line = match line {
                            Ok(l) => l,
                            Err(_) => continue, // 读取出错的行跳过
                        };
                        let Some(mat) = re.find(&line) else { continue };
                        let (content, sc, ec) = truncate_line_window(&line, mat.start(), mat.end());
                        line_matches.push(LineMatch {
                            line_number: idx + 1,
                            content,
                            start_col: sc,
                            end_col: ec,
                        });
                        total.fetch_add(1, Ordering::Relaxed);
                    }

                    if !line_matches.is_empty() {
                        // 锁中毒时恢复内部数据，避免连锁 panic
                        let mut matches_map = matches_clone.lock().unwrap_or_else(|e| {
                            error!("锁中毒: {}", e);
                            e.into_inner()
                        });
                        matches_map.insert(path_str, line_matches);
                    }
                }
                WalkState::Continue
            })
        });

        // 本根遍历期间已被取消：不再处理后续根
        if SEARCH_GENERATION.load(Ordering::Relaxed) != my_gen {
            break;
        }
    }

    let guard = matches.lock().unwrap_or_else(|e| {
        error!("锁中毒: {}", e);
        e.into_inner()
    });
    guard.clone()
}

/// HashMap → SearchResult 列表。HashMap 迭代序随机：
/// 同一查询两次搜索若顺序不同，前端整个列表会洗牌跳动（用户点击结果打开文件后找不到刚打开的项）。
fn collect_results_sorted(
    matches_map: &std::collections::HashMap<String, Vec<LineMatch>>,
) -> Vec<SearchResult> {
    let mut results: Vec<SearchResult> = matches_map
        .iter()
        .map(|(path, line_matches)| {
            let file_name = PathBuf::from(path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            SearchResult {
                file_path: path.clone(),
                file_name,
                line_matches: line_matches.clone(),
            }
        })
        .collect();
    // 按 file_path 稳定排序：同一查询的每次搜索产生完全一致的顺序，
    // 结果落地时列表不再洗牌（即时搜索下旧批次落地不会打乱用户正在查看的结果）
    results.sort_by(|a, b| a.file_path.cmp(&b.file_path));
    results
}

/// 过滤出可搜索的有效根（独立函数便于单测，不依赖 AppHandle）：
/// - 不存在/非目录的根：跳过（与旧逐根 invoke 容错语义一致）；
/// - 白名单校验失败（安全越权）：立即拒绝（fail-closed 原则）；
/// - 全部根不可用：报错。
fn filter_valid_roots(
    allowed: &[PathBuf],
    roots: &[String],
) -> Result<Vec<PathBuf>, String> {
    let mut valid_roots = Vec::with_capacity(roots.len());
    for r in roots {
        let root = PathBuf::from(r);
        // 先做存在性检查：被删除的根无法 canonicalize、必然不在白名单内，
        // 若先走白名单校验会被 fail-closed 拒绝导致整单失败。
        // 不存在的路径不会被 walk 触碰（无越权面），跳过安全。
        if !root.exists() || !root.is_dir() {
            continue;
        }
        // 根实际存在：canonicalize 可行，白名单校验失败（安全越权）立即拒绝（fail-closed 原则）
        if check_path_in_roots(allowed, &root).is_err() {
            return Err(format!("Path is outside allowed directories: {}", root.display()));
        }
        valid_roots.push(root);
    }
    if valid_roots.is_empty() {
        return Err("All search roots are unavailable".to_string());
    }
    Ok(valid_roots)
}

#[tauri::command]
pub async fn search_in_files(
    app: tauri::AppHandle,
    // 全部已打开工作区根（folder 1 个 / workspace 多个）：
    // 多根合并单次 invoke 时白名单必须覆盖所有根，否则其余根被 fail-closed 拒绝
    workspace_roots: Option<Vec<String>>,
    req: SearchRequest,
) -> Result<Vec<SearchResult>, String> {
    // 聚合白名单：全部已打开根 + 应用数据目录（安全语义与逐根校验等价）
    let allowed = crate::services::fs_guard::allowed_roots_multi(
        &app,
        workspace_roots.as_deref().unwrap_or(&[]),
    )?;
    // 逐根校验白名单与存在性，多根共享同一批次
    let valid_roots = filter_valid_roots(&allowed, &req.roots)?;

    // 模式构造逻辑与旧实现完全一致（行为等价）
    let pattern_str = if req.use_regex {
        req.query.clone()
    } else if req.whole_word {
        format!("\\b{}\\b", regex::escape(&req.query))
    } else if req.case_sensitive {
        req.query.clone()
    } else {
        format!("(?i){}", regex::escape(&req.query))
    };

    let regex = regex::Regex::new(&pattern_str)
        .map_err(|e| format!("Invalid pattern: {}", e))?;

    // 取本批次代际号：即时搜索下新查询发起即令旧批次失效
    let my_gen = SEARCH_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;

    // blocking 线程执行并行遍历（tokio 线程池不被阻塞）
    let matches_map = tokio::task::spawn_blocking(move || {
        walk_and_match(&valid_roots, &regex, my_gen)
    }).await.map_err(|e| format!("Search task failed: {}", e))?;

    // 被新批次取代：返回空（前端按代际丢弃，本就不可见）
    if SEARCH_GENERATION.load(std::sync::atomic::Ordering::SeqCst) != my_gen {
        return Ok(vec![]);
    }

    let results = collect_results_sorted(&matches_map);

    Ok(results)
}

#[cfg(test)]
mod search_tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::Ordering;
    use std::sync::Mutex;

    /// 串行化：三个测试共享全局 SEARCH_GENERATION，须互斥执行防互相推进代际
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    /// 构造独立临时工作区（测试结束自行清理）
    fn temp_workspace(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("sw-rt-search-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        base
    }

    /// 排除规则与旧实现等价：仅普通 md 命中，node_modules/隐藏文件/二进制扩展不命中
    #[test]
    fn exclusion_rules_equivalent() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let root = temp_workspace("excl");
        fs::write(root.join("a.md"), "needle here\nsecond line\n").unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::write(root.join("node_modules/n.md"), "needle in node_modules\n").unwrap();
        fs::write(root.join(".hidden.md"), "needle hidden\n").unwrap();
        fs::write(root.join("pic.png"), "needle fake binary\n").unwrap();

        let re = regex::Regex::new("needle").unwrap();
        // gen 取当前值且不推进：visitor 视为本批次有效，正常完成遍历
        let my_gen = SEARCH_GENERATION.load(Ordering::SeqCst);
        let map = walk_and_match(&[root.clone()], &re, my_gen);

        let keys: Vec<&String> = map.keys().collect();
        assert!(keys.iter().any(|k| k.ends_with("/a.md")), "a.md 应命中: {:?}", keys);
        assert!(!keys.iter().any(|k| k.contains("node_modules")), "node_modules 应被排除: {:?}", keys);
        assert!(!keys.iter().any(|k| k.contains(".hidden.md")), "隐藏文件应被排除: {:?}", keys);
        assert!(!keys.iter().any(|k| k.contains("pic.png")), "二进制扩展应被排除: {:?}", keys);

        let _ = fs::remove_dir_all(&root);
    }

    /// 自指 symlink 不死循环不 panic（follow_links(false) 防环）
    #[cfg(unix)]
    #[test]
    fn self_referential_symlink_terminates() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let root = temp_workspace("symlink");
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::write(root.join("docs/a.md"), "needle\n").unwrap();
        std::os::unix::fs::symlink(&root.join("docs"), root.join("docs/self")).unwrap();

        let re = regex::Regex::new("needle").unwrap();
        let my_gen = SEARCH_GENERATION.load(Ordering::SeqCst);
        let map = walk_and_match(&[root.clone()], &re, my_gen);

        assert_eq!(map.len(), 1, "仅 a.md 命中且正常终止: {:?}", map.keys().collect::<Vec<_>>());

        let _ = fs::remove_dir_all(&root);
    }

    /// 代际取消：本批次已被新搜索取代时返回空
    #[test]
    fn stale_generation_returns_empty() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let root = temp_workspace("cancel");
        fs::write(root.join("a.md"), "needle\n").unwrap();

        // fetch_add 返回旧值作 my_gen，全局已推进到 my_gen+1 → visitor 立即 Quit
        let my_gen = SEARCH_GENERATION.fetch_add(1, Ordering::SeqCst);
        let re = regex::Regex::new("needle").unwrap();
        let map = walk_and_match(&[root.clone()], &re, my_gen);

        assert!(map.is_empty(), "旧批次应返回空: {:?}", map.keys().collect::<Vec<_>>());

        let _ = fs::remove_dir_all(&root);
    }

    /// 结果顺序确定性：HashMap 迭代序随机，同一组命中两次转换必须产生完全一致的顺序，
    /// 否则每次搜索落地前端列表整体洗牌（用户打开文件后找不到刚点的结果）
    #[test]
    fn results_order_deterministic_across_conversions() {
        // 50 个 key：无排序时两个 HashMap 实例迭代序几乎必然不同，保证测试能抓到 bug
        let all: Vec<String> = (0..50).map(|i| format!("f{:02}.md", 49 - i)).collect();
        let mk_map = |order: &[String]| -> std::collections::HashMap<String, Vec<LineMatch>> {
            let mut m = std::collections::HashMap::new();
            for p in order {
                m.insert(
                    p.clone(),
                    vec![LineMatch { line_number: 1, content: "x".into(), start_col: 0, end_col: 1 }],
                );
            }
            m
        };
        let paths = |v: &[SearchResult]| -> Vec<String> {
            v.iter().map(|r| r.file_path.clone()).collect()
        };

        // 正序/反序插入的两个 HashMap（迭代序随机）→ 转换结果必须一致且有序
        let a = collect_results_sorted(&mk_map(&all));
        let reversed: Vec<String> = all.iter().rev().cloned().collect();
        let b = collect_results_sorted(&mk_map(&reversed));

        let mut expected = all.clone();
        expected.sort();
        assert_eq!(paths(&a), expected, "结果必须按 file_path 排序");
        assert_eq!(paths(&a), paths(&b), "同一组命中两次转换顺序必须完全一致");
    }

    /// 载荷上限 T1：超长行内容必须窗口截断（全量返回会让单条匹配携带 MB 级内容，
    /// 广泛查询下 IPC JSON 撑爆 webview 主线程 → 输入卡死）
    #[test]
    fn long_line_content_is_truncated_to_window() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let root = temp_workspace("trunc");

        // ASCII 超长行：needle 位于第 10000 字符处
        let ascii_line = format!("{}needle{}", "a".repeat(10000), "b".repeat(9994));
        fs::write(root.join("big.md"), ascii_line).unwrap();
        // CJK 超长行：字节数 = 字符数 × 3，验证字节→字符偏移换算
        let cjk_line = format!("{}needle{}", "中".repeat(10000), "文".repeat(9994));
        fs::write(root.join("cjk.md"), cjk_line).unwrap();

        let re = regex::Regex::new("needle").unwrap();
        let my_gen = SEARCH_GENERATION.load(Ordering::SeqCst);
        let map = walk_and_match(&[root.clone()], &re, my_gen);

        let window_bound = LINE_WINDOW_HALF * 2 + "needle".chars().count();
        for (name, key) in [("ascii", "/big.md"), ("cjk", "/cjk.md")] {
            let ms = map
                .iter()
                .find(|(k, _)| k.ends_with(key))
                .map(|(_, v)| v)
                .unwrap_or_else(|| panic!("{} 必须命中", name));
            let m = ms.first().unwrap();
            let content_chars = m.content.chars().count();
            assert!(
                content_chars <= window_bound,
                "{} 行内容必须截断到窗口内，实际 {} 字符",
                name,
                content_chars
            );
            assert!(m.content.contains("needle"), "{} 截断窗口必须包含命中", name);
            assert!(m.end_col <= content_chars, "{} 窗口内列偏移必须一致", name);
            assert_eq!(ms.len(), 1, "{} 单行单匹配（与旧去重语义一致）", name);
        }

        let _ = fs::remove_dir_all(&root);
    }

    /// 载荷上限 T2：单次搜索全局匹配行总数封顶（广泛查询不再产生无界载荷）
    #[test]
    fn total_line_matches_capped() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let root = temp_workspace("cap");
        // 6000 行每行都命中 → 超过上限必须截停
        let body: String = (0..6000).map(|_| "needle line\n").collect();
        fs::write(root.join("many.md"), body).unwrap();

        let re = regex::Regex::new("needle").unwrap();
        let my_gen = SEARCH_GENERATION.load(Ordering::SeqCst);
        let map = walk_and_match(&[root.clone()], &re, my_gen);

        let total: usize = map.values().map(|v| v.len()).sum();
        assert!(
            total <= MAX_TOTAL_LINE_MATCHES,
            "匹配行总数必须封顶 {}，实际 {}",
            MAX_TOTAL_LINE_MATCHES,
            total
        );

        let _ = fs::remove_dir_all(&root);
    }

    /// CPU 资源约束（用户要求占用 ≤50% 甚至更低）：搜索遍历线程数
    /// 不得超过逻辑核数一半，且硬上限 2（多核机器占用更低）
    #[test]
    fn search_thread_count_bounded_for_cpu() {
        let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2);
        let t = search_thread_count();
        assert!(t >= 1, "至少 1 线程，实际 {}", t);
        assert!(t <= 2, "搜索线程硬上限 2（CPU ≤50% 甚至更低），实际 {}", t);
        assert!(
            t * 2 <= cores,
            "线程×2 不得超过逻辑核数（占用 ≤50%）：{} 核 {} 线程",
            cores,
            t
        );
    }

    /// 行顺序确定性：同一文件内行号必须升序
    /// （HashMap into_values 迭代序随机 → 文件内匹配行每次搜索洗牌，同「跳动」缺陷族）
    #[test]
    fn line_matches_sorted_by_line_number() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let root = temp_workspace("lineorder");
        // 100 行每行命中：随机序恰为升序的概率 ≈ 1/100!，可稳定抓到缺陷
        let body: String = (0..100).map(|i| format!("needle {}\n", i)).collect();
        fs::write(root.join("order.md"), body).unwrap();

        let re = regex::Regex::new("needle").unwrap();
        let my_gen = SEARCH_GENERATION.load(Ordering::SeqCst);
        let map = walk_and_match(&[root.clone()], &re, my_gen);

        let ms = map.values().next().expect("order.md 必须命中");
        let numbers: Vec<usize> = ms.iter().map(|m| m.line_number).collect();
        let mut sorted = numbers.clone();
        sorted.sort();
        assert_eq!(numbers, sorted, "文件内匹配行必须按行号升序");

        let _ = fs::remove_dir_all(&root);
    }

    /// P1-2 回归：walk_and_match 对不存在的根不 panic，有效根正常搜索
    /// （search_in_files 层面：存在性失败跳过而非拒绝，全部不可用才报错）
    #[test]
    fn walk_and_match_tolerates_missing_root() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let valid_root = temp_workspace("mixed");
        fs::write(valid_root.join("a.md"), "needle here\n").unwrap();
        // 唯一不存在的根
        let missing_root = std::env::temp_dir()
            .join(format!("sw-absent-root-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));

        let re = regex::Regex::new("needle").unwrap();
        let my_gen = SEARCH_GENERATION.load(Ordering::SeqCst);
        // WalkParallel 对不存在根应跳过或返回空，不 panic
        let map = walk_and_match(&[valid_root.clone(), missing_root.clone()], &re, my_gen);

        assert!(
            map.keys().any(|k| k.ends_with("/a.md")),
            "有效根应正常搜索，实际 keys: {:?}",
            map.keys().collect::<Vec<_>>()
        );

        let _ = fs::remove_dir_all(&valid_root);
    }

    /// A1 回归：被彻底删除的根被跳过而非整单拒绝。
    /// 根被删除时 canonicalize 失败 → 不进白名单；若白名单校验先于 exists 检查，
    /// check_path_in_roots 会走 existing_ancestor 找到父目录后拒绝 → 整个搜索失败。
    /// 期望：跳过被删根，有效根正常保留；越权根仍 fail-closed。
    #[test]
    fn filter_valid_roots_skips_deleted_root() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let root_a = temp_workspace("a1valid");
        fs::write(root_a.join("a.md"), "needle\n").unwrap();
        // 被删除的根：从不创建
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let deleted = std::env::temp_dir().join(format!("sw-a1-deleted-{}-{}", std::process::id(), nanos));
        // 白名单只含根 A（模拟 allowed_roots_multi 对被删根 canonicalize 失败跳过的结果）；
        // 与生产一致须 canonicalize（macOS /tmp → /private/tmp）
        let allowed = vec![std::fs::canonicalize(&root_a).unwrap()];
        // 存在但白名单外的根：用于验证 fail-closed 语义不变
        let outside = std::env::temp_dir().join(format!("sw-a1-outside-{}-{}", std::process::id(), nanos + 1));
        fs::create_dir_all(&outside).unwrap();

        // ① 被删根 + 有效根：跳过被删根，返回有效根
        let res = filter_valid_roots(
            &allowed,
            &[root_a.to_string_lossy().into_owned(), deleted.to_string_lossy().into_owned()],
        );
        assert!(res.is_ok(), "被删根应被跳过而非整单拒绝: {:?}", res.err());
        let valid = res.unwrap();
        assert_eq!(valid.len(), 1, "应只保留有效根 A");

        // ② 全部不可用：报错
        assert!(filter_valid_roots(&allowed, &[deleted.to_string_lossy().into_owned()]).is_err());

        // ③ 存在但白名单外：立即拒绝（fail-closed 安全语义不变）
        assert!(filter_valid_roots(&allowed, &[outside.to_string_lossy().into_owned()]).is_err());

        let _ = fs::remove_dir_all(&root_a);
        let _ = fs::remove_dir_all(&outside);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    // C21 回归：tmp 名唯一（pid + 原子计数 + 纳秒），并发写不互踩
    #[test]
    fn unique_tmp_path_generates_distinct_names() {
        let target = Path::new("/tmp/ws/notes/a.md");
        let a = unique_tmp_path(target);
        let b = unique_tmp_path(target);
        assert_ne!(a, b);
        // 与目标同目录（rename 同盘原子）
        assert_eq!(a.parent(), target.parent());
        // 保留原文件名前缀，.tmp 后缀
        let name = a.file_name().unwrap().to_str().unwrap();
        assert!(name.starts_with(".a.md.") && name.ends_with(".tmp"), "{}", name);
        // 原扩展名不再被 with_extension 改写（旧实现 a.tar.gz → a.tar.tmp）
        let nested = Path::new("/tmp/ws/notes/a.tar.gz");
        let t = unique_tmp_path(nested).file_name().unwrap().to_str().unwrap().to_string();
        assert!(t.starts_with(".a.tar.gz."), "{}", t);
    }
}
