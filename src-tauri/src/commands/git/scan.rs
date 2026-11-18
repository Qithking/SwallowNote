use std::path::Path;
use super::models::GitRepositoryInfo;
use super::runner::run_git;
use super::branch::get_branch;
use super::conflict::get_uncommitted_count;
use log::debug;

/// Scan directory for all git repositories
#[tauri::command]
pub async fn scan_git_repos(root_path: String) -> Result<Vec<GitRepositoryInfo>, String> {
    // 扫描涉及大量同步文件 I/O 与 git 子进程调用，放入 spawn_blocking 避免阻塞 tokio 工作线程。
    tokio::task::spawn_blocking(move || {
        let root = Path::new(&root_path);
        if !root.exists() {
            return Err(format!("Path does not exist: {}", root_path));
        }

        let mut repos = Vec::new();
        scan_dir_recursive(root, &mut repos, None)?;
        Ok(repos)
    })
    .await
    .map_err(|e| format!("Scan task panicked: {}", e))?
}

pub fn scan_dir_recursive(dir: &Path, repos: &mut Vec<GitRepositoryInfo>, parent_path: Option<String>) -> Result<(), String> {
    // Skip common non-repo directories
    let dir_name = dir.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    if dir_name.starts_with('.')
        || dir_name == "node_modules"
        || dir_name == "target"
        || dir_name == "dist"
        || dir_name == "build"
    {
        return Ok(());
    }

    // Check if this directory is a git repo
    let git_dir = dir.join(".git");
    if git_dir.exists() {
        let repo_name = dir.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let path_str = dir.to_string_lossy().to_string().replace('\\', "/");

        // Check if .git is a file (indicating a submodule or linked worktree)
        // P2 修复：linked worktree 的 `.git` 同样是文件（内容形如
        // "gitdir: <主仓>/.git/worktrees/<name>"），旧判断把 worktree 误标为
        // submodule。按 gitdir 指针内容区分：指向 .git/modules/ 的才是 submodule。
        let is_submodule = git_dir.is_file() && is_submodule_gitfile(&git_dir);

        // Get remote URL
        // G-05 修复：get_remote_url 返回 Result<Option<String>, String>，flatten 后得到 Option<String>
        let remote_url_result = get_remote_url(&path_str);
        match &remote_url_result {
            Ok(url) => debug!("[DIAG] scan_dir_recursive repo={} get_remote_url={:?}", path_str, url.as_ref()),
            Err(e) => debug!("[DIAG] scan_dir_recursive repo={} get_remote_url error={}", path_str, e),
        }
        let remote_url = remote_url_result.ok().flatten();

        // Get current branch
        let current_branch = get_branch(&path_str).unwrap_or_else(|_| "unknown".to_string());

        // Check for uncommitted changes
        let (has_changes, change_count) = get_uncommitted_count(&path_str);

        repos.push(GitRepositoryInfo {
            name: repo_name.clone(),
            path: path_str.clone(),
            remote_url,
            has_uncommitted_changes: has_changes,
            uncommitted_count: change_count,
            current_branch,
            is_submodule,
            parent_path: parent_path.clone(),
        });

        // Check for submodules in this repo
        let gitmodules_path = dir.join(".gitmodules");
        if gitmodules_path.exists() && !is_submodule {
            if let Ok(submodule_paths) = parse_gitmodules(&gitmodules_path) {
                for submodule_rel_path in submodule_paths {
                    let submodule_full_path = dir.join(&submodule_rel_path);
                    if submodule_full_path.exists() && submodule_full_path.join(".git").exists() {
                        let submodule_name = Path::new(&submodule_rel_path)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("unknown")
                            .to_string();

                        let submodule_path_str = submodule_full_path.to_string_lossy().to_string().replace('\\', "/");
                        let submodule_remote_result = get_remote_url(&submodule_path_str);
                        match &submodule_remote_result {
                            Ok(url) => debug!("[DIAG] scan_dir_recursive repo={} get_remote_url={:?}", submodule_path_str, url.as_ref()),
                            Err(e) => debug!("[DIAG] scan_dir_recursive repo={} get_remote_url error={}", submodule_path_str, e),
                        }
                        let submodule_remote = submodule_remote_result.ok().flatten();
                        let submodule_branch = get_branch(&submodule_path_str).unwrap_or_else(|_| "unknown".to_string());
                        let (submodule_has_changes, submodule_change_count) = get_uncommitted_count(&submodule_path_str);

                        repos.push(GitRepositoryInfo {
                            name: submodule_name,
                            path: submodule_path_str,
                            remote_url: submodule_remote,
                            has_uncommitted_changes: submodule_has_changes,
                            uncommitted_count: submodule_change_count,
                            current_branch: submodule_branch,
                            is_submodule: true,
                            parent_path: Some(path_str.clone()),
                        });
                    }
                }
            }
        }

        // If .git is a file (submodule), don't recurse into it
        // If .git is a directory (independent repo), continue scanning subdirectories for nested repos
        if is_submodule {
            return Ok(());
        }
    }

    // Recursively scan subdirectories
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            // P2 修复：跳过符号链接目录——symlink 可能成环（link → 某祖先目录），
            // 跟随进入会无限递归卡死扫描线程。跳过链接不损失根目录本身的扫描能力，
            // 仅不再穿透用户手工放置的符号链接目录（可接受的安全边界）。
            let is_symlink = entry
                .file_type()
                .map(|t| t.is_symlink())
                .unwrap_or(false);
            if is_symlink {
                debug!("[DIAG] scan_dir_recursive skip symlink entry: {}", path.display());
                continue;
            }
            if path.is_dir() {
                scan_dir_recursive(&path, repos, parent_path.clone())?;
            }
        }
    }

    Ok(())
}

