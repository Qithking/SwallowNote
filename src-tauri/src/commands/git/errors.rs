/// Check if a git error is a rebase/merge conflict
/// P2 修复：不再裸匹配 `contains("conflict")`——仓库路径/文件名含 "conflict"
/// 子串的认证/网络错误（如 URL https://host/conflict/repo 403）会被误判为冲突，
/// 错码路由到冲突面板而不是凭证框。改为只匹配 git 真实输出中的固定形态。
pub fn is_conflict_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    // "CONFLICT (content/add/rename/delete): Merge conflict in X" 等 git 冲突输出
    lower.contains("merge conflict")
        || lower.contains("conflict in")
        || lower.contains("conflict (")
        || lower.contains("could not apply")
        || lower.contains("resolve them")
        || lower.contains("fix conflicts")
        || lower.contains("after resolving the conflicts")
        || lower.contains("failed to merge in the changes")
        || lower.contains("pull is not possible because you have unmerged files")
        || lower.contains("cannot rebase") && lower.contains("uncommitted changes")
}

/// Check if a git error is an authentication failure
pub fn is_auth_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("could not read password")
        || lower.contains("permission denied (publickey)")
        || lower.contains("permission denied (keyboard-interactive)")
        || lower.contains("access denied")
        // S-07 修复：`could not read from remote repository` 在纯网络故障（远程
        // 不可达/仓库不存在）时同样输出，无条件归 auth 会误弹凭证框——仅在同时
        // 伴随认证信号（access rights / permission denied / authentication）时归类。
        || (lower.contains("could not read from remote repository")
            && (lower.contains("access rights")
                || lower.contains("permission denied")
                || lower.contains("authentication")))
        || lower.contains("http 403")
        || lower.contains("invalid username or password")
        || lower.contains("authentication error")
        || lower.contains("logon failed")
        || lower.contains("authentication required")
        || lower.contains("username for")
        || lower.contains("password for")
        || lower.contains("fatal: unable to access") && (lower.contains("403") || lower.contains("401") || lower.contains("authentication") || lower.contains("credential"))
}

/// git ≥2.27：pull.rebase 未设置且本地/远端历史分叉时，裸 `git pull` 拒绝执行
/// （exit 128，"You have divergent branches and need to specify how to reconcile them."）。
/// 该错误不属于 conflict/auth/local-changes-overwrite，调用方需显式选择
/// 合并策略（默认 merge → `pull --no-rebase`）重试，否则同步将永久失败。
pub fn is_divergent_branches_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("divergent branches") || lower.contains("need to specify how to reconcile")
}

/// S-26：本地未提交改动会被 merge/pull 覆盖时的拒绝错误
/// （git 提示 "please commit your changes or stash them"）。
/// 此前未归类，落入通用失败分支，前端无法给出"提交或暂存本地改动"
/// 的明确指引。归入独立错误码 LOCAL_CHANGES_OVERWRITE。
pub fn is_local_changes_overwrite_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    // P2 修复：补齐同语义变体——此前仅命中 "local changes..." 一句：
    // - `git pull --rebase` 带未暂存改动报 "cannot pull with rebase: You have unstaged changes"
    //   （index 有暂存改动时为 "...Your index contains uncommitted changes"）
    // - untracked 文件被合并覆盖报 "The following untracked working tree files would be overwritten"
    // 这些变体此前落入通用失败分支，前端无法给出「先提交或暂存」指引
    lower.contains("local changes to the following files would be overwritten")
        || lower.contains("cannot pull with rebase: you have unstaged changes")
        || lower.contains("cannot pull with rebase: your index contains uncommitted changes")
        || lower.contains("untracked working tree files would be overwritten")
}

