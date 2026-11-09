use crate::ai_proxy::{handlers, AiProxyState, AiSettings};
use axum::extract::{Request, State};
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Router;
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;

pub struct AiProxyServer {
    pub shutdown_tx: tokio::sync::oneshot::Sender<()>,
    pub shutdown_handle: tokio::task::JoinHandle<()>,
    pub port: u16,
    /// 本地代理访问令牌，经 Tauri command 返回给 webview
    pub token: String,
}

/// 鉴权中间件：所有 /api/* 请求必须携带与启动时生成的 token 一致的
/// x-ai-proxy-token 请求头，否则 401。防止任意本机网页调用代理
/// 窃取 API Key 或篡改 settings。
async fn auth_middleware(
    State(state): State<Arc<AiProxyState>>,
    req: Request,
    next: Next,
) -> Response {
    let provided = req
        .headers()
        .get("x-ai-proxy-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    // 常量时间比较，避免计时侧信道（防御纵深）
    if !constant_time_eq(provided, &state.token) {
        return (StatusCode::UNAUTHORIZED, "invalid proxy token").into_response();
    }
    next.run(req).await
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

pub async fn start_ai_proxy(settings: AiSettings) -> Result<AiProxyServer, String> {
    let port = settings.port;
    let state = Arc::new(AiProxyState::new(settings));

    // CORS 收敛：仅允许 Tauri webview（macOS/Linux: tauri://localhost、
    // Windows: http://tauri.localhost）与 dev server 的 Origin，
    // 其余网页跨站调用将被浏览器拦截（配合 token 双重防护）。
    let cors = CorsLayer::new()
        .allow_origin([
            HeaderValue::from_static("tauri://localhost"),
            HeaderValue::from_static("http://tauri.localhost"),
            HeaderValue::from_static("http://localhost:1420"),
        ])
        .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            HeaderName::from_static("x-ai-proxy-token"),
        ]);

    let token = state.token.clone();

    let app = Router::new()
        .route("/api/chat", axum::routing::post(handlers::chat_handler))
        .route("/api/models", axum::routing::get(handlers::models_handler))
        .route(
            "/api/settings",
            axum::routing::post(handlers::settings_handler),
        )
        // 先加鉴权（内层），后加 CORS（外层）：CORS preflight OPTIONS
        // 由外层直接响应，实际请求依次经过 CORS → 鉴权 → handler。
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .layer(cors)
        .with_state(state);

    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind port {}: {}", port, e))?;

    let actual_port = listener
        .local_addr()
        .map_err(|e| format!("local_addr failed: {}", e))?
        .port();

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    let shutdown_handle = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .ok();
    });

    Ok(AiProxyServer {
        shutdown_tx,
        shutdown_handle,
        port: actual_port,
        token,
    })
}
