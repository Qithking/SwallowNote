//! Markdown → themed HTML conversion.
//!
//! The output is an HTML **fragment** (no `<html><head><body>`) that the
//! caller can either paste directly into the WeChat editor (where the
//! fragment becomes a child of the editor's content area) or render in a
//! preview pane via `dangerouslySetInnerHTML`.
//!
//! Design notes:
//!  - All visual rules live in `themes::Theme`. Every emitted element
//!    gets a `style="..."` attribute with the values from the chosen
//!    theme. There are no `<style>` blocks, no classes, no external
//!    stylesheet references — those get stripped by the WeChat editor.
//!  - The renderer is hand-rolled on top of `pulldown-cmark` events so
//!    we can interleave `style` attributes on every tag without depending
//!    on a third-party Markdown-It fork.
//!  - Code blocks are routed through `highlight::highlight_code` which
//!    produces `<pre><code>` fragments with span-level coloring.

use crate::highlight::highlight_code;
use crate::themes::Theme;
use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConvertError {
    #[error("markdown parsing failed: {0}")]
    Markdown(String),
}

pub fn markdown_to_themed_html(
    markdown: &str,
    theme: Theme,
    platform: &str,
) -> Result<String, ConvertError> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(markdown, options);
    let mut writer = HtmlWriter::new(theme, platform);

    for event in parser {
        writer.handle_event(event);
    }

    writer.finalize();
    Ok(writer.into_string())
}

// ─── Writer state machine ───────────────────────────────────────────────────

struct HtmlWriter {
    out: String,
    theme: Theme,
    platform: String,
    /// Stack of open heading levels so end_tag can emit the matching close.
    heading_stack: Vec<usize>,
    /// Stack of open list kinds (true = ordered) so end_tag can emit the
    /// matching close (`</ol>` vs `</ul>`).
    list_stack: Vec<bool>,
    /// Open list depth (1 = top-level). Used to compute indent.
    list_depth: usize,
    /// Is the *current* list item a task list item? Set to `true` by
    /// `push_task_marker` and consumed by `End(Item)` so we don't
    /// double-prefix task list items (■/□ + •).
    current_item_is_task: bool,
    /// Currently in a list item? If so, the next inline emission routes
    /// to the item buffer instead of the document buffer.
    in_item: bool,
    item_buf: String,
    /// Currently in a code block, accumulating text.
    in_code_block: bool,
    code_lang: String,
    code_buf: String,
    /// Currently in a blockquote, accumulating paragraph inlines.
    in_blockquote: bool,
    blockquote_buf: String,
    /// Currently in a table; collecting rows and cells.
    in_table: bool,
    table_rows: Vec<Vec<String>>,
    current_row: Vec<String>,
    current_cell: String,
    in_table_head: bool,
    table_headers: Vec<String>,
}

impl HtmlWriter {
    fn new(theme: Theme, platform: &str) -> Self {
        Self {
            out: String::with_capacity(4096),
            theme,
            platform: platform.to_string(),
            heading_stack: Vec::new(),
            list_stack: Vec::new(),
            list_depth: 0,
            current_item_is_task: false,
            in_item: false,
            item_buf: String::new(),
            in_code_block: false,
            code_lang: String::new(),
            code_buf: String::new(),
            in_blockquote: false,
            blockquote_buf: String::new(),
            in_table: false,
            table_rows: Vec::new(),
            current_row: Vec::new(),
            current_cell: String::new(),
            in_table_head: false,
            table_headers: Vec::new(),
        }
    }

    fn into_string(self) -> String {
        self.out
    }

    fn handle_event(&mut self, event: Event<'_>) {
        match event {
            Event::Start(tag) => self.start_tag(tag),
            Event::End(tag_end) => self.end_tag(tag_end),
            Event::Text(text) => self.push_text(&text),
            Event::Code(text) => self.push_inline_code(&text),
            Event::SoftBreak => self.push_soft_break(),
            Event::HardBreak => self.push_hard_break(),
            Event::Rule => self.push_rule(),
            Event::TaskListMarker(checked) => self.push_task_marker(checked),
            // Drop raw HTML, math and footnote refs for MVP safety.
            Event::Html(_)
            | Event::InlineHtml(_)
            | Event::InlineMath(_)
            | Event::DisplayMath(_)
            | Event::FootnoteReference(_) => {}
        }
    }

