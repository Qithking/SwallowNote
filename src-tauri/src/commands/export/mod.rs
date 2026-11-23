//! 宿主导出原语模块（宿主原语路线 C1）。
//!
//! 从导出插件 `package/export/src-tauri` 迁移转换引擎（convert.rs +
//! math.rs + docx_postprocess.rs），剥离 JSON-RPC 协议层，改造为：
//! - **主题参数化**：`ExportTheme` 由前端采集当前生效主题值传入，样式跟随主题；
//! - **图片读取迁入宿主**：命令收 `note_path` 自行解析相对路径图片并嵌入，
//!   读取范围经 fs_guard 白名单校验（工作区根 + 应用数据目录）；
//! - **对话框选位（方案 E 修订）**：导出经系统保存对话框选择存储位置，
//!   默认预填系统下载目录；用户取消则导出中止（`__cancelled__` 标记，
//!   前端静默处理）。
//!
//! fs_guard 豁免登记（services/fs_guard.rs `EXEMPTED_COMMANDS`）：
//! `export_docx` / `export_html` / `open_print_preview` — 写入目标是用户经
//! 系统保存对话框显式选择的路径（默认预填下载目录，用户对落盘位置有明确
//! 意图），白名单校验不适用；图片等输入读取仍走 ensure_path_allowed。
//!
//! 核心转换函数保持无 Tauri 依赖（原样迁移单测）。

pub mod docx_postprocess;
pub mod math;

use base64::Engine;
use docx_rs::*;
use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use thiserror::Error;

/// English Metric Units per inch. The OOXML drawing spec measures
/// image dimensions in EMUs (1 inch = 914 400 EMUs); the
/// `Pic::size` method takes a width/height pair in EMU.
const EMU_PER_INCH: u32 = 914_400;
/// Default DOCX image width in inches. The image height is
/// computed by `Pic::new` from the image bytes themselves, so
/// we only specify the width and let the height be derived.
const DEFAULT_IMAGE_WIDTH_INCH: u32 = 6;

/// HTML 打印预览自动唤起系统打印对话框的注入脚本
const AUTO_PRINT_SCRIPT: &str = "<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},300);});</script>";

// Reject obviously oversized inputs to avoid hanging the worker on
// a huge conversion. 5 MiB is far above any real document size and
// small enough that pulldown-cmark handles it in a few hundred ms
// on commodity hardware.
const MAX_MARKDOWN_BYTES: usize = 5 * 1024 * 1024;

// ─── 主题 ────────────────────────────────────────────────────────────────────

/// 导出主题值（camelCase，由前端 `collectExportTheme()` 采集当前生效值传入）。
/// 数值均为 px；颜色均为 CSS 颜色字符串（#RGB/#RRGGBB/rgb()/rgba() 均可）。
#[derive(Debug, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ExportTheme {
    pub body_font: String,
    pub body_size: f64,
    pub line_height: f64,
    pub h1_size: f64,
    pub h2_size: f64,
    pub h3_size: f64,
    pub h4_size: f64,
    pub h5_size: f64,
    pub text_color: String,
    pub link_color: String,
    pub border_color: String,
    pub code_font: String,
    pub code_size: f64,
    pub code_bg: String,
    pub quote_color: String,
    pub table_header_bg: String,
}

impl Default for ExportTheme {
    fn default() -> Self {
        Self {
            body_font: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Helvetica, Arial, \"PingFang SC\", \"Microsoft YaHei\", sans-serif".to_string(),
            body_size: 14.0,
            line_height: 1.6,
            h1_size: 32.0,
            h2_size: 24.0,
            h3_size: 19.0,
            h4_size: 16.0,
            h5_size: 14.0,
            text_color: "#333333".to_string(),
            link_color: "#0366d6".to_string(),
            border_color: "#dddddd".to_string(),
            code_font: "\"SF Mono\", Menlo, Monaco, \"Courier New\", monospace".to_string(),
            code_size: 12.0,
            code_bg: "#f6f8fa".to_string(),
            quote_color: "#666666".to_string(),
            table_header_bg: "#f6f8fa".to_string(),
        }
    }
}

// ─── Error type ──────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum ExportError {
    #[error("DOCX generation failed: {0}")]
    DocxGeneration(String),
    #[error("Markdown too large: {size} bytes (max {max})")]
    MarkdownTooLarge { size: usize, max: usize },
}

// ─── 主题值 → DOCX/HTML 渲染常量 ─────────────────────────────────────────────

/// 通用字体关键字（DOCX 侧不可直接使用，跳过）
const GENERIC_FONT_KEYWORDS: &[&str] = &[
    "sans-serif",
    "serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
    "-apple-system",
    "blinkmacsystemfont",
];

/// CJK 字体识别关键词（小写比较）
const CJK_FONT_KEYWORDS: &[&str] = &[
    "pingfang",
    "yahei",
    "heiti",
    "songti",
    "simsun",
    "simhei",
    "kaiti",
    "fangsong",
    "wenquanyi",
    "noto sans cjk",
    "noto serif cjk",
    "微软雅黑",
    "宋体",
    "黑体",
    "楷体",
];

/// 从 CSS font-family 栈中取出第一个可用于 DOCX 的具体字体名，
/// 跳过系统关键字/通用族。找不到时返回 None（调用方回退默认字体）。
fn first_font_family(stack: &str) -> Option<String> {
    stack.split(',').find_map(|item| {
        let name = item.trim().trim_matches('"').trim_matches('\'').trim();
        if name.is_empty() {
            return None;
        }
        let lower = name.to_ascii_lowercase();
        if GENERIC_FONT_KEYWORDS.iter().any(|k| lower == *k) || lower.starts_with("ui-") {
            return None;
        }
        Some(name.to_string())
    })
}

/// 从 CSS font-family 栈中找出第一个 CJK 字体（东亚文字用）。
fn find_cjk_font(stack: &str) -> Option<String> {
    stack.split(',').find_map(|item| {
        let name = item.trim().trim_matches('"').trim_matches('\'').trim();
        if name.is_empty() {
            return None;
        }
        let lower = name.to_ascii_lowercase();
        if CJK_FONT_KEYWORDS.iter().any(|k| lower.contains(k)) {
            Some(name.to_string())
        } else {
            None
        }
    })
}

/// px 字号 → OOXML 半磅（half-points）：pt = px * 0.75，half = pt * 2
fn px_to_half_points(px: f64) -> usize {
    (px * 1.5).round().max(1.0) as usize
}

/// CSS 颜色 → 6 位十六进制（无 #，DOCX 要求）。
/// 支持 #RGB / #RRGGBB / rgb() / rgba()；无法解析时回退 fallback。
fn css_color_to_hex(s: &str, fallback: &str) -> String {
    let s = s.trim();
    if let Some(hex) = s.strip_prefix('#') {
        let hex = hex.trim();
        if hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return hex.to_ascii_lowercase();
        }
        if hex.len() == 3 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
            // #ABC → AABBCC
            return hex
                .chars()
                .flat_map(|c| [c, c])
                .collect::<String>()
                .to_ascii_lowercase();
        }
        return fallback.to_string();
    }
    // rgb(r, g, b) / rgba(r, g, b, a)
    let lower = s.to_ascii_lowercase();
    if lower.starts_with("rgb") {
        let inner = match (lower.find('('), lower.rfind(')')) {
            (Some(a), Some(b)) if b > a => &lower[a + 1..b],
            _ => return fallback.to_string(),
        };
        let nums: Vec<u32> = inner
            .split(',')
            .filter_map(|p| {
                let p = p.trim().trim_end_matches('%');
                p.parse::<f64>().ok().map(|v| v.round().clamp(0.0, 255.0) as u32)
            })
            .collect();
        if nums.len() >= 3 {
            return format!("{:02x}{:02x}{:02x}", nums[0], nums[1], nums[2]);
        }
    }
    fallback.to_string()
}

/// 从 `ExportTheme` 预计算的 DOCX 渲染常量（半磅字号、字体名、无#十六进制色）
struct DocxStyle {
    latin_font: String,
    east_asia_font: String,
    mono_font: String,
    body_half: usize,
    code_half: usize,
    h_halves: [usize; 6],
    text_hex: String,
    link_hex: String,
    border_hex: String,
    quote_hex: String,
    code_bg_hex: String,
    table_header_hex: String,
}

impl DocxStyle {
    fn from_theme(theme: &ExportTheme) -> Self {
        let latin_font = first_font_family(&theme.body_font).unwrap_or_else(|| "Calibri".into());
        let east_asia_font = find_cjk_font(&theme.body_font).unwrap_or_else(|| "SimSun".into());
        let mono_font =
            first_font_family(&theme.code_font).unwrap_or_else(|| "Courier New".into());
        Self {
            latin_font,
            east_asia_font,
            mono_font,
            body_half: px_to_half_points(theme.body_size),
            code_half: px_to_half_points(theme.code_size),
            h_halves: [
                px_to_half_points(theme.h1_size),
                px_to_half_points(theme.h2_size),
                px_to_half_points(theme.h3_size),
                px_to_half_points(theme.h4_size),
                px_to_half_points(theme.h5_size),
                px_to_half_points(theme.h5_size), // H6 主题未定义，沿用 H5
            ],
            text_hex: css_color_to_hex(&theme.text_color, "333333"),
            link_hex: css_color_to_hex(&theme.link_color, "0366d6"),
            border_hex: css_color_to_hex(&theme.border_color, "dddddd"),
            quote_hex: css_color_to_hex(&theme.quote_color, "666666"),
            code_bg_hex: css_color_to_hex(&theme.code_bg, "f6f8fa"),
            table_header_hex: css_color_to_hex(&theme.table_header_bg, "f6f8fa"),
        }
    }

    /// 组装 CJK/Latin 字体对（东亚字符用 CJK 字体，拉丁用正文字体）
    fn run_fonts(&self) -> RunFonts {
        RunFonts::new()
            .east_asia(&self.east_asia_font)
            .ascii(&self.latin_font)
    }

    fn mono_fonts(&self) -> RunFonts {
        RunFonts::new()
            .east_asia(&self.mono_font)
            .ascii(&self.mono_font)
    }
}

