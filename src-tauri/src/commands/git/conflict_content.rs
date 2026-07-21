use std::path::Path;
use super::runner::{run_git, run_git_no_trim, run_git_with_env};
use super::branch::{is_rebase_scenario, fix_detached_head};

/// G-14 修复：从 git index 的指定 stage 获取文件内容（统一三处重复的 stage 读取逻辑）。
/// stage 2 = ours，stage 3 = theirs。返回 Ok(Some(content)) 表示成功获取非空内容，
/// Ok(None) 表示该 stage 无内容（文件可能不存在于此 side），Err 表示 git 命令失败。
pub fn fetch_stage_content(repo_path: &str, rel_path: &str, stage: u8) -> Option<String> {
    let stage_ref = format!(":{}:{}", stage, rel_path);
    // G-16 修复：使用 run_git_no_trim 保留文件原始末尾换行
    if let Ok(output) = run_git_no_trim(repo_path, &["show", &stage_ref]) {
        if !output.is_empty() {
            return Some(output);
        }
    }
    // cat-file fallback：通过 ls-files 获取 stage 的 blob hash，再 cat-file -p
    if let Ok(ls_output) = run_git(repo_path, &["ls-files", "-s", "--", rel_path]) {
        let stage_str = stage.to_string();
        for line in ls_output.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 && parts[1] == stage_str {
                let hash = parts[2];
                if let Ok(content) = run_git_no_trim(repo_path, &["cat-file", "-p", hash]) {
                    if !content.is_empty() {
                        return Some(content);
                    }
                }
            }
        }
    }
    None
}

/// Helper function to get conflict content for a specific side.
/// Handles the rebase ours/theirs swap correctly.
/// G-14 修复：使用 is_rebase_scenario 和 fetch_stage_content 公共函数，减少重复逻辑。
pub fn get_conflict_content(repo_path: &str, rel_path: &str, side: &str) -> Result<String, String> {
    let is_rebasing = is_rebase_scenario(repo_path);

    if side == "local" {
        if is_rebasing {
            // During rebase: REBASE_HEAD = our local commit, :3: = theirs = our local
            // G-16 修复：使用 run_git_no_trim 保留文件原始末尾换行
            if let Ok(output) = run_git_no_trim(repo_path, &["show", &format!("REBASE_HEAD:{}", rel_path)]) {
                if !output.is_empty() { return Ok(output); }
            }
            if let Ok(output) = run_git_no_trim(repo_path, &["show", &format!(":3:{}", rel_path)]) {
                if !output.is_empty() { return Ok(output); }
            }
        } else {
            // During merge: HEAD = our local branch, :2: = ours = our local
            if let Ok(output) = run_git_no_trim(repo_path, &["show", &format!("HEAD:{}", rel_path)]) {
                if !output.is_empty() { return Ok(output); }
            }
            if let Ok(output) = run_git_no_trim(repo_path, &["show", &format!(":2:{}", rel_path)]) {
                if !output.is_empty() { return Ok(output); }
            }
        }
        Err(format!("Failed to get local content for {}", rel_path))
    } else if side == "remote" {
        if is_rebasing {
            // During rebase: HEAD = upstream/remote, :2: = ours = upstream/remote
            if let Ok(output) = run_git_no_trim(repo_path, &["show", &format!("HEAD:{}", rel_path)]) {
                if !output.is_empty() { return Ok(output); }
            }
            if let Ok(output) = run_git_no_trim(repo_path, &["show", &format!(":2:{}", rel_path)]) {
                if !output.is_empty() { return Ok(output); }
            }
        } else {
            // During merge: :3: = theirs = remote, MERGE_HEAD = remote
            if let Ok(output) = run_git_no_trim(repo_path, &["show", &format!(":3:{}", rel_path)]) {
                if !output.is_empty() { return Ok(output); }
            }
            let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
            if merge_head.exists() {
                if let Ok(output) = run_git_no_trim(repo_path, &["show", &format!("MERGE_HEAD:{}", rel_path)]) {
                    if !output.is_empty() { return Ok(output); }
                }
            }
        }
        Err(format!("Failed to get remote content for {}", rel_path))
    } else {
        Err(format!("Invalid side: {}", side))
    }
}

/// Helper function to check if all conflicts are resolved and continue rebase/merge if so
pub fn check_and_continue_rebase(repo_path: &str) -> Result<(), String> {
    let remaining = run_git(repo_path, &["diff", "--name-only", "--diff-filter=U"])?;
    if remaining.trim().is_empty() {
        // All conflicts resolved - continue the rebase/merge
        let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
        let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");

        if rebase_merge.exists() || rebase_apply.exists() {
            // Continue rebase - use GIT_EDITOR=true to skip editor
            let result = run_git_with_env(
                repo_path,
                &["rebase", "--continue"],
                &[("GIT_EDITOR", "true")],
            );
            match result {
                Ok(_) => {
                    // Rebase continued successfully - fix detached HEAD if needed
                    let _ = fix_detached_head(repo_path);
                }
                Err(e) => {
                    // G-04 修复：rebase --continue 失败时必须返回错误，
                    // 否则前端误报"冲突已解决"，但仓库仍处于 rebase-in-progress 状态，
                    // 用户感知为"解决冲突无效"。
                    eprintln!("[ERROR] git_resolve_conflict_file: rebase --continue failed: {}", e);
                    return Err(format!("REBASE_CONTINUE_FAILED:{}", e));
                }
            }
        } else {
            let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
            if merge_head.exists() {
                // G-12 修复：保留 git 自动生成的 merge commit 信息（--no-edit）。
                // 如需让用户输入 merge commit 信息，需要前端提供输入框（后续优化）。
                // G-04 修复：merge commit 失败时同样返回错误，避免前端误报"已解决"
                if let Err(e) = run_git(repo_path, &["commit", "--no-edit"]) {
                    eprintln!("[ERROR] git_resolve_conflict_file: merge commit failed: {}", e);
                    return Err(format!("MERGE_COMMIT_FAILED:{}", e));
                }
                // Fix detached HEAD after merge commit
                let _ = fix_detached_head(repo_path);
            }
        }
    }
    Ok(())
}