/// P1-4 修复：判断错误串是否已带前后端错误码协议前缀。
/// fix_detached_head / checkout_with_stash 等底层函数可能直接返回带前缀的错误
/// （REBASE_CONFLICT: / DETACHED_HEAD_DIVERGED: 等），调用方包装
/// "Failed to fix ..." 会破坏前缀，前端 startsWith 匹配失败 → 冲突面板不弹。
/// 带协议前缀的错误必须原样上抛，仅裸错误才允许包装。
pub fn is_protocol_error(error: &str) -> bool {
    const PREFIXES: [&str; 7] = [
        "AUTH_REQUIRED:",
        "REBASE_CONFLICT:",
        "DETACHED_HEAD_DIVERGED:",
        "DETACHED_HEAD:",
        "SUBMODULE_UNCOMMITTED:",
        "REBASE_CONTINUE_FAILED:",
        "MERGE_COMMIT_FAILED:",
    ];
    PREFIXES.iter().any(|p| error.starts_with(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_conflict_error_conflict_keywords() {
        assert!(is_conflict_error("CONFLICT (content): Merge conflict in file.txt"));
        assert!(is_conflict_error("error: could not apply abc123"));
        assert!(is_conflict_error("Auto-merging file.rs\nCONFLICT (content): Merge conflict"));
        assert!(is_conflict_error("Please resolve them and commit the result"));
        assert!(is_conflict_error("Fix conflicts and then commit the result"));
        assert!(is_conflict_error("After resolving the conflicts, run git rebase --continue"));
        assert!(is_conflict_error("Failed to merge in the changes"));
        assert!(is_conflict_error("Pull is not possible because you have unmerged files"));
    }

    #[test]
    fn test_is_conflict_error_non_conflict() {
        assert!(!is_conflict_error("Everything up-to-date"));
        assert!(!is_conflict_error("Successfully rebased"));
        assert!(!is_conflict_error("authentication failed"));
        assert!(!is_conflict_error("fatal: not a git repository"));
        assert!(!is_conflict_error(""));
    }

    #[test]
    fn test_is_conflict_error_rebase_uncommitted() {
        // "cannot rebase" + "uncommitted changes" 的组合才算冲突
        assert!(is_conflict_error("cannot rebase: you have uncommitted changes"));
        assert!(!is_conflict_error("cannot rebase onto main branch"));
        assert!(!is_conflict_error("uncommitted changes detected"));
    }

    /// P2 回归：不再裸匹配 "conflict" 子串——路径/URL 含 conflict 的认证、网络错误
    /// 不得误判为冲突（否则凭证框路由到冲突面板）；git 真实冲突输出必须仍命中
    #[test]
    fn test_is_conflict_error_not_broad_substring() {
        // 认证错误但 URL 含 "conflict"：必须归 auth 而非 conflict
        assert!(!is_conflict_error(
            "fatal: unable to access 'https://github.com/conflict/repo/': 403"
        ));
        // 文件名含 conflict 的非冲突失败
        assert!(!is_conflict_error("fatal: bad object conflict-notes.txt"));
        // git 真实冲突输出的各种形态仍命中
        assert!(is_conflict_error("CONFLICT (rename/delete): a.txt deleted in HEAD."));
        assert!(is_conflict_error("Auto-merging notes/conflict.md\nCONFLICT (add/add): Merge conflict in notes/conflict.md"));
        // "cannot pull with rebase: You have unstaged changes" 不是冲突也不是 "cannot rebase"
        assert!(!is_conflict_error("error: cannot pull with rebase: You have unstaged changes."));
    }

    /// P2 回归：本地改动覆盖的 rebase 与 untracked 变体必须命中，
    /// 归入 LOCAL_CHANGES_OVERWRITE（此前落入通用失败分支）
    #[test]
    fn test_is_local_changes_overwrite_error_variants() {
        assert!(is_local_changes_overwrite_error(
            "error: cannot pull with rebase: You have unstaged changes.\nerror: Please commit or stash them."
        ));
        assert!(is_local_changes_overwrite_error(
            "error: cannot pull with rebase: Your index contains uncommitted changes."
        ));
        assert!(is_local_changes_overwrite_error(
            "error: The following untracked working tree files would be overwritten by merge:\n\tnew.txt\nPlease move or remove them before you merge."
        ));
        // 非该模式不误报
        assert!(!is_local_changes_overwrite_error("CONFLICT (content): Merge conflict"));
        assert!(!is_local_changes_overwrite_error("Everything up-to-date"));
    }

    #[test]
    fn test_is_auth_error_auth_keywords() {
        assert!(is_auth_error("Authentication failed for repo"));
        assert!(is_auth_error("fatal: could not read Username for 'https://github.com'"));
        assert!(is_auth_error("fatal: could not read Password for 'https://github.com'"));
        assert!(is_auth_error("Permission denied (publickey)"));
        assert!(is_auth_error("Permission denied (keyboard-interactive)"));
        assert!(is_auth_error("Access denied"));
        // S-07 修复：裸 `could not read from remote repository` 不算认证错误（纯网络
        // 故障同样输出该句）；附带认证信号（access rights / permission denied）才归类
        assert!(!is_auth_error("fatal: could not read from remote repository"));
        assert!(is_auth_error("fatal: could not read from remote repository\nPlease make sure you have the correct access rights and the repository exists."));
        assert!(is_auth_error("HTTP 403 Forbidden"));
        assert!(is_auth_error("Invalid username or password"));
        assert!(is_auth_error("Logon failed"));
        assert!(is_auth_error("Authentication required but no credential provided"));
    }

    #[test]
    fn test_is_auth_error_non_auth() {
        assert!(!is_auth_error("Everything up-to-date"));
        assert!(!is_auth_error("CONFLICT (content): Merge conflict"));
        assert!(!is_auth_error(""));
        assert!(!is_auth_error("fatal: not a git repository"));
    }

    #[test]
    fn test_is_auth_error_unable_to_access_with_403() {
        // "fatal: unable to access" + 403 才算认证错误
        assert!(is_auth_error("fatal: unable to access 'https://github.com/repo': The requested URL returned error: 403"));
        assert!(is_auth_error("fatal: unable to access: 401 Unauthorized"));
        assert!(is_auth_error("fatal: unable to access: authentication required"));
        assert!(is_auth_error("fatal: unable to access: credential helper error"));
        // 无 403/401/auth/credential 的 unable to access 不算认证错误
        assert!(!is_auth_error("fatal: unable to access: Connection timed out"));
    }

    #[test]
    fn test_is_conflict_error_patterns() {
        // Various conflict error patterns that should return true
        // "conflict" (case-insensitive)
        assert!(is_conflict_error("CONFLICT (content): Merge conflict in file.txt"));
        assert!(is_conflict_error("merge conflict detected"));
        assert!(is_conflict_error("Conflict in src/main.rs"));
        // "could not apply"
        assert!(is_conflict_error("error: could not apply abc123"));
        // "resolve them"
        assert!(is_conflict_error("Please resolve them and commit the result"));
        // "fix conflicts"
        assert!(is_conflict_error("Fix conflicts and then commit the result"));
        // "after resolving the conflicts"
        assert!(is_conflict_error("After resolving the conflicts, run git rebase --continue"));
        // "failed to merge in the changes"
        assert!(is_conflict_error("Failed to merge in the changes"));
        // "pull is not possible because you have unmerged files"
        assert!(is_conflict_error("Pull is not possible because you have unmerged files"));
        // "cannot rebase" + "uncommitted changes"
        assert!(is_conflict_error("cannot rebase: you have uncommitted changes"));

        // Non-conflict patterns that should return false
        assert!(!is_conflict_error("Everything up-to-date"));
        assert!(!is_conflict_error("Successfully rebased"));
        assert!(!is_conflict_error("authentication failed"));
        assert!(!is_conflict_error("fatal: not a git repository"));
        assert!(!is_conflict_error(""));
        // "cannot rebase" alone (without "uncommitted changes") is NOT a conflict
        assert!(!is_conflict_error("cannot rebase onto main branch"));
        // "uncommitted changes" alone (without "cannot rebase") is NOT a conflict
        assert!(!is_conflict_error("uncommitted changes detected"));
    }

    #[test]
    fn test_is_auth_error_patterns() {
        // Various auth error patterns that should return true
        // "authentication failed"
        assert!(is_auth_error("Authentication failed for repo"));
        assert!(is_auth_error("AUTHENTICATION FAILED"));
        // "could not read username" / "could not read password"
        assert!(is_auth_error("fatal: could not read Username for 'https://github.com'"));
        assert!(is_auth_error("fatal: could not read Password for 'https://github.com'"));
        // "permission denied (publickey)" / "permission denied (keyboard-interactive)"
        assert!(is_auth_error("Permission denied (publickey)"));
        assert!(is_auth_error("Permission denied (keyboard-interactive)"));
        // "access denied"
        assert!(is_auth_error("Access denied"));
        // S-07 修复：裸 `could not read from remote repository`（无认证信号）不算
        // 认证错误——远程不可达/仓库不存在等纯网络故障也会输出该句，误归 auth
        // 会让前端误弹凭证框
        assert!(!is_auth_error("fatal: could not read from remote repository"));
        assert!(!is_auth_error("fatal: could not read from remote repository: Connection refused"));
        // "http 403"
        assert!(is_auth_error("HTTP 403 Forbidden"));
        // "invalid username or password"
        assert!(is_auth_error("Invalid username or password"));
        // "authentication error"
        assert!(is_auth_error("Authentication error occurred"));
        // "logon failed"
        assert!(is_auth_error("Logon failed"));
        // "authentication required"
        assert!(is_auth_error("Authentication required but no credential provided"));
        // "username for" / "password for"
        assert!(is_auth_error("Username for 'https://github.com':"));
        assert!(is_auth_error("Password for 'https://user@github.com':"));
        // "fatal: unable to access" + 403/401/authentication/credential
        assert!(is_auth_error("fatal: unable to access: 403 Forbidden"));
        assert!(is_auth_error("fatal: unable to access: 401 Unauthorized"));

        // Non-auth patterns that should return false
        assert!(!is_auth_error("Everything up-to-date"));
        assert!(!is_auth_error("CONFLICT (content): Merge conflict"));
        assert!(!is_auth_error("fatal: not a git repository"));
        assert!(!is_auth_error(""));
        // "401" alone (without "fatal: unable to access") is NOT an auth error
        assert!(!is_auth_error("401 Unauthorized"));
        // "fatal: unable to access" without 403/401/auth/credential is NOT an auth error
        assert!(!is_auth_error("fatal: unable to access: Connection timed out"));
    }

    /// S-26：本地改动覆盖错误识别——merge/pull/checkout 拒绝文本必须命中，
    /// 冲突/认证/成功等其它错误不受影响
    #[test]
    fn test_is_local_changes_overwrite_error_patterns() {
        assert!(is_local_changes_overwrite_error(
            "error: Your local changes to the following files would be overwritten by merge: src/main.rs Please commit your changes or stash them before you merge."
        ));
        assert!(is_local_changes_overwrite_error(
            "error: Your local changes to the following files would be overwritten by checkout"
        ));
        assert!(is_local_changes_overwrite_error(
            "YOUR LOCAL CHANGES TO THE FOLLOWING FILES WOULD BE OVERWRITTEN BY PULL"
        ));
        // 非该模式：冲突、认证、成功等不误报
        assert!(!is_local_changes_overwrite_error("CONFLICT (content): Merge conflict"));
        assert!(!is_local_changes_overwrite_error("authentication failed"));
        assert!(!is_local_changes_overwrite_error("Everything up-to-date"));
        assert!(!is_local_changes_overwrite_error(""));
    }

    /// P1-4：协议前缀错误识别——带前缀的错误必须原样上抛不被包装，
    /// 裸错误（普通 git stderr）允许调用方包装
    #[test]
    fn test_is_protocol_error_prefixes() {
        assert!(is_protocol_error("REBASE_CONFLICT:CONFLICT (content): Merge conflict in a.md"));
        assert!(is_protocol_error("AUTH_REQUIRED:fatal: could not read Username"));
        // DETACHED_HEAD_DIVERGED 不得被 DETACHED_HEAD 前缀误吞（子串顺序）
        assert!(is_protocol_error("DETACHED_HEAD_DIVERGED:main:1:2"));
        assert!(is_protocol_error("DETACHED_HEAD:Repository is in detached HEAD state"));
        assert!(is_protocol_error("SUBMODULE_UNCOMMITTED:submodule has changes"));
        assert!(is_protocol_error("REBASE_CONTINUE_FAILED:git rebase --continue failed"));
        assert!(is_protocol_error("MERGE_COMMIT_FAILED:commit failed"));
        // 裸错误不算协议前缀
        assert!(!is_protocol_error("Failed to fix detached HEAD: checkout failed"));
        assert!(!is_protocol_error("fatal: not a git repository"));
        assert!(!is_protocol_error(""));
        // 前缀必须在开头，出现在中间不算（调用方包装后已破坏，无法恢复）
        assert!(!is_protocol_error("Failed to fix: REBASE_CONFLICT:conflict"));
    }

    /// git ≥2.27 分叉拒绝错误识别：hint 与 fatal 两种表述都必须命中，
    /// 冲突/认证等其它错误不受影响
    #[test]
    fn test_is_divergent_branches_error_patterns() {
        assert!(is_divergent_branches_error(
            "hint: You have divergent branches and need to specify how to reconcile them.\nfatal: Need to specify how to reconcile divergent branches."
        ));
        assert!(is_divergent_branches_error("fatal: Need to specify how to reconcile divergent branches."));
        assert!(is_divergent_branches_error("YOU HAVE DIVERGENT BRANCHES"));
        // 非该模式：冲突、认证、成功等不误报
        assert!(!is_divergent_branches_error("CONFLICT (content): Merge conflict"));
        assert!(!is_divergent_branches_error("authentication failed"));
        assert!(!is_divergent_branches_error("Everything up-to-date"));
        assert!(!is_divergent_branches_error(""));
    }
}