// ─── Core functions ──────────────────────────────────────────────────────────

/// Convert a Markdown string to a DOCX file and return raw bytes.
///
/// `image_assets` is a map from image URL (as it appears in the markdown)
/// to raw image bytes. When an `Inline::Image` is rendered and its `url`
/// is present in the map, the bytes are embedded as a real DOCX drawing
/// element; otherwise the renderer falls back to the textual placeholder.
///
/// `rendered_assets` 是前端预渲染的 mermaid/katex/markmap PNG 字节，
/// 键为 `{ "__mermaid_0__": bytes, ... }`（命令层已解码 base64）。
pub fn markdown_to_docx(
    markdown: String,
    image_assets: HashMap<String, Vec<u8>>,
    rendered_assets: HashMap<String, Vec<u8>>,
    theme: &ExportTheme,
) -> Result<Vec<u8>, ExportError> {
    if markdown.len() > MAX_MARKDOWN_BYTES {
        return Err(ExportError::MarkdownTooLarge {
            size: markdown.len(),
            max: MAX_MARKDOWN_BYTES,
        });
    }
    let (doc, math_blocks) = build_docx(&markdown, &image_assets, &rendered_assets, theme)?;
    let mut buf = Cursor::new(Vec::new());
    doc.build()
        .pack(&mut buf)
        .map_err(|e| ExportError::DocxGeneration(format!("docx-rs pack failed: {}", e)))?;

    // 如果有数学块，进行 ZIP 后处理注入 OMML
    let bytes = if math_blocks.is_empty() {
        buf.into_inner()
    } else {
        docx_postprocess::inject_omml(&buf.into_inner(), &math_blocks)
            .map_err(|e| ExportError::DocxGeneration(format!("OMML injection failed: {}", e)))?
    };

    Ok(bytes)
}

/// Convert a Markdown string to styled HTML (for print preview / PDF via
/// system print dialog / standalone .html export). Returns a complete HTML
/// document with theme-interpolated CSS.
///
/// `rendered_svg` 是前端预渲染的 mermaid/katex/markmap SVG 片段，
/// 格式为 `{ "__mermaid_0__": "<svg ...>...</svg>", ... }`；对应代码块
/// 被替换为内嵌渲染产物（离线可用，不再依赖在线 mermaid.js）。
/// `image_data_uris` 是已解析为 data: URI 的本地图片映射（相对路径图片内嵌）。
pub fn markdown_to_html(
    markdown: String,
    theme: &ExportTheme,
    rendered_svg: &HashMap<String, String>,
    image_data_uris: &HashMap<String, String>,
) -> Result<String, ExportError> {
    if markdown.len() > MAX_MARKDOWN_BYTES {
        return Err(ExportError::MarkdownTooLarge {
            size: markdown.len(),
            max: MAX_MARKDOWN_BYTES,
        });
    }

    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(&markdown, options);
    let mut html_output = String::new();
    pulldown_cmark::html::push_html(&mut html_output, parser);

    // 自定义渲染块（mermaid/katex/markmap）替换为内嵌 SVG 渲染产物
    let html_output = replace_rendered_blocks(&html_output, rendered_svg);
    // 相对路径图片替换为 data: URI（导出的 .html 单文件离线可见）
    let html_output = embed_image_data_uris(&html_output, image_data_uris);

    let html_doc = format!(
        r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{
    font-family: {body_font};
    font-size: {body_size}px;
    line-height: {line_height};
    color: {text};
    width: 794px;
    margin: 0 auto;
    padding: 20px;
    box-sizing: border-box;
    background: #fff;
  }}
  h1 {{ font-size: {h1}px; margin: 24px 0 16px; border-bottom: 1px solid {border}; padding-bottom: 8px; page-break-after: avoid; }}
  h2 {{ font-size: {h2}px; margin: 20px 0 12px; border-bottom: 1px solid {border}; padding-bottom: 6px; page-break-after: avoid; }}
  h3 {{ font-size: {h3}px; margin: 16px 0 8px; page-break-after: avoid; }}
  h4 {{ font-size: {h4}px; margin: 14px 0 6px; page-break-after: avoid; }}
  h5 {{ font-size: {h5}px; margin: 12px 0 4px; page-break-after: avoid; }}
  h6 {{ font-size: {h5}px; margin: 10px 0 4px; color: {quote}; page-break-after: avoid; }}
  p {{ margin: 8px 0; }}
  code {{
    font-family: {code_font};
    font-size: {code_size}px;
    background: {code_bg};
    padding: 2px 6px;
    border-radius: 3px;
  }}
  pre {{
    background: {code_bg};
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    page-break-inside: avoid;
  }}
  pre code {{
    background: none;
    padding: 0;
  }}
  blockquote {{
    border-left: 4px solid {border};
    margin: 8px 0;
    padding: 4px 16px;
    color: {quote};
    page-break-inside: avoid;
  }}
  table {{
    border-collapse: collapse;
    width: 100%;
    margin: 12px 0;
    page-break-inside: avoid;
  }}
  th, td {{
    border: 1px solid {border};
    padding: 6px 12px;
    text-align: left;
  }}
  th {{
    background: {table_header_bg};
    font-weight: bold;
  }}
  ul, ol {{
    padding-left: 24px;
    margin: 8px 0;
  }}
  li {{ margin: 4px 0; }}
  hr {{ border: none; border-top: 1px solid {border}; margin: 16px 0; }}
  img {{ max-width: 100%; height: auto; page-break-inside: avoid; }}
  a {{ color: {link}; text-decoration: none; }}
  del {{ text-decoration: line-through; color: {quote}; }}
</style>
</head>
<body>
{body}
</body>
</html>"#,
        body_font = theme.body_font,
        body_size = theme.body_size,
        line_height = theme.line_height,
        text = theme.text_color,
        h1 = theme.h1_size,
        h2 = theme.h2_size,
        h3 = theme.h3_size,
        h4 = theme.h4_size,
        h5 = theme.h5_size,
        border = theme.border_color,
        code_font = theme.code_font,
        code_size = theme.code_size,
        code_bg = theme.code_bg,
        quote = theme.quote_color,
        table_header_bg = theme.table_header_bg,
        link = theme.link_color,
        body = html_output,
    );

    Ok(html_doc)
}

/// 将 pulldown 输出 HTML 中的 mermaid/katex/markmap 代码块替换为
/// 前端预渲染的 SVG 片段。计数约定与 DOCX 路径一致：按文档顺序对
/// 三类代码块统一编号 N，资源键为 `__{lang}_{N}__`；缺失资源的
/// 代码块保留原始 `<pre>` 内容（源码兜底）。
fn replace_rendered_blocks(html: &str, assets: &HashMap<String, String>) -> String {
    const LANGS: [&str; 3] = ["mermaid", "katex", "markmap"];
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    let mut idx = 0usize;

    loop {
        // 找到最早出现的三类代码块之一
        let mut earliest: Option<(usize, &str)> = None;
        for lang in LANGS {
            let open = format!("<pre><code class=\"language-{}\"", lang);
            if let Some(pos) = rest.find(&open) {
                if earliest.map(|(p, _)| pos < p).unwrap_or(true) {
                    earliest = Some((pos, lang));
                }
            }
        }
        let Some((pos, lang)) = earliest else {
            out.push_str(rest);
            break;
        };

        let code_end = rest[pos..].find("</code></pre>").map(|i| pos + i + "</code></pre>".len());
        let Some(end) = code_end else {
            // 未闭合（畸形 HTML），剩余原样保留
            out.push_str(rest);
            break;
        };

        out.push_str(&rest[..pos]);
        match assets.get(&format!("__{}_{}__", lang, idx)) {
            Some(svg) => out.push_str(svg),
            // 缺失渲染资源 → 保留原代码块（源码兜底）
            None => out.push_str(&rest[pos..end]),
        }
        rest = &rest[end..];
        idx += 1;
    }
    out
}

/// 将 HTML 中已解析的相对路径图片 `src` 替换为 data: URI。
/// URL 中的 `&` 在 HTML 输出中会被转义为 `&amp;`，两种形态都尝试替换。
fn embed_image_data_uris(html: &str, data_uris: &HashMap<String, String>) -> String {
    let mut out = html.to_string();
    for (url, uri) in data_uris {
        let plain = format!("src=\"{}\"", url);
        let escaped = format!("src=\"{}\"", url.replace('&', "&amp;"));
        let replacement = format!("src=\"{}\"", uri);
        if out.contains(&plain) {
            out = out.replace(&plain, &replacement);
        } else if out.contains(&escaped) {
            out = out.replace(&escaped, &replacement);
        }
    }
    out
}

// ─── Intermediate types ──────────────────────────────────────────────────────

#[derive(Clone, Debug)]
enum Inline {
    Text(String),
    Bold(String),
    Italic(String),
    BoldItalic(String),
    /// Inline code span, holds the text verbatim.
    Code(String),
    /// ~~strikethrough~~ run, resolved text after the closing tag.
    Strike(String),
    /// Hyperlink. `text` is the rendered anchor; `url` is preserved
    /// for the DOCX rendering (anchor + parenthesized URL).
    Link { text: String, url: String },
    /// Image. `url` is resolved via `image_assets` (bytes) for real
    /// embedding, otherwise falls back to the alt-text placeholder.
    Image { alt: String, url: String },
    SoftBreak,
}

/// A list (ordered or unordered). Owns its items so nesting
/// (`- outer\n  - inner`) is naturally expressed as
/// `List { items: [ListItem { children: [List { ... }] }] }`.
#[derive(Clone, Debug)]
struct List {
    ordered: bool,
    items: Vec<ListItem>,
}

/// One item in a [`List`]. `inlines` is the item's primary
/// content; `children` holds any nested blocks (sub-lists,
/// paragraphs, block quotes, code blocks).
#[derive(Clone, Debug)]
struct ListItem {
    /// 1-based position within the enclosing list.
    index: usize,
    inlines: Vec<Inline>,
    children: Vec<Block>,
}

