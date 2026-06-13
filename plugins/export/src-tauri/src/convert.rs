/**
 * Markdown → DOCX conversion logic.
 *
 * This module is the core conversion engine used by the JSON-RPC
 * backend binary (main.rs). It is framework-agnostic and has no
 * dependency on Tauri or any other application framework.
 */
use docx_rs::*;
use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use std::io::Cursor;
use base64::Engine;
use thiserror::Error;

// ─── Error type ──────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum ExportError {
    #[error("DOCX generation failed: {0}")]
    DocxGeneration(String),
    #[error("HTML generation failed: {0}")]
    HtmlGeneration(String),
    #[error("Markdown parsing failed: {0}")]
    MarkdownParsing(String),
}

// ─── Core function ───────────────────────────────────────────────────────────

/// Convert a Markdown string to a DOCX file and return base64-encoded bytes.
pub fn markdown_to_docx(markdown: String) -> Result<String, ExportError> {
    let doc = build_docx(&markdown)?;
    let mut buf = Cursor::new(Vec::new());
    doc.build()
        .pack(&mut buf)
        .map_err(|e| ExportError::DocxGeneration(format!("docx-rs pack failed: {}", e)))?;
    let bytes = buf.into_inner();
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(b64)
}

// ─── Intermediate types ──────────────────────────────────────────────────────

#[derive(Clone, Debug)]
enum Inline {
    Text(String),
    Bold(String),
    Italic(String),
    BoldItalic(String),
    Code(String),
    SoftBreak,
}

#[derive(Clone, Debug)]
enum Block {
    Heading { level: usize, inlines: Vec<Inline> },
    Paragraph(Vec<Inline>),
    CodeBlock { code: String },
    ListItem { depth: usize, inlines: Vec<Inline> },
    Table { headers: Vec<Vec<Inline>>, rows: Vec<Vec<Vec<Inline>>> },
}

// ─── DOCX builder ────────────────────────────────────────────────────────────

fn build_docx(markdown: &str) -> Result<Docx, ExportError> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(markdown, options);
    let blocks = parse_blocks(parser);

    let mut doc = Docx::new();

    for block in &blocks {
        match block {
            Block::Heading { level, inlines } => {
                let style = format!("Heading{}", level.min(&6));
                let para = append_inlines(Paragraph::new().style(&style), inlines);
                doc = doc.add_paragraph(para);
            }
            Block::Paragraph(inlines) => {
                let para = append_inlines(Paragraph::new(), inlines);
                doc = doc.add_paragraph(para);
            }
            Block::CodeBlock { code } => {
                if !code.is_empty() {
                    let para = Paragraph::new().add_run(
                        Run::new()
                            .add_text(code)
                            .fonts(RunFonts::new().east_asia("Courier New").ascii("Courier New"))
                            .size(18),
                    );
                    doc = doc.add_paragraph(para);
                }
            }
            Block::ListItem { depth, inlines } => {
                let indent_val: i32 = (*depth as i32).min(4) * 360;
                let mut para = Paragraph::new()
                    .add_run(Run::new().add_text("• "))
                    .indent(Some(indent_val), None, None, None);
                para = append_inlines(para, inlines);
                doc = doc.add_paragraph(para);
            }
            Block::Table { headers, rows } => {
                if headers.is_empty() && rows.is_empty() {
                    continue;
                }
                let mut table = Table::new(Vec::new());
                if !headers.is_empty() {
                    let cells: Vec<TableCell> = headers.iter().map(|cell_inlines| {
                        let para = append_inlines(Paragraph::new(), cell_inlines);
                        TableCell::new().add_paragraph(para)
                    }).collect();
                    table = table.add_row(TableRow::new(cells));
                }
                for row_inlines in rows {
                    let cells: Vec<TableCell> = row_inlines.iter().map(|cell_inlines| {
                        let para = append_inlines(Paragraph::new(), cell_inlines);
                        TableCell::new().add_paragraph(para)
                    }).collect();
                    table = table.add_row(TableRow::new(cells));
                }
                doc = doc.add_table(table);
            }
        }
    }

    Ok(doc)
}

fn append_inlines(mut para: Paragraph, inlines: &[Inline]) -> Paragraph {
    for inline in inlines {
        match inline {
            Inline::Text(t) => {
                para = para.add_run(Run::new().add_text(t));
            }
            Inline::Bold(t) => {
                para = para.add_run(Run::new().add_text(t).bold());
            }
            Inline::Italic(t) => {
                para = para.add_run(Run::new().add_text(t).italic());
            }
            Inline::BoldItalic(t) => {
                para = para.add_run(Run::new().add_text(t).bold().italic());
            }
            Inline::Code(c) => {
                para = para.add_run(
                    Run::new()
                        .add_text(c)
                        .fonts(RunFonts::new().ascii("Courier New").east_asia("Courier New"))
                        .size(20),
                );
            }
            Inline::SoftBreak => {
                para = para.add_run(Run::new().add_break(BreakType::TextWrapping));
            }
        }
    }
    para
}

