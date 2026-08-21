use std::path::Path;
use super::runner::run_git;
use log::{debug, warn};

/// G-13 修复：读取 git 配置 pull.rebase，决定 pull 时使用 rebase 还是 merge。
/// 默认使用 rebase（保持原有行为），但尊重用户 git 配置（pull.rebase=false 时用 merge）。
pub fn should_use_rebase(path: &str) -> bool {
    match run_git(path, &["config", "--get", "pull.rebase"]) {
        Ok(output) => {
            let val = output.trim().to_lowercase();
            // pull.rebase=false → 用 merge；pull.rebase=true/yes/on → 用 rebase
            // 未设置或空 → 默认 rebase
            if val.is_empty() {
                true
            } else {
                val != "false" && val != "no" && val != "off" && val != "0"
            }
        }
        Err(_) => true, // 配置读取失败时默认 rebase（保持原有行为）
    }
}

/// 解析"应该把当前 HEAD 推送到哪个远程分支"。
/// 优先级：rebase 状态记录的分支 > 当前分支（已处理 detached HEAD）> 远程默认分支。
pub fn resolve_push_target_branch(repo_path: &str) -> Option<String> {
    if let Some(branch) = get_rebase_branch(repo_path) {
        if !branch.is_empty() && branch != "HEAD" {
            return Some(branch);
        }
    }
    if let Ok(branch) = get_branch(repo_path) {
        let trimmed = branch.trim();
        if !trimmed.is_empty() && trimmed != "HEAD" {
            return Some(trimmed.to_string());
        }
    }
    if let Ok(sym) = run_git(repo_path, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) {
        let trimmed = sym.trim().trim_start_matches("origin/").to_string();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }
    None
}

