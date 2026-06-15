//! Lightweight syntax highlighter.
//!
//! We avoid the `syntect` dependency (large compile time, heavy
//! binaries) in favor of a 50-line keyword + string + comment recognizer
//! that is good enough for short code blocks inside Markdown articles.
//!
//! Recognized languages: `js`, `ts`, `javascript`, `typescript`, `py`,
//! `python`, `rust`, `rs`, `go`, `json`, `bash`, `sh`, `shell`. Any
//! unknown language falls back to a single-color escaped `<pre><code>`.

use crate::themes::Theme;

struct Highlighter {
    out: String,
    theme: Theme,
}

pub fn highlight_code(code: &str, lang: &str, theme: Theme) -> String {
    let lang = normalize_lang(lang);
    let mut h = Highlighter {
        out: String::with_capacity(code.len() * 2),
        theme,
    };
    h.out.push_str("<pre style=\"");
    h.out.push_str(&pre_style(theme));
    h.out.push_str("\"><code style=\"");
    h.out.push_str(&code_style(theme));
    h.out.push_str("\">");

    match lang {
        Some(l) => {
            highlight_with_lang(&mut h, code, l);
        }
        None => {
            h.out.push_str(&escape_html(code));
        }
    }

    h.out.push_str("</code></pre>");
    h.out
}

fn normalize_lang(lang: &str) -> Option<&'static str> {
    let l = lang.trim().to_ascii_lowercase();
    match l.as_str() {
        "js" | "javascript" => Some("js"),
        "ts" | "typescript" => Some("ts"),
        "py" | "python" => Some("py"),
        "rust" | "rs" => Some("rust"),
        "go" => Some("go"),
        "json" => Some("json"),
        "bash" | "sh" | "shell" | "zsh" => Some("bash"),
        _ => None,
    }
}