    fn start_tag(&mut self, tag: Tag<'_>) {
        match tag {
            Tag::Paragraph => {
                if self.in_blockquote {
                    // accumulate in blockquote_buf
                } else if self.in_item {
                    // accumulate in item_buf
                } else {
                    self.out.push_str(&format!(
                        "<p style=\"{}\">",
                        paragraph_style(self.theme)
                    ));
                }
            }
            Tag::Heading { level, .. } => {
                let lvl = match level {
                    HeadingLevel::H1 => 1,
                    HeadingLevel::H2 => 2,
                    HeadingLevel::H3 => 3,
                    HeadingLevel::H4 => 4,
                    HeadingLevel::H5 => 5,
                    HeadingLevel::H6 => 6,
                };
                self.heading_stack.push(lvl);
                self.out.push_str(&heading_open(lvl, self.theme));
            }
            Tag::BlockQuote(_) => {
                self.in_blockquote = true;
                self.blockquote_buf.clear();
                self.out
                    .push_str(&format!("<blockquote style=\"{}\">", blockquote_style(self.theme)));
            }
            Tag::CodeBlock(kind) => {
                self.in_code_block = true;
                self.code_buf.clear();
                self.code_lang = match kind {
                    pulldown_cmark::CodeBlockKind::Indented => String::new(),
                    pulldown_cmark::CodeBlockKind::Fenced(lang) => lang.to_string(),
                };
            }
            Tag::List(start) => {
                // If we're inside a list item and have buffered text,
                // flush it *before* the nested list starts so the outer
                // item's text appears before the nested <ul>/<ol> in
                // document order. Without this, the inner `Start(Item)`
                // would `clear()` the buffer and the outer text is lost.
                if self.in_item && !self.item_buf.is_empty() {
                    if let Some(&ordered) = self.list_stack.last() {
                        let prefix = if ordered { "1. " } else { "• " };
                        let buf = format!("{prefix}{}", self.item_buf);
                        self.out.push_str(&format!(
                            "<span style=\"{}\">{}</span>",
                            paragraph_style(self.theme),
                            buf
                        ));
                        self.item_buf.clear();
                    }
                }
                let ordered = start.is_some();
                self.list_stack.push(ordered);
                self.list_depth += 1;
                if ordered {
                    self.out
                        .push_str(&format!("<ol style=\"{}\">", list_style(self.theme, true)));
                } else {
                    self.out
                        .push_str(&format!("<ul style=\"{}\">", list_style(self.theme, false)));
                }
            }
            Tag::Item => {
                self.in_item = true;
                self.item_buf.clear();
                // Reset the task-list flag; `push_task_marker` will
                // re-set it if this item is a task list item. Bullet
                // prefix is decided in `End(Item)` after we know.
                self.current_item_is_task = false;
                // Visual bullet/ordinal prefix is emitted in `End(Item)`
                // because at this point we don't yet know whether the
                // upcoming `TaskListMarker` event will mark this item
                // as a task list item (which should not get a •/1.
                // prefix on top of the ■/□).
                self.out.push_str("<li style=\"");
                self.out.push_str(&list_item_style(self.theme, self.list_depth));
                self.out.push_str("\">");
            }
            Tag::Table(_) => {
                self.in_table = true;
                self.table_rows.clear();
                self.table_headers.clear();
                self.out
                    .push_str(&format!("<table style=\"{}\">", table_style(self.theme)));
                // Intentionally do NOT emit a leading <tbody> here —
                // the actual thead/tbody is assembled in End(Table)
                // once we know whether a header row was present.
            }
            Tag::TableHead => {
                self.in_table_head = true;
                self.current_row.clear();
            }
            Tag::TableRow => {
                self.current_row.clear();
            }
            Tag::TableCell => {
                self.current_cell.clear();
            }
            Tag::Strong => self.push_open_span("font-weight:bold;color:", self.theme.text),
            Tag::Emphasis => self.push_open_span("font-style:italic;color:", self.theme.text),
            Tag::Strikethrough => {
                self.push_open_span("text-decoration:line-through;color:", self.theme.text_muted)
            }
            Tag::Link { dest_url, title, .. } => {
                self.flush_inline_buffers();
                let mut attrs = format!(
                    "href=\"{}\" style=\"{}\"",
                    escape_attr(&dest_url),
                    link_style(self.theme)
                );
                if !title.is_empty() {
                    attrs.push_str(&format!(" title=\"{}\"", escape_attr(&title)));
                }
                self.out.push_str(&format!("<a {attrs}>"));
            }
            Tag::Image { dest_url, title, .. } => {
                self.flush_inline_buffers();
                let mut attrs = format!(
                    "src=\"{}\" style=\"{}\"",
                    escape_attr(&dest_url),
                    image_style(self.theme)
                );
                if !title.is_empty() {
                    attrs.push_str(&format!(" alt=\"{}\" title=\"{}\"", escape_attr(&title), escape_attr(&title)));
                } else {
                    attrs.push_str(&format!(" alt=\"{}\"", escape_attr(&dest_url)));
                }
                self.out.push_str(&format!("<img {attrs} />"));
            }
            _ => {}
        }
    }

