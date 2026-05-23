use crate::ai_proxy::{handlers, AiProxyState, AiSettings};
use axum::Router;
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;

pub struct AiProxyServer {
    pub shutdown_tx: tokio::sync::oneshot::Sender<()>,
    pub shutdown_handle: tokio::task::JoinHandle<()>,
    pub port: u16,
}

pub async fn start_ai_proxy(settings: AiSettings) -> Result<AiProxyServer, String> {
    let port = settings.port;
    let state = Arc::new(AiProxyState::new(settings));

    let app = Router::new()
        .route("/api/chat", axum::routing::post(handlers::chat_handler))
        .route("/api/models", axum::routing::get(handlers::models_handler))
        .route("/api/settings", axum::routing::post(handlers::settings_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind port {}: {}", port, e))?;

    let actual_port = listener.local_addr().unwrap().port();

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
    })
}
