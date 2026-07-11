//! 后端 i18n 模块：编译期嵌入翻译 JSON，提供线程安全 locale 查询。
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::RwLock;

/// Global locale state, defaulting to "zh-CN"
static CURRENT_LOCALE: Lazy<RwLock<String>> = Lazy::new(|| RwLock::new("zh-CN".to_string()));

/// Nested translation map: locale -> (key -> value)
static TRANSLATIONS: Lazy<RwLock<HashMap<String, serde_json::Value>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// Compile-time embedded translation files
/// These are resolved relative to the Cargo.toml directory (src-tauri/)
const ZH_CN_JSON: &str = include_str!("../../src/i18n/locales/zh-CN.json");
const EN_JSON: &str = include_str!("../../src/i18n/locales/en.json");

/// Set the current locale (called from frontend when language changes)
pub fn set_locale(locale: &str) {
    if let Ok(mut current) = CURRENT_LOCALE.write() {
        *current = locale.to_string();
    }
}

/// Get the current locale
pub fn get_locale() -> String {
    CURRENT_LOCALE.read().map(|l| l.clone()).unwrap_or_else(|_| "zh-CN".to_string())
}

/// Initialize translations by parsing the embedded JSON files.
/// This should be called once during app setup.
pub fn init_translations() {
    // 优雅降级：mutex 中毒时不 panic，复用内部 guard，与 t_with_locale 保持一致
    let mut translations = TRANSLATIONS.write().unwrap_or_else(|e| e.into_inner());

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(ZH_CN_JSON) {
        translations.insert("zh-CN".to_string(), value);
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(EN_JSON) {
        translations.insert("en".to_string(), value);
    }
}

/// Get a translated string for the given key using the current locale.
/// Key format: "backend.git.cloneStarted" (dot-separated, maps to nested JSON)
/// Falls back to English, then to the key itself if not found.
pub fn t(key: &str) -> String {
    t_with_locale(key, &get_locale())
}

/// Get a translated string for the given key using the specified locale.
pub fn t_with_locale(key: &str, locale: &str) -> String {
    let translations = TRANSLATIONS.read().unwrap_or_else(|e| e.into_inner());

    // Try the requested locale first
    if let Some(value) = translations.get(locale) {
        if let Some(result) = lookup_nested(value, key) {
            return result;
        }
    }

    // Fall back to English
    if locale != "en" {
        if let Some(value) = translations.get("en") {
            if let Some(result) = lookup_nested(value, key) {
                return result;
            }
        }
    }

    // Fall back to zh-CN
    if locale != "zh-CN" {
        if let Some(value) = translations.get("zh-CN") {
            if let Some(result) = lookup_nested(value, key) {
                return result;
            }
        }
    }

    // Last resort: return the key itself
    key.to_string()
}

/// Look up a dot-separated key in a nested JSON object
fn lookup_nested(value: &serde_json::Value, key: &str) -> Option<String> {
    let parts: Vec<&str> = key.split('.').collect();
    let mut current = value;

    for part in &parts {
        match current {
            serde_json::Value::Object(map) => {
                current = map.get(*part)?;
            }
            _ => return None,
        }
    }

    match current {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

/// Tauri command to set the locale from the frontend
#[tauri::command]
pub fn set_app_locale(locale: String) -> Result<(), String> {
    // 空字符串 locale 会导致 retain 后只保留 "" 和 "en"，误清 zh-CN 翻译，需拦截
    if locale.is_empty() {
        return Err("locale cannot be empty".into());
    }
    set_locale(&locale);
    // 清理 TRANSLATIONS：仅保留当前 locale 与 fallback(en)，移除其他 locale 数据，避免无上限增长。
    // 若目标 locale 不在已加载集合中（例如曾被 retain 清理过），先重新加载编译期嵌入的翻译，
    // 保证切回该 locale 时数据可用，不会因为清理导致翻译丢失。
    if let Ok(mut translations) = TRANSLATIONS.write() {
        if !translations.contains_key(&locale) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(ZH_CN_JSON) {
                translations.insert("zh-CN".to_string(), value);
            }
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(EN_JSON) {
                translations.insert("en".to_string(), value);
            }
        }
        // 仅保留当前 locale 与 en 兜底，其余 locale 数据移除
        translations.retain(|key, _| key == &locale || key == "en");
    }
    Ok(())
}
