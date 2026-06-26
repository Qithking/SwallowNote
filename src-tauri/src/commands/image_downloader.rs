//! 后端图片批量下载服务。
//!
//! 由前端 MarkdownEditor 在用户点击工具栏「下载远程图片」按钮时调用，
//! 统一处理所有远程图片的下载、文件名生成、落盘与相对路径计算。
//! 前端不直接 fetch 图片字节。
//! 下载过程中通过 `remote-image-download-progress` 事件推送实时进度与速度。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex as TokioMutex;

/// URL in-flight 锁表：同一 URL 的并发请求串行化，保证只下载一次。
/// key 为 URL，value 为对应 URL 专属的异步锁；锁释放后 entry 保留以便复用。
type UrlLockMap = StdMutex<HashMap<String, Arc<TokioMutex<()>>>>;
static URL_LOCKS: OnceLock<UrlLockMap> = OnceLock::new();

/// 获取 URL 对应的异步锁（同一 URL 的并发请求串行化，保证只下载一次）。
/// 不同 URL 之间互不阻塞，仅对同一 URL 的并发请求排队。
fn get_url_lock(url: &str) -> Arc<TokioMutex<()>> {
    let locks = URL_LOCKS.get_or_init(|| StdMutex::new(HashMap::new()));
    // 锁中毒时直接恢复（不会发生在正常流程中），避免 panic 影响下载主流程
    let mut map = locks.lock().unwrap_or_else(|e| e.into_inner());
    map.entry(url.to_string())
        .or_insert_with(|| Arc::new(TokioMutex::new(())))
        .clone()
}

/// 全局共享的 reqwest Client（连接池复用 + 性能更优）。
/// 首次调用时初始化，后续所有下载任务复用同一 client。
fn shared_http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            // 安全：禁止自动跟随重定向，改由 fetch_with_redirect 手动逐跳校验后再跟随，
            // 防止公网 URL 通过 302 跳到 127.0.0.1 等内网地址绕过 SSRF 校验
            .redirect(reqwest::redirect::Policy::none())
            // 连接池配置：默认即可（max_idle_per_host=32）
            .pool_idle_timeout(Duration::from_secs(90))
            // 单次连接空闲超时
            .tcp_keepalive(Duration::from_secs(60))
            // HTTPS：默认接受系统信任链
            .timeout(Duration::from_secs(60)) // 单次请求总超时 60s
            .connect_timeout(Duration::from_secs(15)) // 握手超时 15s
            .user_agent(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            )
            .build()
            .expect("init reqwest client")
    })
}

/// 失败重试次数（首次失败后再重试 N-1 次）。
const RETRY_COUNT: usize = 3;
/// 两次重试之间的初始退避（毫秒），后续指数倍增。
const RETRY_BACKOFF_MS: u64 = 300;
/// 手动跟随重定向的最大次数，超过则视为失败，避免无限重定向。
const MAX_REDIRECTS: usize = 5;

/// 浏览器请求头 Accept：按 q 值递减匹配，CDN/防盗链多按此协商。
const BROWSER_ACCEPT: &str =
    "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
/// 浏览器请求头 Accept-Language：与目标站点常用 zh-CN 优先。
const BROWSER_ACCEPT_LANGUAGE: &str = "zh-CN,zh;q=0.9,en;q=0.8";

/// 判断 HTTP 状态码是否可重试（429 限流 + 5xx 服务器临时错误）。
fn is_retryable_status(code: u16) -> bool {
    code == 429 || (500..600).contains(&code)
}

/// 判断 reqwest 错误是否可重试（超时、握手失败、连接重置、5xx 响应等）。
fn is_retryable_error(err: &reqwest::Error) -> bool {
    if err.is_timeout() || err.is_connect() || err.is_request() {
        return true;
    }
    if let Some(status) = err.status() {
        return is_retryable_status(status.as_u16());
    }
    false
}

