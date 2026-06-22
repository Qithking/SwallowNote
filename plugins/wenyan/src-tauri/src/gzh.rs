/**
 * WeChat Official Account API client.
 *
 * Implements the two-step push flow:
 *   1. fetch_access_token() — exchange app_id + app_secret for access_token
 *   2. add_draft() — push article HTML to the draft box
 *
 * Uses reqwest::blocking so the JSON-RPC backend binary stays single-threaded
 * and simple (no async runtime boilerplate).
 *
 * Error messages embed the WeChat API's `errcode` + `errmsg` so the frontend
 * can surface actionable diagnostics (e.g. "40164 invalid ip" → IP whitelist).
 */
use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;

/// Default WeChat API base URL. Overridable via the `api_base_url` param
/// for proxy / testing scenarios.
const DEFAULT_API_BASE: &str = "https://api.weixin.qq.com";

/// HTTP timeout for all WeChat API calls. 30s matches the picgo uploader's
/// limit and is generous enough for large article HTML on slow connections.
const HTTP_TIMEOUT_SECS: u64 = 30;

// ─── Error type ──────────────────────────────────────────────────────────────

/// Application-level error codes used as the `code` field in JSON-RPC error
/// responses. Mirrors the pattern in the export plugin's `convert.rs`.
pub const ERR_ACCESS_TOKEN: i64 = 2001;
pub const ERR_ADD_DRAFT: i64 = 2002;
pub const ERR_NETWORK: i64 = 2003;

#[derive(Debug, Error)]
pub enum GzhError {
    /// access_token request failed (bad app_id/secret, IP not whitelisted, etc.)
    #[error("access_token 获取失败: {0}")]
    AccessToken(String),
    /// draft/add request failed (invalid token, content too large, etc.)
    #[error("草稿推送失败: {0}")]
    AddDraft(String),
    /// Network / transport error (timeout, DNS, connection refused)
    #[error("网络错误: {0}")]
    Network(String),
}

impl GzhError {
    pub fn code(&self) -> i64 {
        match self {
            GzhError::AccessToken(_) => ERR_ACCESS_TOKEN,
            GzhError::AddDraft(_) => ERR_ADD_DRAFT,
            GzhError::Network(_) => ERR_NETWORK,
        }
    }

    /// Format the error message with an `[ERR_CODE=xxx]` prefix that the
    /// frontend can extract via regex (same convention as the export plugin).
    pub fn display_with_code(&self) -> String {
        format!("[ERR_CODE={}] {}", self.code(), self)
    }
}

// ─── WeChat API response types ───────────────────────────────────────────────

/// Response from `/cgi-bin/token`. On success contains `access_token` +
/// `expires_in`; on failure contains `errcode` + `errmsg`.
#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    expires_in: Option<u64>,
    errcode: Option<i64>,
    errmsg: Option<String>,
}

/// Response from `/cgi-bin/draft/add`. On success contains `media_id`;
/// on failure contains `errcode` + `errmsg`.
#[derive(Deserialize)]
struct DraftResponse {
    media_id: Option<String>,
    errcode: Option<i64>,
    errmsg: Option<String>,
}

/// Article payload sent to `/cgi-bin/draft/add`. Field names match the
/// WeChat API spec (snake_case). `need_open_comment` and
/// `only_fans_can_comment` are u32 (0/1) per the API spec.
#[derive(Serialize)]
struct ArticlePayload {
    title: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    thumb_media_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_source_url: Option<String>,
    need_open_comment: u32,
    only_fans_can_comment: u32,
}

#[derive(Serialize)]
struct DraftRequest {
    articles: Vec<ArticlePayload>,
}

// ─── Public API ──────────────────────────────────────────────────────────────

/// Parameters for the push flow. Extracted from the JSON-RPC `params` object
/// in `main.rs`. All string fields are owned so the struct can outlive the
/// JSON-RPC deserialization scope.
pub struct PushParams {
    pub app_id: String,
    pub app_secret: String,
    pub title: String,
    pub content: String,
    pub author: Option<String>,
    pub digest: Option<String>,
    pub thumb_media_id: Option<String>,
    pub content_source_url: Option<String>,
    pub need_open_comment: bool,
    pub only_fans_can_comment: bool,
    pub api_base_url: Option<String>,
}

/// Execute the full push flow: fetch access_token → add draft → return media_id.
pub fn push_to_gzh(params: PushParams) -> Result<String, GzhError> {
    let base_url = params
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(DEFAULT_API_BASE)
        .trim_end_matches('/');

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| GzhError::Network(format!("HTTP client init failed: {}", e)))?;

    let token = fetch_access_token(&client, &params.app_id, &params.app_secret, base_url)?;

    let article = ArticlePayload {
        title: params.title,
        content: params.content,
        thumb_media_id: params.thumb_media_id.filter(|s| !s.trim().is_empty()),
        author: params.author.filter(|s| !s.trim().is_empty()),
        digest: params.digest.filter(|s| !s.trim().is_empty()),
        content_source_url: params.content_source_url.filter(|s| !s.trim().is_empty()),
        need_open_comment: if params.need_open_comment { 1 } else { 0 },
        only_fans_can_comment: if params.only_fans_can_comment { 1 } else { 0 },
    };

    add_draft(&client, &token, article, base_url)
}

// ─── Internal helpers ────────────────────────────────────────────────────────

fn fetch_access_token(
    client: &reqwest::blocking::Client,
    app_id: &str,
    app_secret: &str,
    base_url: &str,
) -> Result<String, GzhError> {
    let url = format!(
        "{}/cgi-bin/token?grant_type=client_credential&appid={}&secret={}",
        base_url, app_id, app_secret
    );

    let resp = client
        .get(&url)
        .send()
        .map_err(|e| GzhError::Network(format!("access_token 请求失败: {}", e)))?;

    let body: TokenResponse = resp
        .json()
        .map_err(|e| GzhError::Network(format!("access_token 响应解析失败: {}", e)))?;

    if let Some(token) = body.access_token {
        return Ok(token);
    }

    // Error response: embed errcode + errmsg for actionable diagnostics.
    let errcode = body.errcode.unwrap_or(-1);
    let errmsg = body.errmsg.unwrap_or_else(|| "unknown error".to_string());
    Err(GzhError::AccessToken(format!(
        "errcode={} {}",
        errcode, errmsg
    )))
}

fn add_draft(
    client: &reqwest::blocking::Client,
    access_token: &str,
    article: ArticlePayload,
    base_url: &str,
) -> Result<String, GzhError> {
    let url = format!("{}/cgi-bin/draft/add?access_token={}", base_url, access_token);

    let payload = DraftRequest {
        articles: vec![article],
    };

    let resp = client
        .post(&url)
        .json(&payload)
        .send()
        .map_err(|e| GzhError::Network(format!("draft/add 请求失败: {}", e)))?;

    let body: DraftResponse = resp
        .json()
        .map_err(|e| GzhError::Network(format!("draft/add 响应解析失败: {}", e)))?;

    if let Some(media_id) = body.media_id {
        return Ok(media_id);
    }

    let errcode = body.errcode.unwrap_or(-1);
    let errmsg = body.errmsg.unwrap_or_else(|| "unknown error".to_string());
    Err(GzhError::AddDraft(format!(
        "errcode={} {}",
        errcode, errmsg
    )))
}
