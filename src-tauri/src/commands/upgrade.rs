use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

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
        .map_err(|e| format!("请求失败: {}", e))?;

    if response.status() == 403 {
        return Err("GitHub API 限流，请稍后重试".to_string());
    }

    if !response.status().is_success() {
        return Err(format!("请求失败: {}", response.status()));
    }

    let release: GithubRelease = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let platform_ext = get_platform_extension();
    let asset = release
        .assets
        .iter()
        .find(|a| a.name.ends_with(platform_ext.as_str()))
        .ok_or_else(|| format!("未找到 {} 安装包", platform_ext))?;

    let download_dir = get_default_download_dir();
    let file_path = download_dir.join(&asset.name);

    let response = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    let file = std::fs::File::create(&file_path)
        .map_err(|e| format!("创建文件失败: {}", e))?;
    let mut writer = std::io::BufWriter::new(file);

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("下载出错: {}", e))?;
        std::io::Write::write_all(&mut writer, &chunk)
            .map_err(|e| format!("写入文件失败: {}", e))?;
        downloaded += chunk.len() as u64;
        let progress = if total_size > 0 {
            (downloaded as f64 / total_size as f64) * 100.0
        } else {
            0.0
        };
        let _ = app.emit("download-progress", DownloadProgress {
            progress,
            downloaded,
            total: total_size,
        });
    }

    let _ = app.emit("download-complete", DownloadComplete {
        path: file_path.to_string_lossy().to_string(),
    });

    Ok(())
}

#[tauri::command]
pub async fn open_installer(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开安装包失败: {}", e))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("打开安装包失败: {}", e))?;
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
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string())
}