// ─── Markdown parser ─────────────────────────────────────────────────────────

fn parse_blocks<'a>(parser: Parser<'a>) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    let mut current_inlines: Vec<Inline> = Vec::new();
    let mut in_heading: Option<usize> = None;
    let mut in_code_block = false;
    let mut code_block_content = String::new();
    let mut list_depth: usize = 0;
    let mut in_item = false;
    let mut item_inlines: Vec<Inline> = Vec::new();
    let mut bold_stack: usize = 0;
    let mut italic_stack: usize = 0;

    let mut in_table_cell = false;
    let mut table_headers: Vec<Vec<Inline>> = Vec::new();
    let mut table_rows: Vec<Vec<Vec<Inline>>> = Vec::new();
    let mut current_row_cells: Vec<Vec<Inline>> = Vec::new();
    let mut current_cell_inlines: Vec<Inline> = Vec::new();

    for event in parser {
        match event {
            Event::Start(tag) => match tag {
                Tag::Heading { level, .. } => {
                    flush_inlines(&mut blocks, &mut current_inlines);
                    in_heading = Some(match level {
                        HeadingLevel::H1 => 1,
                        HeadingLevel::H2 => 2,
                        HeadingLevel::H3 => 3,
                        HeadingLevel::H4 => 4,
                        HeadingLevel::H5 => 5,
                        HeadingLevel::H6 => 6,
                    });
                }
                Tag::Paragraph => {
                    flush_inlines(&mut blocks, &mut current_inlines);
                }
                Tag::CodeBlock(_) => {
                    flush_inlines(&mut blocks, &mut current_inlines);
                    in_code_block = true;
                    code_block_content.clear();
                }
                Tag::List(_) => {
                    flush_inlines(&mut blocks, &mut current_inlines);
                    list_depth += 1;
                }
                Tag::Item => {
                    flush_inlines(&mut blocks, &mut current_inlines);
                    in_item = true;
                    item_inlines.clear();
                }
                Tag::Strong => { bold_stack += 1; }
                Tag::Emphasis => { italic_stack += 1; }
                Tag::Strikethrough => {}
                Tag::Table(_) => {
                    flush_inlines(&mut blocks, &mut current_inlines);
                    table_headers.clear();
                    table_rows.clear();
                    current_row_cells.clear();
                    current_cell_inlines.clear();
                }
                Tag::TableHead => { current_row_cells.clear(); }
                Tag::TableRow => { current_row_cells.clear(); }
                Tag::TableCell => {
                    in_table_cell = true;
                    current_cell_inlines.clear();
                }
                Tag::Link { .. } => {}
                Tag::Image { .. } => {}
                Tag::BlockQuote(_) => {
                    flush_inlines(&mut blocks, &mut current_inlines);
                }
                _ => {}
            },
            Event::End(tag_end) => match tag_end {
                TagEnd::Heading(_) => {
                    if let Some(level) = in_heading.take() {
                        blocks.push(Block::Heading {
                            level,
                            inlines: std::mem::take(&mut current_inlines),
                        });
                    }
                }
                TagEnd::Paragraph => {
                    flush_inlines(&mut blocks, &mut current_inlines);
                }
                TagEnd::CodeBlock => {
                    blocks.push(Block::CodeBlock {
                        code: std::mem::take(&mut code_block_content),
                    });
                    in_code_block = false;
                }
                TagEnd::List(_) => {
                    list_depth = list_depth.saturating_sub(1);
                }
                TagEnd::Item => {
                    blocks.push(Block::ListItem {
                        depth: list_depth,
                        inlines: std::mem::take(&mut item_inlines),
                    });
                    in_item = false;
                }
                TagEnd::Strong => { bold_stack = bold_stack.saturating_sub(1); }
                TagEnd::Emphasis => { italic_stack = italic_stack.saturating_sub(1); }
                TagEnd::Table => {
                    blocks.push(Block::Table {
                        headers: std::mem::take(&mut table_headers),
                        rows: std::mem::take(&mut table_rows),
                    });
                }
                TagEnd::TableHead => {
                    table_headers = std::mem::take(&mut current_row_cells);
                }
                TagEnd::TableRow => {
                    table_rows.push(std::mem::take(&mut current_row_cells));
                }
                TagEnd::TableCell => {
                    in_table_cell = false;
                    current_row_cells.push(std::mem::take(&mut current_cell_inlines));
                }
                TagEnd::BlockQuote(_) => {}
                _ => {}
            },
            Event::Text(text) => {
                if in_code_block {
                    code_block_content.push_str(&text);
                } else if in_table_cell {
                    current_cell_inlines.push(classify_inline(&text, bold_stack, italic_stack));
                } else if in_item {
                    item_inlines.push(classify_inline(&text, bold_stack, italic_stack));
                } else {
                    current_inlines.push(classify_inline(&text, bold_stack, italic_stack));
                }
            }
            Event::Code(code) => {
                let inline = Inline::Code(code.to_string());
                if in_table_cell {
                    current_cell_inlines.push(inline);
                } else if in_item {
                    item_inlines.push(inline);
                } else {
                    current_inlines.push(inline);
                }
            }
            Event::SoftBreak => {
                if in_code_block {
                    code_block_content.push('\n');
                } else if in_table_cell {
                    current_cell_inlines.push(Inline::SoftBreak);
                } else if in_item {
                    item_inlines.push(Inline::SoftBreak);
                } else {
                    current_inlines.push(Inline::SoftBreak);
                }
            }
            Event::HardBreak => {
                if in_code_block {
                    code_block_content.push('\n');
                } else if in_table_cell {
                    current_cell_inlines.push(Inline::SoftBreak);
                } else if in_item {
                    item_inlines.push(Inline::SoftBreak);
                } else {
                    current_inlines.push(Inline::SoftBreak);
                }
            }
            Event::TaskListMarker(checked) => {
                let marker = if checked { "☑ " } else { "☐ " };
                if in_item {
                    item_inlines.push(Inline::Text(marker.to_string()));
                } else {
                    current_inlines.push(Inline::Text(marker.to_string()));
                }
            }
            _ => {}
        }
    }

    flush_inlines(&mut blocks, &mut current_inlines);
    blocks
}

