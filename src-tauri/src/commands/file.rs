use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Serialize)]
pub struct FileMetadata {
    pub modified_time: String,
    pub file_size: u64,
}

#[tauri::command]
pub async fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
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

#[cfg(target_os = "macos")]
use std::process::Command as StdCommand;

#[cfg(target_os = "windows")]
use std::process::Command as StdCommand;

#[cfg(target_os = "linux")]
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
    pub root_path: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub use_regex: bool,
    pub include_files: Option<String>,  // Glob pattern for files to include
    pub exclude_files: Option<String>,  // Glob pattern for files to exclude
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
fn is_hidden(entry: &tokio::fs::DirEntry) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let file_name = entry.file_name();
    let bytes = file_name.as_os_str().as_bytes();
    if !bytes.is_empty() && bytes[0] == b'.' {
        return true;
    }
    const UF_HIDDEN: u32 = 0x00008000;
    if let Ok(metadata) = std::fs::metadata(entry.path()) {
        use std::os::darwin::fs::MetadataExt;
        if metadata.st_flags() & UF_HIDDEN != 0 {
            return true;
        }
    }
    false
}

#[cfg(target_os = "linux")]
fn is_hidden(entry: &tokio::fs::DirEntry) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let file_name = entry.file_name();
    let bytes = file_name.as_os_str().as_bytes();
    !bytes.is_empty() && bytes[0] == b'.'
}

#[cfg(target_os = "windows")]
fn is_hidden(entry: &tokio::fs::DirEntry) -> bool {
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x00000002;
    if let Ok(metadata) = std::fs::metadata(entry.path()) {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0 {
            return true;
        }
    }
    false
}