    fn end_tag(&mut self, tag_end: TagEnd) {
        match tag_end {
            TagEnd::Paragraph => {
                if self.in_blockquote {
                    // blockquote is buffered, not flushed per-paragraph
                } else if self.in_item {
                    // item is buffered
                } else {
                    self.out.push_str("</p>");
                }
            }
            TagEnd::Heading(_) => {
                if let Some(lvl) = self.heading_stack.pop() {
                    self.out.push_str(&heading_close(lvl));
                }
            }
            TagEnd::BlockQuote(_) => {
                if !self.blockquote_buf.is_empty() {
                    self.out
                        .push_str(&format!("<p style=\"{}\">", paragraph_style(self.theme)));
                    self.out.push_str(&self.blockquote_buf);
                    self.out.push_str("</p>");
                    self.blockquote_buf.clear();
                }
                self.out.push_str("</blockquote>");
                self.in_blockquote = false;
            }
            TagEnd::CodeBlock => {
                let lang = self.code_lang.clone();
                self.out.push_str(&highlight_code(
                    &self.code_buf,
                    &lang,
                    self.theme,
                ));
                self.in_code_block = false;
                self.code_buf.clear();
            }
            TagEnd::List(_) => {
                // Close either </ol> or </ul>; we just popped depth, so
                // emit both safe tags; the open determines the close.
                self.list_depth = self.list_depth.saturating_sub(1);
                if let Some(ordered) = self.list_stack.pop() {
                    self.out.push_str(if ordered { "</ol>" } else { "</ul>" });
                } else {
                    self.out.push_str("</ul>");
                }
            }
            TagEnd::Item => {
                // Prepend the visual bullet/ordinal prefix *here* (not
                // in `Start(Item)`) so we know whether `push_task_marker`
                // has fired and marked this item as a task list item.
                // Task items already have a ■/□ in `item_buf`; we must
                // not stack a •/1. on top of it.
                if !self.item_buf.is_empty() && !self.current_item_is_task {
                    if let Some(&ordered) = self.list_stack.last() {
                        let prefix = if ordered { "1. " } else { "• " };
                        self.item_buf = format!("{prefix}{}", self.item_buf);
                    }
                }
                // Flush any inline content accumulated during the item.
                // If the buffer is empty (e.g. the text was already
                // flushed in `Start(List)` because this item contains a
                // nested list), we skip emitting a bare prefix span.
                if !self.item_buf.is_empty() {
                    self.out.push_str(&format!(
                        "<span style=\"{}\">{}</span>",
                        paragraph_style(self.theme),
                        self.item_buf
                    ));
                    self.item_buf.clear();
                }
                self.out.push_str("</li>");
                self.in_item = false;
                self.current_item_is_task = false;
            }
            TagEnd::Strong => self.out.push_str("</span>"),
            TagEnd::Emphasis => self.out.push_str("</span>"),
            TagEnd::Strikethrough => self.out.push_str("</span>"),
            TagEnd::Link => self.out.push_str("</a>"),
            TagEnd::Image => { /* self-closing */ }
            TagEnd::Table => {
                // Assemble <thead> + <tbody> once at end, so the final
                // markup always has a single <tbody> sibling (instead
                // of the malformed "leading <tbody> + thead + tbody"
                // shape the eager-open produced before the fix).
                if !self.table_headers.is_empty() {
                    self.out.push_str("<thead><tr>");
                    for h in &self.table_headers {
                        self.out.push_str(&format!(
                            "<th style=\"{}\">{}</th>",
                            table_head_style(self.theme),
                            h
                        ));
                    }
                    self.out.push_str("</tr></thead>");
                }
                if !self.table_rows.is_empty() {
                    self.out.push_str("<tbody>");
                    for row in &self.table_rows {
                        self.out.push_str("<tr>");
                        for cell in row {
                            self.out.push_str(&format!(
                                "<td style=\"{}\">{}</td>",
                                table_cell_style(self.theme),
                                cell
                            ));
                        }
                        self.out.push_str("</tr>");
                    }
                    self.out.push_str("</tbody>");
                }
                self.out.push_str("</table>");
                self.in_table = false;
            }
            TagEnd::TableHead => {
                self.table_headers = std::mem::take(&mut self.current_row);
                self.in_table_head = false;
            }
            TagEnd::TableRow => {
                let row = std::mem::take(&mut self.current_row);
                // pulldown-cmark fires End(TableRow) BEFORE End(TableHead)
                // for the header row, then again for every body row.
                // Route the row into the correct buffer so the header
                // ends up in <thead> and the body in <tbody>.
                if self.in_table_head {
                    self.table_headers = row;
                } else {
                    self.table_rows.push(row);
                }
            }
            TagEnd::TableCell => {
                self.current_row.push(std::mem::take(&mut self.current_cell));
            }
            _ => {}
        }
    }

