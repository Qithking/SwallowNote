//! 后端图片批量下载服务。
//!
//! 由前端 MarkdownEditor 在用户点击工具栏「下载远程图片」按钮时调用，
//! 统一处理所有远程图片的下载、文件名生成、落盘与相对路径计算。
//! 前端不直接 fetch 图片字节。

use rand::Rng;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// 单张远程图片的下载请求。
#[derive(Debug, Clone, Deserialize)]
pub struct RemoteImageRequest {
    /// 远程图片 URL（http / https）
    pub url: String,
    /// 落盘目录（绝对路径，由前端解析 uploadPath 规则得到）
    pub target_dir: String,
    /// 当前文件所在目录（用于计算相对路径）
    pub file_dir: String,
    /// 工作区根目录（用于计算相对路径的 fallback）
    pub root_path: String,
    /// 可选的文件名 hint（来自 URL 原文件名，预留给后续扩展）
    #[serde(default)]
    #[allow(dead_code)]
    pub name_hint: Option<String>,
}

/// 单张远程图片的下载结果。
#[derive(Debug, Clone, Serialize)]
pub struct RemoteImageResult {
    /// 原始 URL
    pub url: String,
    /// 是否成功
    pub ok: bool,
    /// 写入的绝对路径（仅成功时有值）
    pub local_path: Option<String>,
    /// 基于当前文件目录的相对路径（仅成功时有值）
    pub relative_path: Option<String>,
    /// 生成的文件名（仅成功时有值）
    pub file_name: Option<String>,
    /// 失败信息（仅失败时有值）
    pub error: Option<String>,
}

/// 批量下载入参。
#[derive(Debug, Clone, Deserialize)]
pub struct DownloadImagesPayload {
    pub images: Vec<RemoteImageRequest>,
}

/// 推断文件扩展名：URL path → Content-Type → bin。
fn infer_ext(url: &str, content_type: Option<&str>) -> String {
    // 1. 尝试从 URL 路径推断
    if let Ok(parsed) = url::Url::parse(url) {
        if let Some(path) = parsed.path_segments().and_then(|mut s| s.next_back()) {
            if let Some(dot_idx) = path.rfind('.') {
                let ext = &path[dot_idx + 1..];
                // 限制最大长度，避免异常情况
                if !ext.is_empty() && ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
                    return ext.to_lowercase();
                }
            }
        }
    }

    // 2. 尝试从 Content-Type 推断
    if let Some(ct) = content_type {
        let ct = ct.split(';').next().unwrap_or("").trim().to_lowercase();
        let ext = match ct.as_str() {
            "image/jpeg" | "image/jpg" => "jpg",
            "image/png" => "png",
            "image/gif" => "gif",
            "image/webp" => "webp",
            "image/svg+xml" => "svg",
            "image/bmp" => "bmp",
            "image/ico" | "image/x-icon" => "ico",
            "image/avif" => "avif",
            "image/tiff" => "tiff",
            "application/octet-stream" => "bin",
            _ => return "bin".to_string(),
        };
        return ext.to_string();
    }

    "bin".to_string()
}

/// 生成唯一文件名：${timestamp}-${random}.${ext}
fn generate_file_name(ext: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let random: u32 = rand::thread_rng().gen_range(100_000..999_999);
    format!("{}-{:x}.{}", timestamp, random, ext)
}

/// 计算相对路径：file_dir 优先 → root_path fallback → 仅文件名。
fn compute_relative_path(local_path: &str, file_dir: &str, root_path: &str) -> String {
    let local = local_path.replace('\\', "/");
    let file_dir = file_dir.replace('\\', "/");
    let root_path = root_path.replace('\\', "/");

    if !file_dir.is_empty() && local.starts_with(&file_dir) && local.len() > file_dir.len() {
        let rest = &local[file_dir.len()..];
        let rest = rest.trim_start_matches('/');
        return format!("./{}", rest);
    }
    if !root_path.is_empty() && local.starts_with(&root_path) && local.len() > root_path.len() {
        let rest = &local[root_path.len()..];
        return rest.trim_start_matches('/').to_string();
    }
    PathBuf::from(&local)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| local.clone())
}

/// 单张图片下载 + 落盘（tokio 异步）。
async fn download_one(req: RemoteImageRequest, permit: tokio::sync::OwnedSemaphorePermit) -> (RemoteImageResult, tokio::sync::OwnedSemaphorePermit) {
    // permit 在本函数返回时自动释放（限流槽位归还）
    let result = download_one_inner(req).await;
    (result, permit)
}