/// 判断 IPv4 是否属于私网/环回/链路本地等不可访问范围。
fn is_private_ipv4(ip: &Ipv4Addr) -> bool {
    ip.is_loopback()          // 127.0.0.0/8
        || ip.is_private()    // 10.0.0.0/8、172.16.0.0/12、192.168.0.0/16
        || ip.is_link_local() // 169.254.0.0/16
        || ip.is_unspecified() // 0.0.0.0
        || ip.is_broadcast()   // 255.255.255.255
}

/// 判断 IPv6 是否属于环回/唯一本地/链路本地等不可访问范围。
fn is_private_ipv6(ip: &Ipv6Addr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() {
        // ::1 / ::
        return true;
    }
    let segs = ip.segments();
    // fc00::/7 唯一本地地址：首字节为 0xfc 或 0xfd
    if (segs[0] & 0xfe00) == 0xfc00 {
        return true;
    }
    // fe80::/10 链路本地地址
    if (segs[0] & 0xffc0) == 0xfe80 {
        return true;
    }
    false
}

/// SSRF 校验：仅允许 http/https scheme，并拒绝私网/环回/链路本地 IP 字面量。
/// 注意：简化实现，仅校验 IP 字面量形式的 host，不解析域名（DNS rebinding 不在范围内）。
fn validate_remote_url(raw: &str) -> Result<(), String> {
    let parsed = url::Url::parse(raw).map_err(|e| format!("invalid url: {}", e))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("unsupported scheme: {}", other)),
    }
    let host = parsed.host_str().ok_or_else(|| "missing host".to_string())?;
    // IPv6 字面量在 URL 中以 [::1] 形式出现，host_str 可能带方括号，统一去除
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        if is_private_ipv4(&ip) {
            return Err(format!("private/loopback IPv4 not allowed: {}", ip));
        }
    } else if let Ok(ip) = host.parse::<Ipv6Addr>() {
        if is_private_ipv6(&ip) {
            return Err(format!("private/loopback IPv6 not allowed: {}", ip));
        }
    }
    Ok(())
}

/// 进度事件名（与前端 MarkdownEditor 中 listen() 的事件名一致）。
const PROGRESS_EVENT: &str = "remote-image-download-progress";

/// 单张图片完成事件名（用于前端立即替换 block URL）。
const ITEM_DONE_EVENT: &str = "remote-image-download-item-done";

/// 单张图片完成事件 payload。
#[derive(Debug, Clone, Serialize)]
struct DownloadItemDone {
    /// 原始 URL
    url: String,
    /// 是否成功
    ok: bool,
    /// 下载字节数（成功时为实际大小）
    bytes: u64,
    /// 相对路径（仅成功时有值）
    relative_path: Option<String>,
    /// 文件名（仅成功时有值）
    file_name: Option<String>,
    /// 错误信息（仅失败时有值）
    error: Option<String>,
}

/// 进度事件 payload。
#[derive(Debug, Clone, Serialize)]
struct DownloadProgress {
    /// 已完成数量（含成功 + 失败）
    done: usize,
    /// 总数量
    total: usize,
    /// 当前正在下载的 URL（仅 doing 阶段存在；每张开始时推送）
    current_url: Option<String>,
    /// 阶段："start" | "doing" | "done"
    phase: String,
    /// 已下载字节数（用于计算实时速度）
    bytes_downloaded: u64,
    /// 整批开始到当前的耗时（毫秒）
    elapsed_ms: u64,
}

/// 辅助：构造失败 RemoteImageResult（bytes=0）。
fn err_result(url: String, err: String) -> RemoteImageResult {
    RemoteImageResult {
        url,
        ok: false,
        local_path: None,
        relative_path: None,
        file_name: None,
        error: Some(err),
        bytes: 0,
    }
}