#[tauri::command]
pub async fn list_directory(
    path: String,
    show_all_files: Option<bool>,
    markdown_only: Option<bool>,
) -> Result<Vec<FileNode>, String> {
    let path = PathBuf::from(&path);
    let show_all_files = show_all_files.unwrap_or(false);
    let markdown_only = markdown_only.unwrap_or(false);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", path.display()));
    }

    let mut entries = tokio::fs::read_dir(&path)
        .await
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut nodes = Vec::new();

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| format!("Failed to read entry: {}", e))?
    {
        let file_name = entry.file_name().to_string_lossy().to_string();

        if !show_all_files {
            if is_hidden(&entry) {
                continue;
            }
            if file_name == "node_modules" || file_name == ".swallownote" {
                continue;
            }
        }

        let entry_path = entry.path();
        let is_directory = entry_path.is_dir();

        if markdown_only && !is_directory {
            let lower_name = file_name.to_lowercase();
            if !lower_name.ends_with(".md") && !lower_name.ends_with(".markdown") {
                continue;
            }
        }

        // Normalize path separators to forward slashes for cross-platform consistency
        let path_str = entry_path.to_string_lossy().to_string().replace('\\', "/");
        nodes.push(FileNode {
            id: Uuid::new_v4().to_string(),
            name: file_name,
            path: path_str,
            is_directory,
            children: None,
        });
    }

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
pub async fn read_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(&path);

    if !path.exists() {
        return Err(format!("File does not exist: {}", path.display()));
    }

    if !path.is_file() {
        return Err(format!("Path is not a file: {}", path.display()));
    }

    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(&path);

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }

    // On Windows, renaming over an existing file triggers a Remove event in file watchers,
    // which causes the editor tab to close unexpectedly. Use direct write on Windows to avoid this.
    // On macOS/Linux, atomic write (write to temp + rename) is preferred for data safety.
    #[cfg(target_os = "windows")]
    {
        tokio::fs::write(&path, &content)
            .await
            .map_err(|e| format!("Failed to write file: {}", e))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Atomic write: write to temp file first, then rename
        let temp_path = path.with_extension("tmp");
        tokio::fs::write(&temp_path, &content)
            .await
            .map_err(|e| format!("Failed to write temporary file: {}", e))?;

        tokio::fs::rename(&temp_path, &path)
            .await
            .map_err(|e| format!("Failed to rename temporary file: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn write_binary_file(path: String, data: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

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
pub async fn create_file(req: CreateFileRequest) -> Result<String, String> {
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
pub async fn delete_file(path: String) -> Result<(), String> {
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
pub async fn rename_file(req: RenameFileRequest) -> Result<(), String> {
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
pub async fn copy_file(req: RenameFileRequest) -> Result<(), String> {
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
pub async fn copy_file_to_clipboard(path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    #[cfg(target_os = "macos")]
    {
        // Use AppleScript Cocoa bridge to call NSPasteboard directly.
        // This avoids deprecated AppleScript "set the clipboard to" and flaky JXA.
        // Escape double-quotes for AppleScript string literal.
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
            .arg(&format!(
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
        // Use PowerShell to copy file path to clipboard in a format Explorer understands
        let escaped_path = path.display().to_string()
            .replace('"', "\"\"");
        let ps_command = format!(
            r#"Add-Type -AssemblyName System.Windows.Forms;
[System.Windows.Forms.Clipboard]::SetFileDropList(@("{}"));"#,
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
        // Use NSPasteboard via osascript to read file URLs from the clipboard.
        // Use AppleScript's text item delimiters with linefeed to properly handle
        // paths that contain commas (which would otherwise be misinterpreted as list separators).
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
                    // Simple percent-decode for file URIs
                    let uri = &trimmed[7..];
                    let mut decoded = String::with_capacity(uri.len());
                    let mut chars = uri.chars();
                    while let Some(c) = chars.next() {
                        if c == '%' {
                            let hex: String = chars.by_ref().take(2).collect();
                            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                                decoded.push(byte as char);
                            } else {
                                decoded.push('%');
                                decoded.push_str(&hex);
                            }
                        } else {
                            decoded.push(c);
                        }
                    }
                    decoded
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
pub async fn open_in_finder(path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    // Determine the folder to open
    let target = if path.is_dir() {
        path.clone()
    } else {
        path.parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| path.clone())
    };

    #[cfg(target_os = "macos")]
    {
        if path.is_file() {
            // open -R opens Finder and selects the file
            StdCommand::new("open")
                .arg("-R")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
        } else {
            StdCommand::new("open")
                .arg(&target)
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
        }
    }

    #[cfg(target_os = "windows")]
    {
        // explorer /select,<file> opens Explorer and selects the file
        if path.is_file() {
            super::create_command("explorer")
                .arg(format!("/select,{}", path.display()))
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
        } else {
            super::create_command("explorer")
                .arg(&target)
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
        }
    }

    #[cfg(target_os = "linux")]
    StdCommand::new("xdg-open")
        .arg(&target)
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn search_in_files(req: SearchRequest) -> Result<Vec<SearchResult>, String> {
    use std::sync::Arc;
    use std::sync::Mutex;
    use std::io::BufRead;
    use std::io::BufReader;

    let root = PathBuf::from(&req.root_path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("Invalid root path: {}", root.display()));
    }

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

    let file_matches: Arc<Mutex<std::collections::HashMap<String, Vec<LineMatch>>>> = 
        Arc::new(Mutex::new(std::collections::HashMap::new()));

    // Run the blocking file I/O on a separate thread to avoid blocking the tokio runtime
    let file_matches_clone = file_matches.clone();
    tokio::task::spawn_blocking(move || {
        fn collect_files(dir: &Path, files: &mut Vec<PathBuf>) {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let file_name = entry.file_name();
                    let name = file_name.to_string_lossy();
                    if name.starts_with('.') {
                        continue;
                    }
                    if matches!(name.as_ref(), "node_modules" | "target" | "dist" | "build" | ".swallownote" | "__pycache__" | ".next" | ".nuxt") {
                        continue;
                    }
                    let path = entry.path();
                    if path.is_dir() {
                        collect_files(&path, files);
                    } else {
                        files.push(path);
                    }
                }
            }
        }

        let mut all_files = Vec::new();
        collect_files(&root, &mut all_files);

        for path in all_files {
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
                    continue;
                }
            }

            let path_str = path.to_string_lossy().to_string().replace('\\', "/");
            
            if let Ok(file) = std::fs::File::open(&path) {
                let reader = BufReader::new(file);
                let lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();
                
                let mut line_matches: Vec<LineMatch> = Vec::new();
                
                for (idx, line) in lines.iter().enumerate() {
                    for mat in regex.find_iter(line) {
                        line_matches.push(LineMatch {
                            line_number: idx + 1,
                            content: line.clone(),
                            start_col: mat.start(),
                            end_col: mat.end(),
                        });
                    }
                }

                if !line_matches.is_empty() {
                    let mut matches_map = file_matches_clone.lock().unwrap();
                    let mut line_map: std::collections::HashMap<usize, LineMatch> = std::collections::HashMap::new();
                    for m in line_matches {
                        line_map.entry(m.line_number).or_insert(m);
                    }
                    let unique: Vec<LineMatch> = line_map.into_values().collect();
                    if !unique.is_empty() {
                        matches_map.insert(path_str, unique);
                    }
                }
            }
        }
    }).await.map_err(|e| format!("Search task failed: {}", e))?;

    let matches_map = file_matches.lock().unwrap();
    let results: Vec<SearchResult> = matches_map.iter()
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

    Ok(results)
}
