use super::models::{WordDiffPart, WordDiffResult};

/// S-25：word diff 输入大小上限（两文本合计字节数）。
/// TextDiff::from_words 的词级 diff 在超大输入（数 MB 级文件）上会消耗
/// 显著 CPU/内存（词拆分 + 对齐），冲突面板大文件场景可能卡顿。
/// 超限返回独立错误码，由前端降级为行级对比。
pub const WORD_DIFF_MAX_INPUT_BYTES: usize = 1_000_000;

/// Compute word-level diff between two text strings using the `similar` crate.
/// This performs a word-granularity diff (similar to `diffWords` in jsdiff),
/// then splits the result into separate arrays for the old and new sides.
///
/// Frontend usage:
/// - Left pane (remote/old): iterate `old_parts`, highlight parts where `removed == true`
/// - Right pane (local/new): iterate `new_parts`, highlight parts where `added == true`
#[tauri::command]
pub fn compute_word_diff(old_text: String, new_text: String) -> Result<WordDiffResult, String> {
    use similar::{ChangeTag, TextDiff};

    // S-25 修复：超大输入直接报错，避免 from_words 耗 CPU/内存导致卡顿
    if old_text.len() + new_text.len() > WORD_DIFF_MAX_INPUT_BYTES {
        return Err(format!(
            "WORD_DIFF_TOO_LARGE: input exceeds {} bytes limit",
            WORD_DIFF_MAX_INPUT_BYTES
        ));
    }

    let diff = TextDiff::from_words(&old_text, &new_text);

    let mut old_parts: Vec<WordDiffPart> = Vec::new();
    let mut new_parts: Vec<WordDiffPart> = Vec::new();

    for change in diff.iter_all_changes() {
        // Use to_string_lossy() instead of to_string() — the Display impl of Change
        // auto-appends '\n' when the value doesn't end with a newline (for unified diff
        // output). This would corrupt the content and cause wrong position tracking in
        // the frontend. to_string_lossy() returns the raw value without the extra '\n'.
        let value = change.to_string_lossy().into_owned();
        match change.tag() {
            ChangeTag::Delete => {
                old_parts.push(WordDiffPart {
                    value,
                    removed: true,
                    added: false,
                });
            }
            ChangeTag::Insert => {
                new_parts.push(WordDiffPart {
                    value,
                    removed: false,
                    added: true,
                });
            }
            ChangeTag::Equal => {
                let part = WordDiffPart {
                    value,
                    removed: false,
                    added: false,
                };
                old_parts.push(part.clone());
                new_parts.push(part);
            }
        }
    }

    Ok(WordDiffResult {
        old_parts,
        new_parts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compute_word_diff_test(old_text: &str, new_text: &str) -> WordDiffResult {
        compute_word_diff(old_text.to_string(), new_text.to_string()).unwrap()
    }

    #[test]
    fn test_identical_text() {
        let result = compute_word_diff_test("hello world", "hello world");

        // old_parts should concatenate to old_text
        let old_concatenated: String = result.old_parts.iter().map(|p| p.value.as_str()).collect();
        let new_concatenated: String = result.new_parts.iter().map(|p| p.value.as_str()).collect();

        assert_eq!(old_concatenated, "hello world", "old_parts should concatenate to old_text");
        assert_eq!(new_concatenated, "hello world", "new_parts should concatenate to new_text");

        // No parts should be marked as removed or added
        assert!(result.old_parts.iter().all(|p| !p.removed && !p.added), "No parts should be marked as changed for identical text");
        assert!(result.new_parts.iter().all(|p| !p.removed && !p.added), "No parts should be marked as changed for identical text");
    }

    #[test]
    fn test_different_text() {
        let result = compute_word_diff_test("hello world", "hello earth");

        let old_concatenated: String = result.old_parts.iter().map(|p| p.value.as_str()).collect();
        let new_concatenated: String = result.new_parts.iter().map(|p| p.value.as_str()).collect();

        assert_eq!(old_concatenated, "hello world", "old_parts should concatenate to old_text");
        assert_eq!(new_concatenated, "hello earth", "new_parts should concatenate to new_text");
    }

    #[test]
    fn test_identical_multiline() {
        let text = "line1\nline2\nline3";
        let result = compute_word_diff_test(text, text);

        let old_concatenated: String = result.old_parts.iter().map(|p| p.value.as_str()).collect();
        let new_concatenated: String = result.new_parts.iter().map(|p| p.value.as_str()).collect();

        assert_eq!(old_concatenated, text);
        assert_eq!(new_concatenated, text);

        // No parts should be marked as changed
        assert!(result.old_parts.iter().all(|p| !p.removed && !p.added));
        assert!(result.new_parts.iter().all(|p| !p.removed && !p.added));
    }

    #[test]
    fn test_different_multiline() {
        let result = compute_word_diff_test("line1\nline2\nline3", "line1\nmodified\nline3");

        let old_concatenated: String = result.old_parts.iter().map(|p| p.value.as_str()).collect();
        let new_concatenated: String = result.new_parts.iter().map(|p| p.value.as_str()).collect();

        assert_eq!(old_concatenated, "line1\nline2\nline3");
        assert_eq!(new_concatenated, "line1\nmodified\nline3");

        // Should have some removed parts in old and added parts in new
        assert!(result.old_parts.iter().any(|p| p.removed), "old should have removed parts");
        assert!(result.new_parts.iter().any(|p| p.added), "new should have added parts");
    }

    #[test]
    fn test_compute_word_diff_basic() {
        // Identical texts should produce only "equal" parts (no removed/added).
        let result = compute_word_diff_test("hello world", "hello world");

        // Concatenated parts must equal the input text on both sides.
        let old_concatenated: String = result.old_parts.iter().map(|p| p.value.as_str()).collect();
        let new_concatenated: String = result.new_parts.iter().map(|p| p.value.as_str()).collect();
        assert_eq!(old_concatenated, "hello world");
        assert_eq!(new_concatenated, "hello world");

        // For identical texts, no part should be marked as removed or added.
        // All parts are "equal" (WordDiffPart with removed=false, added=false).
        assert!(
            result.old_parts.iter().all(|p| !p.removed && !p.added),
            "identical texts should have no removed/added parts in old_parts"
        );
        assert!(
            result.new_parts.iter().all(|p| !p.removed && !p.added),
            "identical texts should have no removed/added parts in new_parts"
        );

        // old_parts and new_parts should be identical for identical inputs.
        assert_eq!(result.old_parts.len(), result.new_parts.len());
        for (o, n) in result.old_parts.iter().zip(result.new_parts.iter()) {
            assert_eq!(o.value, n.value);
            assert_eq!(o.removed, n.removed);
            assert_eq!(o.added, n.added);
        }
    }

    #[test]
    fn test_compute_word_diff_insert_delete() {
        // Texts with both insertions and deletions:
        // old: "hello world"  → "hello" is deleted
        // new: "hi world"     → "hi" is inserted
        // " world" is equal on both sides.
        let result = compute_word_diff_test("hello world", "hi world");

        // Concatenated parts must equal the respective inputs.
        let old_concatenated: String = result.old_parts.iter().map(|p| p.value.as_str()).collect();
        let new_concatenated: String = result.new_parts.iter().map(|p| p.value.as_str()).collect();
        assert_eq!(old_concatenated, "hello world", "old_parts must concatenate to old_text");
        assert_eq!(new_concatenated, "hi world", "new_parts must concatenate to new_text");

        // old_parts should have at least one removed part (the deleted "hello").
        assert!(
            result.old_parts.iter().any(|p| p.removed),
            "old_parts should contain at least one removed part"
        );
        // new_parts should have at least one added part (the inserted "hi").
        assert!(
            result.new_parts.iter().any(|p| p.added),
            "new_parts should contain at least one added part"
        );

        // old_parts should NOT have any added parts (added parts only appear in new_parts).
        assert!(
            result.old_parts.iter().all(|p| !p.added),
            "old_parts should not contain added parts"
        );
        // new_parts should NOT have any removed parts (removed parts only appear in old_parts).
        assert!(
            result.new_parts.iter().all(|p| !p.removed),
            "new_parts should not contain removed parts"
        );
    }

    /// S-25：超过上限的输入必须返回 WORD_DIFF_TOO_LARGE（拒绝词级 diff）
    #[test]
    fn test_compute_word_diff_rejects_oversized_input() {
        let big = "x".repeat(WORD_DIFF_MAX_INPUT_BYTES + 1);
        // 用 .err() 避免 WordDiffResult 不实现 Debug 导致的 expect_err 编译失败
        let err = compute_word_diff(big.clone(), "small".to_string()).err();
        assert!(err.is_some(), "oversized input must be rejected");
        let err = err.unwrap();
        assert!(err.starts_with("WORD_DIFF_TOO_LARGE"), "unexpected error: {}", err);

        // 边界：恰好等于上限（0 + limit）应放行
        let at_limit = "y".repeat(WORD_DIFF_MAX_INPUT_BYTES);
        assert!(compute_word_diff(at_limit, String::new()).is_ok(),
            "input at the limit should still be accepted");
    }
}