#[derive(Clone, Debug)]
enum Block {
    Heading { level: usize, inlines: Vec<Inline> },
    Paragraph(Vec<Inline>),
    CodeBlock { code: String, lang: Option<String> },
    List(List),
    BlockQuote(Vec<Block>),
    Table {
        headers: Vec<Vec<Inline>>,
        rows: Vec<Vec<Vec<Inline>>>,
    },
}

// ─── DOCX builder ────────────────────────────────────────────────────────────

/// 行内渲染选项（标题字号/引用颜色/表头加粗覆盖）
#[derive(Clone, Copy)]
struct InlineOpts<'a> {
    /// 半磅字号覆盖（标题层级使用；None = 正文字号）
    size: Option<usize>,
    /// 颜色覆盖（引用块使用 quote_hex；None = 正文色）
    color: Option<&'a str>,
    /// 表头强制加粗
    force_bold: bool,
}

impl<'a> InlineOpts<'a> {
    fn body() -> Self {
        Self { size: None, color: None, force_bold: false }
    }
}

fn build_docx(
    markdown: &str,
    image_assets: &HashMap<String, Vec<u8>>,
    rendered_assets: &HashMap<String, Vec<u8>>,
    theme: &ExportTheme,
) -> Result<(Docx, Vec<(String, String)>), ExportError> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(markdown, options);
    let blocks = parse_blocks(parser);

    let style = DocxStyle::from_theme(theme);
    let mut doc = Docx::new();
    let mut rendered_block_index: usize = 0;
    let mut math_blocks: Vec<(String, String)> = Vec::new();
    for block in &blocks {
        doc = render_block(
            block,
            0,
            image_assets,
            rendered_assets,
            &style,
            &mut rendered_block_index,
            &mut math_blocks,
            doc,
        );
    }
    Ok((doc, math_blocks))
}

/// Render a single block into the DOCX. `depth` is the current
/// 0-indexed list nesting depth (0 at the top level).
fn render_block(
    block: &Block,
    depth: usize,
    image_assets: &HashMap<String, Vec<u8>>,
    rendered_assets: &HashMap<String, Vec<u8>>,
    style: &DocxStyle,
    rendered_block_index: &mut usize,
    math_blocks: &mut Vec<(String, String)>,
    doc: Docx,
) -> Docx {
    match block {
        Block::Heading { level, inlines } => {
            let style_name = format!("Heading{}", level.min(&6));
            let half = style.h_halves[level.saturating_sub(1).min(5)];
            let para = append_inlines(
                Paragraph::new().style(&style_name),
                inlines,
                image_assets,
                style,
                &InlineOpts { size: Some(half), color: None, force_bold: false },
            );
            doc.add_paragraph(para)
        }
        Block::Paragraph(inlines) => {
            let para = append_inlines(
                Paragraph::new(),
                inlines,
                image_assets,
                style,
                &InlineOpts::body(),
            );
            doc.add_paragraph(para)
        }
        Block::CodeBlock { code, lang } => render_code_block(
            code,
            lang,
            rendered_assets,
            style,
            rendered_block_index,
            math_blocks,
            doc,
        ),
        Block::List(list) => render_list(
            list,
            depth,
            image_assets,
            style,
            rendered_assets,
            rendered_block_index,
            math_blocks,
            doc,
        ),
        Block::BlockQuote(children) => {
            let mut doc = doc;
            for child in children {
                if let Block::Paragraph(inlines) = child {
                    let mut para = Paragraph::new()
                        .indent(Some(720), None, None, None)
                        .align(AlignmentType::Left);
                    para = para.add_run(
                        Run::new()
                            .add_text("│ ")
                            .italic()
                            .color(&style.quote_hex)
                            .fonts(style.run_fonts()),
                    );
                    para = append_inlines(
                        para,
                        inlines,
                        image_assets,
                        style,
                        &InlineOpts { size: None, color: Some(&style.quote_hex), force_bold: false },
                    );
                    doc = doc.add_paragraph(para);
                } else {
                    doc = render_block(
                        child,
                        depth,
                        image_assets,
                        rendered_assets,
                        style,
                        rendered_block_index,
                        math_blocks,
                        doc,
                    );
                }
            }
            doc
        }
        Block::Table { headers, rows } => render_table(headers, rows, style, doc),
    }
}

fn render_code_block(
    code: &str,
    lang: &Option<String>,
    rendered_assets: &HashMap<String, Vec<u8>>,
    style: &DocxStyle,
    rendered_block_index: &mut usize,
    math_blocks: &mut Vec<(String, String)>,
    doc: Docx,
) -> Docx {
    if code.is_empty() {
        return doc;
    }

    // 处理前端渲染类代码块（mermaid / katex / markmap）
    if let Some(lang_str) = lang {
        match lang_str.as_str() {
            // ── 数学公式：优先 OMML，降级为图片，最终保留源码 ──
            "katex" => {
                let idx = *rendered_block_index;
                *rendered_block_index += 1;

                // 尝试 LaTeX → OMML（Word 原生可编辑公式）
                if let Ok(omml) = math::latex_to_omml(code) {
                    let placeholder = format!("__MATH_BLOCK_{}__", idx);
                    math_blocks.push((placeholder.clone(), omml));
                    // 插入占位段落，ZIP 后处理时替换为 OMML
                    return doc.add_paragraph(
                        Paragraph::new().add_run(Run::new().add_text(&placeholder)),
                    );
                }

                // OMML 失败 → 尝试前端渲染的图片
                let asset_key = format!("__katex_{}__", idx);
                if let Some(bytes) = rendered_assets.get(&asset_key) {
                    let pic = Pic::new(bytes)
                        .size(EMU_PER_INCH * DEFAULT_IMAGE_WIDTH_INCH, EMU_PER_INCH * 3)
                        .id(asset_key);
                    let para = Paragraph::new()
                        .align(AlignmentType::Center)
                        .add_run(Run::new().add_image(pic));
                    return doc.add_paragraph(para);
                }

                // 最终降级：保留源码
                return render_code_block_fallback(code, lang_str, style, doc);
            }

            // ── Mermaid / Markmap：前端渲染图片嵌入 ──
            "mermaid" | "markmap" => {
                let idx = *rendered_block_index;
                *rendered_block_index += 1;

                let asset_key = format!("__{}_{}__", lang_str, idx);
                if let Some(bytes) = rendered_assets.get(&asset_key) {
                    let pic = Pic::new(bytes)
                        .size(EMU_PER_INCH * DEFAULT_IMAGE_WIDTH_INCH, EMU_PER_INCH * 4)
                        .id(asset_key);
                    let para = Paragraph::new()
                        .align(AlignmentType::Center)
                        .add_run(Run::new().add_image(pic));
                    return doc.add_paragraph(para);
                }

                // 无渲染资源 → 保留源码
                return render_code_block_fallback(code, lang_str, style, doc);
            }

            _ => {}
        }
    }

    // 普通代码块：保持原有渲染逻辑
    render_code_block_plain(code, lang, style, doc)
}

/// 前端渲染类代码块的降级渲染（保留源码 + 语言标签）
fn render_code_block_fallback(code: &str, lang: &str, style: &DocxStyle, doc: Docx) -> Docx {
    let mut para = Paragraph::new();
    para = para.add_run(
        Run::new()
            .add_text(format!("[{}]", lang))
            .size(14)
            .color("888888"),
    );
    para = para.add_run(
        Run::new()
            .add_text("\n")
            .size(14)
            .color("888888"),
    );
    para = para.add_run(
        Run::new()
            .add_text(code)
            .fonts(style.mono_fonts())
            .size(style.code_half)
            .shading(Shading::new().fill(&style.code_bg_hex)),
    );
    doc.add_paragraph(para)
}

/// 普通代码块渲染（非前端渲染类语言）
fn render_code_block_plain(code: &str, lang: &Option<String>, style: &DocxStyle, doc: Docx) -> Docx {
    let mut para = Paragraph::new();
    if let Some(lang) = lang {
        if !lang.is_empty() {
            para = para.add_run(
                Run::new()
                    .add_text(format!("[{}]", lang))
                    .size(14)
                    .color("888888"),
            );
            para = para.add_run(
                Run::new()
                    .add_text("\n")
                    .size(14)
                    .color("888888"),
            );
        }
    }
    para = para.add_run(
        Run::new()
            .add_text(code)
            .fonts(style.mono_fonts())
            .size(style.code_half)
            .shading(Shading::new().fill(&style.code_bg_hex)),
    );
    doc.add_paragraph(para)
}

#[allow(clippy::too_many_arguments)]
fn render_list(
    list: &List,
    depth: usize,
    image_assets: &HashMap<String, Vec<u8>>,
    style: &DocxStyle,
    rendered_assets: &HashMap<String, Vec<u8>>,
    rendered_block_index: &mut usize,
    math_blocks: &mut Vec<(String, String)>,
    doc: Docx,
) -> Docx {
    let indent_val: i32 = ((depth + 1) as i32).min(4) * 360;
    let mut doc = doc;
    for item in &list.items {
        let marker = if list.ordered {
            format!("{}. ", item.index)
        } else {
            "• ".to_string()
        };
        let mut para = Paragraph::new()
            .add_run(Run::new().add_text(marker).fonts(style.run_fonts()))
            .indent(Some(indent_val), None, None, None);
        para = append_inlines(para, &item.inlines, image_assets, style, &InlineOpts::body());
        doc = doc.add_paragraph(para);
        for child in &item.children {
            doc = render_block(
                child,
                depth + 1,
                image_assets,
                rendered_assets,
                style,
                rendered_block_index,
                math_blocks,
                doc,
            );
        }
    }
    doc
}

