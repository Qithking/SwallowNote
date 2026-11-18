use std::path::{Path, PathBuf};
use super::models::ConflictFile;
use super::with_repo_lock;
use super::runner::{run_git, run_git_no_trim, run_git_blocking};
use super::paths::{to_git_path, unescape_git_path, git_state_path};
use super::branch::is_rebase_scenario;
use super::conflict_content::{fetch_stage_content, get_conflict_content, check_and_continue_rebase};
// 冲突文件写入统一过 fs_guard 白名单闸（架构审计候选 2）
use crate::services::fs_guard::ensure_path_allowed;
use log::{debug, warn};

/// S-02：判断指定文件是否处于 git 冲突（unmerged）状态。
/// 通过 `ls-files --unmerged -- <path>` 检查——只有真实冲突文件才会在 index
/// 留下 unmerged 条目。冲突处理只允许操作此类文件，避免误删/误覆盖普通文件。
pub fn is_file_unmerged(repo_path: &str, rel_path: &str) -> bool {
    run_git(repo_path, &["ls-files", "--unmerged", "--", rel_path])
        .map(|o| !o.trim().is_empty())
        .unwrap_or(false)
}

/// 校验相对 git 路径不含路径穿越组件（".."）。
/// S-23 修复：原 `contains("..")` 会误拒绝含双点的合法文件名
/// （如 "a..b.txt"、"dir/..hidden"），改为按 '/' 分割做组件级判断——
/// 只有独立的 ".." 组件才是真实穿越（"../secret"、"a/../../b"）。
pub fn has_path_traversal(git_path: &str) -> bool {
    git_path.split('/').any(|comp| comp == "..")
}

/// Get list of conflicting files in a repository during a rebase or merge
#[tauri::command]
pub async fn git_get_conflict_files(repo_path: String) -> Result<Vec<ConflictFile>, String> {
    // Check if there's an ongoing rebase or merge
    // S-24 修复：经 git rev-parse --git-path 解析 gitdir 真实路径，支持 worktree
    // （.git 为文件时仍能查到主仓库 gitdir 下的状态文件）
    let has_state_file = git_state_path(&repo_path, "rebase-merge").exists()
        || git_state_path(&repo_path, "rebase-apply").exists()
        || git_state_path(&repo_path, "MERGE_HEAD").exists();

    let mut seen_paths = std::collections::HashSet::new();
    let mut files = Vec::new();

    // Method 1: Get unmerged files using diff-filter=U
    if let Ok(output) = run_git(&repo_path, &["-c", "core.quotepath=false", "diff", "--name-only", "--diff-filter=U"]) {
        for line in output.lines() {
            // S-11 修复：Method 1 同样经 unescape_git_path（与 Method 2/3 一致）——
            // 此前仅 trim_matches('"')，含引号/反斜杠/制表符的文件名（git C 风格
            // 转义）路径被破坏，且 Method 1 非空时短路掉正确处理路径的 Method 2/3。
            let rel_path = unescape_git_path(line.trim().trim_matches('"'));
            if !rel_path.is_empty() && seen_paths.insert(rel_path.clone()) {
                let abs_path = format!("{}/{}", repo_path.trim_end_matches('/'), rel_path);
                files.push(ConflictFile {
                    path: rel_path,
                    abs_path,
                });
            }
        }
    }

    // Method 2: Use ls-files --unmerged as fallback
    if files.is_empty() {
        if let Ok(ls_output) = run_git(&repo_path, &["-c", "core.quotepath=false", "ls-files", "--unmerged"]) {
            for line in ls_output.lines() {
                // 顺带修复（审计 Method2）：前 3 个字段（mode/hash/stage）以空白分隔，
                // 其后全部是路径——按字段边界跳过而非 split_whitespace+join，
                // 避免路径中的连续空格被压缩成单个空格导致文件定位失败
                let mut rest = line.trim_start();
                let mut well_formed = true;
                for _ in 0..3 {
                    match rest.find(char::is_whitespace) {
                        Some(i) => rest = rest[i + 1..].trim_start(),
                        None => { well_formed = false; break; }
                    }
                }
                if !well_formed || rest.is_empty() {
                    continue;
                }
                let rel_path = unescape_git_path(rest.trim().trim_matches('"'));
                if seen_paths.insert(rel_path.clone()) {
                    let abs_path = format!("{}/{}", repo_path.trim_end_matches('/'), rel_path);
                    files.push(ConflictFile {
                        path: rel_path,
                        abs_path,
                    });
                }
            }
        }
    }

    // Method 3: Use git status --porcelain to find conflict markers (UU, AA, DU, UD etc)
    if files.is_empty() {
        if let Ok(status_output) = run_git(&repo_path, &["-c", "core.quotepath=false", "status", "--porcelain"]) {
            for line in status_output.lines() {
                let line = line.trim();
                if line.len() >= 4 {
                    let xy = &line[0..2];
                    if xy.contains("U") || xy == "DD" || xy == "AA" {
                        let raw_path = line[3..].trim();
                        let rel_path = unescape_git_path(raw_path.trim_matches('"'));
                        if seen_paths.insert(rel_path.clone()) {
                            let abs_path = format!("{}/{}", repo_path.trim_end_matches('/'), rel_path);
                            files.push(ConflictFile {
                                path: rel_path,
                                abs_path,
                            });
                        }
                    }
                }
            }
        }
    }

    // Method 4: Check for conflict markers in working tree files as last resort
    if files.is_empty() && has_state_file {
        // 顺带修复（审计 Method4 quotepath）：关闭 core.quotepath 并按 Method2/3
        // 同样方式 unescape——中文路径默认被转义为 "\346..." 带引号形式，
        // 直接 trim 后拼出的绝对路径不存在，冲突文件列表会漏掉中文文件
        if let Ok(grep_output) = run_git(&repo_path, &["-c", "core.quotepath=false", "grep", "-l", "^<<<<<<< ", "--full-name"]) {
            for line in grep_output.lines() {
                let rel_path = unescape_git_path(line.trim().trim_matches('"'));
                if !rel_path.is_empty() && seen_paths.insert(rel_path.clone()) {
                    let abs_path = format!("{}/{}", repo_path.trim_end_matches('/'), rel_path);
                    files.push(ConflictFile {
                        path: rel_path,
                        abs_path,
                    });
                }
            }
        }
    }

    // Early return if no state file and no conflicts found
    if !has_state_file && files.is_empty() {
        debug!("[INFO] git_get_conflict_files: no rebase/merge state found and no conflicts detected in {}", repo_path);
        return Ok(vec![]);
    }

    // If we have a state file but found NO actual conflict files via standard methods,
    // the rebase/merge may be in a special state (e.g. interactive rebase with empty todo).
    // Return empty list - the frontend should keep showing the conflict tab until user resolves it.
    if files.is_empty() {
        debug!("[INFO] git_get_conflict_files: rebase/merge state exists but no unmerged files found in {}", repo_path);
    }

    debug!("[INFO] git_get_conflict_files: found {} conflict files in {}", files.len(), repo_path);
    Ok(files)
}