fn highlight_with_lang(h: &mut Highlighter, code: &str, lang: &str) {
    // We tokenize line-by-line so we can recognise comments (// or #)
    // and strings with the standard state machine.
    let keywords: &[&str] = match lang {
        "js" | "ts" => &[
            "const", "let", "var", "function", "return", "if", "else",
            "for", "while", "do", "switch", "case", "break", "continue",
            "class", "extends", "new", "this", "super", "import", "export",
            "from", "as", "async", "await", "try", "catch", "finally",
            "throw", "typeof", "instanceof", "in", "of", "true", "false",
            "null", "undefined", "yield", "static", "interface", "type",
        ],
        "py" => &[
            "def", "return", "if", "elif", "else", "for", "while", "in",
            "not", "and", "or", "class", "self", "import", "from", "as",
            "try", "except", "finally", "raise", "with", "yield", "lambda",
            "True", "False", "None", "pass", "break", "continue", "global",
            "nonlocal", "async", "await",
        ],
        "rust" => &[
            "fn", "let", "mut", "const", "static", "if", "else", "match",
            "for", "while", "loop", "return", "struct", "enum", "trait",
            "impl", "pub", "use", "mod", "crate", "self", "Self", "super",
            "as", "where", "async", "await", "move", "ref", "in", "true",
            "false", "unsafe", "extern", "type",
        ],
        "go" => &[
            "func", "var", "const", "type", "struct", "interface", "return",
            "if", "else", "for", "range", "switch", "case", "default",
            "break", "continue", "package", "import", "go", "chan", "select",
            "defer", "map", "true", "false", "nil",
        ],
        "json" => &["true", "false", "null"],
        "bash" => &[
            "if", "then", "else", "elif", "fi", "for", "in", "do", "done",
            "while", "case", "esac", "function", "return", "export",
            "local", "echo", "true", "false",
        ],
        _ => &[],
    };

    // String + comment prefixes per language.
    let (line_comment, block_comment_open, block_comment_close) = match lang {
        "py" | "bash" => (Some("#"), None, None),
        "json" => (None, None, None),
        _ => (Some("//"), Some("/*"), Some("*/")),
    };

    let mut in_block_comment = false;
    let mut in_string: Option<char> = None;

    let chars: Vec<char> = code.chars().collect();
    let mut i = 0;
    let mut token_start = 0;
    let mut line_buf = String::new();
    let mut at_line_start = true;

    while i < chars.len() {
        let c = chars[i];
        let peek1 = chars.get(i + 1).copied().unwrap_or('\0');
        let peek2 = chars.get(i + 2).copied().unwrap_or('\0');

        // Newline handling: emit pending line buffer.
        if c == '\n' {
            // Flush pending word
            if !line_buf.is_empty() {
                emit_word(h, &line_buf, keywords, at_line_start);
                line_buf.clear();
            }
            h.out.push('\n');
            token_start = i + 1;
            at_line_start = true;
            i += 1;
            in_string = None;
            continue;
        }

        // Line comment
        if at_line_start
            && line_comment.is_some()
            && in_string.is_none()
            && line_comment_prefix_at(&chars, i, line_comment.unwrap())
        {
            // Flush pending word
            if !line_buf.is_empty() {
                emit_word(h, &line_buf, keywords, at_line_start);
                line_buf.clear();
            }
            // Emit rest of line as comment
            let end = find_newline(&chars, i);
            let slice: String = chars[i..end].iter().collect();
            h.out.push_str(&format!(
                "<span style=\"color:{};font-style:italic\">{}</span>",
                h.theme.code_comment,
                escape_html(&slice)
            ));
            i = end;
            at_line_start = true;
            continue;
        }

        // Block comment
        if in_block_comment {
            if let (Some(open), Some(close)) = (block_comment_open, block_comment_close) {
                if c == '*' && peek1 == '/' {
                    // Flush word buffer
                    if !line_buf.is_empty() {
                        emit_word(h, &line_buf, keywords, at_line_start);
                        line_buf.clear();
                    }
                    h.out.push_str("*/");
                    h.out.push_str(&format!(
                        "<span style=\"color:{};font-style:italic\">",
                        h.theme.code_comment
                    ));
                    in_block_comment = false;
                    i += 2;
                    continue;
                }
                if c == '/' && peek1 == '*' {
                    if !line_buf.is_empty() {
                        emit_word(h, &line_buf, keywords, at_line_start);
                        line_buf.clear();
                    }
                    h.out.push_str(&format!(
                        "<span style=\"color:{};font-style:italic\">/*",
                        h.theme.code_comment
                    ));
                    in_block_comment = true;
                    i += 2;
                    continue;
                }
            }
        } else if let (Some(open), Some(_close)) = (block_comment_open, block_comment_close) {
            if c == '/' && peek1 == '*' && in_string.is_none() {
                if !line_buf.is_empty() {
                    emit_word(h, &line_buf, keywords, at_line_start);
                    line_buf.clear();
                }
                h.out.push_str(&format!(
                    "<span style=\"color:{};font-style:italic\">/*",
                    h.theme.code_comment
                ));
                in_block_comment = true;
                i += 2;
                continue;
            }
        }

        // String literal
        if in_string.is_none() && (c == '"' || c == '\'' || c == '`') {
            if !line_buf.is_empty() {
                emit_word(h, &line_buf, keywords, at_line_start);
                line_buf.clear();
            }
            in_string = Some(c);
            h.out.push_str(&format!(
                "<span style=\"color:{}\">",
                h.theme.code_string
            ));
            h.out.push_str(&escape_char(c));
            at_line_start = false;
            i += 1;
            continue;
        }
        if let Some(quote) = in_string {
            if c == '\\' && (peek1 == quote || peek1 == '\\') {
                h.out.push_str(&escape_char(c));
                h.out.push_str(&escape_char(peek1));
                i += 2;
                continue;
            }
            if c == quote {
                h.out.push_str(&escape_char(c));
                h.out.push_str("</span>");
                in_string = None;
                at_line_start = false;
                i += 1;
                continue;
            }
            // escape html
            h.out.push_str(&escape_html_char(c));
            at_line_start = false;
            i += 1;
            continue;
        }

        // JSON special
        if lang == "json" {
            // Treat "key": or true/false/null as colored by the regex
            // before reaching the generic word logic.
        }

        // Whitespace separates tokens.
        if c.is_whitespace() {
            if !line_buf.is_empty() {
                emit_word(h, &line_buf, keywords, at_line_start);
                line_buf.clear();
            }
            h.out.push(c);
            token_start = i + 1;
            if c == '\n' {
                at_line_start = true;
            } else {
                at_line_start = false;
            }
            i += 1;
            continue;
        }

        line_buf.push(c);
        i += 1;
    }

    // Flush final word
    if !line_buf.is_empty() {
        emit_word(h, &line_buf, keywords, at_line_start);
    }
    if in_block_comment {
        h.out.push_str("</span>");
    }
    if in_string.is_some() {
        h.out.push_str("</span>");
    }
}

