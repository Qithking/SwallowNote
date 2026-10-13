use std::path::Path;
use super::runner::run_git;
use log::{debug, warn};

/// 读取 git 配置 pull.rebase，决定 pull 用 rebase 还是 merge。
/// 默认 merge：Auto-save 提交频繁，rebase 逐个重放会放大冲突；仅显式配置 true 时用 rebase。
pub fn should_use_rebase(path: &str) -> bool {
    match run_git(path, &["config", "--get", "pull.rebase"]) {
        Ok(output) => {
            let val = output.trim().to_lowercase();
            if val.is_empty() {
                false
            } else {
                matches!(val.as_str(), "true" | "yes" | "on" | "1")
            }
        }
        Err(_) => false,
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

    // B3: rebase 进行中，切回记录的分支
    if let Some(target_branch) = get_rebase_branch(repo_path) {
        debug!("[INFO] fix_detached_head: switching to rebase branch {}", target_branch);
        checkout_with_stash(repo_path, &target_branch)?;
        debug!("[INFO] fix_detached_head: successfully switched to {}", target_branch);
        return Ok(());
    }

    // B1: 从当前 HEAD 原地挂分支——checkout -b 只移动 ref 指针，不覆盖脏工作区。
    if let Ok(head_hash) = run_git(repo_path, &["rev-parse", "HEAD"]) {
        let head_hash = head_hash.trim().to_string();
        let branch_name = resolve_recovery_branch_name(repo_path, &head_hash);
        let local_ref = format!("refs/heads/{}", branch_name);
        let local_exists = run_git(repo_path, &["show-ref", "--verify", &local_ref]).is_ok();
        if !local_exists {
            let remote_ref = format!("refs/remotes/origin/{}", branch_name);
            let remote_exists = run_git(repo_path, &["show-ref", "--verify", &remote_ref]).is_ok();
            match run_git(repo_path, &["checkout", "-b", &branch_name, &head_hash]) {
                Ok(_) => {
                    // 远程存在同名分支时建立上游跟踪，后续 push 无需指定目标
                    if remote_exists {
                        let track_target = format!("origin/{}", branch_name);
                        if let Err(e) = run_git(repo_path, &["branch", "--set-upstream-to", &track_target, &branch_name]) {
                            warn!("[WARN] fix_detached_head: set-upstream-to {} failed: {}", track_target, e);
                        }
                    }
                    debug!("[INFO] fix_detached_head: attached HEAD to new branch {} via checkout -b", branch_name);
                    return Ok(());
                }
                Err(e) => {
                    warn!("[WARN] fix_detached_head: checkout -b {} failed: {}", branch_name, e);
                }
            }
        }
    }

    // B3: 本地分支已存在时先分叉检测，分叉则报错让前端弹框决策。
    if let Ok(remote_default) = run_git(repo_path, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) {
        let remote_default = remote_default.trim();
        if let Some(local_branch) = remote_default.strip_prefix("origin/") {
            let local_ref = format!("refs/heads/{}", local_branch);
            let has_local = run_git(repo_path, &["show-ref", "--verify", &local_ref]).is_ok();
            if has_local {
                if let Some(diverged_msg) = detect_diverged(repo_path, local_branch) {
                    return Err(diverged_msg);
                }
                debug!("[INFO] fix_detached_head: switching to local branch {}", local_branch);
                checkout_with_stash(repo_path, local_branch)?;
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
                    match checkout_with_stash(repo_path, target) {
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

/// 解析从当前 HEAD 原地建分支用的名字：优先远程默认分支名，否则 sync/recovery-<hash8>。
fn resolve_recovery_branch_name(repo_path: &str, head_hash: &str) -> String {
    if let Ok(sym) = run_git(repo_path, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) {
        let trimmed = sym.trim().trim_start_matches("origin/");
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let hash8 = if head_hash.len() >= 8 { &head_hash[..8] } else { head_hash };
    format!("sync/recovery-{}", hash8)
}

/// 检测本地分支与当前 HEAD 是否双向分叉（rev-list --left-right --count 两侧均 >0）。
/// 分叉时返回 DETACHED_HEAD_DIVERGED:<branch>:<left>:<right>，否则返回 None。
fn detect_diverged(repo_path: &str, local_branch: &str) -> Option<String> {
    let range = format!("{}...HEAD", local_branch);
    let count = run_git(repo_path, &["rev-list", "--left-right", "--count", &range]).ok()?;
    // 输出以制表符分隔两个数字，用 split_whitespace 兼容
    let mut nums = count.trim().split_whitespace();
    let left = nums.next()?.parse::<u64>().ok()?;
    let right = nums.next()?.parse::<u64>().ok()?;
    if left > 0 && right > 0 {
        warn!(
            "[WARN] fix_detached_head: local branch {} diverged from HEAD (left={}, right={}), refusing to auto-switch",
            local_branch, left, right
        );
        Some(format!("DETACHED_HEAD_DIVERGED:{}:{}:{}", local_branch, left, right))
    } else {
        None
    }
}

/// stash → checkout → pop；失败即返回，不用 --force 回退（会丢弃本地改动）。
fn checkout_with_stash(repo_path: &str, branch: &str) -> Result<(), String> {
    let stashed = stash_create(repo_path);

    match run_git(repo_path, &["checkout", branch]) {
        Ok(_) => {
            if stashed {
                if let Err(e) = run_git(repo_path, &["stash", "pop", "--quiet"]) {
                    warn!("[WARN] fix_detached_head: stash pop failed: {}. Stash retained.", e);
                }
            }
            Ok(())
        }
        Err(e) => {
            // 失败时把 stash pop 回来，还原工作区
            if stashed {
                let _ = run_git(repo_path, &["stash", "pop", "--quiet"]);
            }
            warn!("[WARN] fix_detached_head: checkout {} failed: {} (no force fallback)", branch, e);
            Err(format!("Failed to fix detached HEAD: checkout {} failed: {}", branch, e))
        }
    }
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

/// 分叉错误需上抛前端弹框决策，不能 warn 后继续。
pub fn is_diverged_error(err: &str) -> bool {
    err.starts_with("DETACHED_HEAD_DIVERGED:")
}

/// 创建 stash，返回是否真的新建了条目（干净工作区 push 成功但不新建），
/// 避免误 pop 用户历史遗留的旧 stash。
fn stash_create(repo_path: &str) -> bool {
    let count = |p: &str| run_git(p, &["stash", "list"]).map(|o| o.lines().count()).unwrap_or(0);
    let before = count(repo_path);
    if run_git(repo_path, &["stash", "push", "--include-untracked", "--quiet", "-m", "SwallowNote: auto stash before branch attach"]).is_err() {
        return false;
    }
    count(repo_path) > before
}

/// 分叉决策一：checkout -B 把本地分支重置到当前 HEAD（丢弃分支独有提交），需前端确认。
#[tauri::command]
pub async fn git_attach_branch_to_head(path: String, branch: String) -> Result<(), String> {
    let stashed = stash_create(&path);
    let res = run_git(&path, &["checkout", "-B", &branch, "HEAD"]);
    if stashed {
        let _ = run_git(&path, &["stash", "pop", "--quiet"]);
    }
    res.map(|_| ()).map_err(|e| format!("Failed to attach branch {} to current HEAD: {}", branch, e))
}

/// 分叉决策二：仅 stash + checkout 切回本地分支，不做 reset/merge。
#[tauri::command]
pub async fn git_switch_to_local_branch(path: String, branch: String) -> Result<(), String> {
    let stashed = stash_create(&path);
    let res = run_git(&path, &["checkout", &branch]);
    if stashed {
        let _ = run_git(&path, &["stash", "pop", "--quiet"]);
    }
    res.map(|_| ()).map_err(|e| format!("Failed to switch to branch {}: {}", branch, e))
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

    /// 取指定 rev 的完整 hash（测试辅助）
    fn rev_parse(repo: &std::path::Path, rev: &str) -> String {
        let out = std::process::Command::new("git")
            .current_dir(repo)
            .args(["rev-parse", rev])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    /// 未配置 pull.rebase 时默认使用 merge。
    #[test]
    fn test_should_use_rebase_defaults_to_merge_when_unset() {
        let tmp = setup_conflict_repo();
        assert!(
            !should_use_rebase(tmp.path().to_str().unwrap()),
            "unset pull.rebase should default to merge"
        );
    }

    /// 显式 pull.rebase=true 必须被尊重。
    #[test]
    fn test_should_use_rebase_respects_explicit_true() {
        let tmp = setup_conflict_repo();
        git_cmd(tmp.path(), &["config", "pull.rebase", "true"]);
        assert!(
            should_use_rebase(tmp.path().to_str().unwrap()),
            "explicit pull.rebase=true should use rebase"
        );
    }

    /// 显式 pull.rebase=false 必须保持 merge。
    #[test]
    fn test_should_use_rebase_respects_explicit_false() {
        let tmp = setup_conflict_repo();
        git_cmd(tmp.path(), &["config", "pull.rebase", "false"]);
        assert!(
            !should_use_rebase(tmp.path().to_str().unwrap()),
            "explicit pull.rebase=false should use merge"
        );
    }

    /// 统计 stash list 条目数（测试辅助）
    fn stash_count(repo: &std::path::Path) -> usize {
        let out = std::process::Command::new("git")
            .current_dir(repo)
            .args(["stash", "list"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).lines().count()
    }

    /// 工作区干净时不得消费用户历史遗留的 stash（干净工作区 push 不新建条目）。
    #[test]
    fn test_checkout_with_stash_does_not_pop_user_legacy_stash_when_tree_clean() {
        let tmp = setup_conflict_repo();
        let repo = tmp.path();
        let repo_str = repo.to_str().unwrap();

        // 预置一条用户历史 stash（随后工作区恢复干净）
        std::fs::write(repo.join("user_secret.txt"), "legacy\n").unwrap();
        git_cmd(repo, &["stash", "push", "--include-untracked", "-q", "-m", "user legacy stash"]);
        assert_eq!(stash_count(repo), 1, "precondition: one legacy stash exists");
        assert!(!repo.join("user_secret.txt").exists(), "working tree should be clean");

        // 进入 detached HEAD，模拟 fix_detached_head 切回 main 的真实路径
        let head_hash = rev_parse(repo, "HEAD");
        git_cmd(repo, &["checkout", "-q", &head_hash]);

        checkout_with_stash(repo_str, "main").expect("checkout back to main should succeed");

        assert_eq!(
            stash_count(repo), 1,
            "user legacy stash must not be consumed when no new stash entry was created"
        );
        assert!(
            !repo.join("user_secret.txt").exists(),
            "legacy stash content must not be applied into the working tree"
        );
    }

    /// 双向分叉（本地分支与 HEAD 各有独有提交）应被识别为分叉。
    #[test]
    fn test_detect_diverged_flags_true_divergence() {
        let tmp = setup_conflict_repo();
        let repo = tmp.path();
        let repo_str = repo.to_str().unwrap();

        // main 前进一个提交
        std::fs::write(repo.join("file.txt"), "line1\nbase\nmain-b\n").unwrap();
        git_cmd(repo, &["commit", "-qam", "main-only"]);

        // 回到首个提交，并在 detached HEAD 上再做一个提交 → 与 main 双向分叉
        let first = rev_parse(repo, "HEAD~1");
        git_cmd(repo, &["checkout", "-q", &first]);
        std::fs::write(repo.join("other.txt"), "detached\n").unwrap();
        git_cmd(repo, &["add", "other.txt"]);
        git_cmd(repo, &["commit", "-q", "-m", "detached-only"]);

        let msg = detect_diverged(repo_str, "main").expect("should detect divergence");
        assert!(msg.starts_with("DETACHED_HEAD_DIVERGED:main:"), "unexpected payload: {}", msg);
    }

    /// HEAD 仅落后于本地分支（无独有提交）不算分叉，应返回 None。
    #[test]
    fn test_detect_diverged_returns_none_when_head_behind() {
        let tmp = setup_conflict_repo();
        let repo = tmp.path();
        let repo_str = repo.to_str().unwrap();

        let first = rev_parse(repo, "HEAD");
        std::fs::write(repo.join("file.txt"), "line1\nbase\nmain-b\n").unwrap();
        git_cmd(repo, &["commit", "-qam", "main-only"]);
        git_cmd(repo, &["checkout", "-q", &first]);

        assert!(detect_diverged(repo_str, "main").is_none(),
            "HEAD behind local branch must not be treated as divergence");
    }

    /// 端到端：无本地分支指向 detached HEAD 时，应 checkout -b 原地挂分支且不丢改动。
    #[test]
    fn test_fix_detached_head_attaches_new_branch_in_place() {
        let tmp = setup_conflict_repo();
        let repo = tmp.path();
        let repo_str = repo.to_str().unwrap();

        // main 前进一个提交，然后回到首个提交进入 detached HEAD（无分支指向它）
        let first = rev_parse(repo, "HEAD");
        std::fs::write(repo.join("file.txt"), "line1\nbase\nmain-b\n").unwrap();
        git_cmd(repo, &["commit", "-qam", "main-only"]);
        git_cmd(repo, &["checkout", "-q", &first]);
        assert!(is_detached_head(repo_str), "precondition: HEAD should be detached");

        // 制造一个未提交改动，验证原地挂分支不会覆盖它
        std::fs::write(repo.join("dirty.txt"), "keep me\n").unwrap();

        fix_detached_head(repo_str).expect("should attach a new branch in place");

        assert!(!is_detached_head(repo_str), "HEAD should no longer be detached");
        assert!(repo.join("dirty.txt").exists(), "working tree change must be preserved");
    }

    /// 端到端：与本地默认分支分叉时必须返回 DETACHED_HEAD_DIVERGED，不静默切换。
    #[test]
    fn test_fix_detached_head_returns_diverged_error() {
        let tmp = setup_conflict_repo();
        let repo = tmp.path();
        let repo_str = repo.to_str().unwrap();

        // main 前进一个提交
        std::fs::write(repo.join("file.txt"), "line1\nbase\nmain-b\n").unwrap();
        git_cmd(repo, &["commit", "-qam", "main-only"]);

        // 构造 remote-tracking 引用，让 origin/HEAD 解析到 origin/main
        let main_head = rev_parse(repo, "main");
        git_cmd(repo, &["update-ref", "refs/remotes/origin/main", &main_head]);
        git_cmd(repo, &["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);

        // 回到首个提交并在 detached HEAD 上再做提交 → 与 main 双向分叉
        let first = rev_parse(repo, "HEAD~1");
        git_cmd(repo, &["checkout", "-q", &first]);
        std::fs::write(repo.join("other.txt"), "detached\n").unwrap();
        git_cmd(repo, &["add", "other.txt"]);
        git_cmd(repo, &["commit", "-q", "-m", "detached-only"]);

        let err = fix_detached_head(repo_str).expect_err("should return diverged error");
        assert!(is_diverged_error(&err), "expected diverged error, got: {}", err);
    }
}