// 获取冲突文件的本地版本。rebase 用 stage 3/REBASE_HEAD，merge 用 stage 2/HEAD。
#[tauri::command]
pub async fn git_get_conflict_local_content(repo_path: String, file_path: String) -> Result<String, String> {
    debug!("[INFO] git_get_conflict_local_content: repo_path={}, file_path={}", repo_path, file_path);

    let rel_path = file_path.trim().trim_start_matches('/').trim_matches('"').to_string();
    // Validate: reject path traversal attempts（S-23：组件级校验，放行 a..b.txt 等合法文件名）
    if has_path_traversal(&rel_path) {
        return Err(format!("Invalid file path: path traversal detected in '{}'", rel_path));
    }
    debug!("[INFO] git_get_conflict_local_content: normalized rel_path='{}'", rel_path);

    // G-14 修复：使用公共函数统一 stage 映射逻辑
    // rebase: local = REBASE_HEAD + stage 3（theirs = 本地）
    // merge : local = HEAD + stage 2（ours = 本地）
    let is_rebasing = is_rebase_scenario(&repo_path);
    let result = if is_rebasing {
        // 先尝试 REBASE_HEAD（rebase 场景下的本地提交）
        // G-16 修复：使用 run_git_no_trim 保留文件原始末尾换行
        if let Ok(output) = run_git_no_trim(&repo_path, &["show", &format!("REBASE_HEAD:{}", rel_path)]) {
            if !output.is_empty() { return Ok(output); }
        }
        // 再用 stage 3 + cat-file fallback
        fetch_stage_content(&repo_path, &rel_path, 3)
    } else {
        // 先尝试 HEAD（merge 场景下的本地分支）
        if let Ok(output) = run_git_no_trim(&repo_path, &["show", &format!("HEAD:{}", rel_path)]) {
            if !output.is_empty() { return Ok(output); }
        }
        // 再用 stage 2 + cat-file fallback
        fetch_stage_content(&repo_path, &rel_path, 2)
    };

    if let Some(content) = result {
        debug!("[INFO] git_get_conflict_local_content: OK from stage (len={})", content.len());
        Ok(content)
    } else {
        warn!("[WARN] git_get_conflict_local_content: all git strategies failed for '{}' in {}, returning empty (file may not exist on this side)", rel_path, repo_path);
        Ok(String::new())
    }
}

