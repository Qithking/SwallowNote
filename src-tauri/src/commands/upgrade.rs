use futures::StreamExt;
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// Get the current running app bundle path on macOS
#[cfg(target_os = "macos")]
fn get_current_app_bundle_path() -> Option<PathBuf> {
    // Get the path to the current executable
    std::env::current_exe().ok().and_then(|exe_path| {
        // Traverse up to find the .app bundle
        // Path structure: SwallowNote.app/Contents/MacOS/SwallowNote
        let mut path = exe_path;
        while path.parent().is_some() {
            if path.extension().is_some_and(|ext| ext == "app") {
                return Some(path);
            }
            path = path.parent()?.to_path_buf();
        }
        None
    })
}

/// Global lock to prevent concurrent downloads.
/// If a download is already in progress, subsequent calls are rejected.
static IS_DOWNLOADING: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));

#[derive(Debug, Serialize, Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GithubRelease {
    pub tag_name: String,
    pub assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub progress: f64,
    pub downloaded: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadComplete {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[allow(dead_code)]
pub struct DownloadError {
    pub message: String,
}

fn get_default_download_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        dirs::download_dir().unwrap_or_else(|| PathBuf::from("."))
    }
    #[cfg(target_os = "windows")]
    {
        dirs::download_dir().unwrap_or_else(|| PathBuf::from("."))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        PathBuf::from(".")
    }
}

#[tauri::command]
pub async fn download_latest_release(app: AppHandle) -> Result<(), String> {
    // Acquire the download lock – reject if a download is already in progress
    if IS_DOWNLOADING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return Err("A download is already in progress".to_string());
    }

    let result = download_latest_release_inner(&app).await;

    // Always release the lock when done (success or failure)
    IS_DOWNLOADING.store(false, Ordering::SeqCst);
    result
}

