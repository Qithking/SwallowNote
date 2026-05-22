/// Backend i18n module for SwallowNote
/// Embeds translation JSON files at compile time using include_str!,
/// and provides a thread-safe way to get translated messages based on the
/// current locale setting.
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
    let mut translations = TRANSLATIONS.write().unwrap();

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
    let translations = TRANSLATIONS.read().unwrap();

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
    set_locale(&locale);
    Ok(())
}
