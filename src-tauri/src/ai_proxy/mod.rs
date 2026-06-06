pub mod crypto;
pub mod handlers;
pub mod server;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSettings {
    pub provider: String,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub port: u16,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            provider: String::new(),
            api_key: String::new(),
            base_url: String::new(),
            model: String::new(),
            port: 4017,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSettingsUpdate {
    pub provider: Option<String>,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
}

pub struct AiProxyState {
pub settings: RwLock<AiSettings>,
pub client: Client,
}

impl AiProxyState {
pub fn new(settings: AiSettings) -> Self {
Self {
settings: RwLock::new(settings),
client: Client::new(),
}
}
}

pub fn get_provider_base_url(provider: &str, custom_url: &str) -> String {
    match provider {
        "openai" => {
            if custom_url.is_empty() {
                "https://api.openai.com/v1".to_string()
            } else {
                custom_url.trim_end_matches('/').to_string()
            }
        }
        "anthropic" => {
            if custom_url.is_empty() {
                "https://api.anthropic.com/v1".to_string()
            } else {
                custom_url.trim_end_matches('/').to_string()
            }
        }
        "google" => {
            if custom_url.is_empty() {
                "https://generativelanguage.googleapis.com/v1beta".to_string()
            } else {
                custom_url.trim_end_matches('/').to_string()
            }
        }
        "deepseek" => {
            if custom_url.is_empty() {
                "https://api.deepseek.com/v1".to_string()
            } else {
                custom_url.trim_end_matches('/').to_string()
            }
        }
        "ollama" => {
            if custom_url.is_empty() {
                "http://localhost:11434/v1".to_string()
            } else {
                custom_url.trim_end_matches('/').to_string()
            }
        }
        "custom" => custom_url.trim_end_matches('/').to_string(),
        _ => custom_url.trim_end_matches('/').to_string(),
    }
}

pub fn get_provider_models(provider: &str) -> Vec<ModelInfo> {
    match provider {
        "openai" => vec![
            ModelInfo { id: "gpt-4o".into(), name: "GPT-4o".into() },
            ModelInfo { id: "gpt-4o-mini".into(), name: "GPT-4o Mini".into() },
            ModelInfo { id: "gpt-4-turbo".into(), name: "GPT-4 Turbo".into() },
            ModelInfo { id: "gpt-3.5-turbo".into(), name: "GPT-3.5 Turbo".into() },
            ModelInfo { id: "o1".into(), name: "o1".into() },
            ModelInfo { id: "o1-mini".into(), name: "o1 Mini".into() },
            ModelInfo { id: "o3-mini".into(), name: "o3 Mini".into() },
        ],
        "anthropic" => vec![
            ModelInfo { id: "claude-sonnet-4-20250514".into(), name: "Claude Sonnet 4".into() },
            ModelInfo { id: "claude-3-5-sonnet-20241022".into(), name: "Claude 3.5 Sonnet".into() },
            ModelInfo { id: "claude-3-5-haiku-20241022".into(), name: "Claude 3.5 Haiku".into() },
            ModelInfo { id: "claude-3-opus-20240229".into(), name: "Claude 3 Opus".into() },
        ],
        "google" => vec![
            ModelInfo { id: "gemini-2.5-pro".into(), name: "Gemini 2.5 Pro".into() },
            ModelInfo { id: "gemini-2.5-flash".into(), name: "Gemini 2.5 Flash".into() },
            ModelInfo { id: "gemini-2.0-flash".into(), name: "Gemini 2.0 Flash".into() },
            ModelInfo { id: "gemini-1.5-pro".into(), name: "Gemini 1.5 Pro".into() },
        ],
        "deepseek" => vec![
            ModelInfo { id: "deepseek-chat".into(), name: "DeepSeek Chat".into() },
            ModelInfo { id: "deepseek-reasoner".into(), name: "DeepSeek Reasoner".into() },
        ],
        "ollama" => vec![
            ModelInfo { id: "llama3.1".into(), name: "Llama 3.1".into() },
            ModelInfo { id: "qwen2.5".into(), name: "Qwen 2.5".into() },
            ModelInfo { id: "gemma2".into(), name: "Gemma 2".into() },
            ModelInfo { id: "mistral".into(), name: "Mistral".into() },
            ModelInfo { id: "codellama".into(), name: "Code Llama".into() },
        ],
        "custom" => vec![],
        _ => vec![],
    }
}