// 获取冲突文件的远程版本。rebase 用 stage 2/HEAD，merge 用 stage 3/MERGE_HEAD。
#[tauri::command]
pub async fn git_get_conflict_remote_content(repo_path: String, file_path: String) -> Result<String, String> {
    debug!("[INFO] git_get_conflict_remote_content: repo_path={}, file_path={}", repo_path, file_path);

    let rel_path = file_path.trim().trim_start_matches('/').trim_matches('"').to_string();
    // Validate: reject path traversal attempts（S-23：组件级校验，放行 a..b.txt 等合法文件名）
    if has_path_traversal(&rel_path) {
        return Err(format!("Invalid file path: path traversal detected in '{}'", rel_path));
    }
    debug!("[INFO] git_get_conflict_remote_content: normalized rel_path='{}'", rel_path);

    // G-14 修复：使用公共函数统一 stage 映射逻辑
    // rebase: remote = HEAD + stage 2（ours = upstream/remote）
    // merge : remote = MERGE_HEAD + stage 3（theirs = remote）
    let is_rebasing = is_rebase_scenario(&repo_path);
    let result = if is_rebasing {
        // 先尝试 HEAD（rebase 场景下的 upstream/remote）
        // G-16 修复：使用 run_git_no_trim 保留文件原始末尾换行
        if let Ok(output) = run_git_no_trim(&repo_path, &["show", &format!("HEAD:{}", rel_path)]) {
            if !output.is_empty() { return Ok(output); }
        }
        // 再用 stage 2 + cat-file fallback
        fetch_stage_content(&repo_path, &rel_path, 2)
    } else {
        // 先尝试 MERGE_HEAD（merge 场景下的 remote）
        let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
        if merge_head.exists() {
            if let Ok(output) = run_git_no_trim(&repo_path, &["show", &format!("MERGE_HEAD:{}", rel_path)]) {
                if !output.is_empty() { return Ok(output); }
            }
        }
        // 再用 stage 3 + cat-file fallback
        fetch_stage_content(&repo_path, &rel_path, 3)
    };

    if let Some(content) = result {
        debug!("[INFO] git_get_conflict_remote_content: OK from stage (len={})", content.len());
        Ok(content)
    } else {
        warn!("[WARN] git_get_conflict_remote_content: all git strategies failed for '{}' in {}, returning empty (file may not exist on this side)", rel_path, repo_path);
        Ok(String::new())
    }
}

/// Resolve a conflict by choosing a side for a specific file
/// side: "local" or "remote"
#[tauri::command]
pub async fn git_resolve_conflict_file(
    app: tauri::AppHandle,
    workspace_root: Option<String>,
    db: tauri::State<'_, crate::db::Database>,
    repo_path: String,
    file_path: String,
    side: String,
) -> Result<(), String> {
    // S-09 修复：per-repo 互斥 + blocking 线程池——resolve 会写工作树/索引并可能
    // 触发 rebase --continue，与 pull/commit 并发会踩踏（index.lock 冲突）；
    // 锁等待与命令体都移入 spawn_blocking，不阻塞 tokio worker（同 S-08 约定）。
    let lock_key = repo_path.clone();
    let repo_path_for_lock = repo_path.clone();
    let result = run_git_blocking(move || {
        with_repo_lock(&lock_key, || {
            git_resolve_conflict_file_impl(app, workspace_root, repo_path_for_lock, file_path, side)
        })
    })
    .await;
    // S-27：resolve 成功后后端主动对齐 DB 冲突记录（前端 handlePostResolve 清理的
    // 兜底——前端异常路径会残留脏记录，启动时误报冲突 badge）。db 为借用不能
    // 移入闭包，在闭包外按结果同步。
    if result.is_ok() {
        sync_conflict_record_after_change(&db, &repo_path);
    }
    result
}

/// 检测工作树文件内容是否仍含未解决的冲突标记（resolve 前兜底校验）。
/// P2 修复：单独的 `=======` 不再算冲突标记——markdown 的 setext 标题下划线
/// 或分隔线常为 `=======`，旧判断会把用户合法的 markdown 内容拦在 resolve 之外；
/// 真实冲突（merge / diff3 风格）必然同时存在起始标记 `<<<<<<<` 或结束标记
/// `>>>>>>>`，故只以这两个标记为准。
fn worktree_has_conflict_markers(content: &str) -> bool {
    content.contains("<<<<<<<") || content.contains(">>>>>>>")
}