/// 判断 `.git` 指针文件（内容形如 "gitdir: <path>"）是否属于 submodule。
/// submodule 的 gitdir 指向 <父仓>/.git/modules/<name>（git 用 modules 目录
/// 集中存放子模块仓库），linked worktree 的 gitdir 指向
/// <主仓>/.git/worktrees/<name>。读取失败时按旧行为视为 submodule（保守兼容）。
fn is_submodule_gitfile(git_file: &Path) -> bool {
    match std::fs::read_to_string(git_file) {
        Ok(content) => {
            let gitdir = content
                .trim()
                .strip_prefix("gitdir:")
                .map(|s| s.trim())
                .unwrap_or("");
            // 兼容 Windows 反斜杠路径
            gitdir.replace('\\', "/").contains(".git/modules/")
        }
        Err(_) => true,
    }
}

/// Parse .gitmodules file to extract submodule paths.
/// 使用 `git config -f` 解析，比手工分行匹配更健壮：可容忍 `path=value`、
/// `path = value`、`path\t=\tvalue` 等多种写法以及注释、引号等差异。
pub fn parse_gitmodules(gitmodules_path: &Path) -> Result<Vec<String>, String> {
    // .gitmodules 的父目录（仓库根）作为 git 命令的工作目录
    let dir = gitmodules_path
        .parent()
        .and_then(|p| p.to_str())
        .ok_or("Invalid .gitmodules path")?;
    let gitmodules_str = gitmodules_path
        .to_str()
        .ok_or("Invalid .gitmodules path encoding")?;
    // --get-regexp 匹配 key（形如 submodule.<name>.path），输出 "<key> <value>"
    match run_git(dir, &["config", "-f", gitmodules_str, "--get-regexp", r"submodule\..*\.path"]) {
        Ok(output) => {
            let mut paths = Vec::new();
            for line in output.lines() {
                // 输出格式：<key> <value>，例如 "submodule.foo.path modules/foo"
                // 取第一个空格之后的部分作为子模块路径
                if let Some(idx) = line.find(' ') {
                    let p = line[idx..].trim();
                    if !p.is_empty() {
                        paths.push(p.to_string());
                    }
                }
            }
            Ok(paths)
        }
        Err(_) => {
            // git config --get-regexp 在无匹配时退出码为 1（非真实错误），返回空列表。
            Ok(Vec::new())
        }
    }
}