    fn push_text(&mut self, text: &str) {
        if self.in_code_block {
            self.code_buf.push_str(text);
            return;
        }
        if self.in_table {
            // Cells: just store raw text wrapped in paragraph style.
            self.current_cell.push_str(&inline_text_styled(text, self.theme));
            return;
        }
        let styled = inline_text_styled(text, self.theme);
        if self.in_blockquote {
            self.blockquote_buf.push_str(&styled);
        } else if self.in_item {
            self.item_buf.push_str(&styled);
        } else {
            self.out.push_str(&styled);
        }
    }

    fn push_inline_code(&mut self, text: &str) {
        let html = format!(
            "<code style=\"{}\">{}</code>",
            inline_code_style(self.theme),
            escape_html(text)
        );
        if self.in_blockquote {
            self.blockquote_buf.push_str(&html);
        } else if self.in_item {
            self.item_buf.push_str(&html);
        } else if self.in_table {
            self.current_cell.push_str(&html);
        } else {
            self.out.push_str(&html);
        }
    }

    fn push_soft_break(&mut self) {
        if self.in_code_block {
            self.code_buf.push('\n');
        } else {
            // WeChat often strips single newlines; use a space
            if self.in_blockquote {
                self.blockquote_buf.push(' ');
            } else if self.in_item {
                self.item_buf.push(' ');
            } else {
                self.out.push(' ');
            }
        }
    }

    fn push_hard_break(&mut self) {
        if self.in_code_block {
            self.code_buf.push('\n');
        } else {
            let br = format!("<br style=\"{}\"/>", "display:block;content:'';margin:6px 0");
            if self.in_blockquote {
                self.blockquote_buf.push_str(&br);
            } else if self.in_item {
                self.item_buf.push_str(&br);
            } else {
                self.out.push_str(&br);
            }
        }
    }

    fn push_rule(&mut self) {
        self.out.push_str(&format!("<hr style=\"{}\"/>", rule_style(self.theme)));
    }

    fn push_task_marker(&mut self, checked: bool) {
        // ■ (U+25A0 BLACK SQUARE) and □ (U+25A1 WHITE SQUARE) read
        // consistently across macOS / Windows / Linux fonts. The
        // previous ☑/☐ pair has noticeably different visual weight
        // depending on the font, which made task lists look uneven.
        let marker = if checked { "■ " } else { "□ " };
        self.current_item_is_task = true;
        if self.in_item {
            self.item_buf.push_str(marker);
        } else {
            self.out.push_str(marker);
        }
    }