fn git_resolve_conflict_file_impl(
    app: tauri::AppHandle,
    workspace_root: Option<String>,
    repo_path: String,
    file_path: String,
    side: String,
) -> Result<(), String> {
    // strip_prefix 失败时用 canonicalize 规范化两个路径后再 strip，处理符号链接、相对路径等情况
    // 用 match + to_path_buf 取得所有权，避免 or_else 闭包返回引用局部变量导致的借用错误。
    let rel_path = match Path::new(&file_path).strip_prefix(Path::new(&repo_path)) {
        Ok(p) => p.to_path_buf(),
        Err(_) => {
            // 规范化后重试：解决因路径形式不一致（如 /var vs /private/var）导致 strip_prefix 失败
            let canon_file = std::fs::canonicalize(&file_path)
                .map_err(|e| format!("Failed to resolve file path '{}': {}", file_path, e))?;
            let canon_repo = std::fs::canonicalize(&repo_path)
                .map_err(|e| format!("Failed to resolve repo path '{}': {}", repo_path, e))?;
            canon_file
                .strip_prefix(&canon_repo)
                .map(|p| p.to_path_buf())
                .map_err(|e| {
                    format!("File path '{}' is not within repository '{}': {}", file_path, repo_path, e)
                })?
        }
    };
    let git_path = to_git_path(&rel_path);

    // Validate: reject path traversal attempts（S-23：组件级校验，放行 a..b.txt 等合法文件名）
    if has_path_traversal(&git_path) {
        return Err(format!("Invalid file path: path traversal detected in '{}'", git_path));
    }

    debug!("[INFO] git_resolve_conflict_file: repo_path={}, file_path={}, side={}", repo_path, file_path, side);

    // S-02：写/删前校验目标文件确实处于 unmerged 状态——冲突处理只允许
    // 操作真实冲突文件；前端列表过期/外部已解决后传入非冲突文件时拒绝，
    // 防止静默删除工作区文件或把非冲突文件覆盖为某侧版本（潜在数据丢失）。
    if !is_file_unmerged(&repo_path, &git_path) {
        return Err(format!("NOT_UNMERGED:{}", git_path));
    }

    // If side is "current", the user has already edited and saved the file via
    // git_save_conflict_file_content, so we just need to stage it.
    // If side is "local" or "remote", we overwrite with the chosen side's content.
    // get_conflict_content 返回 Ok(None) 表示该侧文件不存在（modify/delete 冲突），
    // "接受该侧"的语义即删除文件：移除工作区文件后由 git add stage 该删除。
    if side != "current" {
        let target_path = Path::new(&repo_path).join(&rel_path);
        // fs_guard 白名单校验（候选 2）：写入目标必须位于工作区/应用数据目录内
        ensure_path_allowed(&app, workspace_root.as_deref(), &target_path)?;
        match get_conflict_content(&repo_path, &git_path, &side)? {
            Some(content) => {
                // 写入目标必须基于 repo_path + 相对路径，避免前端传入的 file_path
                // 指向仓库外（路径穿越）。
                std::fs::write(&target_path, &content)
                    .map_err(|e| format!("Failed to write file: {}", e))?;
            }
            None => {
                // 该侧已删除：确保工作区文件被移除（若本来就不存在则无需处理）
                if target_path.exists() {
                    std::fs::remove_file(&target_path)
                        .map_err(|e| format!("Failed to remove file: {}", e))?;
                }
            }
        }
    }

    // Stage the resolved file
    // S-10 修复：side=current（用户编辑保存后 stage）时后端兜底校验工作树文件
    // 不再含冲突标记——此前仅前端保证顺序（先 save 后 resolve），前端顺序出错时
    // 带 <<<<<<< 标记的文件会被 add 提交进历史。side=local/remote 已由上方写入
    // 权威内容，无需此检查。
    if side == "current" {
        let target_path = Path::new(&repo_path).join(&rel_path);
        // 用 read + from_utf8_lossy 而非 read_to_string：冲突标记为 ASCII，
        // 非 UTF-8 字节不影响检测；权限/IO 读取失败必须上抛（此文件已通过
        // is_file_unmerged 校验必然存在，静默跳过会让带标记内容被 add）
        let existing = std::fs::read(&target_path)
            .map_err(|e| format!("Failed to read conflict file '{}': {}", target_path.display(), e))?;
        let existing = String::from_utf8_lossy(&existing);
        if worktree_has_conflict_markers(&existing) {
            return Err(format!(
                "CONFLICT_MARKERS:{} still contains conflict markers. Please edit and save the file before marking resolved.",
                git_path
            ));
        }
    }
    run_git(&repo_path, &["add", &git_path])?;

    check_and_continue_rebase(&repo_path)
}

/// Save edited content to a conflict file (without marking as resolved).
/// This writes the user's edits back to the file but does NOT stage it.
/// The conflict is NOT considered resolved until git_resolve_conflict_file is called,
/// which stages the file and checks if rebase can continue.
#[tauri::command]
pub async fn git_save_conflict_file_content(
    app: tauri::AppHandle,
    workspace_root: Option<String>,
    repo_path: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    // S-09 修复：per-repo 互斥 + blocking 线程池——save 写工作树，与 pull 并发
    // 会踩踏（同 resolve 一致）。
    let lock_key = repo_path.clone();
    run_git_blocking(move || {
        with_repo_lock(&lock_key, || {
            git_save_conflict_file_content_impl(app, workspace_root, repo_path, file_path, content)
        })
    })
    .await
}