/// 辅助：构造成功 RemoteImageResult。
fn ok_result(
    url: String,
    local_path: String,
    relative_path: String,
    file_name: String,
    bytes: u64,
) -> RemoteImageResult {
    RemoteImageResult {
        url,
        ok: true,
        local_path: Some(local_path),
        relative_path: Some(relative_path),
        file_name: Some(file_name),
        error: None,
        bytes,
    }
}

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
    /// 下载字节数（成功时为实际大小，失败为 0）
    pub bytes: u64,
}

/// 批量下载入参。
#[derive(Debug, Clone, Deserialize)]
pub struct DownloadImagesPayload {
    pub images: Vec<RemoteImageRequest>,
}

/// 仅从 URL 路径推断扩展名（不发 HTTP 请求），无扩展名返回空字符串。
/// 用于在发起 HTTP 请求之前预先确定文件名，以便命中去重缓存。
fn infer_ext_from_url(url: &str) -> String {
    if let Ok(parsed) = url::Url::parse(url) {
        if let Some(path) = parsed.path_segments().and_then(|mut s| s.next_back()) {
            if let Some(dot_idx) = path.rfind('.') {
                let ext = &path[dot_idx + 1..];
                if !ext.is_empty() && ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
                    return ext.to_lowercase();
                }
            }
        }
    }
    String::new()
}

/// 推断文件扩展名：URL path → Content-Type → bin。
fn infer_ext(url: &str, content_type: Option<&str>) -> String {
    if let Ok(parsed) = url::Url::parse(url) {
        if let Some(path) = parsed.path_segments().and_then(|mut s| s.next_back()) {
            if let Some(dot_idx) = path.rfind('.') {
                let ext = &path[dot_idx + 1..];
                if !ext.is_empty() && ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
                    return ext.to_lowercase();
                }
            }
        }
    }

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
            "image/heic" => "heic",
            "image/heif" => "heif",
            "image/apng" => "png",
            "application/octet-stream" => "bin",
            _ => return "bin".to_string(),
        };
        return ext.to_string();
    }

    "bin".to_string()
}

