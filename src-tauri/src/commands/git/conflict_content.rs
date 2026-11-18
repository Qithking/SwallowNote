use std::path::Path;
use super::runner::{run_git, run_git_no_trim, run_git_with_env};
use super::branch::{is_rebase_scenario, fix_detached_head};
use log::error;

/// G-14 修复：从 git index 的指定 stage 获取文件内容（统一三处重复的 stage 读取逻辑）。
/// stage 2 = ours，stage 3 = theirs。
/// P2 修复（近 P1）：Ok(Some(content)) = 该 stage 存在（content 可为合法空串）；
/// Ok(None) = 该 stage 无此文件（`git show` 失败且 ls-files 无对应 stage 条目）；
/// Err 表示 git 命令失败。此前 `!output.is_empty()` 把合法空 blob 当缺失，
/// 空文件侧 resolve 会被当作「该侧已删除」而误删工作区文件。
pub fn fetch_stage_content(repo_path: &str, rel_path: &str, stage: u8) -> Option<String> {
    let stage_ref = format!(":{}:{}", stage, rel_path);
    // G-16 修复：使用 run_git_no_trim 保留文件原始末尾换行
    // P2 修复：show 成功即返回——空串是合法空文件内容，不是「缺失」
    if let Ok(output) = run_git_no_trim(repo_path, &["show", &stage_ref]) {
        return Some(output);
    }
    // cat-file fallback：通过 ls-files 获取 stage 的 blob hash，再 cat-file -p
    // P2 修复：stage 条目存在即返回，空 blob（hash 对应空内容）同样合法
    if let Ok(ls_output) = run_git(repo_path, &["ls-files", "-s", "--", rel_path]) {
        let stage_str = stage.to_string();
        for line in ls_output.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 && parts[1] == stage_str {
                let hash = parts[2];
                if let Ok(content) = run_git_no_trim(repo_path, &["cat-file", "-p", hash]) {
                    return Some(content);
                }
            }
        }
    }
    None
}

/// Helper function to get conflict content for a specific side.
/// Handles the rebase ours/theirs swap correctly.
/// G-14 修复：使用 is_rebase_scenario 和 fetch_stage_content 公共函数，减少重复逻辑。
/// 返回值语义：Ok(Some(content)) = 该侧内容（可为合法空串，P2 修复）；
/// Ok(None) = 该侧文件不存在（modify/delete 冲突，所有 git show 来源均失败）；
/// Err = git 命令失败或 side 非法。
pub fn get_conflict_content(repo_path: &str, rel_path: &str, side: &str) -> Result<Option<String>, String> {
    let is_rebasing = is_rebase_scenario(repo_path);

    if side == "local" {
        if is_rebasing {
            // During rebase: REBASE_HEAD = our local commit, :3: = theirs = our local
            // G-16 修复：使用 run_git_no_trim 保留文件原始末尾换行
            if let Ok(output) = run_git_no_trim(repo_path, &["show", &format!("REBASE_HEAD:{}", rel_path)]) {
                return Ok(Some(output));
            }
            if let Ok(output) = run_git_no_trim(repo_path, &["show", &format!(":3:{}", rel_path)]) {
                return Ok(Some(output));
            }
        } else {
            // During merge: HEAD = our local branch, :2: = ours = our local
            if let Ok(output) = run_git_no_trim(repo_path, &["show", &format!("HEAD:{}", rel_path)]) {
                return Ok(Some(output));
            }
            if let Ok(output) = run_git_no_trim(repo_path, &["show", &format!(":2:{}", rel_path)]) {
                return Ok(Some(output));
            }
        }
        // 所有来源均失败（git show 报错）→ 该侧文件不存在（modify/delete 冲突），
        // 这是合法状态而非错误；注意空文件侧 show 会成功返回空串，不得落入此分支
        Ok(None)
    } else if side == "remote" {
        if is_rebasing {
            // During rebase: HEAD = upstream/remote, :2: = ours = upstream/remote
            if let Ok(output) = run_git_no_trim(repo_path, &["show", &format!("HEAD:{}", rel_path)]) {
                return Ok(Some(output));
            }
            if let Ok(output) = run_git_no_trim(repo_path, &["show", &format!(":2:{}", rel_path)]) {
                return Ok(Some(output));
            }
        } else {
            // During merge: :3: = theirs = remote, MERGE_HEAD = remote
            if let Ok(output) = run_git_no_trim(repo_path, &["show", &format!(":3:{}", rel_path)]) {
                return Ok(Some(output));
            }
            let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
            if merge_head.exists() {
                if let Ok(output) = run_git_no_trim(repo_path, &["show", &format!("MERGE_HEAD:{}", rel_path)]) {
                    return Ok(Some(output));
                }
            }
        }
        Ok(None)
    } else {
        Err(format!("Invalid side: {}", side))
    }
}

/// Helper function to check if all conflicts are resolved and continue rebase/merge if so
pub fn check_and_continue_rebase(repo_path: &str) -> Result<(), String> {
    let remaining = run_git(repo_path, &["diff", "--name-only", "--diff-filter=U"])?;
    if remaining.trim().is_empty() {
        // All conflicts resolved - continue the rebase/merge
        // P0-3 修复：经 git_state_path 解析状态文件路径，支持 linked worktree
        // （.git 为文件时 rebase 状态在主 gitdir worktrees/<name>/ 下，
        //  直接拼 .git/rebase-merge 会漏检，rebase --continue 永远不会被执行）
        let rebase_merge = super::paths::git_state_path(repo_path, "rebase-merge");
        let rebase_apply = super::paths::git_state_path(repo_path, "rebase-apply");

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
                    let _ = fix_detached_head(repo_path); // cleanup failure is non-fatal; continue best-effort
                }
                Err(e) => {
                    // G-04 修复：rebase --continue 失败时必须返回错误，
                    // 否则前端误报"冲突已解决"，但仓库仍处于 rebase-in-progress 状态，
                    // 用户感知为"解决冲突无效"。
                    error!("[ERROR] git_resolve_conflict_file: rebase --continue failed: {}", e);
                    return Err(format!("REBASE_CONTINUE_FAILED:{}", e));
                }
            }
        } else {
            // P0-3 修复：同上，worktree 下 MERGE_HEAD 在主 gitdir 内
            let merge_head = super::paths::git_state_path(repo_path, "MERGE_HEAD");
            if merge_head.exists() {
                // G-12 修复：保留 git 自动生成的 merge commit 信息（--no-edit）。
                // 如需让用户输入 merge commit 信息，需要前端提供输入框（后续优化）。
                // G-04 修复：merge commit 失败时同样返回错误，避免前端误报"已解决"
                if let Err(e) = run_git(repo_path, &["commit", "--no-edit"]) {
                    error!("[ERROR] git_resolve_conflict_file: merge commit failed: {}", e);
                    return Err(format!("MERGE_COMMIT_FAILED:{}", e));
                }
                // Fix detached HEAD after merge commit
                let _ = fix_detached_head(repo_path); // cleanup failure is non-fatal; continue best-effort
            }
        }
    }
    Ok(())
}