/// 获取当前分支名。
/// 注意：在 detached HEAD 状态下，`git rev-parse --abbrev-ref HEAD` 会返回字面量 "HEAD"，
/// 后续若拼成 `origin/HEAD:path` 会因 `origin/HEAD` 引用不存在而失败（Windows 上常见）。
/// 因此在 detached HEAD 时按以下顺序回退到真实分支名：
///   1. `refs/remotes/origin/HEAD` 符号引用（远程默认分支）
///   2. `init.defaultBranch` 配置
///   3. 兜底返回字符串 "HEAD"（保持向后兼容）
pub fn get_branch(path: &str) -> Result<String, String> {
    let raw = run_git(path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if raw.trim() != "HEAD" {
        return Ok(raw);
    }
    // detached HEAD：尝试解析远程默认分支
    if let Ok(sym) = run_git(path, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) {
        // symbolic-ref 返回形如 "origin/main"，需剥离 "origin/" 前缀，
        // 否则后续 git_pull_file_latest 会拼出 "origin/origin/main:path" 必然失败。
        let trimmed = sym.trim().trim_start_matches("origin/");
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    if let Ok(default_branch) = run_git(path, &["config", "--get", "init.defaultBranch"]) {
        let trimmed = default_branch.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    Ok("HEAD".to_string())
}

/// Get the branch name that is being rebased, from the rebase state files
/// This works even when HEAD is detached during a rebase
pub fn get_rebase_branch(repo_path: &str) -> Option<String> {
    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");

    // For rebase-merge: read head-name file
    if rebase_merge.exists() {
        let head_name_path = rebase_merge.join("head-name");
        if let Ok(content) = std::fs::read_to_string(&head_name_path) {
            let branch = content.trim().strip_prefix("refs/heads/").unwrap_or(content.trim());
            if !branch.is_empty() && branch != "HEAD" {
                return Some(branch.to_string());
            }
        }
    }

    // For rebase-apply: read head-name file
    if rebase_apply.exists() {
        let head_name_path = rebase_apply.join("head-name");
        if let Ok(content) = std::fs::read_to_string(&head_name_path) {
            let branch = content.trim().strip_prefix("refs/heads/").unwrap_or(content.trim());
            if !branch.is_empty() && branch != "HEAD" {
                return Some(branch.to_string());
            }
        }
    }

    // Fallback: try reading ORIG_HEAD and checking if it matches a branch
    if let Ok(orig_head) = run_git(repo_path, &["rev-parse", "ORIG_HEAD"]) {
        if let Ok(branches) = run_git(repo_path, &["branch", "--format=%(refname:short)=%(objectname)"]) {
            for line in branches.lines() {
                let parts: Vec<&str> = line.splitn(2, '=').collect();
                if parts.len() == 2 && parts[1].trim() == orig_head.trim() {
                    return Some(parts[0].trim().to_string());
                }
            }
        }
    }

    None
}

/// Simple check if a rebase or merge is currently in progress
pub fn is_rebase_or_merge_in_progress(repo_path: &str) -> bool {
    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
    let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
    rebase_merge.exists() || rebase_apply.exists() || merge_head.exists()
}

/// Check if the repository has REAL merge conflicts (not just stale state files).
/// Returns true only if there are actual unmerged files in the index or working tree.
/// This should be used instead of is_rebase_or_merge_in_progress() when deciding
/// whether to trigger the conflict resolution UI, to avoid false positives from
/// stale rebase/merge state files left behind by interrupted operations.
pub fn has_real_conflicts(repo_path: &str) -> bool {
    // Method 1: Check for unmerged files via diff-filter=U
    let diff_check = run_git(repo_path, &["diff", "--name-only", "--diff-filter=U"])
        .map(|o| !o.trim().is_empty())
        .unwrap_or(false);
    if diff_check {
        return true;
    }

    // Method 2: Check for unmerged entries in the index via ls-files --unmerged
    let ls_check = run_git(repo_path, &["ls-files", "--unmerged"])
        .map(|o| !o.trim().is_empty())
        .unwrap_or(false);
    if ls_check {
        return true;
    }

    // Method 3: Check porcelain status for conflict indicators (UU, AA, DU, UD, DD)
    if let Ok(status_output) = run_git(repo_path, &["status", "--porcelain"]) {
        for line in status_output.lines() {
            if line.len() >= 4 {
                let xy = &line[0..2];
                if xy.contains("U") || xy == "DD" || xy == "AA" {
                    return true;
                }
            }
        }
    }

    false
}

/// Clean up stale rebase/merge state files (when state files exist but no real conflicts).
/// This happens when an operation (pull --rebase, etc.) was interrupted (network error, crash)
/// but left behind .git/rebase-merge or .git/MERGE_HEAD files without actual unmerged files.
pub fn cleanup_stale_rebase_state(repo_path: &str) {
    debug!("[INFO] Cleaning up stale rebase/merge state in {}", repo_path);

    // 存在真实冲突文件时不清理，避免丢失未解决的冲突状态
    if has_real_conflicts(repo_path) {
        debug!("[INFO] cleanup_stale_rebase_state: real conflicts exist, skipping cleanup in {}", repo_path);
        return;
    }

    let _ = run_git(repo_path, &["rebase", "--abort"]); // cleanup failure is non-fatal; continue best-effort
    let _ = run_git(repo_path, &["merge", "--abort"]); // cleanup failure is non-fatal; continue best-effort

    // Force-remove stale state files/directories if abort didn't clean them.
    // When rebase was stale (process killed), `git rebase --abort` reports "no rebase in progress"
    // and leaves the files behind. These files cause is_detached_head/fix_detached_head to bail
    // out, leaving HEAD detached → git pull fails with "You are not currently on a branch".
    force_remove_stale_state_files(repo_path);
}

/// Force-remove stale rebase/merge state files and directories.
/// Only safe to call when has_real_conflicts() returns false.
fn force_remove_stale_state_files(repo_path: &str) {
    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
    let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");

    if rebase_merge.exists() {
        let done_path = rebase_merge.join("done");
        if done_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&done_path) {
                if !content.trim().is_empty() {
                    warn!("[WARN] force_remove_stale_state_files: removing stale rebase-merge with non-empty done file in {}", repo_path);
                }
            }
        }
        debug!("[INFO] force_remove_stale_state_files: removing .git/rebase-merge in {}", repo_path);
        let _ = std::fs::remove_dir_all(&rebase_merge);
    }
    if rebase_apply.exists() {
        debug!("[INFO] force_remove_stale_state_files: removing .git/rebase-apply in {}", repo_path);
        let _ = std::fs::remove_dir_all(&rebase_apply);
    }
    if merge_head.exists() {
        debug!("[INFO] force_remove_stale_state_files: removing .git/MERGE_HEAD in {}", repo_path);
        let _ = std::fs::remove_file(&merge_head);
    }
}

/// G-14 修复：检测当前是否处于 rebase 场景（统一三处重复的检测逻辑）。
/// rebase 和 merge 场景下 stage 映射相反，必须正确区分。
pub fn is_rebase_scenario(repo_path: &str) -> bool {
    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
    rebase_merge.exists() || rebase_apply.exists()
}

/// Fix detached HEAD state by switching back to the correct branch.
/// 用户场景：clone 后默认分支存在且全程没有手动切换分支，应用应自动把 detached HEAD 挂回分支，
/// 不需要用户手动执行 `git checkout`。
///
/// 修复优先级：
/// 1. 若处于 rebase/merge 进行中，不干扰，直接返回 Ok。
/// 2. 若 HEAD 已附在本地分支上，无需修复。
/// 3. 尝试从 rebase 状态记录中恢复目标分支。
/// 4. 按远程默认分支（refs/remotes/origin/HEAD）切回对应本地分支；
///    若本地分支不存在，则自动创建并跟踪远程分支。
/// 5. 回退到在本地分支中查找指向当前 HEAD 的分支并切换。
///
/// 返回 Err 表示检测到 detached HEAD 但无法自动修复；返回 Ok 表示无需修复或修复成功。
pub fn fix_detached_head(repo_path: &str) -> Result<(), String> {
    // Don't interfere with active rebase/merge
    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
    let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
    if rebase_merge.exists() || rebase_apply.exists() || merge_head.exists() {
        return Ok(());
    }

    // Check if we're in detached HEAD state
    let branch = match run_git(repo_path, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        Ok(b) => b,
        Err(_) => return Ok(()),
    };

    if branch != "HEAD" {
        return Ok(()); // Not detached
    }

    debug!("[INFO] fix_detached_head: detected detached HEAD in {}", repo_path);

    // 3. Try to find the correct branch from rebase state
    if let Some(target_branch) = get_rebase_branch(repo_path) {
        debug!("[INFO] fix_detached_head: switching to branch {}", target_branch);
        run_git(repo_path, &["checkout", &target_branch])
            .map_err(|e| format!("Failed to fix detached HEAD: {}", e))?;
        debug!("[INFO] fix_detached_head: successfully switched to {}", target_branch);
        return Ok(());
    }

    // 4. 按远程默认分支恢复：切换到对应本地分支，不存在则创建并跟踪远程
    if let Ok(remote_default) = run_git(repo_path, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) {
        let remote_default = remote_default.trim();
        if let Some(local_branch) = remote_default.strip_prefix("origin/") {
            let local_ref = format!("refs/heads/{}", local_branch);
            let has_local = run_git(repo_path, &["show-ref", "--verify", &local_ref]).is_ok();
            if has_local {
                debug!("[INFO] fix_detached_head: switching to local branch {}", local_branch);
                run_git(repo_path, &["checkout", local_branch])
                    .map_err(|e| format!("Failed to fix detached HEAD: {}", e))?;
            } else {
                debug!(
                    "[INFO] fix_detached_head: creating local branch {} tracking {}",
                    local_branch, remote_default
                );
                run_git(repo_path, &["checkout", "-b", local_branch, remote_default])
                    .map_err(|e| format!("Failed to fix detached HEAD: {}", e))?;
            }
            debug!("[INFO] fix_detached_head: successfully attached HEAD to {}", local_branch);
            return Ok(());
        }
    }

    // 5. Fallback: try checking out a local branch that points to current HEAD
    if let Ok(head_hash) = run_git(repo_path, &["rev-parse", "HEAD"]) {
        if let Ok(branches) = run_git(repo_path, &["branch", "--format=%(refname:short)=%(objectname)"]) {
            for line in branches.lines() {
                let parts: Vec<&str> = line.splitn(2, '=').collect();
                if parts.len() == 2 && parts[1].trim() == head_hash.trim() {
                    let target = parts[0].trim();
                    debug!("[INFO] fix_detached_head: found matching branch {}, switching", target);
                    match run_git(repo_path, &["checkout", target]) {
                        Ok(_) => {
                            debug!("[INFO] fix_detached_head: successfully switched to {}", target);
                            return Ok(());
                        }
                        Err(e) => {
                            warn!("[WARN] fix_detached_head: failed to switch to {}: {}", target, e);
                            continue;
                        }
                    }
                }
            }
        }
    }

    Err(format!(
        "DETACHED_HEAD:Repository is in detached HEAD state and could not be automatically fixed in {}.",
        repo_path
    ))
}

/// G-06 修复：检测仓库是否处于 detached HEAD 状态（不自动切换分支）。
/// 用于提交前检测：若 detached，返回 true 让调用方决定是否报错或提示用户手动处理。
/// 处于 rebase/merge 进行中时返回 false（这些场景由 fix_detached_head 在结束后处理）。
pub fn is_detached_head(repo_path: &str) -> bool {
    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
    let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
    if rebase_merge.exists() || rebase_apply.exists() || merge_head.exists() {
        return false;
    }
    match run_git(repo_path, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        Ok(branch) => branch == "HEAD",
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::test_utils::{git_cmd, setup_conflict_repo};

    /// Reproduces: stale rebase state files (with non-empty `done` file) cause
    /// cleanup_stale_rebase_state to skip cleanup, leaving is_detached_head
    /// unable to detect detached HEAD. This leads to
    /// "You are not currently on a branch" during git pull.
    #[test]
    fn test_cleanup_stale_rebase_state_removes_stale_rebase_merge_with_done_file() {
        let tmp = setup_conflict_repo();
        let repo = tmp.path();
        let repo_str = repo.to_str().unwrap();

        // Detach HEAD by checking out the commit hash directly
        let head_hash = std::process::Command::new("git")
            .current_dir(repo)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap();
        let head_hash = String::from_utf8_lossy(&head_hash.stdout).trim().to_string();
        git_cmd(repo, &["checkout", "-q", &head_hash]);

        // Simulate a crashed/interrupted rebase: manually create .git/rebase-merge
        // with a non-empty `done` file (worst case: interactive rebase early-return)
        let rebase_merge_dir = repo.join(".git/rebase-merge");
        std::fs::create_dir_all(&rebase_merge_dir).unwrap();
        std::fs::write(rebase_merge_dir.join("head-name"), "refs/heads/main\n").unwrap();
        std::fs::write(rebase_merge_dir.join("done"), "pick abc1234 base commit\n").unwrap();

        // Before cleanup: is_detached_head returns false because state files exist
        assert!(!is_detached_head(repo_str),
            "is_detached_head should return false when stale rebase state files exist (bug reproduction)");

        // Call cleanup
        cleanup_stale_rebase_state(repo_str);

        // After cleanup: stale state files must be removed
        assert!(!rebase_merge_dir.exists(),
            "stale .git/rebase-merge must be removed by cleanup_stale_rebase_state");

        // After cleanup: is_detached_head must detect detached HEAD
        assert!(is_detached_head(repo_str),
            "is_detached_head should return true after stale state files are removed");
    }
}
