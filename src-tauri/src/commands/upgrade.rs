use futures::StreamExt;
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

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

/// Install the downloaded update and restart the application.
///
/// On macOS:
/// 1. Attach the DMG using hdiutil
/// 2. Find the .app bundle inside the mounted volume
/// 3. Copy it to /Applications, replacing the old version
/// 4. Detach the DMG
/// 5. Launch the new version and exit the current process
///
/// On Windows:
/// Falls back to opening the installer (user handles the rest)
#[tauri::command]
pub async fn install_and_restart(app: AppHandle, dmg_path: String) -> Result<(), String> {
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
                    let mount = line.split('\t').last().unwrap_or("").trim();
                    if mount.starts_with("/Volumes/") {
                        return Some(mount.to_string());
                    }
                }
                None
            })
            .last()
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
        let dest_app = PathBuf::from("/Applications").join(&app_name_str);

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

        // Step 4: Detach the DMG
        let _ = std::process::Command::new("hdiutil")
            .args(["detach", &mount_point, "-force"])
            .output();

        // Step 5: Launch the new version and exit the current process
        let new_app_path = dest_app.to_string_lossy().to_string();
        std::process::Command::new("open")
            .arg(&new_app_path)
            .spawn()
            .map_err(|e| format!("Failed to launch new version: {}", e))?;

        // Give the new process a moment to start, then exit the current app
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(500));
            app.exit(0);
        });

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        // On non-macOS platforms, fall back to just opening the installer
        let _ = app;
        open_installer(dmg_path).await
    }
}