/// 生成基于 URL hash 的文件名：sha256(url) 前 32 hex 字符 + ext。
/// 同一 URL 永远产生同一文件名，天然支持去重。
fn generate_file_name(url: &str, ext: &str) -> String {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    let hash = hasher.finalize();
    // 取前 16 字节（32 hex 字符）作为文件名主体，碰撞概率极低
    let hex: String = hash.iter().take(16).map(|b| format!("{:02x}", b)).collect();
    if ext.is_empty() {
        hex
    } else {
        format!("{}.{}", hex, ext)
    }
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

/// 下载单张图片的上下文（用于累计字节数、开始时间、并发控制）。
struct DownloadContext {
    app_handle: AppHandle,
    bytes_total: Arc<AtomicU64>,
    done_counter: Arc<AtomicUsize>,
    total: usize,
    started_at: Instant,
}

impl DownloadContext {
    /// 构造 DownloadProgress 事件 payload。
    fn build_progress(
        &self,
        phase: &str,
        done: usize,
        current_url: Option<String>,
    ) -> DownloadProgress {
        let bytes = self.bytes_total.load(Ordering::SeqCst);
        let elapsed_ms = self.started_at.elapsed().as_millis() as u64;
        DownloadProgress {
            done,
            total: self.total,
            current_url,
            phase: phase.to_string(),
            bytes_downloaded: bytes,
            elapsed_ms,
        }
    }

    /// 发送进度事件。
    fn emit(&self, payload: DownloadProgress) {
        let _ = self.app_handle.emit(PROGRESS_EVENT, payload);
    }
}

/// 单张图片下载 + 落盘（tokio 异步），负责发送"开始"和"完成"事件并累加字节。
async fn download_one(
    req: RemoteImageRequest,
    permit: tokio::sync::OwnedSemaphorePermit,
    ctx: Arc<DownloadContext>,
) -> (RemoteImageResult, tokio::sync::OwnedSemaphorePermit) {
    // 1. 发送"doing"事件：标识这张图片开始下载（done 还未递增）
    ctx.emit(ctx.build_progress(
        "doing",
        ctx.done_counter.load(Ordering::SeqCst),
        Some(req.url.clone()),
    ));

    // 2. 执行下载（permit 在函数返回时 drop，槽位归还）
    let result = download_one_inner(req).await;

    // 2.5 立即 emit 单张完成事件：前端收到后可以马上替换 block URL，不需等整批
    let _ = ctx.app_handle.emit(
        ITEM_DONE_EVENT,
        DownloadItemDone {
            url: result.url.clone(),
            ok: result.ok,
            bytes: result.bytes,
            relative_path: result.relative_path.clone(),
            file_name: result.file_name.clone(),
            error: result.error.clone(),
        },
    );

    // 3. 累加 done 计数与字节数后再次发送"doing"事件：让前端感知到本张已完成
    let done = ctx.done_counter.fetch_add(1, Ordering::SeqCst) + 1;
    ctx.bytes_total.fetch_add(result.bytes, Ordering::SeqCst);
    ctx.emit(ctx.build_progress("doing", done, None));

    (result, permit)
}

/// 推断图片请求 Referer：使用 URL 自身的 scheme + host，可降低 CDN 防盗链 403 概率。
fn infer_referer(url: &str) -> Option<String> {
    url::Url::parse(url)
        .ok()
        .map(|u| u.origin().ascii_serialization())
}

/// 发送图片下载请求（含浏览器 UA / Referer / Accept），失败时返回 reqwest::Error。
async fn fetch_image_once(url: &str) -> Result<reqwest::Response, reqwest::Error> {
    let client = shared_http_client();
    let mut req = client.get(url).header(
        reqwest::header::ACCEPT,
        reqwest::header::HeaderValue::from_static(BROWSER_ACCEPT),
    );
    req = req.header(
        reqwest::header::ACCEPT_LANGUAGE,
        reqwest::header::HeaderValue::from_static(BROWSER_ACCEPT_LANGUAGE),
    );
    if let Some(referer) = infer_referer(url) {
        if let Ok(v) = reqwest::header::HeaderValue::from_str(&referer) {
            req = req.header(reqwest::header::REFERER, v);
        }
    }

    req.send().await
}

/// 下载过程中的错误分类，用于区分可重试与不可重试错误。
enum DownloadError {
    /// 网络/HTTP 错误，是否重试由 is_retryable_error / is_retryable_status 判断
    Request(reqwest::Error),
    /// 重定向处理错误（含 SSRF 阻断、超过最大跳数等），不可重试
    Redirect(String),
}

/// 发送请求并手动逐跳处理重定向。
/// 因 shared_http_client 已禁用自动重定向，此处对每个 3xx 响应：
/// 1. 解析 Location（支持相对路径，基于当前 URL resolve）
/// 2. 重新调用 validate_remote_url 进行 SSRF 校验
/// 3. 校验通过才跟随，最多跟随 MAX_REDIRECTS 次
/// 这样可防止公网 URL 302 到 127.0.0.1 等内网地址绕过初始 SSRF 校验。
async fn fetch_with_redirect(start_url: &str) -> Result<reqwest::Response, DownloadError> {
    let mut current_url = start_url.to_string();
    let mut redirects = 0usize;
    loop {
        let response = fetch_image_once(&current_url)
            .await
            .map_err(DownloadError::Request)?;
        // 非重定向响应：直接返回（含 2xx 成功与 4xx/5xx 错误，交给上层重试逻辑判断）
        if !response.status().is_redirection() {
            return Ok(response);
        }
        // 超过最大重定向次数：视为失败
        if redirects >= MAX_REDIRECTS {
            return Err(DownloadError::Redirect(format!(
                "too many redirects (max {})",
                MAX_REDIRECTS
            )));
        }
        redirects += 1;
        // 解析 Location header
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| {
                DownloadError::Redirect("redirect without Location header".to_string())
            })?
            .to_string();
        // 基于当前 URL resolve Location（处理相对路径与绝对路径）
        let base = url::Url::parse(&current_url)
            .map_err(|e| DownloadError::Redirect(format!("invalid url: {}", e)))?;
        let next = base
            .join(&location)
            .map_err(|e| DownloadError::Redirect(format!("invalid redirect location: {}", e)))?;
        let next_str = next.as_str().to_string();
        // 关键：对重定向目标重新进行 SSRF 校验，阻止跳向内网地址
        if let Err(e) = validate_remote_url(&next_str) {
            return Err(DownloadError::Redirect(format!(
                "SSRF blocked on redirect: {}",
                e
            )));
        }
        current_url = next_str;
    }
}