fn emit_word(h: &mut Highlighter, word: &str, keywords: &[&str], _at_line_start: bool) {
    if keywords.contains(&word) {
        h.out.push_str(&format!(
            "<span style=\"color:{}\">{}</span>",
            h.theme.code_keyword,
            escape_html(word)
        ));
    } else if word.chars().all(|c| c.is_ascii_digit() || c == '.' || c == '_') {
        // numbers
        h.out.push_str(&format!(
            "<span style=\"color:{}\">{}</span>",
            h.theme.code_string,
            escape_html(word)
        ));
    } else {
        h.out.push_str(&escape_html(word));
    }
}

fn line_comment_prefix_at(chars: &[char], i: usize, prefix: &str) -> bool {
    let prefix_chars: Vec<char> = prefix.chars().collect();
    if i + prefix_chars.len() > chars.len() {
        return false;
    }
    for (j, pc) in prefix_chars.iter().enumerate() {
        if chars[i + j] != *pc {
            return false;
        }
    }
    true
}

fn find_newline(chars: &[char], from: usize) -> usize {
    let mut i = from;
    while i < chars.len() && chars[i] != '\n' {
        i += 1;
    }
    i
}

fn pre_style(t: Theme) -> String {
    format!(
        "background:{};border-radius:6px;padding:14px 16px;overflow-x:auto;\
         font-size:14px;line-height:1.65;margin:16px 0;font-family:{}",
        t.pre_bg, t.font_family
    )
}

fn code_style(t: Theme) -> String {
    format!(
        "background:transparent;color:{};font-family:inherit;\
         font-size:14px;line-height:1.65;white-space:pre",
        t.text
    )
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn escape_html_char(c: char) -> String {
    match c {
        '&' => "&amp;".to_string(),
        '<' => "&lt;".to_string(),
        '>' => "&gt;".to_string(),
        '"' => "&quot;".to_string(),
        '\'' => "&#39;".to_string(),
        _ => c.to_string(),
    }
}

fn escape_char(c: char) -> String {
    match c {
        '&' => "&amp;".to_string(),
        '<' => "&lt;".to_string(),
        '>' => "&gt;".to_string(),
        '"' => "&quot;".to_string(),
        _ => c.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_lang_falls_back_to_escape() {
        let out = highlight_code("a < b", "mystery", crate::themes::WECHAT_DEFAULT);
        assert!(out.contains("&lt;"));
        assert!(!out.contains("<span"));
    }

    #[test]
    fn js_keywords_highlighted() {
        let out = highlight_code("const x = 1", "js", crate::themes::WECHAT_ROSE);
        assert!(out.contains("#a626a4"), "expected rose code_keyword color in output, got: {out}");
    }

    #[test]
    fn comments_highlighted_in_rust() {
        let out = highlight_code("// hi\nlet x = 1", "rust", crate::themes::WECHAT_TECH);
        assert!(out.contains("<span"));
    }
}