fn render_table(
    headers: &[Vec<Inline>],
    rows: &[Vec<Vec<Inline>>],
    style: &DocxStyle,
    doc: Docx,
) -> Docx {
    if headers.is_empty() && rows.is_empty() {
        return doc;
    }
    // 单一 borders 规格应用到每个单元格；color 用主题边框色，
    // 使导出表格边框跟随当前主题（对齐编辑器 `border: 1px solid`）。
    let borders = TableCellBorders::new()
        .set(
            TableCellBorder::new(TableCellBorderPosition::Top)
                .size(4)
                .color(&style.border_hex),
        )
        .set(
            TableCellBorder::new(TableCellBorderPosition::Bottom)
                .size(4)
                .color(&style.border_hex),
        )
        .set(
            TableCellBorder::new(TableCellBorderPosition::Left)
                .size(4)
                .color(&style.border_hex),
        )
        .set(
            TableCellBorder::new(TableCellBorderPosition::Right)
                .size(4)
                .color(&style.border_hex),
        );
    // docx-rs 0.4 的 `Table::set_grid` 接受 twips（1/20 pt）列宽，
    // 目标 9000 twips（≈ 6.25 inch）对齐 A4 打印宽度。
    let col_count = headers
        .iter()
        .map(|c| c.len())
        .chain(rows.iter().filter_map(|r| r.first().map(|c| c.len())))
        .max()
        .unwrap_or(1)
        .max(1);
    let per_col_twips: usize = 9000 / col_count;
    let grid: Vec<usize> = (0..col_count).map(|_| per_col_twips).collect();
    let mut table = Table::new(Vec::new()).set_grid(grid.clone());
    if !headers.is_empty() {
        let cells: Vec<TableCell> = headers
            .iter()
            .map(|cell_inlines| {
                let para = append_inlines(
                    Paragraph::new(),
                    cell_inlines,
                    &HashMap::new(),
                    style,
                    &InlineOpts { size: None, color: None, force_bold: true },
                );
                TableCell::new()
                    .add_paragraph(para)
                    .set_borders(borders.clone())
                    .shading(Shading::new().fill(&style.table_header_hex))
            })
            .collect();
        table = table.add_row(TableRow::new(cells));
    }
    for row_inlines in rows {
        let cells: Vec<TableCell> = row_inlines
            .iter()
            .map(|cell_inlines| {
                let para = append_inlines(
                    Paragraph::new(),
                    cell_inlines,
                    &HashMap::new(),
                    style,
                    &InlineOpts::body(),
                );
                TableCell::new()
                    .add_paragraph(para)
                    .set_borders(borders.clone())
            })
            .collect();
        table = table.add_row(TableRow::new(cells));
    }
    doc.add_table(table)
}

fn append_inlines(
    mut para: Paragraph,
    inlines: &[Inline],
    image_assets: &HashMap<String, Vec<u8>>,
    style: &DocxStyle,
    opts: &InlineOpts,
) -> Paragraph {
    // 有效字号：标题覆盖优先，否则用主题正文字号（半磅）
    let effective_size = opts.size.unwrap_or(style.body_half);
    for inline in inlines {
        match inline {
            Inline::Text(t) => {
                let mut run = Run::new()
                    .add_text(t)
                    .fonts(style.run_fonts())
                    .size(effective_size);
                if opts.force_bold {
                    run = run.bold();
                }
                run = match opts.color {
                    Some(c) => run.color(c),
                    None => run.color(&style.text_hex),
                };
                para = para.add_run(run);
            }
            Inline::Bold(t) => {
                para = para.add_run(
                    Run::new()
                        .add_text(t)
                        .bold()
                        .fonts(style.run_fonts())
                        .size(effective_size)
                        .color(opts.color.unwrap_or(&style.text_hex)),
                );
            }
            Inline::Italic(t) => {
                para = para.add_run(
                    Run::new()
                        .add_text(t)
                        .italic()
                        .fonts(style.run_fonts())
                        .size(effective_size)
                        .color(opts.color.unwrap_or(&style.text_hex)),
                );
            }
            Inline::BoldItalic(t) => {
                para = para.add_run(
                    Run::new()
                        .add_text(t)
                        .bold()
                        .italic()
                        .fonts(style.run_fonts())
                        .size(effective_size)
                        .color(opts.color.unwrap_or(&style.text_hex)),
                );
            }
            Inline::Strike(t) => {
                para = para.add_run(
                    Run::new()
                        .add_text(t)
                        .strike()
                        .fonts(style.run_fonts())
                        .size(effective_size)
                        .color(opts.color.unwrap_or(&style.text_hex)),
                );
            }
            Inline::Code(c) => {
                para = para.add_run(
                    Run::new()
                        .add_text(c)
                        .fonts(style.mono_fonts())
                        .size(style.code_half)
                        .shading(Shading::new().fill(&style.code_bg_hex)),
                );
            }
            Inline::Link { text, url } => {
                // 锚文本按主题链接色渲染，URL 以括号附注保留
                para = para.add_run(
                    Run::new()
                        .add_text(text)
                        .color(&style.link_hex)
                        .underline("single")
                        .fonts(style.run_fonts()),
                );
                if !url.is_empty() && url != text {
                    para = para.add_run(
                        Run::new()
                            .add_text(format!(" ({})", url))
                            .color("888888")
                            .fonts(style.run_fonts()),
                    );
                }
            }
            Inline::Image { alt, url } => {
                // 有图片字节则嵌入真实 drawing 元素，否则回退占位文本
                if let Some(bytes) = image_assets.get(url) {
                    let pic = Pic::new(bytes)
                        .size(EMU_PER_INCH * DEFAULT_IMAGE_WIDTH_INCH, EMU_PER_INCH * 4)
                        .id(url.clone());
                    para = para.add_run(Run::new().add_image(pic));
                } else {
                    // 无字节：渲染 alt（若空则通用 "[图片]" 标签），
                    // 避免标签自嵌套（"[图片: [图片]]"）
                    let label = if alt.is_empty() {
                        "[图片]".to_string()
                    } else {
                        alt.clone()
                    };
                    para = para.add_run(
                        Run::new()
                            .add_text(label)
                            .italic()
                            .color("666666")
                            .fonts(style.run_fonts()),
                    );
                    if !url.is_empty() {
                        para = para.add_run(
                            Run::new()
                                .add_text(format!(" ({})", url))
                                .color("888888")
                                .fonts(style.run_fonts()),
                        );
                    }
                }
            }
            Inline::SoftBreak => {
                para = para.add_run(Run::new().add_break(BreakType::TextWrapping));
            }
        }
    }
    para
}

// ─── Markdown parser ─────────────────────────────────────────────────────────

/// Push a completed `Block` to the innermost open container.
/// Priority: current list item's `children` → innermost open block
/// quote → top-level `blocks`.
fn push_block(state: &mut ParseState, block: Block) {
    if let Some(item) = state.item_stack.last_mut() {
        item.children.push(block);
        return;
    }
    if let Some(quote_blocks) = state.quote_blocks_stack.last_mut() {
        quote_blocks.push(block);
        return;
    }
    state.blocks.push(block);
}

/// Push an inline into the active inline buffer.
/// Priority: current list item's `inlines` → current table cell →
/// shared `current_inlines` buffer.
fn push_inline(state: &mut ParseState, inline: Inline) {
    if let Some(top) = state.item_stack.last_mut() {
        top.inlines.push(inline);
        return;
    }
    if state.in_table_cell {
        state.current_cell_inlines.push(inline);
        return;
    }
    state.current_inlines.push(inline);
}

/// Finalise the pending `current_inlines` into a [`Block::Paragraph`]
/// and route it via [`push_block`]. Called at every block boundary.
fn flush_current_paragraph(state: &mut ParseState) {
    if !state.current_inlines.is_empty() {
        let inlines = std::mem::take(&mut state.current_inlines);
        push_block(state, Block::Paragraph(inlines));
    }
}

/// Internal mutable state for the parser.
struct ParseState {
    blocks: Vec<Block>,
    current_inlines: Vec<Inline>,
    in_heading: Option<usize>,
    in_code_block: bool,
    code_block_content: String,
    current_code_lang: Option<String>,
    list_stack: Vec<ListBuilder>,
    item_stack: Vec<ListItem>,
    bold_stack: usize,
    italic_stack: usize,
    strike_stack: usize,
    in_table_cell: bool,
    table_headers: Vec<Vec<Inline>>,
    table_rows: Vec<Vec<Vec<Inline>>>,
    current_row_cells: Vec<Vec<Inline>>,
    current_cell_inlines: Vec<Inline>,
    /// Stack of open block quotes' child-block vectors; the top of
    /// the stack is the innermost open quote (nested-quote fix).
    quote_blocks_stack: Vec<Vec<Block>>,
    link_stack: Vec<(String, Vec<Inline>)>,
    pending_image: Option<(String, String)>,
}

/// Per-list accumulator. `next_index` is the 1-based number assigned
/// to the next `Start(Item)`; pre-loaded with the list's start number
/// so a `3. foo` list's first item is `index = 3`.
struct ListBuilder {
    ordered: bool,
    items: Vec<ListItem>,
    next_index: usize,
}

impl ParseState {
    fn new() -> Self {
        Self {
            blocks: Vec::new(),
            current_inlines: Vec::new(),
            in_heading: None,
            in_code_block: false,
            code_block_content: String::new(),
            current_code_lang: None,
            list_stack: Vec::new(),
            item_stack: Vec::new(),
            bold_stack: 0,
            italic_stack: 0,
            strike_stack: 0,
            in_table_cell: false,
            table_headers: Vec::new(),
            table_rows: Vec::new(),
            current_row_cells: Vec::new(),
            current_cell_inlines: Vec::new(),
            quote_blocks_stack: Vec::new(),
            link_stack: Vec::new(),
            pending_image: None,
        }
    }
}