/// 请求图片，含 RETRY_COUNT 次重试与指数退避。
/// 重定向由 fetch_with_redirect 手动处理；重定向/SSRF 错误不可重试，立即返回。
/// 返回 Response 或最后一次错误描述字符串。
async fn fetch_image_with_retry(url: &str) -> Result<reqwest::Response, String> {
    let mut attempt = 0usize;

    loop {
        match fetch_with_redirect(url).await {
            Ok(r) if r.status().is_success() => return Ok(r),
            Ok(r) => {
                let status = r.status().as_u16();
                let err = format!("http status {}", status);
                if !is_retryable_status(status) {
                    return Err(err);
                }
                if attempt >= RETRY_COUNT - 1 {
                    return Err(err);
                }
            }
            Err(DownloadError::Redirect(msg)) => {
                // 重定向/SSRF 阻断错误不可重试，直接返回
                return Err(msg);
            }
            Err(DownloadError::Request(e)) => {
                let err = format!("request failed: {}", e);
                if !is_retryable_error(&e) {
                    return Err(err);
                }
                if attempt >= RETRY_COUNT - 1 {
                    return Err(err);
                }
            }
        }

        attempt += 1;
        // 指数退避：300ms / 600ms / ...
        let backoff = RETRY_BACKOFF_MS * (1u64 << attempt.saturating_sub(1));
        tokio::time::sleep(std::time::Duration::from_millis(backoff)).await;
    }
}

/// 对可能尚不存在的路径做规范化：逐级向上找到已存在的祖先 canonicalize 后，
/// 再把剩余路径片段拼回，用于在 create_dir_all 之前校验 target_dir 归属。
fn canonicalize_for_check(path: &Path) -> Option<PathBuf> {
    // 路径已存在：直接 canonicalize
    if let Ok(canon) = path.canonicalize() {
        return Some(canon);
    }
    // 路径不存在：逐级向上找已存在的祖先
    let mut current = path.to_path_buf();
    let mut remaining: Vec<PathBuf> = Vec::new();
    while !current.exists() {
        match current.file_name() {
            Some(name) => remaining.push(PathBuf::from(name)),
            None => return None,
        }
        if !current.pop() {
            return None;
        }
    }
    let mut canon = current.canonicalize().ok()?;
    for part in remaining.into_iter().rev() {
        canon = canon.join(part);
    }
    Some(canon)
}

/// 校验 target_dir 规范化后必须位于 root_path 之内，防止路径穿越。
/// root_path 必须已存在；target_dir 允许不存在（用 canonicalize_for_check 规范化）。
fn resolve_within_root(target_dir: &str, root_path: &str) -> Result<PathBuf, String> {
    let root_canon = PathBuf::from(root_path)
        .canonicalize()
        .map_err(|e| format!("root_path canonicalize failed ({}): {}", root_path, e))?;
    let target_canon = canonicalize_for_check(Path::new(target_dir))
        .ok_or_else(|| format!("target_dir canonicalize failed: {}", target_dir))?;
    // starts_with 按 path 组件比较，可正确处理边界（/foo/bar 不算在 /foo/ba 内）
    if !target_canon.starts_with(&root_canon) {
        return Err(format!(
            "target_dir not within root_path: target={} root={}",
            target_canon.display(),
            root_canon.display()
        ));
    }
    Ok(target_canon)
}