/// 单张图片下载 + 落盘（tokio 异步）核心逻辑。
async fn download_one_inner(req: RemoteImageRequest) -> RemoteImageResult {
    let url = req.url.clone();

    // 1. 请求图片
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("SwallowNote/1.0")
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return RemoteImageResult {
                url,
                ok: false,
                local_path: None,
                relative_path: None,
                file_name: None,
                error: Some(format!("build http client failed: {}", e)),
            };
        }
    };

    let response = match client.get(&req.url).send().await {
        Ok(r) => r,
        Err(e) => {
            return RemoteImageResult {
                url,
                ok: false,
                local_path: None,
                relative_path: None,
                file_name: None,
                error: Some(format!("request failed: {}", e)),
            };
        }
    };

    if !response.status().is_success() {
        return RemoteImageResult {
            url,
            ok: false,
            local_path: None,
            relative_path: None,
            file_name: None,
            error: Some(format!("http status {}", response.status().as_u16())),
        };
    }

    // 2. 提取扩展名 + 读取字节
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let bytes = match response.bytes().await {
        Ok(b) => b,
        Err(e) => {
            return RemoteImageResult {
                url,
                ok: false,
                local_path: None,
                relative_path: None,
                file_name: None,
                error: Some(format!("read body failed: {}", e)),
            };
        }
    };

    let ext = infer_ext(&req.url, content_type.as_deref());
    let file_name = generate_file_name(&ext);

    // 3. 确保目标目录存在
    let target_dir = req.target_dir.trim().to_string();
    let target_dir = if target_dir.is_empty() {
        // 兜底：使用 file_dir
        req.file_dir.clone()
    } else {
        target_dir
    };

    if let Err(e) = tokio::fs::create_dir_all(&target_dir).await {
        return RemoteImageResult {
            url,
            ok: false,
            local_path: None,
            relative_path: None,
            file_name: None,
            error: Some(format!("create dir failed: {}", e)),
        };
    }

    let local_path = if target_dir.is_empty() {
        file_name.clone()
    } else {
        format!(
            "{}/{}",
            target_dir.trim_end_matches('/'),
            file_name
        )
    };

    // 4. 写入磁盘
    if let Err(e) = tokio::fs::write(&local_path, &bytes).await {
        return RemoteImageResult {
            url,
            ok: false,
            local_path: None,
            relative_path: None,
            file_name: Some(file_name),
            error: Some(format!("write file failed: {}", e)),
        };
    }

    // 5. 计算相对路径
    let relative_path = compute_relative_path(&local_path, &req.file_dir, &req.root_path);

    RemoteImageResult {
        url,
        ok: true,
        local_path: Some(local_path),
        relative_path: Some(relative_path),
        file_name: Some(file_name),
        error: None,
    }
}

/// 批量下载远程图片命令。
/// 前端传入一组 RemoteImageRequest，后端并发下载并返回每张图片的结果。
/// 并发数受 MAX_CONCURRENT_DOWNLOADS 限制，避免一次性占用过多网络/磁盘资源。
const MAX_CONCURRENT_DOWNLOADS: usize = 3;

#[tauri::command]
pub async fn download_remote_images(
    payload: DownloadImagesPayload,
) -> Result<Vec<RemoteImageResult>, String> {
    // 1. 创建信号量，限制最多 3 个并发下载任务，避免资源占用过大
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_DOWNLOADS));
    let mut tasks = Vec::with_capacity(payload.images.len());

    for req in payload.images.into_iter() {
        // 在启动 task 之前申请 permit；申请后 permit 与 task 绑定
        let permit = match semaphore.clone().acquire_owned().await {
            Ok(p) => p,
            Err(e) => {
                // Semaphore 关闭等异常情况下，整批直接失败并返回当前已积累的 errors
                return Err(format!("acquire download permit failed: {}", e));
            }
        };
        tasks.push(tokio::spawn(download_one(req, permit)));
    }

    let mut results = Vec::with_capacity(tasks.len());
    for handle in tasks {
        // handle 返回 (RemoteImageResult, OwnedSemaphorePermit)，permit 在此处 drop
        match handle.await {
            Ok((result, _permit)) => results.push(result),
            Err(e) => results.push(RemoteImageResult {
                url: String::new(),
                ok: false,
                local_path: None,
                relative_path: None,
                file_name: None,
                error: Some(format!("join task failed: {}", e)),
            }),
        }
    }
    Ok(results)
}