fn parse_blocks<'a>(parser: Parser<'a>) -> Vec<Block> {
    let mut s = ParseState::new();

    for event in parser {
        match event {
            Event::Start(tag) => match tag {
                Tag::Heading { level, .. } => {
                    flush_current_paragraph(&mut s);
                    s.in_heading = Some(match level {
                        HeadingLevel::H1 => 1,
                        HeadingLevel::H2 => 2,
                        HeadingLevel::H3 => 3,
                        HeadingLevel::H4 => 4,
                        HeadingLevel::H5 => 5,
                        HeadingLevel::H6 => 6,
                    });
                }
                Tag::Paragraph => {
                    flush_current_paragraph(&mut s);
                }
                Tag::CodeBlock(kind) => {
                    flush_current_paragraph(&mut s);
                    s.in_code_block = true;
                    s.code_block_content.clear();
                    s.current_code_lang = match kind {
                        CodeBlockKind::Fenced(lang) => {
                            if lang.is_empty() { None } else { Some(lang.to_string()) }
                        }
                        CodeBlockKind::Indented => None,
                    };
                }
                Tag::List(start) => {
                    flush_current_paragraph(&mut s);
                    // `Tag::List` carries `Option<u64>`: `Some(n)` means
                    // an ordered list starting at index `n`; `None`
                    // means a bullet list.
                    let ordered = start.is_some();
                    let list_start = start.unwrap_or(1);
                    s.list_stack.push(ListBuilder {
                        ordered,
                        items: Vec::new(),
                        next_index: list_start as usize,
                    });
                }
                Tag::Item => {
                    flush_current_paragraph(&mut s);
                    s.item_stack.push(ListItem {
                        index: 0,
                        inlines: Vec::new(),
                        children: Vec::new(),
                    });
                }
                Tag::Strong => { s.bold_stack += 1; }
                Tag::Emphasis => { s.italic_stack += 1; }
                Tag::Strikethrough => { s.strike_stack += 1; }
                Tag::Table(_) => {
                    flush_current_paragraph(&mut s);
                    s.table_headers.clear();
                    s.table_rows.clear();
                    s.current_row_cells.clear();
                    s.current_cell_inlines.clear();
                }
                Tag::TableHead => { s.current_row_cells.clear(); }
                Tag::TableRow => { s.current_row_cells.clear(); }
                Tag::TableCell => {
                    s.in_table_cell = true;
                    s.current_cell_inlines.clear();
                }
                Tag::Link { dest_url, .. } => {
                    s.link_stack.push((dest_url.to_string(), Vec::new()));
                }
                Tag::Image { dest_url, .. } => {
                    s.pending_image = Some((String::new(), dest_url.to_string()));
                }
                Tag::BlockQuote(_) => {
                    flush_current_paragraph(&mut s);
                    s.quote_blocks_stack.push(Vec::new());
                }
                _ => {}
            },
            Event::End(tag_end) => match tag_end {
                TagEnd::Heading(_) => {
                    if let Some(level) = s.in_heading.take() {
                        let inlines = std::mem::take(&mut s.current_inlines);
                        push_block(&mut s, Block::Heading { level, inlines });
                    }
                }
                TagEnd::Paragraph => {
                    flush_current_paragraph(&mut s);
                }
                TagEnd::CodeBlock => {
                    let code = std::mem::take(&mut s.code_block_content);
                    let lang = s.current_code_lang.take();
                    push_block(&mut s, Block::CodeBlock { code, lang });
                    s.in_code_block = false;
                }
                TagEnd::List(_) => {
                    let builder = s
                        .list_stack
                        .pop()
                        .expect("End(List) without matching Start(List)");
                    push_block(
                        &mut s,
                        Block::List(List {
                            ordered: builder.ordered,
                            items: builder.items,
                        }),
                    );
                }
                TagEnd::Item => {
                    let mut item = s
                        .item_stack
                        .pop()
                        .expect("End(Item) without matching Start(Item)");
                    let list = s
                        .list_stack
                        .last_mut()
                        .expect("End(Item) outside any list");
                    item.index = list.next_index;
                    list.next_index += 1;
                    list.items.push(item);
                }
                TagEnd::Strong => { s.bold_stack = s.bold_stack.saturating_sub(1); }
                TagEnd::Emphasis => { s.italic_stack = s.italic_stack.saturating_sub(1); }
                TagEnd::Strikethrough => { s.strike_stack = s.strike_stack.saturating_sub(1); }
                TagEnd::Table => {
                    let headers = std::mem::take(&mut s.table_headers);
                    let rows = std::mem::take(&mut s.table_rows);
                    push_block(&mut s, Block::Table { headers, rows });
                }
                TagEnd::TableHead => {
                    s.table_headers = std::mem::take(&mut s.current_row_cells);
                }
                TagEnd::TableRow => {
                    s.table_rows.push(std::mem::take(&mut s.current_row_cells));
                }
                TagEnd::TableCell => {
                    s.in_table_cell = false;
                    s.current_row_cells.push(std::mem::take(&mut s.current_cell_inlines));
                }
                TagEnd::BlockQuote(_) => {
                    // Close the innermost open quote: pop the child vec,
                    // wrap as `Block::BlockQuote`, and route through
                    // `push_block` so the new block lands in the parent
                    // container (nested-quote fix).
                    let children = s
                        .quote_blocks_stack
                        .pop()
                        .expect("End(BlockQuote) without matching Start(BlockQuote)");
                    push_block(&mut s, Block::BlockQuote(children));
                }
                TagEnd::Link => {
                    if let Some((url, inlines)) = s.link_stack.pop() {
                        // Build the link's anchor text from its child
                        // inlines; images contribute alt + URL, nested
                        // links preserve their inner anchor text.
                        let text: String = inlines
                            .iter()
                            .map(|i| match i {
                                Inline::Text(t)
                                | Inline::Bold(t)
                                | Inline::Italic(t)
                                | Inline::BoldItalic(t)
                                | Inline::Strike(t)
                                | Inline::Code(t) => t.clone(),
                                Inline::Image { alt, url } => {
                                    if alt.is_empty() {
                                        format!("[图片]({})", url)
                                    } else {
                                        format!("{} ({})", alt, url)
                                    }
                                }
                                Inline::Link { text: inner_text, url: inner_url } => {
                                    if inner_text.is_empty() {
                                        format!("[link]({})", inner_url)
                                    } else {
                                        format!("{} ({})", inner_text, inner_url)
                                    }
                                }
                                _ => String::new(),
                            })
                            .collect();
                        if s.link_stack.is_empty() {
                            push_inline(&mut s, Inline::Link { text, url });
                        } else {
                            // Nested link: push into the parent link's
                            // inlines buffer.
                            if let Some(top) = s.link_stack.last_mut() {
                                top.1.push(Inline::Link { text, url });
                            }
                        }
                    }
                }
                TagEnd::Image => {
                    if let Some((alt, url)) = s.pending_image.take() {
                        let image = Inline::Image { alt, url };
                        // Image inside a link is a common pattern
                        // (clickable badge / icon): push into the
                        // link's inlines buffer.
                        if let Some((_, ref mut buf)) = s.link_stack.last_mut() {
                            buf.push(image);
                        } else {
                            push_inline(&mut s, image);
                        }
                    }
                }
                _ => {}
            },
            Event::Text(text) => {
                if s.in_code_block {
                    s.code_block_content.push_str(&text);
                } else if let Some((ref mut alt, _)) = s.pending_image {
                    alt.push_str(&text);
                } else {
                    // Capture stack counters before the mutable borrow.
                    let bold = s.bold_stack;
                    let italic = s.italic_stack;
                    let strike = s.strike_stack;
                    let classified = classify_inline(&text, bold, italic, strike);
                    // Text inside a link goes into the link's pending
                    // inlines, not the current paragraph.
                    if let Some((_, ref mut buf)) = s.link_stack.last_mut() {
                        buf.push(classified);
                    } else {
                        push_inline(&mut s, classified);
                    }
                }
            }
            Event::Code(code) => {
                let inline = Inline::Code(code.to_string());
                if let Some((_, ref mut buf)) = s.link_stack.last_mut() {
                    buf.push(inline);
                } else {
                    push_inline(&mut s, inline);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if s.in_code_block {
                    s.code_block_content.push('\n');
                } else {
                    let br = Inline::SoftBreak;
                    if let Some((_, ref mut buf)) = s.link_stack.last_mut() {
                        buf.push(br);
                    } else {
                        push_inline(&mut s, br);
                    }
                }
            }
            Event::TaskListMarker(checked) => {
                let marker = if checked { "☑ " } else { "☐ " };
                push_inline(&mut s, Inline::Text(marker.to_string()));
            }
            _ => {}
        }
    }

    flush_current_paragraph(&mut s);
    s.blocks
}

fn classify_inline(text: &str, bold: usize, italic: usize, strike: usize) -> Inline {
    match (bold > 0, italic > 0, strike > 0) {
        (true, true, _) => Inline::BoldItalic(text.to_string()),
        (true, false, _) => Inline::Bold(text.to_string()),
        (false, true, _) => Inline::Italic(text.to_string()),
        (false, false, true) => Inline::Strike(text.to_string()),
        (false, false, false) => Inline::Text(text.to_string()),
    }
}

// ─── 宿主命令层（保存对话框选位 + 图片/渲染资源组装） ────────────────────────

/// 导出命令结果：返回最终落盘路径（前端 toast 展示）
#[derive(Debug, Clone, Serialize)]
pub struct ExportResult {
    pub path: String,
}

/// 解析导出目标目录：系统下载目录；不可用时回退应用数据目录/exports
fn resolve_download_dir(app: &AppHandle) -> PathBuf {
    dirs::download_dir().unwrap_or_else(|| {
        app.path()
            .app_data_dir()
            .map(|d| d.join("exports"))
            .unwrap_or_else(|_| std::env::temp_dir().join("swallownote-exports"))
    })
}

/// 清理文件名中的路径分隔符与控制字符，防止路径穿越
fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .split(['/', '\\'])
        .last()
        .unwrap_or("export")
        .chars()
        .filter(|c| !c.is_control())
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').trim();
    if trimmed.is_empty() {
        "export".to_string()
    } else {
        trimmed.to_string()
    }
}

/// 导出取消错误标记：用户在保存对话框点击取消，前端据此静默处理
const EXPORT_CANCELLED: &str = "__cancelled__";

/// 从文件名提取 stem 并补齐目标扩展名（对话框默认文件名用）
fn export_default_file_name(file_name: &str, ext: &str) -> Result<String, String> {
    let clean = sanitize_file_name(file_name);
    if clean.is_empty() {
        return Err("文件名为空".to_string());
    }
    // 已带目标扩展名则沿用 stem，否则补齐
    let stem = match Path::new(&clean).extension() {
        Some(e) if e.eq_ignore_ascii_case(ext) => Path::new(&clean)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or(clean.clone()),
        _ => clean.clone(),
    };
    Ok(format!("{}.{}", stem, ext))
}

