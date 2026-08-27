use std::path::Path;

/// Convert a filesystem path to the forward-slash form required by Git commands.
/// Git expects '/' separators on Windows; passing native backslashes will
/// fail for paths like "HEAD:foo\\bar.md" or "git add foo\\bar.md".
/// On Unix-like systems backslashes are valid filename characters, so we only
/// normalize on Windows to avoid corrupting legitimate filenames.
pub fn to_git_path(path: &Path) -> String {
    #[cfg(target_os = "windows")]
    {
        path.to_string_lossy().replace('\\', "/")
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_string_lossy().to_string()
    }
}

/// Unescape git path output that may contain octal escape sequences like \346\205\221
/// Git uses these for non-ASCII filenames when core.quotepath is true (the default).
/// For example: "\346\210\221\347\232\204\345\267\245\344\275\234/test.md" -> "我的工作/test.md"
/// UTF-8 characters are encoded as multiple consecutive \NNN sequences (one per byte).
pub fn unescape_git_path(path: &str) -> String {
    let mut result = String::with_capacity(path.len());
    let mut i = 0;
    let bytes = path.as_bytes();

    while i < bytes.len() {
        if bytes[i] == b'\\' {
            // 先处理 \\ 和 \" 反转义（必须在八进制转义之前判断，避免 \\\NNN 被误解析）
            if i + 1 < bytes.len() {
                if bytes[i + 1] == b'\\' {
                    // \\ → \
                    result.push('\\');
                    i += 2;
                    continue;
                }
                if bytes[i + 1] == b'"' {
                    // \" → "
                    result.push('"');
                    i += 2;
                    continue;
                }
            }
            // Try to parse octal escape: \NNN
            if i + 3 < bytes.len() {
                if let (Some(d1), Some(d2), Some(d3)) = (
                    char::from(bytes[i + 1]).to_digit(8),
                    char::from(bytes[i + 2]).to_digit(8),
                    char::from(bytes[i + 3]).to_digit(8),
                ) {
                    let byte_val = (d1 << 6 | d2 << 3 | d3) as u8;
                    // Collect consecutive escaped bytes to form valid UTF-8
                    let mut byte_buf = vec![byte_val];
                    let mut j = i + 4;
                    while j + 3 < bytes.len() && bytes[j] == b'\\' {
                        if let (Some(nd1), Some(nd2), Some(nd3)) = (
                            char::from(bytes[j + 1]).to_digit(8),
                            char::from(bytes[j + 2]).to_digit(8),
                            char::from(bytes[j + 3]).to_digit(8),
                        ) {
                            let next_byte = (nd1 << 6 | nd2 << 3 | nd3) as u8;
                            byte_buf.push(next_byte);
                            j += 4;
                        } else {
                            break;
                        }
                    }
                    // Decode the collected bytes as UTF-8
                    let decoded = String::from_utf8_lossy(&byte_buf);
                    result.push_str(&decoded);
                    i = j;
                    continue;
                }
            }
        }
        // Regular character
        if let Some(c) = path[i..].chars().next() {
            result.push(c);
            i += c.len_utf8();
        } else {
            i += 1;
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unescape_git_path_plain() {
        // 普通路径不做转义处理
        assert_eq!(unescape_git_path("src/main.rs"), "src/main.rs");
        assert_eq!(unescape_git_path("path/to/file.txt"), "path/to/file.txt");
    }

    #[test]
    fn test_unescape_git_path_octal_utf8() {
        // 中文路径 \346\210\221 = "我" (3 字节 UTF-8)
        let escaped = "\\346\\210\\221.md";
        assert_eq!(unescape_git_path(escaped), "我.md");
    }

    #[test]
    fn test_unescape_git_path_backslash() {
        // \\ → \
        assert_eq!(unescape_git_path("path\\\\to\\\\file"), "path\\to\\file");
    }

    #[test]
    fn test_unescape_git_path_escaped_quote() {
        // \" → "
        let escaped = "\\\"quoted\\\".md";
        assert_eq!(unescape_git_path(escaped), "\"quoted\".md");
    }

    #[test]
    fn test_unescape_git_path_mixed() {
        // 混合转义：反斜杠 + 八进制 UTF-8
        let escaped = "path\\\\\\346\\210\\221.txt";
        assert_eq!(unescape_git_path(escaped), "path\\我.txt");
    }

    #[test]
    fn test_unescape_git_path_quoted_path() {
        // git quotepath 输出形如 "\346\210\221.md"，首尾引号由调用方 trim，
        // unescape_git_path 只负责转义还原
        let escaped = "\\346\\210\\221\\347\\232\\204\\347\\254\\224\\350\\256\\260.md";
        assert_eq!(unescape_git_path(escaped), "我的笔记.md");
    }

    #[test]
    fn test_unescape_git_path_trailing_backslash() {
        // 末尾单独的 \ 无后续字符，原样保留
        assert_eq!(unescape_git_path("path\\"), "path\\");
    }

    #[test]
    fn test_unescape_git_path_incomplete_octal() {
        // \NN 不够 3 位时不做八进制转义，原样保留
        assert_eq!(unescape_git_path("\\34"), "\\34");
    }

    #[test]
    fn test_to_git_path_normalizes_for_target_platform() {
        // On Windows backslashes are path separators and must be converted to '/' for Git.
        // On Unix-like systems backslashes are valid filename characters and must be preserved.
        #[cfg(target_os = "windows")]
        {
            assert_eq!(to_git_path(std::path::Path::new("foo\\bar\\baz.md")), "foo/bar/baz.md");
            assert_eq!(to_git_path(std::path::Path::new("D:\\repo\\我的工作\\202607.md")), "D:/repo/我的工作/202607.md");
            assert_eq!(to_git_path(std::path::Path::new("simple.md")), "simple.md");
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(to_git_path(std::path::Path::new("foo/bar/baz.md")), "foo/bar/baz.md");
            assert_eq!(to_git_path(std::path::Path::new("repo/我的工作/202607.md")), "repo/我的工作/202607.md");
            // A backslash inside a filename must not be altered on Unix.
            assert_eq!(to_git_path(std::path::Path::new("my\\file.md")), "my\\file.md");
        }
    }

    #[test]
    fn test_to_git_path_windows_backslash() {
        // On Windows, backslashes are path separators and must be converted to forward slashes.
        // On non-Windows, this test is a no-op (the if-block is skipped).
        if cfg!(windows) {
            assert_eq!(to_git_path(std::path::Path::new("foo\\bar\\baz.md")), "foo/bar/baz.md");
            assert_eq!(to_git_path(std::path::Path::new("D:\\repo\\notes\\test.md")), "D:/repo/notes/test.md");
            // Multiple consecutive backslashes are each converted
            assert_eq!(to_git_path(std::path::Path::new("a\\b\\c\\d.txt")), "a/b/c/d.txt");
            // No backslashes → unchanged
            assert_eq!(to_git_path(std::path::Path::new("simple.md")), "simple.md");
        }
    }

    #[test]
    fn test_to_git_path_unix_backslash_preserved() {
        // On non-Windows, backslashes are valid filename characters and must be preserved.
        // On Windows, this test is a no-op (the if-block is skipped).
        if !cfg!(windows) {
            // A backslash inside a filename must not be altered on Unix.
            assert_eq!(to_git_path(std::path::Path::new("my\\file.md")), "my\\file.md");
            // Multiple backslashes preserved
            assert_eq!(to_git_path(std::path::Path::new("weird\\name\\file.txt")), "weird\\name\\file.txt");
            // Forward slashes unchanged
            assert_eq!(to_git_path(std::path::Path::new("foo/bar/baz.md")), "foo/bar/baz.md");
        }
    }

    #[test]
    fn test_unescape_git_path_octal() {
        // \303\244 is the UTF-8 encoding of 'ä' (0xC3 0xA4 = 195 164 = octal 303 244)
        let escaped = "\\303\\244";
        assert_eq!(unescape_git_path(escaped), "ä");

        // Multiple UTF-8 chars: "über" = \303\274ber
        // 'ü' = U+00FC = UTF-8 0xC3 0xBC = octal 303 274
        let escaped_u = "\\303\\274ber";
        assert_eq!(unescape_git_path(escaped_u), "über");
    }
}
