use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

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

#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<FileNode>, String> {
    let path = PathBuf::from(&path);

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

        // Skip hidden files and directories (except .git)
        if file_name.starts_with('.') && file_name != ".git" {
            continue;
        }

        // Skip node_modules and other common ignore patterns
        if file_name == "node_modules" || file_name == ".swallownote" {
            continue;
        }

        let entry_path = entry.path();
        let is_directory = entry_path.is_dir();

        nodes.push(FileNode {
            id: Uuid::new_v4().to_string(),
            name: file_name,
            path: entry_path.to_string_lossy().to_string(),
            is_directory,
            children: None,
        });
    }

    // Sort: directories first, then alphabetically
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

    // Atomic write: write to temp file first, then rename
    let temp_path = path.with_extension("tmp");
    tokio::fs::write(&temp_path, &content)
        .await
        .map_err(|e| format!("Failed to write temporary file: {}", e))?;

    tokio::fs::rename(&temp_path, &path)
        .await
        .map_err(|e| format!("Failed to rename temporary file: {}", e))?;

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

    Ok(path.to_string_lossy().to_string())
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
        StdCommand::new("powershell")
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
            StdCommand::new("explorer")
                .arg(format!("/select,{}", path.display()))
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
        } else {
            StdCommand::new("explorer")
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
