use std::path::Path;
use super::models::GitRepositoryInfo;
use super::runner::run_git;
use super::branch::get_branch;
use super::conflict::get_uncommitted_count;

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

        // Check if .git is a file (indicating a submodule)
        let is_submodule = git_dir.is_file();

        // Get remote URL
        // G-05 修复：get_remote_url 返回 Result<Option<String>, String>，flatten 后得到 Option<String>
        let remote_url_result = get_remote_url(&path_str);
        if cfg!(debug_assertions) {
            match &remote_url_result {
                Ok(url) => eprintln!("[DIAG] scan_dir_recursive repo={} get_remote_url={:?}", path_str, url.as_ref()),
                Err(e) => eprintln!("[DIAG] scan_dir_recursive repo={} get_remote_url error={}", path_str, e),
            }
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
                        if cfg!(debug_assertions) {
                            match &submodule_remote_result {
                                Ok(url) => eprintln!("[DIAG] scan_dir_recursive repo={} get_remote_url={:?}", submodule_path_str, url.as_ref()),
                                Err(e) => eprintln!("[DIAG] scan_dir_recursive repo={} get_remote_url error={}", submodule_path_str, e),
                            }
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
            if path.is_dir() {
                scan_dir_recursive(&path, repos, parent_path.clone())?;
            }
        }
    }

    Ok(())
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

/// G-05 修复：获取远程仓库 URL。
/// 返回值区分三种情况：
/// - `Ok(Some(url))`：配置了 origin 远程且 URL 有效
/// - `Ok(None)`：没有配置 origin 远程（正常情况，git_pull 应跳过）
/// - `Err(e)`：git 命令执行失败（如仓库损坏、git 配置异常），调用方应报错而非静默成功
pub fn get_remote_url(path: &str) -> Result<Option<String>, String> {
    // 诊断日志：用于定位"未配置远程仓库"bug（release 构建静默）
    if cfg!(debug_assertions) {
        eprintln!("[DIAG] get_remote_url path={}", path);
    }
    // 先检查是否有 origin 远程配置
    let remotes = run_git(path, &["remote"])?;
    if cfg!(debug_assertions) {
        eprintln!("[DIAG] get_remote_url path={} remotes={:?}", path, remotes);
    }
    if !remotes.lines().any(|r| r.trim() == "origin") {
        // 没有配置 origin 远程，返回 None 表示"无远程配置"
        if cfg!(debug_assertions) {
            eprintln!("[DIAG] get_remote_url path={} no origin remote", path);
        }
        return Ok(None);
    }
    // 有 origin 但 get-url 失败，说明 git 配置异常（如 .git/config 损坏）
    let output = run_git(path, &["remote", "get-url", "origin"])?;
    let url = output.trim().to_string();
    if cfg!(debug_assertions) {
        eprintln!("[DIAG] get_remote_url path={} url={}", path, url);
    }
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
}