fn classify_inline(text: &str, bold: usize, italic: usize) -> Inline {
    match (bold > 0, italic > 0) {
        (true, true) => Inline::BoldItalic(text.to_string()),
        (true, false) => Inline::Bold(text.to_string()),
        (false, true) => Inline::Italic(text.to_string()),
        (false, false) => Inline::Text(text.to_string()),
    }
}

fn flush_inlines(blocks: &mut Vec<Block>, inlines: &mut Vec<Inline>) {
    if !inlines.is_empty() {
        blocks.push(Block::Paragraph(std::mem::take(inlines)));
    }
}

// ─── Markdown → HTML ──────────────────────────────────────────────────────────

/// Convert a Markdown string to styled HTML suitable for PDF rendering.
/// Returns a complete HTML document with embedded CSS for proper rendering.
pub fn markdown_to_html(markdown: String) -> Result<String, ExportError> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(&markdown, options);
    let mut html_output = String::new();
    pulldown_cmark::html::push_html(&mut html_output, parser);

    let html_doc = format!(
        r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #333;
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
  }}
  h1 {{ font-size: 28px; margin: 24px 0 16px; border-bottom: 1px solid #eee; padding-bottom: 8px; }}
  h2 {{ font-size: 22px; margin: 20px 0 12px; border-bottom: 1px solid #eee; padding-bottom: 6px; }}
  h3 {{ font-size: 18px; margin: 16px 0 8px; }}
  h4 {{ font-size: 16px; margin: 14px 0 6px; }}
  h5 {{ font-size: 14px; margin: 12px 0 4px; }}
  h6 {{ font-size: 13px; margin: 10px 0 4px; color: #666; }}
  p {{ margin: 8px 0; }}
  code {{
    font-family: "SF Mono", "Menlo", "Monaco", "Courier New", monospace;
    font-size: 12px;
    background: #f6f8fa;
    padding: 2px 6px;
    border-radius: 3px;
  }}
  pre {{
    background: #f6f8fa;
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
  }}
  pre code {{
    background: none;
    padding: 0;
  }}
  blockquote {{
    border-left: 4px solid #ddd;
    margin: 8px 0;
    padding: 4px 16px;
    color: #666;
  }}
  table {{
    border-collapse: collapse;
    width: 100%;
    margin: 12px 0;
  }}
  th, td {{
    border: 1px solid #ddd;
    padding: 6px 12px;
    text-align: left;
  }}
  th {{
    background: #f6f8fa;
    font-weight: bold;
  }}
  ul, ol {{
    padding-left: 24px;
    margin: 8px 0;
  }}
  li {{ margin: 4px 0; }}
  hr {{ border: none; border-top: 1px solid #eee; margin: 16px 0; }}
  img {{ max-width: 100%; }}
  a {{ color: #0366d6; text-decoration: none; }}
  del {{ text-decoration: line-through; color: #666; }}
</style>
</head>
<body>
{}
</body>
</html>"#,
        html_output
    );

    Ok(html_doc)
}
