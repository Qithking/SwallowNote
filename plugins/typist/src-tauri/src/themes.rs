//! Theme definitions for the typist plugin.
//!
//! MVP ships 5 hardcoded themes targeted at the WeChat Official Account
//! editor. Each theme is a `Theme` value containing the colors, fonts and
//! link/heading scales that the `convert` module will inline into every
//! emitted HTML tag. The frontend only stores the `id`; the backend is the
//! single source of truth for visual rules.
//!
//! To add a new theme, add a `match` arm in `get_theme` with a unique
//! `id` and append the matching metadata entry in `list_themes`.

use serde::Serialize;

/// Visual rule set for a single theme. All fields are borrowed `&'static
/// str`s so the value is `Copy` and can be returned from `match` arms
/// without allocation.
#[derive(Clone, Copy, Debug)]
pub struct Theme {
    pub id: &'static str,
    pub name: &'static str,
    pub platform: &'static str,
    /// Default body text color
    pub text: &'static str,
    /// Subtle color for muted text (e.g. blockquote body)
    pub text_muted: &'static str,
    /// Background color for the article
    pub bg: &'static str,
    /// Heading colors for H1..H6 (6 entries)
    pub heading: [&'static str; 6],
    /// Accent color used for links and inline emphasis
    pub accent: &'static str,
    /// Inline `<code>` background color
    pub code_bg: &'static str,
    /// Inline `<code>` text color
    pub code_text: &'static str,
    /// Block `<pre>` background color
    pub pre_bg: &'static str,
    /// Code keyword highlight color (for the simple highlighter)
    pub code_keyword: &'static str,
    /// Code string literal color
    pub code_string: &'static str,
    /// Code comment color
    pub code_comment: &'static str,
    /// Blockquote left border color
    pub blockquote_border: &'static str,
    /// Blockquote background color
    pub blockquote_bg: &'static str,
    /// Table border color
    pub table_border: &'static str,
    /// Table header background
    pub table_head_bg: &'static str,
    /// Font stack (used for `font-family`)
    pub font_family: &'static str,
    /// Use dark text on light bg (true) or light text on dark bg (false)
    pub is_light: bool,
}

/// Theme metadata returned to the frontend by `themes_list`. The CSS
/// payload itself is not exposed; the frontend just needs the id/label.
#[derive(Clone, Debug, Serialize)]
pub struct ThemeMeta {
    pub id: &'static str,
    pub name: &'static str,
    pub platform: &'static str,
}

pub const WECHAT_DEFAULT: Theme = Theme {
    id: "wechat-default",
    name: "公众号默认",
    platform: "wechat",
    text: "#3f3f3f",
    text_muted: "#888888",
    bg: "#ffffff",
    heading: ["#1a1a1a", "#1a1a1a", "#222222", "#2a2a2a", "#333333", "#3a3a3a"],
    accent: "#576b95",
    code_bg: "#f4f4f5",
    code_text: "#c7254e",
    pre_bg: "#f4f4f5",
    code_keyword: "#a626a4",
    code_string: "#50a14f",
    code_comment: "#a0a1a7",
    blockquote_border: "#d0d0d0",
    blockquote_bg: "#f7f7f7",
    table_border: "#dddddd",
    table_head_bg: "#f6f6f6",
    font_family: "-apple-system, BlinkMacSystemFont, \"Helvetica Neue\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif",
    is_light: true,
};

pub const WECHAT_ROSE: Theme = Theme {
    id: "wechat-rose",
    name: "蔷薇紫",
    platform: "wechat",
    text: "#3f3f3f",
    text_muted: "#8e8e93",
    bg: "#ffffff",
    heading: ["#c027d6", "#c027d6", "#a31cad", "#8b1fa0", "#70208f", "#5b207d"],
    accent: "#c027d6",
    code_bg: "#f4f1f8",
    code_text: "#c027d6",
    pre_bg: "#f4f1f8",
    code_keyword: "#a626a4",
    code_string: "#50a14f",
    code_comment: "#a0a1a7",
    blockquote_border: "#c027d6",
    blockquote_bg: "#f9f4fc",
    table_border: "#e6d8ee",
    table_head_bg: "#f4f1f8",
    font_family: "-apple-system, BlinkMacSystemFont, \"Helvetica Neue\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif",
    is_light: true,
};

pub const WECHAT_GEEK: Theme = Theme {
    id: "wechat-geek",
    name: "极客黑",
    platform: "wechat",
    text: "#e4e4e7",
    text_muted: "#a1a1aa",
    bg: "#1e1e22",
    heading: ["#7dd3fc", "#7dd3fc", "#a5f3fc", "#bef264", "#fde047", "#fca5a5"],
    accent: "#7dd3fc",
    code_bg: "#2a2a30",
    code_text: "#f472b6",
    pre_bg: "#27272a",
    code_keyword: "#c084fc",
    code_string: "#86efac",
    code_comment: "#71717a",
    blockquote_border: "#7dd3fc",
    blockquote_bg: "#26262c",
    table_border: "#3f3f46",
    table_head_bg: "#27272a",
    font_family: "\"SF Mono\", \"JetBrains Mono\", Menlo, Monaco, Consolas, \"Courier New\", monospace",
    is_light: false,
};

pub const WECHAT_TECH: Theme = Theme {
    id: "wechat-tech",
    name: "科技蓝",
    platform: "wechat",
    text: "#2c3e50",
    text_muted: "#7f8c8d",
    bg: "#ffffff",
    heading: ["#0066cc", "#0066cc", "#1e88e5", "#1976d2", "#1565c0", "#0d47a1"],
    accent: "#0066cc",
    code_bg: "#eef4fb",
    code_text: "#c7254e",
    pre_bg: "#eef4fb",
    code_keyword: "#0066cc",
    code_string: "#2e7d32",
    code_comment: "#9e9e9e",
    blockquote_border: "#0066cc",
    blockquote_bg: "#f0f6fc",
    table_border: "#bbdefb",
    table_head_bg: "#e3f2fd",
    font_family: "-apple-system, BlinkMacSystemFont, \"Helvetica Neue\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif",
    is_light: true,
};

pub const WECHAT_MINIMAL: Theme = Theme {
    id: "wechat-minimal",
    name: "简约白",
    platform: "wechat",
    text: "#1a1a1a",
    text_muted: "#666666",
    bg: "#ffffff",
    heading: ["#1a1a1a", "#1a1a1a", "#1a1a1a", "#1a1a1a", "#1a1a1a", "#1a1a1a"],
    accent: "#1a1a1a",
    code_bg: "#fafafa",
    code_text: "#d6336c",
    pre_bg: "#fafafa",
    code_keyword: "#d6336c",
    code_string: "#2f9e44",
    code_comment: "#adb5bd",
    blockquote_border: "#e0e0e0",
    blockquote_bg: "#fafafa",
    table_border: "#eeeeee",
    table_head_bg: "#fafafa",
    font_family: "-apple-system, BlinkMacSystemFont, \"Helvetica Neue\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif",
    is_light: true,
};

/// All supported theme constants. Inserted into `get_theme` and
/// `list_themes` macros below. Keep the order stable: it determines the
/// display order in the frontend theme picker.
pub const ALL_THEMES: &[Theme] = &[
    WECHAT_DEFAULT,
    WECHAT_ROSE,
    WECHAT_GEEK,
    WECHAT_TECH,
    WECHAT_MINIMAL,
];

/// Lookup a theme by id. Returns the default theme if id is unknown so
/// the frontend never sees a hard error on a stale selection.
pub fn get_theme(theme_id: &str) -> Theme {
    for t in ALL_THEMES {
        if t.id == theme_id {
            return *t;
        }
    }
    WECHAT_DEFAULT
}

/// Enumerate every theme for `themes_list`. Returns lightweight metadata
/// (no styles) so the payload is small.
pub fn list_themes() -> Vec<ThemeMeta> {
    ALL_THEMES
        .iter()
        .map(|t| ThemeMeta {
            id: t.id,
            name: t.name,
            platform: t.platform,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_theme_returns_matching() {
        let t = get_theme("wechat-rose");
        assert_eq!(t.id, "wechat-rose");
        assert_eq!(t.accent, "#c027d6");
    }

    #[test]
    fn get_theme_falls_back_to_default() {
        let t = get_theme("nope");
        assert_eq!(t.id, "wechat-default");
    }

    #[test]
    fn list_themes_returns_five() {
        let list = list_themes();
        assert_eq!(list.len(), 5);
        assert!(list.iter().any(|t| t.id == "wechat-rose"));
    }
}
