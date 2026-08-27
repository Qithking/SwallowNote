use super::models::{WordDiffPart, WordDiffResult};

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
}