/// Inner implementation that performs the actual download.
async fn download_latest_release_inner(app: &AppHandle) -> Result<(), String> {
    let client = Client::builder()
        .user_agent("SwallowNote/0.1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let release_url = "https://api.github.com/repos/Qithking/SwallowNote/releases/latest";

    let response = client
        .get(release_url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if response.status() == 403 {
        return Err("GitHub API rate limited, please try again later".to_string());
    }

    if !response.status().is_success() {
        return Err(format!("Request failed: {}", response.status()));
    }

    let release: GithubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let platform_ext = get_platform_extension();
    let asset = release
        .assets
        .iter()
        .find(|a| a.name.ends_with(platform_ext.as_str()))
        .ok_or_else(|| format!("No {} installer found", platform_ext))?;

    let download_dir = get_default_download_dir();
    let file_path = download_dir.join(&asset.name);

    let response = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    let file = std::fs::File::create(&file_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    let mut writer = std::io::BufWriter::new(file);

    // Throttle progress events: only emit when integer percentage actually changes
    // and at least 500ms has passed since last emit. This prevents UI flickering
    // caused by too-frequent updates with minimal visual change.
    let mut last_emitted_percent: u8 = 0;
    let mut last_emit_time = Instant::now();
    let emit_interval = std::time::Duration::from_millis(500);

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Download error: {}", e))?;
        std::io::Write::write_all(&mut writer, &chunk)
            .map_err(|e| format!("Failed to write file: {}", e))?;
        downloaded += chunk.len() as u64;
        let progress = if total_size > 0 {
            (downloaded as f64 / total_size as f64) * 100.0
        } else {
            0.0
        };
        let current_percent = progress as u8;
        let now = Instant::now();
        // Only emit when: percentage increased AND enough time has passed
        if current_percent > last_emitted_percent && now.duration_since(last_emit_time) >= emit_interval {
            last_emitted_percent = current_percent;
            last_emit_time = now;
            let _ = app.emit("download-progress", DownloadProgress {
                progress: current_percent as f64,
                downloaded,
                total: total_size,
            });
        }
    }

    let _ = app.emit("download-complete", DownloadComplete {
        path: file_path.to_string_lossy().to_string().replace('\\', "/"),
    });

    Ok(())
}

/// Cancel the current download by resetting the lock.
/// This is a safety valve – the main protection is on the frontend side.
#[tauri::command]
pub fn cancel_download() -> Result<(), String> {
    IS_DOWNLOADING.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn open_installer(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open installer: {}", e))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        super::create_command("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("Failed to open installer: {}", e))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Unsupported platform".to_string())
    }
}

#[tauri::command]
pub fn get_platform_extension() -> String {
    #[cfg(target_os = "macos")]
    {
        ".dmg".to_string()
    }
    #[cfg(target_os = "windows")]
    {
        ".exe".to_string()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        String::new()
    }
}

#[tauri::command]
pub fn get_download_dir() -> String {
    dirs::download_dir()
        .map(|p| p.to_string_lossy().to_string().replace('\\', "/"))
        .unwrap_or_else(|| ".".to_string())
}

// 安装下载的更新并重启。macOS：attach DMG → 替换 .app → xattr/lsregister → detach → spawn 重启脚本 → exit。Windows：回退到打开 installer。
#[tauri::command]
pub async fn install_and_restart(_app: AppHandle, dmg_path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let dmg = PathBuf::from(&dmg_path);
        if !dmg.exists() {
            return Err(format!("DMG file not found: {}", dmg_path));
        }

        // Step 1: Attach the DMG
        let attach_output = std::process::Command::new("hdiutil")
            .args(["attach", "-nobrowse", "-noverify", "-noautoopen", &dmg_path])
            .output()
            .map_err(|e| format!("Failed to attach DMG: {}", e))?;

        if !attach_output.status.success() {
            let stderr = String::from_utf8_lossy(&attach_output.stderr);
            return Err(format!("Failed to attach DMG: {}", stderr));
        }

        // Parse the mount point from hdiutil output
        // Output format: "/dev/diskN  Apple_HFS  /Volumes/SwallowNote"
        let attach_str = String::from_utf8_lossy(&attach_output.stdout);
        let mount_point = attach_str
            .lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    // The last part(s) form the mount point path
                    // hdiutil output: tab-separated, last field is mount point
                    let mount = line.split('\t').next_back().unwrap_or("").trim();
                    if mount.starts_with("/Volumes/") {
                        return Some(mount.to_string());
                    }
                }
                None
            })
            .next_back()
            .ok_or_else(|| "Could not determine DMG mount point".to_string())?;

        // Step 2: Find the .app bundle in the mounted volume
        let mount_dir = std::path::Path::new(&mount_point);
        let app_bundle = std::fs::read_dir(mount_dir)
            .map_err(|e| format!("Failed to read mounted volume: {}", e))?
            .filter_map(|entry| entry.ok())
            .find(|entry| {
                entry.path().extension().is_some_and(|ext| ext == "app")
            })
            .ok_or_else(|| "No .app bundle found in DMG".to_string())?;

        let app_name = app_bundle.file_name();
        let app_name_str = app_name.to_string_lossy().to_string();
        let source_app = app_bundle.path();
        
        // Determine the destination path for the app
        // Priority: 1. Current running app location (if it's an .app bundle)
        //          2. /Applications (standard system location)
        let mut dest_app = if let Some(current_bundle) = get_current_app_bundle_path() {
            // If the current running app is in an .app bundle, replace it there
            // This handles cases where the app is in ~/Applications, /Applications, or other locations
            current_bundle
        } else {
            // Fallback to /Applications if we can't determine current location
            PathBuf::from("/Applications").join(&app_name_str)
        };
        
        // Check if we have permission to write to the destination
        // Try to create a test file to verify actual write permissions
        let dest_parent = dest_app.parent().ok_or("Invalid destination path")?;
        let test_file = dest_parent.join(".swallownote_write_test");
        let is_writable = std::fs::File::create(&test_file)
            .and_then(|_| std::fs::remove_file(&test_file))
            .is_ok();
        
        if !is_writable {
            // Try to use /Applications as fallback if current location is not writable
            let fallback_dest = PathBuf::from("/Applications").join(&app_name_str);
            if fallback_dest != dest_app {
                // Verify /Applications is writable too
                let app_test = PathBuf::from("/Applications").join(".swallownote_write_test");
                let app_writable = std::fs::File::create(&app_test)
                    .and_then(|_| std::fs::remove_file(&app_test))
                    .is_ok();
                if app_writable {
                    dest_app = fallback_dest;
                } else {
                    return Err("No writable location found for app installation. Please install manually.".to_string());
                }
            } else {
                return Err("Destination directory is not writable. Please install manually or run with appropriate permissions.".to_string());
            }
        }

        // Step 3: Remove old app and copy new one
        // Remove the old version if it exists
        if dest_app.exists() {
            std::fs::remove_dir_all(&dest_app)
                .map_err(|e| format!("Failed to remove old app: {}", e))?;
        }

        // Copy the new version using ditto (preserves macOS metadata, resource forks, etc.)
        let copy_output = std::process::Command::new("ditto")
            .args(["--noqtn", source_app.to_str().unwrap_or(""), dest_app.to_str().unwrap_or("")])
            .output()
            .map_err(|e| format!("Failed to copy app: {}", e))?;

        if !copy_output.status.success() {
            let stderr = String::from_utf8_lossy(&copy_output.stderr);
            // Try to detach the DMG even if copy failed
            let _ = std::process::Command::new("hdiutil")
                .args(["detach", &mount_point, "-force"])
                .output();
            return Err(format!("Failed to copy app bundle: {}", stderr));
        }

        // Step 4: Remove quarantine extended attributes from the new app
        // 显式 xattr -cr 防 Gatekeeper 拦截。
        let dest_app_str = dest_app.to_string_lossy().to_string();
        let _ = std::process::Command::new("xattr")
            .args(["-cr", &dest_app_str])
            .output();

        // Step 5: Refresh Launch Services registration so macOS recognizes the new app
        // 刷新 Launch Services 注册，避免 open 开到旧 binary。
        let _ = std::process::Command::new("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")
            .args(["-f", &dest_app_str])
            .output();

        // Step 6: Detach the DMG
        let _ = std::process::Command::new("hdiutil")
            .args(["detach", &mount_point, "-force"])
            .output();

        // Step 7: Launch the new version AFTER the current process exits
        // spawn detached helper 脚本：等当前 PID 退出后再 open 新 app。
        let current_pid = std::process::id();
        let new_app_path = dest_app.to_string_lossy().to_string();

        // Create a temporary restart script with timeout protection
        let tmp_dir = std::env::temp_dir();
        let restart_script_path = tmp_dir.join(format!("swallownote_restart_{}.sh", current_pid));
        
        // Build the restart script content - using a more reliable approach
        let script_content = build_restart_script(current_pid, &new_app_path, &app_name_str);
        
        std::fs::write(&restart_script_path, script_content)
            .map_err(|e| format!("Failed to write restart script: {}", e))?;

        // Make the script executable
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&restart_script_path, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| format!("Failed to set script permissions: {}", e))?;
        }

        // Execute the restart script as a fully detached process
        // Using nohup with proper I/O redirection to ensure it survives parent termination
        let script_path_str = restart_script_path.to_string_lossy().to_string();
        std::process::Command::new("bash")
            .args(["-c", &format!(
                "(nohup bash '{}' </dev/null >/dev/null 2>&1 &)",
                script_path_str
            )])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn restart helper: {}", e))?;

        // Step 8: Exit the current app
        // Small delay to ensure the helper script has started and is watching our PID
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1000));
            // Use std::process::exit for a clean exit
            std::process::exit(0);
        });

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        // On non-macOS platforms, fall back to just opening the installer
        open_installer(dmg_path).await
    }
}