/// 弹系统保存对话框让用户选择存储位置（默认预填系统下载目录）。
/// 用户取消返回 None；对话框选择的路径若已存在，对话框自带覆盖确认，
/// 落盘时直接覆盖写入。必须在 spawn_blocking 线程调用（blocking 版对话框）。
fn pick_export_target_via_dialog(
    app: &AppHandle,
    file_name: &str,
    ext: &str,
) -> Result<Option<PathBuf>, String> {
    let default_name = export_default_file_name(file_name, ext)?;
    let default_dir = resolve_download_dir(app);
    let (label, extensions): (&str, &[&str]) = match ext {
        "docx" => ("Word 文档", &["docx"]),
        _ => ("HTML 文档", &["html", "htm"]),
    };
    let picked = app
        .dialog()
        .file()
        .add_filter(label, extensions)
        .set_directory(&default_dir)
        .set_file_name(&default_name)
        .blocking_save_file();
    match picked {
        Some(fp) => Ok(Some(
            fp.into_path()
                .map_err(|e| format!("无效的保存路径: {}", e))?,
        )),
        None => Ok(None),
    }
}

/// 简易百分号解码（%XX），用于 markdown 图片 URL 中的转义字符
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// 按扩展名猜测图片 MIME 类型
fn mime_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        _ => "application/octet-stream",
    }
}

/// 从 markdown 中收集所有图片 URL（文档顺序）
fn collect_image_urls(markdown: &str) -> Vec<String> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    Parser::new_ext(markdown, options)
        .filter_map(|e| match e {
            Event::Start(Tag::Image { dest_url, .. }) => Some(dest_url.to_string()),
            _ => None,
        })
        .collect()
}

/// 解析 markdown 中的相对路径图片为原始字节（DOCX 嵌入用）。
/// - 跳过 http(s)/data:/asset: 协议的 URL；
/// - 相对路径基于笔记所在目录解析，绝对路径原样使用；
/// - 读取范围经 fs_guard 白名单校验（工作区根 + 应用数据目录），
///   越界/读取失败静默跳过（回退占位文本，不阻塞导出）。
fn collect_image_assets(
    app: &AppHandle,
    workspace_root: Option<&str>,
    note_path: &str,
    markdown: &str,
) -> HashMap<String, Vec<u8>> {
    let mut assets = HashMap::new();
    let note_dir = Path::new(note_path).parent().map(|p| p.to_path_buf());
    for url in collect_image_urls(markdown) {
        if url.starts_with("http://")
            || url.starts_with("https://")
            || url.starts_with("data:")
            || url.starts_with("asset:")
        {
            continue;
        }
        let decoded = percent_decode(&url);
        let candidate = match (Path::new(&decoded).is_absolute(), &note_dir) {
            (true, _) => PathBuf::from(&decoded),
            (false, Some(dir)) => dir.join(&decoded),
            (false, None) => continue,
        };
        // 白名单校验：图片读取必须位于工作区根或应用数据目录内
        if crate::services::fs_guard::ensure_path_allowed(app, workspace_root, &candidate).is_err()
        {
            continue;
        }
        if let Ok(bytes) = std::fs::read(&candidate) {
            assets.insert(url, bytes);
        }
    }
    assets
}

/// 解析 markdown 中的相对路径图片为 data: URI（HTML 单文件内嵌用）。
/// 解析逻辑与 [`collect_image_assets`] 相同。
fn collect_image_data_uris(
    app: &AppHandle,
    workspace_root: Option<&str>,
    note_path: &str,
    markdown: &str,
) -> HashMap<String, String> {
    let mut uris = HashMap::new();
    let note_dir = Path::new(note_path).parent().map(|p| p.to_path_buf());
    for url in collect_image_urls(markdown) {
        if url.starts_with("http://")
            || url.starts_with("https://")
            || url.starts_with("data:")
            || url.starts_with("asset:")
        {
            continue;
        }
        let decoded = percent_decode(&url);
        let candidate = match (Path::new(&decoded).is_absolute(), &note_dir) {
            (true, _) => PathBuf::from(&decoded),
            (false, Some(dir)) => dir.join(&decoded),
            (false, None) => continue,
        };
        if crate::services::fs_guard::ensure_path_allowed(app, workspace_root, &candidate).is_err()
        {
            continue;
        }
        if let Ok(bytes) = std::fs::read(&candidate) {
            let mime = mime_for_path(&candidate);
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            uris.insert(url, format!("data:{};base64,{}", mime, b64));
        }
    }
    uris
}

// ─── Tauri 命令 ──────────────────────────────────────────────────────────────

/// 导出 DOCX：Markdown → DOCX（主题参数化 + 本地图片嵌入 + OMML 数学公式），
/// 经系统保存对话框选择存储位置（fs_guard 豁免登记见模块注释）。
#[tauri::command]
pub async fn export_docx(
    app: AppHandle,
    workspace_root: Option<String>,
    note_path: String,
    markdown: String,
    theme: ExportTheme,
    rendered_assets: HashMap<String, String>,
    file_name: String,
) -> Result<ExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // 相对路径图片读取迁入宿主（fs_guard 白名单内）
        let image_assets =
            collect_image_assets(&app, workspace_root.as_deref(), &note_path, &markdown);
        // 前端预渲染的 mermaid/katex/markmap PNG 为 base64，解码为字节后传入
        let decoded_rendered: HashMap<String, Vec<u8>> = rendered_assets
            .into_iter()
            .filter_map(|(k, v)| {
                base64::engine::general_purpose::STANDARD
                    .decode(&v)
                    .ok()
                    .map(|bytes| (k, bytes))
            })
            .collect();
        let bytes = markdown_to_docx(markdown, image_assets, decoded_rendered, &theme)
            .map_err(|e| e.to_string())?;
        // 保存对话框选择存储位置（默认预填下载目录），取消则导出中止
        let target = pick_export_target_via_dialog(&app, &file_name, "docx")?
            .ok_or_else(|| EXPORT_CANCELLED.to_string())?;
        std::fs::write(&target, &bytes).map_err(|e| format!("写入文件失败: {}", e))?;
        Ok(ExportResult {
            path: target.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|e| format!("导出任务执行失败: {}", e))?
}

/// 构建 HTML 导出内容（export_html 与 generate_export_html 共用）：
/// 图片内嵌 data: URI + 渲染产物内嵌 + 可选自动打印脚本注入
fn build_export_html(
    app: &AppHandle,
    workspace_root: Option<&str>,
    note_path: Option<&str>,
    markdown: String,
    theme: &ExportTheme,
    rendered_assets: &HashMap<String, String>,
    auto_print: bool,
) -> Result<String, String> {
    let data_uris = match note_path {
        Some(p) => collect_image_data_uris(app, workspace_root, p, &markdown),
        None => HashMap::new(),
    };
    let mut html = markdown_to_html(markdown, theme, rendered_assets, &data_uris)
        .map_err(|e| e.to_string())?;
    if auto_print {
        // 打印预览模式：load 后自动唤起系统打印对话框
        if let Some(pos) = html.rfind("</body>") {
            html.insert_str(pos, AUTO_PRINT_SCRIPT);
        }
    }
    Ok(html)
}

/// 导出 HTML：Markdown → 主题化 HTML（内嵌 SVG 渲染产物 + data: URI 图片），
/// 经系统保存对话框选择存储位置。
#[tauri::command]
pub async fn export_html(
    app: AppHandle,
    workspace_root: Option<String>,
    note_path: Option<String>,
    markdown: String,
    theme: ExportTheme,
    rendered_assets: HashMap<String, String>,
    file_name: String,
) -> Result<ExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let html = build_export_html(
            &app,
            workspace_root.as_deref(),
            note_path.as_deref(),
            markdown,
            &theme,
            &rendered_assets,
            false,
        )?;
        // 保存对话框选择存储位置（默认预填下载目录），取消则导出中止
        let target = pick_export_target_via_dialog(&app, &file_name, "html")?
            .ok_or_else(|| EXPORT_CANCELLED.to_string())?;
        std::fs::write(&target, &html).map_err(|e| format!("写入文件失败: {}", e))?;
        Ok(ExportResult {
            path: target.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|e| format!("导出任务执行失败: {}", e))?
}

/// 生成 HTML 导出内容（不落盘）：PDF 链路用 —— 插件薄壳经此取得主题化
/// HTML（含图片内嵌），再交 `open_print_preview` 打开预览窗口。
#[tauri::command]
pub async fn generate_export_html(
    app: AppHandle,
    workspace_root: Option<String>,
    note_path: Option<String>,
    markdown: String,
    theme: ExportTheme,
    rendered_assets: HashMap<String, String>,
    auto_print: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        build_export_html(
            &app,
            workspace_root.as_deref(),
            note_path.as_deref(),
            markdown,
            &theme,
            &rendered_assets,
            auto_print,
        )
    })
    .await
    .map_err(|e| format!("导出任务执行失败: {}", e))?
}

/// 打开打印预览窗口（PDF 导出入口：用户在系统打印对话框中"存储为 PDF"）。
/// HTML 写入 `app_cache_dir/print_preview/{uuid}.html`（fs_guard 白名单内的
/// 应用数据目录），以 file:// URL 创建独立窗口；窗口关闭时删除临时文件。
/// 临时文件用真实文件而非 data URL —— WebView2 的 NavigateToString 有 ~2MB
/// 上限，长文档会被截断。
#[tauri::command]
pub async fn open_print_preview(app: AppHandle, html: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("解析缓存目录失败: {}", e))?
        .join("print_preview");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建预览目录失败: {}", e))?;
    let id = uuid::Uuid::new_v4();
    let file = dir.join(format!("{}.html", id));
    std::fs::write(&file, &html).map_err(|e| format!("写入预览文件失败: {}", e))?;

    let label = format!("print-{}", id.simple());
    let url = tauri::Url::from_file_path(&file)
        .map_err(|_| "无效的预览文件路径".to_string())?;
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .title("打印预览")
        .inner_size(860.0, 1100.0)
        .resizable(true)
        .build()
        .map_err(|e| format!("创建打印预览窗口失败: {}", e))?;

    // 窗口关闭时清理临时 HTML 文件
    let cleanup_path = file.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
            let _ = std::fs::remove_file(&cleanup_path);
        }
    });
    Ok(())
}