/// 单张图片下载 + 落盘（tokio 异步）核心逻辑。
/// 同一 URL 的并发请求通过 in-flight 锁串行化，保证只下载一次；后续命中已下载文件。
async fn download_one_inner(req: RemoteImageRequest) -> RemoteImageResult {
    let url = req.url.clone();

    // 1. SSRF 校验（锁外，无副作用）：拒绝非 http/https 与私网/环回 IP 字面量
    if let Err(e) = validate_remote_url(&req.url) {
        return err_result(url, format!("SSRF blocked: {}", e));
    }

    // 2. 从 URL 路径推断 ext（锁外，无副作用，不发 HTTP 请求）
    let mut ext = infer_ext_from_url(&req.url);
    let mut file_name = generate_file_name(&req.url, &ext);

    // 3. 确定 target_dir + 路径穿越校验（锁外，无副作用）
    let target_dir = req.target_dir.trim().to_string();
    let target_dir = if target_dir.is_empty() {
        req.file_dir.clone()
    } else {
        target_dir
    };
    // 安全校验（MISS-2）：target_dir 规范化后必须位于 root_path 之内，
    // 防止前端传入任意路径造成路径穿越。root_path 为空时无法校验，跳过（保持原行为）。
    if !target_dir.is_empty() && !req.root_path.trim().is_empty() {
        if let Err(e) = resolve_within_root(&target_dir, &req.root_path) {
            return err_result(url, format!("path traversal blocked: {}", e));
        }
    }

    // 4. 获取 URL in-flight 锁（同一 URL 的并发请求串行化，保证只下载一次）
    //    锁在函数返回时自动释放；SSRF/ext 推断/路径校验无需在锁内
    //    注意：Arc 必须单独绑定到 url_lock，否则临时值在语句结束即释放，
    //    而 MutexGuard 借用了 Arc 内部的 Mutex，会导致编译错误
    let url_lock = get_url_lock(&url);
    let _url_guard = url_lock.lock().await;

    // 5. 计算本地路径
    let local_path = if target_dir.is_empty() {
        file_name.clone()
    } else {
        format!("{}/{}", target_dir.trim_end_matches('/'), file_name)
    };

    // 6. 【锁内】检查文件是否已存在（命中缓存，不发 HTTP 请求，bytes=0）
    if tokio::fs::metadata(&local_path).await.is_ok() {
        let relative_path = compute_relative_path(&local_path, &req.file_dir, &req.root_path);
        return ok_result(url, local_path, relative_path, file_name, 0);
    }

    // 7. 【锁内】请求图片（含重试）+ 读取字节
    let response = match fetch_image_with_retry(&req.url).await {
        Ok(r) => r,
        Err(e) => return err_result(url, e),
    };
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let bytes = match response.bytes().await {
        Ok(b) => b,
        Err(e) => return err_result(url, format!("read body failed: {}", e)),
    };
    let bytes_len = bytes.len() as u64;

    // 8. URL 无扩展名时，用 Content-Type 推断 ext 并更新 file_name
    if ext.is_empty() {
        ext = infer_ext(&req.url, content_type.as_deref());
        file_name = generate_file_name(&req.url, &ext);
    }

    // 9. 【锁内】再次检查文件是否存在（ext 可能变化或并发可能已完成）
    //    file_name 可能已更新，需重新计算 local_path
    let local_path = if target_dir.is_empty() {
        file_name.clone()
    } else {
        format!("{}/{}", target_dir.trim_end_matches('/'), file_name)
    };
    if tokio::fs::metadata(&local_path).await.is_ok() {
        let relative_path = compute_relative_path(&local_path, &req.file_dir, &req.root_path);
        return ok_result(url, local_path, relative_path, file_name, 0);
    }

    // 10. 【锁内】确保目标目录存在
    if let Err(e) = tokio::fs::create_dir_all(&target_dir).await {
        return RemoteImageResult {
            url,
            ok: false,
            local_path: None,
            relative_path: None,
            file_name: Some(file_name),
            error: Some(format!("create dir failed: {}", e)),
            bytes: 0,
        };
    }

    // 11. 【锁内】原子写入：先写 .tmp 文件，成功后重命名，避免残留不完整文件
    let tmp_path = format!("{}.tmp", local_path);
    if let Err(e) = tokio::fs::write(&tmp_path, &bytes).await {
        return RemoteImageResult {
            url,
            ok: false,
            local_path: None,
            relative_path: None,
            file_name: Some(file_name),
            error: Some(format!("write temp file failed: {}", e)),
            bytes: 0,
        };
    }
    if let Err(e) = tokio::fs::rename(&tmp_path, &local_path).await {
        // 重命名失败时清理临时文件
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return RemoteImageResult {
            url,
            ok: false,
            local_path: None,
            relative_path: None,
            file_name: Some(file_name),
            error: Some(format!("rename file failed: {}", e)),
            bytes: 0,
        };
    }

    // 12. 计算相对路径并返回成功
    let relative_path = compute_relative_path(&local_path, &req.file_dir, &req.root_path);
    ok_result(url, local_path, relative_path, file_name, bytes_len)
}