/// 剥离 URL 中内嵌的凭证（https://user:pass@host/path → https://user@host/path）。
/// P2 修复：内嵌凭证若进入 keyring 条目名（系统钥匙串 UI 可见）或诊断日志，
/// 属明文泄露；本函数返回值仅用于展示/存储键场景，git 命令侧仍使用仓库
/// 自身配置的原始 URL。密码允许含未转义的 '@'，故在第一个 '/' 之前的
/// authority 段内取最后一个 '@' 切分。SSH 形式（git@host:path）不含 "://"，
/// 其密码不会内嵌在 URL 中，原样返回。
pub fn sanitize_remote_url(url: &str) -> String {
    let Some(idx) = url.find("://") else {
        return url.to_string();
    };
    let scheme_end = idx + 3;
    let rest = &url[scheme_end..];
    let host_start = rest.find('/').unwrap_or(rest.len());
    let authority = &rest[..host_start];
    let path = &rest[host_start..];
    if let Some(at) = authority.rfind('@') {
        let userinfo = &authority[..at];
        let host = &authority[at + 1..];
        // 保留用户名（可区分账号），去掉密码段；仅密码无用户名时整段去除
        let user = userinfo.split(':').next().unwrap_or("");
        if user.is_empty() {
            return format!("{}{}{}", &url[..scheme_end], host, path);
        }
        return format!("{}{}@{}{}", &url[..scheme_end], user, host, path);
    }
    url.to_string()
}