fn git_save_conflict_file_content_impl(
    app: tauri::AppHandle,
    workspace_root: Option<String>,
    repo_path: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    // S-12 修复：与 resolve 同款 strip_prefix + canonicalize 回退（/var vs /private/var
    // 等符号链接场景），此前仅 strip_prefix 导致 save 报 "Invalid relative path" 而
    // resolve 却成功，前后不一致。
    let rel_path = match Path::new(&file_path).strip_prefix(Path::new(&repo_path)) {
        Ok(p) => p.to_path_buf(),
        Err(_) => {
            let canon_file = std::fs::canonicalize(&file_path)
                .map_err(|e| format!("Failed to resolve file path '{}': {}", file_path, e))?;
            let canon_repo = std::fs::canonicalize(&repo_path)
                .map_err(|e| format!("Failed to resolve repo path '{}': {}", repo_path, e))?;
            canon_file
                .strip_prefix(&canon_repo)
                .map(|p| p.to_path_buf())
                .map_err(|e| {
                    format!("File path '{}' is not within repository '{}': {}", file_path, repo_path, e)
                })?
        }
    };
    let git_path = to_git_path(&rel_path);

    // Validate: reject path traversal attempts（S-23：组件级校验，放行 a..b.txt 等合法文件名）
    if has_path_traversal(&git_path) {
        return Err(format!("Invalid file path: path traversal detected in '{}'", git_path));
    }

    debug!("[INFO] git_save_conflict_file_content: repo_path={}, file_path={}", repo_path, file_path);

    // S-02：写入前校验目标文件确实处于 unmerged 状态——冲突面板保存只允许
    // 操作真实冲突文件，防止把编辑内容写入普通文件覆盖用户数据。
    if !is_file_unmerged(&repo_path, &git_path) {
        return Err(format!("NOT_UNMERGED:{}", git_path));
    }

    // Write the edited content back to the file
    // Do NOT run `git add` here — that would prematurely resolve the conflict.
    // Staging is done in `git_resolve_conflict_file` when the user explicitly resolves.
    // 写入目标基于 repo_path + 相对路径，避免前端传入的 file_path 指向仓库外（路径穿越）。
    let target_path = Path::new(&repo_path).join(&rel_path);
    // fs_guard 白名单校验（候选 2）：写入目标必须位于工作区/应用数据目录内
    ensure_path_allowed(&app, workspace_root.as_deref(), &target_path)?;
    std::fs::write(&target_path, &content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}

/// Abort the current rebase or merge, restoring the repository to a clean state
#[tauri::command]
pub async fn git_abort_conflict(
    db: tauri::State<'_, crate::db::Database>,
    repo_path: String,
) -> Result<(), String> {
    // S-09 修复：per-repo 互斥 + blocking 线程池——abort 会重置工作树/索引，与
    // pull/commit 并发会踩踏。
    let lock_key = repo_path.clone();
    let repo_path_for_lock = repo_path.clone();
    let result = run_git_blocking(move || {
        with_repo_lock(&lock_key, || git_abort_conflict_impl(repo_path_for_lock))
    })
    .await;
    // S-27：abort 后仓库回到冲突前状态，主动删除/对齐 DB 冲突记录（兜底）
    if result.is_ok() {
        sync_conflict_record_after_change(&db, &repo_path);
    }
    result
}

fn git_abort_conflict_impl(repo_path: String) -> Result<(), String> {
    // S-24 修复：worktree 场景经 git rev-parse --git-path 解析状态文件真实路径
    let rebase_merge = git_state_path(&repo_path, "rebase-merge");
    let rebase_apply = git_state_path(&repo_path, "rebase-apply");
    let merge_head = git_state_path(&repo_path, "MERGE_HEAD");

    if rebase_merge.exists() || rebase_apply.exists() {
        run_git(&repo_path, &["rebase", "--abort"])?;
    } else if merge_head.exists() {
        run_git(&repo_path, &["merge", "--abort"])?;
    } else {
        return Err("No rebase or merge in progress".to_string());
    }
    Ok(())
}

/// S-27：resolve/abort 成功后对齐 DB 冲突记录——此前清理只依赖前端
/// handlePostResolve，前端异常路径（崩溃/会话恢复/流程中断）会残留脏记录，
/// 启动时误报冲突 badge。命令成功路径后端主动同步（幂等，与前端重复无害）。
/// 冲突计数用 `git diff --diff-filter=U`（与 check_and_continue_rebase 同源，
/// 只统计 unmerged index 条目）。
fn sync_conflict_record_after_change(db: &crate::db::Database, repo_path: &str) {
    let remaining = run_git(repo_path, &["diff", "--name-only", "--diff-filter=U"])
        .unwrap_or_default();
    let count = remaining.lines().filter(|l| !l.trim().is_empty()).count() as i64;
    let repo_name = Path::new(repo_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(repo_path)
        .to_string();
    if count == 0 {
        let _ = crate::db::conflict_repo::remove_conflict_repo(db, repo_path);
    } else {
        let _ = crate::db::conflict_repo::upsert_conflict_repo(db, repo_path, &repo_name, count);
    }
}

pub fn get_uncommitted_count(path: &str) -> (bool, usize) {
    let status_output = run_git(path, &["status", "--porcelain"]).unwrap_or_default();

    let total_lines = status_output.lines().filter(|l| !l.is_empty()).count();

    // Count only tracked (staged/modified) files, excluding untracked
    let tracked_count = status_output.lines()
        .filter(|line| {
            let xy = line.get(..2).unwrap_or("  ");
            !xy.starts_with('?') && !xy.ends_with('?')
        })
        .count();

    (total_lines > 0, tracked_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::test_utils::{git_cmd, setup_conflict_repo, normalize};

    /// S-02 回归：is_file_unmerged 区分真实冲突文件与普通文件
    #[test]
    fn test_is_file_unmerged_distinguishes_conflict_and_plain() {
        let tmp = setup_conflict_repo();
        let repo = tmp.path();

        // 普通文件（无冲突）：非 unmerged
        assert!(!is_file_unmerged(repo.to_str().unwrap(), "file.txt"));

        // 制造真实冲突：feature 分支改动 file.txt，main 也改动，merge 产生冲突
        git_cmd(repo, &["checkout", "-q", "-b", "feature"]);
        std::fs::write(repo.join("file.txt"), "line1\nremote\n").unwrap();
        git_cmd(repo, &["add", "file.txt"]);
        git_cmd(repo, &["commit", "-q", "-m", "feature"]);

        git_cmd(repo, &["checkout", "-q", "main"]);
        std::fs::write(repo.join("file.txt"), "line1\nlocal\n").unwrap();
        git_cmd(repo, &["add", "file.txt"]);
        git_cmd(repo, &["commit", "-q", "-m", "main"]);

        let status = std::process::Command::new("git")
            .current_dir(repo)
            .args(["merge", "feature", "--no-commit", "--no-ff"])
            .status()
            .unwrap();
        assert!(!status.success(), "merge should produce conflicts");

        assert!(is_file_unmerged(repo.to_str().unwrap(), "file.txt"),
            "file.txt should be unmerged after conflicting merge");

        // 未冲突的文件：仍非 unmerged
        assert!(!is_file_unmerged(repo.to_str().unwrap(), "nonexistent.txt"));
    }

    #[tokio::test]
    async fn test_get_conflict_local_content_merge_has_no_markers() {
        let tmp = setup_conflict_repo();
        let repo = tmp.path();

        git_cmd(repo, &["checkout", "-q", "-b", "feature"]);
        std::fs::write(repo.join("file.txt"), "line1\nremote\n").unwrap();
        git_cmd(repo, &["add", "file.txt"]);
        git_cmd(repo, &["commit", "-q", "-m", "feature"]);

        git_cmd(repo, &["checkout", "-q", "main"]);
        std::fs::write(repo.join("file.txt"), "line1\nlocal\n").unwrap();
        git_cmd(repo, &["add", "file.txt"]);
        git_cmd(repo, &["commit", "-q", "-m", "main"]);

        // Trigger merge conflict without committing
        let status = std::process::Command::new("git")
            .current_dir(repo)
            .args(["merge", "feature", "--no-commit", "--no-ff"])
            .status()
            .unwrap();
        assert!(!status.success(), "merge should produce conflicts");

        let working = std::fs::read_to_string(repo.join("file.txt")).unwrap();
        assert!(working.contains("<<<<<<<"), "working tree should have conflict markers");

        let local = git_get_conflict_local_content(repo.to_str().unwrap().to_string(), "file.txt".to_string()).await.unwrap();
        let remote = git_get_conflict_remote_content(repo.to_str().unwrap().to_string(), "file.txt".to_string()).await.unwrap();

        assert!(!local.contains("<<<<<<<"), "local content must not contain conflict markers:\n{}", local);
        assert!(!local.contains("======="), "local content must not contain conflict markers:\n{}", local);
        assert!(!local.contains(">>>>>>>"), "local content must not contain conflict markers:\n{}", local);
        assert!(!remote.contains("<<<<<<<"), "remote content must not contain conflict markers:\n{}", remote);

        assert_eq!(normalize(&local), "line1\nlocal\n", "local content should be HEAD version");
        assert_eq!(normalize(&remote), "line1\nremote\n", "remote content should be MERGE_HEAD version");
    }

    #[tokio::test]
    async fn test_get_conflict_local_content_rebase_has_no_markers() {
        let tmp = setup_conflict_repo();
        let repo = tmp.path();

        git_cmd(repo, &["checkout", "-q", "-b", "feature"]);
        std::fs::write(repo.join("file.txt"), "line1\nlocal\n").unwrap();
        git_cmd(repo, &["add", "file.txt"]);
        git_cmd(repo, &["commit", "-q", "-m", "feature"]);

        git_cmd(repo, &["checkout", "-q", "main"]);
        std::fs::write(repo.join("file.txt"), "line1\nremote\n").unwrap();
        git_cmd(repo, &["add", "file.txt"]);
        git_cmd(repo, &["commit", "-q", "-m", "main"]);

        // Rebase feature onto main: feature is the branch being rebased (local).
        git_cmd(repo, &["checkout", "-q", "feature"]);
        let status = std::process::Command::new("git")
            .current_dir(repo)
            .args(["rebase", "main"])
            .status()
            .unwrap();
        assert!(!status.success(), "rebase should produce conflicts");
        assert!(repo.join(".git/rebase-merge").exists() || repo.join(".git/rebase-apply").exists(),
            "rebase state should exist");

        let working = std::fs::read_to_string(repo.join("file.txt")).unwrap();
        assert!(working.contains("<<<<<<<"), "working tree should have conflict markers");

        let local = git_get_conflict_local_content(repo.to_str().unwrap().to_string(), "file.txt".to_string()).await.unwrap();
        let remote = git_get_conflict_remote_content(repo.to_str().unwrap().to_string(), "file.txt".to_string()).await.unwrap();

        assert!(!local.contains("<<<<<<<"), "local content must not contain conflict markers:\n{}", local);
        assert!(!local.contains("======="), "local content must not contain conflict markers:\n{}", local);
        assert!(!local.contains(">>>>>>>"), "local content must not contain conflict markers:\n{}", local);
        assert!(!remote.contains("<<<<<<<"), "remote content must not contain conflict markers:\n{}", remote);

        assert_eq!(normalize(&local), "line1\nlocal\n", "local content should be REBASE_HEAD/stage 3 version (branch being rebased)");
        assert_eq!(normalize(&remote), "line1\nremote\n", "remote content should be HEAD/stage 2 version (upstream)");
    }

    /// P2 回归（近 P1）：冲突侧为合法空文件时不得误判为「该侧已删除」——
    /// get_conflict_content 的 `!output.is_empty()` 把空 blob 当缺失 → Ok(None)，
    /// resolve 的 local/remote 路径随后把工作区文件删除（数据丢失）。
    #[test]
    fn test_get_conflict_content_empty_file_side_is_not_none() {
        let tmp = setup_conflict_repo();
        let repo = tmp.path();

        git_cmd(repo, &["checkout", "-q", "-b", "feature"]);
        std::fs::write(repo.join("file.txt"), "line1\nremote\n").unwrap();
        git_cmd(repo, &["add", "file.txt"]);
        git_cmd(repo, &["commit", "-q", "-m", "feature"]);

        git_cmd(repo, &["checkout", "-q", "main"]);
        std::fs::write(repo.join("file.txt"), "").unwrap(); // 本地侧是合法空文件
        git_cmd(repo, &["add", "file.txt"]);
        git_cmd(repo, &["commit", "-q", "-m", "main"]);

        let status = std::process::Command::new("git")
            .current_dir(repo)
            .args(["merge", "feature", "--no-commit", "--no-ff"])
            .status()
            .unwrap();
        assert!(!status.success(), "merge should produce conflicts");

        let local = get_conflict_content(repo.to_str().unwrap(), "file.txt", "local").unwrap();
        assert_eq!(local, Some(String::new()),
            "empty local side is a valid empty file, not a missing side (must not resolve to delete)");
    }

    /// P2 回归：markdown 分隔线/setext 标题（单独 `=======`）不算冲突标记，
    /// 真实标记（<<<<<<< / >>>>>>>）必须仍被拦截
    #[test]
    fn test_worktree_has_conflict_markers() {
        // markdown 合法内容：setext 标题 + 分隔线，不得误报
        assert!(!worktree_has_conflict_markers("Title\n=======\nBody\n"));
        assert!(!worktree_has_conflict_markers(""));
        assert!(!worktree_has_conflict_markers("只含分隔线的普通文档\n=======\n"));
        // 真实冲突标记：起始/结束任一存在即拦截
        assert!(worktree_has_conflict_markers("<<<<<<< ours\n=======\ntheirs\n>>>>>>> branch"));
        assert!(worktree_has_conflict_markers("start\n<<<<<<< HEAD\n"));
        assert!(worktree_has_conflict_markers("end\n>>>>>>> feature\n"));
    }

    /// S-23：组件级路径穿越校验——放行含双点的合法文件名，拒绝真实 ".." 组件
    #[test]
    fn test_has_path_traversal() {
        // 合法：双点在文件名内部，不是独立组件
        assert!(!has_path_traversal("a..b.txt"));
        assert!(!has_path_traversal("dir/..hidden"));
        assert!(!has_path_traversal("dir/file.txt"));
        assert!(!has_path_traversal("..hidden"));
        assert!(!has_path_traversal(""));
        // 真实穿越：独立 ".." 组件
        assert!(has_path_traversal("../secret"));
        assert!(has_path_traversal("dir/../secret"));
        assert!(has_path_traversal("a/../../b"));
        assert!(has_path_traversal("a/.."));
    }

    /// S-24：普通仓库的 git_state_path 解析到 .git/<name>
    #[test]
    fn test_git_state_path_regular_repo() {
        let tmp = setup_conflict_repo();
        let repo = tmp.path();
        let state = git_state_path(repo.to_str().unwrap(), "rebase-merge");
        assert_eq!(state, repo.join(".git/rebase-merge"),
            "regular repo resolves git-state path to .git/<name>");
    }

    /// S-24：worktree 的 .git 是文件，git_state_path 必须解析到 worktree 自己的
    /// gitdir（.git/worktrees/<name>/rebase-merge）——真实 rebase 冲突时状态文件
    /// 就写在那里，此前直接拼 worktree 根的 .git/<name> 会漏检
    #[test]
    fn test_git_state_path_worktree() {
        let tmp = setup_conflict_repo();
        let main = tmp.path();
        let wt_tmp = tempfile::tempdir().unwrap();
        // 默认分支 main 已在主 worktree 检出，link 到新分支避免 "already checked out"
        git_cmd(main, &["worktree", "add", "-q", "-b", "wt-test", wt_tmp.path().to_str().unwrap()]);
        let wt = wt_tmp.path();

        // worktree 的 .git 是文件而非目录
        assert!(wt.join(".git").is_file(),
            "precondition: linked worktree .git must be a file");

        // 在 worktree 内真实制造 rebase 冲突（两个分支改同一行）：
        // ① wt-test 提交（改 f.txt）→ ② 从 main 分出 feat（不含 wt-change）并提交
        // （也改 f.txt）→ ③ 切回 wt-test rebase feat → 冲突
        git_cmd(wt, &["config", "user.email", "test@example.com"]);
        git_cmd(wt, &["config", "user.name", "Test"]);
        std::fs::write(wt.join("file.txt"), "line1\nwt-edit\n").unwrap();
        git_cmd(wt, &["add", "file.txt"]);
        git_cmd(wt, &["commit", "-q", "-m", "wt-change"]);
        // feat 必须从 main 分出（不含 wt-change），否则 rebase 是 fast-forward 无冲突
        git_cmd(main, &["branch", "feat"]);
        git_cmd(wt, &["checkout", "-q", "feat"]);
        std::fs::write(wt.join("file.txt"), "line1\nfeat-edit\n").unwrap();
        git_cmd(wt, &["add", "file.txt"]);
        git_cmd(wt, &["commit", "-q", "-m", "feat-edit"]);
        git_cmd(wt, &["checkout", "-q", "wt-test"]);
        let rebase_status = std::process::Command::new("git")
            .current_dir(wt)
            .args(["rebase", "feat"])
            .status()
            .unwrap();
        assert!(!rebase_status.success(), "rebase must produce conflicts in the worktree");

        // worktree 自身的 .git 是文件，.git/rebase-merge 永远不可能存在
        assert!(!wt.join(".git/rebase-merge").exists(),
            "worktree's own .git is a file, so .git/rebase-merge can never exist");

        // git_state_path 必须解析到 worktree 的 gitdir（真实 rebase 状态所在）
        let state = git_state_path(wt.to_str().unwrap(), "rebase-merge");
        assert!(state.exists(),
            "worktree must resolve rebase-merge state inside its own gitdir (got: {:?})", state);

        // P0-3 回归：is_rebase_scenario 必须基于 git_state_path——worktree 中
        // rebase 状态在主 gitdir 的 worktrees/<name>/ 下，直接拼 .git/rebase-merge
        // 会漏检，导致冲突内容按 merge 语义解析（local/remote 翻转）且
        // rebase --continue 永远不会被执行
        assert!(is_rebase_scenario(wt.to_str().unwrap()),
            "is_rebase_scenario must detect rebase state inside a linked worktree");
        // macOS 下 /var → /private/var 符号链接：rev-parse 输出 canonical 路径，
        // 断言基准也需 canonicalize 后比较
        let expected_base = std::fs::canonicalize(main.join(".git/worktrees"))
            .unwrap_or_else(|_| main.join(".git/worktrees"));
        assert!(state.starts_with(&expected_base),
            "state path should live under the main gitdir worktrees area (got: {:?}, base: {:?})", state, expected_base);
    }
}
