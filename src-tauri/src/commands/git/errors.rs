/// Check if a git error is a rebase/merge conflict
pub fn is_conflict_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("conflict")
        || lower.contains("could not apply")
        || lower.contains("merge conflict")
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
        || lower.contains("fatal: could not read from remote repository")
        || lower.contains("http 403")
        || lower.contains("invalid username or password")
        || lower.contains("authentication error")
        || lower.contains("logon failed")
        || lower.contains("authentication required")
        || lower.contains("username for")
        || lower.contains("password for")
        || lower.contains("fatal: unable to access") && (lower.contains("403") || lower.contains("401") || lower.contains("authentication") || lower.contains("credential"))
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

    #[test]
    fn test_is_auth_error_auth_keywords() {
        assert!(is_auth_error("Authentication failed for repo"));
        assert!(is_auth_error("fatal: could not read Username for 'https://github.com'"));
        assert!(is_auth_error("fatal: could not read Password for 'https://github.com'"));
        assert!(is_auth_error("Permission denied (publickey)"));
        assert!(is_auth_error("Permission denied (keyboard-interactive)"));
        assert!(is_auth_error("Access denied"));
        assert!(is_auth_error("fatal: could not read from remote repository"));
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
        // "fatal: could not read from remote repository"
        assert!(is_auth_error("fatal: could not read from remote repository"));
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
}