    fn push_open_span(&mut self, partial: &str, color: &str) {
        let style = format!("{partial}{color}\"");
        if self.in_blockquote {
            self.blockquote_buf.push_str(&format!("<span style=\"{style}"));
        } else if self.in_item {
            self.item_buf.push_str(&format!("<span style=\"{style}"));
        } else {
            self.out.push_str(&format!("<span style=\"{style}"));
        }
    }

    fn flush_inline_buffers(&mut self) {
        // No-op for now; used by inline openers that might be at the
        // boundary of a buffer zone.
    }

    fn finalize(&mut self) {
        // WeChat-specific wrapping: prepend a hidden paragraph that
        // discourages the editor from silently eating the first heading.
        if self.platform == "wechat" && !self.out.is_empty() {
            // No-op for now; the styling itself is sufficient.
        }
    }
}

// ─── Style helpers ──────────────────────────────────────────────────────────

fn paragraph_style(t: Theme) -> String {
    // Tighter line-height (1.6 vs 1.75) and slightly smaller font
    // (15 vs 16) so the panel preview density matches a typical
    // markdown editor. Margin 12 also keeps paragraph spacing
    // visually aligned with the list margin (8–12px).
    format!(
        "margin:12px 0;line-height:1.6;font-size:15px;color:{};font-family:{}",
        t.text, t.font_family
    )
}

fn heading_open(level: usize, t: Theme) -> String {
    let idx = (level - 1).min(5);
    let color = t.heading[idx];
    let (size, weight, margin) = match level {
        1 => ("22px", "bold", "20px 0 12px"),
        2 => ("19px", "bold", "18px 0 10px"),
        3 => ("17px", "bold", "16px 0 8px"),
        4 => ("15px", "bold", "14px 0 8px"),
        5 => ("14px", "600", "12px 0 6px"),
        _ => ("13px", "600", "12px 0 6px"),
    };
    let extra = if level == 1 {
        "padding-bottom:8px;border-bottom:1px solid #eaecef;"
    } else {
        ""
    };
    format!(
        "<h{level} style=\"color:{color};font-size:{size};font-weight:{weight};\
         margin:{margin};line-height:1.4;{extra}font-family:{font}\">",
        color = color,
        size = size,
        weight = weight,
        margin = margin,
        extra = extra,
        font = t.font_family,
        level = level
    )
}

fn heading_close(level: usize) -> String {
    format!("</h{}>", level)
}

fn blockquote_style(t: Theme) -> String {
    format!(
        "margin:16px 0;padding:12px 16px;border-left:4px solid {};\
         background:{};color:{};border-radius:4px",
        t.blockquote_border, t.blockquote_bg, t.text
    )
}

fn list_style(t: Theme, _ordered: bool) -> String {
    // WeChat strips CSS `list-style: <bullet>`; we instead disable
    // the default browser bullet and inject a literal "•" / "1. "
    // character at item start (see `Start(Item)` / `End(Item)`).
    // padding-left 24 keeps the bullet column narrow but visible.
    format!(
        "margin:8px 0;padding-left:24px;color:{};font-family:{};list-style:none",
        t.text, t.font_family
    )
}

fn list_item_style(t: Theme, depth: usize) -> String {
    let indent = ((depth.saturating_sub(1)) * 12) as i32;
    // 1.6 line-height matches paragraph density; padding-left adds
    // a small visual indent for nested items beyond what `list_style`'s
    // `padding-left:24px` already provides.
    format!(
        "margin:6px 0;line-height:1.6;padding-left:{}px",
        indent
    )
}

fn inline_code_style(t: Theme) -> String {
    // font-weight:500 prevents inline `code` from looking too thin
    // next to surrounding regular text on macOS/Windows default
    // monospace fonts.
    format!(
        "background:{};color:{};padding:2px 6px;border-radius:3px;\
         font-size:14px;font-family:SF Mono,Menlo,Monaco,Consolas,monospace;\
         font-weight:500",
        t.code_bg, t.code_text
    )
}

fn link_style(t: Theme) -> String {
    format!(
        "color:{};text-decoration:none;border-bottom:1px solid {}",
        t.accent, t.accent
    )
}

fn image_style(_t: Theme) -> String {
    "max-width:100%;display:block;margin:16px auto;border-radius:4px".to_string()
}