/// 批量下载远程图片命令。
/// 前端传入一组 RemoteImageRequest，后端并发下载并返回每张图片的结果。
/// 并发数受 MAX_CONCURRENT_DOWNLOADS 限制，避免一次性占用过多网络/磁盘资源。
const MAX_CONCURRENT_DOWNLOADS: usize = 6;

#[tauri::command]
pub async fn download_remote_images(
    payload: DownloadImagesPayload,
    app_handle: AppHandle,
) -> Result<Vec<RemoteImageResult>, String> {
    let total = payload.images.len();
    let started_at = Instant::now();
    let bytes_total = Arc::new(AtomicU64::new(0));
    let done_counter = Arc::new(AtomicUsize::new(0));

    let ctx = Arc::new(DownloadContext {
        app_handle: app_handle.clone(),
        bytes_total: bytes_total.clone(),
        done_counter: done_counter.clone(),
        total,
        started_at,
    });

    // 0. 发送 start 事件
    ctx.emit(ctx.build_progress("start", 0, None));

    // 1. 创建信号量，限制最多 MAX_CONCURRENT_DOWNLOADS 个并发下载任务，避免资源占用过大
    let semaphore = Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_DOWNLOADS));
    let mut tasks = Vec::with_capacity(total);

    for req in payload.images.into_iter() {
        // 在启动 task 之前申请 permit；申请后 permit 与 task 绑定
        let permit = match semaphore.clone().acquire_owned().await {
            Ok(p) => p,
            Err(e) => {
                return Err(format!("acquire download permit failed: {}", e));
            }
        };
        tasks.push(tokio::spawn(download_one(
            req,
            permit,
            ctx.clone(),
        )));
    }

    let mut results = Vec::with_capacity(tasks.len());
    for handle in tasks {
        // handle 返回 (RemoteImageResult, OwnedSemaphorePermit)，permit 在此处 drop
        match handle.await {
            Ok((result, _permit)) => results.push(result),
            Err(e) => {
                // task 自身 join 失败也要计入 done 进度
                let done = ctx.done_counter.fetch_add(1, Ordering::SeqCst) + 1;
                ctx.emit(ctx.build_progress("doing", done, None));
                results.push(RemoteImageResult {
                    url: String::new(),
                    ok: false,
                    local_path: None,
                    relative_path: None,
                    file_name: None,
                    error: Some(format!("join task failed: {}", e)),
                    bytes: 0,
                });
            }
        }
    }

    // 2. 发送 done 事件
    ctx.emit(ctx.build_progress("done", total, None));

    Ok(results)
}