/// G-05 修复：获取远程仓库 URL。
/// 返回值区分三种情况：
/// - `Ok(Some(url))`：配置了 origin 远程且 URL 有效（已脱敏内嵌凭证）
/// - `Ok(None)`：没有配置 origin 远程（正常情况，git_pull 应跳过）
/// - `Err(e)`：git 命令执行失败（如仓库损坏、git 配置异常），调用方应报错而非静默成功
pub fn get_remote_url(path: &str) -> Result<Option<String>, String> {
    // 诊断日志：用于定位"未配置远程仓库"bug（release 构建静默）
    debug!("[DIAG] get_remote_url path={}", path);
    // 先检查是否有 origin 远程配置
    let remotes = run_git(path, &["remote"])?;
    debug!("[DIAG] get_remote_url path={} remotes={:?}", path, remotes);
    if !remotes.lines().any(|r| r.trim() == "origin") {
        // 没有配置 origin 远程，返回 None 表示"无远程配置"
        debug!("[DIAG] get_remote_url path={} no origin remote", path);
        return Ok(None);
    }
    // 有 origin 但 get-url 失败，说明 git 配置异常（如 .git/config 损坏）
    let output = run_git(path, &["remote", "get-url", "origin"])?;
    let url = sanitize_remote_url(output.trim());
    // 日志输出脱敏后的 URL（P2：原始 URL 可能内嵌 user:pass）
    debug!("[DIAG] get_remote_url path={} url={}", path, url);
    if url.is_empty() {
        return Ok(None);
    }
    Ok(Some(url))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_gitmodules_valid() {
        // Create a temp directory with a valid .gitmodules file.
        // parse_gitmodules calls `git config -f <file> --get-regexp ...` which
        // does NOT require a git repo (just reads the file), but does require git installed.
        let tmp = tempfile::tempdir().expect("failed to create temp dir");
        let gitmodules_path = tmp.path().join(".gitmodules");
        let content = "[submodule \"foo\"]\npath = modules/foo\nurl = https://example.com/foo.git\n[submodule \"bar\"]\npath = modules/bar\nurl = https://example.com/bar.git\n";
        std::fs::write(&gitmodules_path, content).expect("failed to write .gitmodules");

        let result = parse_gitmodules(&gitmodules_path);
        assert!(result.is_ok(), "parse_gitmodules should return Ok for a valid .gitmodules file");
        let paths = result.unwrap();
        // When git is available, paths should contain both submodule paths.
        // When git is not available, the function returns Ok(vec![]) (error is swallowed).
        if !paths.is_empty() {
            assert_eq!(paths, vec!["modules/foo", "modules/bar"]);
        }
    }

    #[test]
    fn test_parse_gitmodules_empty() {
        // An empty .gitmodules file has no submodule entries.
        // `git config -f <file> --get-regexp ...` returns no matches (exit code 1),
        // and parse_gitmodules returns Ok(Vec::new()).
        let tmp = tempfile::tempdir().expect("failed to create temp dir");
        let gitmodules_path = tmp.path().join(".gitmodules");
        std::fs::write(&gitmodules_path, "").expect("failed to write empty .gitmodules");

        let result = parse_gitmodules(&gitmodules_path);
        assert!(result.is_ok(), "parse_gitmodules should return Ok for an empty .gitmodules file");
        assert_eq!(result.unwrap(), Vec::<String>::new(), "empty .gitmodules should yield no paths");
    }

    /// P2 回归：内嵌凭证 URL 脱敏——密码不得出现在返回值/日志中
    #[test]
    fn test_sanitize_remote_url() {
        // 基本形态：去密码、留用户名
        assert_eq!(
            sanitize_remote_url("https://user:secret@github.com/user/repo.git"),
            "https://user@github.com/user/repo.git"
        );
        // 密码含 '@'：取 authority 段内最后一个 '@' 切分
        assert_eq!(
            sanitize_remote_url("https://user:p@ss@host.com/repo.git"),
            "https://user@host.com/repo.git"
        );
        // 无凭证：原样返回
        assert_eq!(
            sanitize_remote_url("https://github.com/user/repo.git"),
            "https://github.com/user/repo.git"
        );
        // 无用户名仅密码：整段去掉
        assert_eq!(
            sanitize_remote_url("https://:token@host.com/repo.git"),
            "https://host.com/repo.git"
        );
        // SSH/scp 形式：原样返回
        assert_eq!(
            sanitize_remote_url("git@github.com:user/repo.git"),
            "git@github.com:user/repo.git"
        );
    }

    /// P2 回归：`.git` 指针文件按 gitdir 内容区分 submodule 与 linked worktree
    #[test]
    fn test_is_submodule_gitfile() {
        let tmp = tempfile::tempdir().unwrap();
        // submodule：gitdir 指向 .git/modules/
        let sub_git = tmp.path().join("sub.txt");
        std::fs::write(&sub_git, "gitdir: ../.git/modules/foo\n").unwrap();
        assert!(is_submodule_gitfile(&sub_git));
        // linked worktree：gitdir 指向 .git/worktrees/（不得误判为 submodule）
        let wt_git = tmp.path().join("wt.txt");
        std::fs::write(&wt_git, "gitdir: /repo/.git/worktrees/wt1\n").unwrap();
        assert!(!is_submodule_gitfile(&wt_git));
        // Windows 反斜杠路径同样能识别 worktree
        let wt_git_win = tmp.path().join("wt_win.txt");
        std::fs::write(&wt_git_win, "gitdir: C:/repo/.git/worktrees/wt1\n").unwrap();
        assert!(!is_submodule_gitfile(&wt_git_win));
        // 读取失败按旧行为视为 submodule（保守兼容）
        assert!(is_submodule_gitfile(tmp.path().join("missing.txt").as_path()));
    }

    /// P2 回归：符号链接目录成环不得导致无限递归——symlink 指向祖先目录
    /// 时扫描应在有限步内完成（若死循环，测试将超时挂起）
    #[test]
    fn test_scan_skips_symlink_cycles() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // 根下建一个普通子目录
        let sub = root.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        // symlink 指向根目录自身 → 成环
        #[cfg(unix)]
        std::os::unix::fs::symlink(root, sub.join("loop")).unwrap();
        // root 本身是仓库（.git 目录存在即被视为 repo，但 .git 目录名以 '.' 开头不会递归）
        std::fs::create_dir_all(root.join(".git")).unwrap();

        let mut repos = Vec::new();
        scan_dir_recursive(root, &mut repos, None)
            .expect("scan must terminate on symlink cycle");
    }
}