fn rule_style(t: Theme) -> String {
    format!(
        "border:none;border-top:1px solid {};margin:24px 0",
        if t.is_light { "#eaecef" } else { "#3f3f46" }
    )
}

fn table_style(t: Theme) -> String {
    format!(
        "border-collapse:collapse;width:100%;margin:16px 0;font-size:14px;\
         font-family:{}",
        t.font_family
    )
}

fn table_head_style(t: Theme) -> String {
    format!(
        "border:1px solid {};padding:8px 12px;background:{};\
         text-align:left;font-weight:bold",
        t.table_border, t.table_head_bg
    )
}

fn table_cell_style(t: Theme) -> String {
    format!(
        "border:1px solid {};padding:8px 12px;text-align:left",
        t.table_border
    )
}

fn inline_text_styled(text: &str, _t: Theme) -> String {
    escape_html(text)
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::themes::WECHAT_DEFAULT;

    #[test]
    fn basic_paragraph() {
        let html = markdown_to_themed_html("hello world", WECHAT_DEFAULT, "wechat").unwrap();
        assert!(html.contains("<p"));
        assert!(html.contains("hello world"));
    }

    #[test]
    fn heading_uses_theme_color() {
        let html = markdown_to_themed_html("# Title", WECHAT_DEFAULT, "wechat").unwrap();
        assert!(html.contains("<h1"));
    }

    #[test]
    fn list_emits_ul() {
        let html =
            markdown_to_themed_html("- a\n- b", WECHAT_DEFAULT, "wechat").unwrap();
        assert!(html.contains("<ul"));
        assert!(html.contains("<li"));
    }

    #[test]
    fn code_block_uses_pre() {
        let html =
            markdown_to_themed_html("```js\nconst x = 1\n```", WECHAT_DEFAULT, "wechat")
                .unwrap();
        assert!(html.contains("<pre"));
    }

    #[test]
    fn link_has_inline_style() {
        let html =
            markdown_to_themed_html("[a](https://x.com)", WECHAT_DEFAULT, "wechat")
                .unwrap();
        assert!(html.contains("href=\"https://x.com\""));
        assert!(html.contains("style=\""));
    }

    #[test]
    fn tasklist_emits_filled_square_marker() {
        let html = markdown_to_themed_html(
            "- [x] done\n- [ ] todo",
            WECHAT_DEFAULT,
            "wechat",
        )
        .unwrap();
        // We use ■ (U+25A0) for checked and □ (U+25A1) for unchecked
        // because those two characters render with consistent visual
        // weight across macOS / Windows / Linux default fonts, while
        // the previous ☑ / ☐ pair looked uneven depending on font.
        assert!(html.contains("■"), "expected ■ in: {html}");
        assert!(html.contains("□"), "expected □ in: {html}");
        // Task items must NOT also receive a •/1. prefix on top of
        // the square marker (would look like "• ■ done").
        assert!(
            !html.contains("• ■") && !html.contains("• □"),
            "task item should not have bullet prefix stacked on square marker, got: {html}"
        );
    }

    #[test]
    fn unordered_list_item_has_bullet_prefix() {
        let html = markdown_to_themed_html("- a\n- b", WECHAT_DEFAULT, "wechat").unwrap();
        // WeChat strips CSS `list-style: <bullet>`, so we inject a
        // literal "• " character as the visual bullet. See `End(Item)`.
        assert!(html.contains("• a"), "expected • a in: {html}");
        assert!(html.contains("• b"), "expected • b in: {html}");
    }

    #[test]
    fn ordered_list_item_has_ordinal_prefix() {
        let html = markdown_to_themed_html(
            "1. first\n2. second",
            WECHAT_DEFAULT,
            "wechat",
        )
        .unwrap();
        // MVP: every ordered item gets "1. " — nested ordinals
        // (1.1.1) deferred to a later patch.
        assert!(html.contains("1. first"), "expected 1. first in: {html}");
        assert!(html.contains("1. second"), "expected 1. second in: {html}");
    }

    #[test]
    fn inline_code_has_styled_span() {
        let html =
            markdown_to_themed_html("`foo` bar", WECHAT_DEFAULT, "wechat").unwrap();
        assert!(html.contains("<code"), "expected <code> in: {html}");
        assert!(
            html.contains("background:"),
            "expected background: in <code> style in: {html}"
        );
    }

    /// Regression: the header row used to be misrouted into the body
    /// rows array, which produced an empty <thead> and dumped the
    /// header text into a <td> inside <tbody>. The fix checks
    /// `in_table_head` in `End(TableRow)`. This test exercises the
    /// full table pipeline (header + 1 body row) and asserts the
    /// canonical shape: exactly one <thead> + one <tbody>, header
    /// cells wrapped in <th>, body cells in <td>.
    /// Regression test for nested list rendering: an outer list item
    /// that contains text followed by a nested list must preserve the
    /// outer item's text. Previously `Start(Item)` unconditionally
    /// called `item_buf.clear()`, which wiped the outer item's buffered
    /// text when the nested item started.
    #[test]
    fn nested_list_preserves_outer_item_text() {
        let md = "1. Phase 1 — 显式 hook 字段（最小改动）\n   - 扩展 PluginManifest 添加可选字段\n   - 在 loadAllPlugins 流程中调用\n   - 与 React mount/unmount 解耦（系统级事件）\n";
        let html = markdown_to_themed_html(md, WECHAT_DEFAULT, "wechat").unwrap();
        println!("\n=== nested_list html ===\n{}\n========================\n", html);

        // Outer ordered item text must survive.
        assert!(
            html.contains("Phase 1"),
            "outer ordered item text 'Phase 1' missing in: {html}"
        );

        // Nested unordered item text must survive (in full).
        assert!(
            html.contains("扩展 PluginManifest"),
            "nested item text '扩展 PluginManifest' missing in: {html}"
        );
        assert!(
            html.contains("在 loadAllPlugins"),
            "nested item text '在 loadAllPlugins' missing in: {html}"
        );
        assert!(
            html.contains("与 React mount/unmount 解耦"),
            "nested item text '与 React mount/unmount 解耦' missing in: {html}"
        );
    }

    #[test]
    fn table_header_row_routes_to_thead() {
        let md = "| col1 | col2 |\n|------|------|\n| a    | b    |\n";
        let html = markdown_to_themed_html(md, WECHAT_DEFAULT, "wechat").unwrap();

        // Exactly one of each structural tag. Use `</tag>` counts to
        // avoid `<thead>` being miscounted as `<th` (both share the
        // "<th" prefix substring).
        assert_eq!(html.matches("<thead>").count(), 1, "expected 1 <thead>, got: {html}");
        assert_eq!(html.matches("</thead>").count(), 1, "expected 1 </thead>, got: {html}");
        assert_eq!(html.matches("<tbody>").count(), 1, "expected 1 <tbody>, got: {html}");
        assert_eq!(html.matches("</tbody>").count(), 1, "expected 1 </tbody>, got: {html}");
        assert_eq!(html.matches("</table>").count(), 1, "expected 1 </table>, got: {html}");

        // Count `</th>` and `</td>` rather than `<th`/`<td>` to
        // avoid the `<thead>`-contains-`<th>` substring pitfall.
        let th_count = html.matches("</th>").count();
        let td_count = html.matches("</td>").count();
        assert_eq!(th_count, 2, "expected 2 <th> for header row, got: {html}");
        assert_eq!(td_count, 2, "expected 2 <td> for body row, got: {html}");

        // Header text should appear before body text in document order
        // (thead precedes tbody in the rendered output).
        let thead_pos = html.find("<thead>").unwrap();
        let tbody_pos = html.find("<tbody>").unwrap();
        assert!(thead_pos < tbody_pos, "<thead> must come before <tbody>");

        // The header text must NOT be inside a <td> — it should be
        // inside a <th>. Spot-check that "col1" appears in a <th>.
        let col1_pos = html.find("col1").unwrap();
        // Walk backwards from col1 and find the most recent tag
        // boundary. The cell tag right before col1 must be a <th>,
        // not a <td>. We look for the position of the last `<th` or
        // `<td` before col1, then check which one is closer.
        let before = &html[..col1_pos];
        let last_th = before.rfind("<th").unwrap();
        let last_td = before.rfind("<td");
        let in_th = last_td.map_or(true, |td| last_th > td);
        assert!(in_th, "header text 'col1' should be inside <th>, got: {html}");
    }
}