/// Build the restart helper script content
#[cfg(target_os = "macos")]
fn build_restart_script(pid: u32, app_path: &str, app_name: &str) -> String {
    format!(r#"#!/bin/bash
# SwallowNote restart helper script
LOG_FILE="$TMPDIR/swallownote_restart_{pid}.log"
APP_PATH="{app_path}"
APP_NAME="{app_name}"
BIN_PATH="$APP_PATH/Contents/MacOS/$APP_NAME"

exec >> "$LOG_FILE" 2>&1
echo "$(date '+%Y-%m-%d %H:%M:%S'): Restart helper started"
echo "App path: $APP_PATH"
echo "Binary path: $BIN_PATH"

# Verify binary exists
if [ ! -f "$BIN_PATH" ]; then
    echo "ERROR: Binary not found at $BIN_PATH"
    ls -la "$APP_PATH/Contents/MacOS/" 2>/dev/null || echo "Cannot list MacOS directory"
    exit 1
fi

# Helper function to check if app is running
check_app_running() {{
    local check_count=0
    while [ $check_count -lt 3 ]; do
        # Method 1: Check by exact process name
        if pgrep -x "$APP_NAME" > /dev/null 2>&1; then
            return 0
        fi
        # Method 2: Check by binary path in ps output
        if ps aux | grep -v grep | grep -q "$BIN_PATH"; then
            return 0
        fi
        # Method 3: Check for any process with the app name (broader match)
        if pgrep -i "$APP_NAME" > /dev/null 2>&1; then
            return 0
        fi
        sleep 1
        check_count=$((check_count + 1))
    done
    return 1
}}

# Wait for the old SwallowNote process to exit (with 30s timeout)
echo "Waiting for old process (PID: {pid}) to exit..."
wait_count=0
while kill -0 {pid} 2>/dev/null; do
    sleep 0.2
    wait_count=$((wait_count + 1))
    if [ $wait_count -ge 150 ]; then
        echo "WARNING: Timeout waiting for old process to exit, continuing anyway"
        break
    fi
done

# Additional pause to ensure all resources are released
echo "Old process exited, waiting for resources to release..."
sleep 2

# Launch the new version
LAUNCH_SUCCESS=false

# Method 1: Use open with the full path (preferred - avoids Launch Services cache issues)
echo "Method 1: Trying open with full path..."
if open "$APP_PATH" 2>/dev/null; then
    echo "open command succeeded, waiting to verify..."
    if check_app_running; then
        echo "SUCCESS: Verified app is running after open"
        LAUNCH_SUCCESS=true
    else
        echo "WARNING: App may not have started properly after open"
    fi
else
    echo "ERROR: open command failed"
fi

# Method 2: If open failed or didn't start properly, try direct binary execution
if [ "$LAUNCH_SUCCESS" = false ] && [ -x "$BIN_PATH" ]; then
    echo "Method 2: Trying direct binary execution..."
    # Use nohup to ensure the process survives this script's termination
    nohup "$BIN_PATH" > /dev/null 2>&1 &
    BIN_PID=$!
    echo "Started binary with PID: $BIN_PID"
    sleep 4
    # Check if process is still running
    if kill -0 $BIN_PID 2>/dev/null; then
        echo "SUCCESS: Binary is running (PID: $BIN_PID)"
        LAUNCH_SUCCESS=true
    else
        echo "ERROR: Direct binary launch failed or process died quickly"
    fi
fi

# Method 3: Last resort - try open -n (new instance) with the app path
if [ "$LAUNCH_SUCCESS" = false ]; then
    echo "Method 3: Trying open -n (new instance)..."
    if open -n "$APP_PATH" 2>/dev/null; then
        if check_app_running; then
            echo "SUCCESS: App launched with open -n"
            LAUNCH_SUCCESS=true
        fi
    fi
fi

if [ "$LAUNCH_SUCCESS" = false ]; then
    echo "FATAL ERROR: All launch methods failed!"
    echo "App path: $APP_PATH"
    echo "Binary path: $BIN_PATH"
    echo "Binary exists: $(test -f "$BIN_PATH" && echo 'yes' || echo 'no')"
    echo "Binary executable: $(test -x "$BIN_PATH" && echo 'yes' || echo 'no')"
    ls -la "$APP_PATH" 2>/dev/null || echo "Cannot list app bundle"
fi

# Clean up this script
rm -f "$0"
"#, pid = pid, app_path = app_path, app_name = app_name)
}

#[cfg(not(target_os = "macos"))]
fn build_restart_script(_pid: u32, _app_path: &str, _app_name: &str) -> String {
    String::new()
}