/// 启动时清空 print_preview 临时目录（异常退出残留兜底），在 lib.rs setup 调用
pub fn cleanup_print_preview_files(app: &AppHandle) {
    if let Ok(dir) = app.path().app_cache_dir().map(|d| d.join("print_preview")) {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                if entry.path().is_file() {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
}

// ─── Tests（自插件 convert.rs 迁移 + 主题化适配） ────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use std::io::Read;

    /// Pack a Docx and return its raw bytes.
    fn pack(doc: Docx) -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        doc.build()
            .pack(&mut buf)
            .expect("pack docx");
        buf.into_inner()
    }

    /// Extract a "fake" plain-text projection of the DOCX by scanning
    /// the packed bytes for `<w:t>` XML elements.
    fn docx_text(bytes: &[u8]) -> String {
        let s = String::from_utf8_lossy(bytes);
        let mut buf = String::new();
        let mut i = 0;
        while i < s.len() {
            let rest = &s[i..];
            if let Some(open) = rest.find("<w:t") {
                let abs = i + open;
                if let Some(gt) = s[abs..].find('>') {
                    let after_open = abs + gt + 1;
                    if let Some(close) = s[after_open..].find("</w:t>") {
                        buf.push_str(&s[after_open..after_open + close]);
                        i = after_open + close + "</w:t>".len();
                        continue;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            } else {
                break;
            }
        }
        buf.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
    }

    fn round_trip(md: &str) -> String {
        let bytes = markdown_to_docx(
            md.to_string(),
            HashMap::new(),
            HashMap::new(),
            &ExportTheme::default(),
        )
        .expect("markdown_to_docx");
        docx_text(&bytes)
    }

    #[test]
    fn headings_render_with_correct_levels() {
        let text = round_trip("# H1\n## H2\n### H3\n");
        assert!(text.contains("H1"), "missing H1: {text}");
        assert!(text.contains("H2"), "missing H2: {text}");
        assert!(text.contains("H3"), "missing H3: {text}");
    }

    #[test]
    fn bold_italic_strike_and_code_inline() {
        let text = round_trip(
            "**bold** *italic* ~~strike~~ `code` plain\n",
        );
        assert!(text.contains("bold"), "bold missing: {text}");
        assert!(text.contains("italic"), "italic missing: {text}");
        assert!(text.contains("strike"), "strike missing: {text}");
        assert!(text.contains("code"), "inline code missing: {text}");
        assert!(text.contains("plain"), "plain text missing: {text}");
    }

    #[test]
    fn link_preserves_text_and_url() {
        let text = round_trip("[example](https://example.com)\n");
        assert!(text.contains("example"), "link text missing: {text}");
        assert!(text.contains("https://example.com"), "link url missing: {text}");
    }

    #[test]
    fn image_kept_as_alt_placeholder() {
        let text = round_trip("![diagram](https://x.com/diagram.png)\n");
        assert!(text.contains("diagram"), "alt text missing: {text}");
        assert!(
            text.contains("https://x.com/diagram.png"),
            "image url missing: {text}"
        );
    }

    #[test]
    fn image_with_empty_alt_no_redundant_label() {
        // `![](url)` 无 alt 时不得嵌套占位符（`[图片: [图片]]`）
        let text = round_trip("![](https://x.com/y.png)\n");
        assert!(
            !text.contains("[图片: [图片]]"),
            "redundant nested label: {text}"
        );
        assert!(text.contains("[图片]"), "missing image marker: {text}");
        assert!(
            text.contains("https://x.com/y.png"),
            "missing image url: {text}"
        );
    }

    #[test]
    fn fenced_code_block_keeps_language_tag() {
        let text = round_trip("```rust\nfn main() {}\n```\n");
        assert!(text.contains("rust"), "language tag missing: {text}");
        assert!(text.contains("fn main"), "code body missing: {text}");
    }

    #[test]
    fn blockquote_renders_with_quote_glyph() {
        let text = round_trip("> a quoted line\n");
        assert!(text.contains("│"), "quote glyph missing: {text}");
        assert!(text.contains("a quoted line"), "quote body missing: {text}");
    }

    #[test]
    fn ordered_list_shows_numeric_marker() {
        let text = round_trip("1. one\n2. two\n3. three\n");
        assert!(text.contains("1. one"), "first item marker missing: {text}");
        assert!(text.contains("2. two"), "second item marker missing: {text}");
        assert!(text.contains("3. three"), "third item marker missing: {text}");
    }

    #[test]
    fn unordered_list_still_uses_bullet_marker() {
        let text = round_trip("- apple\n- banana\n- cherry\n");
        assert!(text.contains("• apple"), "bullet for apple missing: {text}");
        assert!(text.contains("• banana"), "bullet for banana missing: {text}");
        assert!(text.contains("• cherry"), "bullet for cherry missing: {text}");
        assert!(
            !text.contains("1. apple"),
            "unordered list unexpectedly got numeric marker: {text}"
        );
    }

    #[test]
    fn ordered_list_respects_non_one_start_number() {
        // pulldown-cmark 0.12 `Tag::List(Option<u64>)` 携带 1-based 起始序号，
        // DOCX 必须保留用户编号而非从 1 重排
        let text = round_trip("3. three\n4. four\n5. five\n");
        assert!(text.contains("3. three"), "start=3 first item: {text}");
        assert!(text.contains("4. four"), "start=3 second item: {text}");
        assert!(text.contains("5. five"), "start=3 third item: {text}");
        assert!(
            !text.contains("1. three"),
            "list with start=3 was renumbered to 1: {text}"
        );
    }

    #[test]
    fn task_list_marker_survives() {
        let text = round_trip("- [x] done\n- [ ] todo\n");
        assert!(text.contains("☑"), "checked marker missing: {text}");
        assert!(text.contains("☐"), "unchecked marker missing: {text}");
        assert!(text.contains("done"), "label missing: {text}");
        assert!(text.contains("todo"), "label missing: {text}");
    }

    #[test]
    fn table_emits_header_and_cells() {
        let text = round_trip("| a | b |\n| - | - |\n| 1 | 2 |\n");
        assert!(text.contains("a"), "header a missing: {text}");
        assert!(text.contains("b"), "header b missing: {text}");
        assert!(text.contains("1"), "cell 1 missing: {text}");
        assert!(text.contains("2"), "cell 2 missing: {text}");
    }

    #[test]
    fn table_cell_preserves_inline_formatting() {
        let text = round_trip(
            "| col |\n| - |\n| [link](https://x.com) **bold** *em* `code` |\n",
        );
        assert!(text.contains("link"), "link text missing: {text}");
        assert!(text.contains("https://x.com"), "link url missing: {text}");
        assert!(text.contains("bold"), "bold text missing: {text}");
        assert!(text.contains("em"), "italic text missing: {text}");
        assert!(text.contains("code"), "code text missing: {text}");
    }

    #[test]
    fn table_cell_with_code_uses_monospace_font() {
        // 表格单元格的行内代码必须使用等宽字体对
        // 主题代码字体栈解析取首个具体字体（默认栈解析为 "SF Mono"），
        // 此处显式指定 Courier New 验证字体写入
        let mut theme = ExportTheme::default();
        theme.code_font = "\"Courier New\", monospace".to_string();
        let bytes = pack(
            build_docx(
                "| a |\n| - |\n| `x` |\n",
                &HashMap::new(),
                &HashMap::new(),
                &theme,
            )
            .expect("build")
            .0,
        );
        let text = docx_text(&bytes);
        assert!(text.contains("x"), "code text missing: {text}");
        let packed = String::from_utf8_lossy(&bytes);
        assert!(
            packed.contains("Courier New"),
            "monospace font Courier New not set on table-cell code run"
        );
    }

    #[test]
    fn oversized_markdown_is_rejected() {
        let md = "a".repeat(MAX_MARKDOWN_BYTES + 1);
        let err = markdown_to_docx(md, HashMap::new(), HashMap::new(), &ExportTheme::default())
            .unwrap_err();
        assert!(
            matches!(err, ExportError::MarkdownTooLarge { .. }),
            "expected MarkdownTooLarge, got {err:?}"
        );
    }

    #[test]
    fn markdown_to_html_wraps_in_doctype() {
        let html = markdown_to_html(
            "# hi\n".to_string(),
            &ExportTheme::default(),
            &HashMap::new(),
            &HashMap::new(),
        )
        .expect("markdown_to_html");
        assert!(html.starts_with("<!DOCTYPE html>"));
        assert!(html.contains("<h1"));
        assert!(html.contains(">hi<"));
        // 打印分页 CSS 注入（打印保真）
        assert!(html.contains("page-break-after: avoid"));
    }

    #[test]
    fn no_lint_smoke() {
        // 空输入也应产出合法 zip（PK 头）
        let bytes = pack(
            build_docx("", &HashMap::new(), &HashMap::new(), &ExportTheme::default())
                .expect("build")
                .0,
        );
        let mut head = [0u8; 2];
        let mut cur = std::io::Cursor::new(&bytes);
        cur.read_exact(&mut head).unwrap();
        assert_eq!(&head, b"PK");
    }

    // ── v3.1 回归测试 ─────────────────────────────────────────────

    /// 列表在引用块内必须嵌套于引用中（v3.1 push_block 调度修复）
    #[test]
    fn blockquote_contains_list_item() {
        let text = round_trip("> - item in quote\n");
        assert!(text.contains("• item in quote"), "item in quote missing: {text}");
        assert!(text.contains("item in quote"), "quote body missing: {text}");
    }

    /// 列表项内的子列表必须保留嵌套上下文
    #[test]
    fn nested_list_keeps_inner_item() {
        let text = round_trip("- outer\n  - inner\n");
        assert!(text.contains("• outer"), "outer item missing: {text}");
        assert!(text.contains("• inner"), "inner item missing: {text}");
    }

    /// `[![alt](img-url)](link-url)` 图片与链接 URL 均须保留
    #[test]
    fn image_inside_link_preserves_both_urls() {
        let text = round_trip("[![alt](https://img.example.com/p.png)](https://x.com)\n");
        assert!(
            text.contains("https://img.example.com/p.png"),
            "image url missing: {text}"
        );
        assert!(text.contains("https://x.com"), "link url missing: {text}");
        assert!(text.contains("alt"), "image alt missing: {text}");
    }

    /// 嵌套引用 `> outer\n> > nested` 双方内容均须保留
    #[test]
    fn nested_blockquote_keeps_outer_and_inner_body() {
        let text = round_trip("> outer line\n> > nested\n");
        assert!(text.contains("outer line"), "outer quote body missing: {text}");
        assert!(text.contains("nested"), "nested quote body missing: {text}");
    }

    #[test]
    fn nested_blockquote_preserves_outer_paragraph() {
        let text = round_trip("> a\n> > b\n");
        assert!(text.contains("a"), "outer 'a' missing: {text}");
        assert!(text.contains("b"), "inner 'b' missing: {text}");
    }

    /// 嵌套链接 `[[text](inner)](outer)` 内层锚文本不得丢失
    #[test]
    fn nested_link_keeps_inner_anchor_text() {
        let text = round_trip("[[text](https://inner.example.com)](https://outer.example.com)\n");
        assert!(
            text.contains("https://inner.example.com"),
            "inner url missing: {text}"
        );
        assert!(
            text.contains("https://outer.example.com"),
            "outer url missing: {text}"
        );
        assert!(text.contains("text"), "inner anchor text missing: {text}");
    }

    // ── 图片嵌入 & 自定义块 ────────────────────────────────────────

    /// 有 base64 字节时必须产出 `<w:drawing>` 真实图片元素
    #[test]
    fn image_with_inlined_asset_renders_drawing() {
        // 1x1 透明 PNG（最小合法 PNG，确定性常量）
        let png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
        let url = "https://cdn.example.com/dot.png".to_string();
        let mut assets = HashMap::new();
        assets.insert(
            url.clone(),
            base64::engine::general_purpose::STANDARD
                .decode(png_b64)
                .expect("decode png"),
        );

        let bytes = markdown_to_docx(
            format!("![alt]({})\n", url),
            assets,
            HashMap::new(),
            &ExportTheme::default(),
        )
        .expect("markdown_to_docx");
        let packed = String::from_utf8_lossy(&bytes);

        assert!(
            packed.contains("<w:drawing"),
            "expected <w:drawing> in packed DOCX; asset was not embedded"
        );
        assert!(
            !packed.contains("[图片]"),
            "[图片] placeholder should be skipped when asset is provided"
        );
    }

    /// 无资源时回退占位文本（优雅降级，导出流程不中断）
    #[test]
    fn image_with_missing_asset_falls_back_to_placeholder() {
        let text = round_trip("![alt](https://nope.example.com/x.png)\n");
        assert!(text.contains("alt"), "alt text missing: {text}");
        assert!(
            text.contains("https://nope.example.com/x.png"),
            "image url missing: {text}"
        );
    }

    /// mermaid 无渲染资源时保留源码（降级路径）
    #[test]
    fn mermaid_code_block_falls_back_to_source() {
        let text = round_trip("```mermaid\ngraph TD; A-->B;\n```\n");
        assert!(text.contains("[mermaid]"), "language tag missing: {text}");
        assert!(text.contains("graph TD"), "code body missing: {text}");
    }

    // ── 主题参数化测试 ─────────────────────────────────────────────

    /// 主题字色应写入文本 run（color 属性跟随主题而非硬编码）
    #[test]
    fn theme_text_color_applied_to_runs() {
        let mut theme = ExportTheme::default();
        theme.text_color = "#1a2b3c".to_string();
        let bytes = pack(
            build_docx("hello", &HashMap::new(), &HashMap::new(), &theme)
                .expect("build")
                .0,
        );
        let packed = String::from_utf8_lossy(&bytes);
        assert!(
            packed.contains("1a2b3c"),
            "theme text color missing in packed DOCX"
        );
    }

    /// 主题正文字号（px → 半磅）应写入 run size
    #[test]
    fn theme_body_size_applied() {
        let mut theme = ExportTheme::default();
        theme.body_size = 16.0; // 16px → 24 half-points (12pt)
        let bytes = pack(
            build_docx("sized", &HashMap::new(), &HashMap::new(), &theme)
                .expect("build")
                .0,
        );
        let packed = String::from_utf8_lossy(&bytes);
        assert!(
            packed.contains("w:sz w:val=\"24\""),
            "theme body size (24 half-points) missing: size attr not found"
        );
    }

    /// CSS 颜色解析：#RGB / #RRGGBB / rgb() / rgba() / 非法回退
    #[test]
    fn css_color_to_hex_variants() {
        assert_eq!(css_color_to_hex("#333333", "000000"), "333333");
        assert_eq!(css_color_to_hex("#F60", "000000"), "ff6600");
        assert_eq!(css_color_to_hex("rgb(1, 2, 3)", "000000"), "010203");
        assert_eq!(css_color_to_hex("rgba(255,0,0,0.5)", "000000"), "ff0000");
        assert_eq!(css_color_to_hex("not-a-color", "abc123"), "abc123");
    }

    /// 字体栈解析：跳过系统关键字/通用族，提取首个具体字体
    #[test]
    fn first_font_family_skips_generics() {
        assert_eq!(
            first_font_family("-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"),
            Some("Segoe UI".to_string())
        );
        assert_eq!(first_font_family("monospace"), None);
        assert_eq!(
            find_cjk_font("-apple-system, \"PingFang SC\", sans-serif"),
            Some("PingFang SC".to_string())
        );
        assert_eq!(find_cjk_font("Helvetica, Arial"), None);
    }

    // ── HTML 渲染块替换 & 图片内嵌 ────────────────────────────────

    /// mermaid 代码块应被替换为内嵌 SVG 渲染产物（离线可用）
    #[test]
    fn html_replaces_mermaid_with_rendered_svg() {
        let mut svg_assets = HashMap::new();
        svg_assets.insert("__mermaid_0__".to_string(), "<svg>rendered</svg>".to_string());
        let html = markdown_to_html(
            "```mermaid\ngraph TD; A-->B;\n```\n".to_string(),
            &ExportTheme::default(),
            &svg_assets,
            &HashMap::new(),
        )
        .expect("markdown_to_html");
        assert!(html.contains("<svg>rendered</svg>"), "rendered SVG missing");
        assert!(
            !html.contains("language-mermaid"),
            "original mermaid code block should be replaced"
        );
    }

    /// 缺失渲染资源时保留原始代码块（源码兜底）
    #[test]
    fn html_keeps_code_block_when_svg_missing() {
        let html = markdown_to_html(
            "```mermaid\ngraph TD; A-->B;\n```\n".to_string(),
            &ExportTheme::default(),
            &HashMap::new(),
            &HashMap::new(),
        )
        .expect("markdown_to_html");
        assert!(html.contains("graph TD; A--&gt;B;") || html.contains("graph TD"));
    }

    /// 相对路径图片应以 data: URI 内嵌进 HTML
    #[test]
    fn html_embeds_image_data_uri() {
        let mut uris = HashMap::new();
        uris.insert(
            "./img/pic.png".to_string(),
            "data:image/png;base64,aGVsbG8=".to_string(),
        );
        let html = markdown_to_html(
            "![pic](./img/pic.png)\n".to_string(),
            &ExportTheme::default(),
            &HashMap::new(),
            &uris,
        )
        .expect("markdown_to_html");
        assert!(
            html.contains("src=\"data:image/png;base64,aGVsbG8=\""),
            "data URI src missing"
        );
    }

    /// auto_print 脚本注入（`</body>` 前插入打印脚本）
    #[test]
    fn html_auto_print_script_position() {
        let script = AUTO_PRINT_SCRIPT;
        let html = format!("<html><body><p>x</p>{}</html>", "</body>");
        let pos_body = html.rfind("</body>").unwrap();
        let mut out = html.to_string();
        out.insert_str(pos_body, script);
        assert!(out.contains(&format!("{}{}", script, "</body>")));
    }

    // ── 文件名清洗 & 重名序号 ──────────────────────────────────────

    /// 文件名清洗：剥离路径分隔符与控制字符，防路径穿越
    #[test]
    fn sanitize_file_name_strips_traversal() {
        assert_eq!(sanitize_file_name("../../etc/passwd.docx"), "passwd.docx");
        assert_eq!(sanitize_file_name("a\\b\\c.pdf"), "c.pdf");
        assert_eq!(sanitize_file_name("note\u{0000}.md"), "note.md");
        assert_eq!(sanitize_file_name("..."), "export");
        assert_eq!(sanitize_file_name("  "), "export");
    }

    /// 对话框默认文件名：清洗 + 补齐扩展名
    #[test]
    fn export_default_file_name_normalizes() {
        assert_eq!(
            export_default_file_name("../../etc/passwd.docx", "docx").unwrap(),
            "passwd.docx"
        );
        // 已带目标扩展名不重复追加
        assert_eq!(
            export_default_file_name("note.docx", "docx").unwrap(),
            "note.docx"
        );
        // 扩展名不同（大小写不敏感）则补齐
        assert_eq!(
            export_default_file_name("note.DOCX", "docx").unwrap(),
            "note.docx"
        );
        assert_eq!(
            export_default_file_name("note.md", "html").unwrap(),
            "note.md.html"
        );
        // "..." 清洗后回退默认名 "export"，不为错误
        assert_eq!(
            export_default_file_name("...", "docx").unwrap(),
            "export.docx"
        );
    }

    /// 百分号解码
    #[test]
    fn percent_decode_basic() {
        assert_eq!(percent_decode("a%20b.png"), "a b.png");
        assert_eq!(percent_decode("100%.png"), "100%.png"); // 非法序列原样保留
        assert_eq!(percent_decode("plain.png"), "plain.png");
    }
}
