//! 文件系统访问闸门（fs_guard）。
//!
//! 所有带路径参数的前端文件命令默认必须经过本模块的 `ensure_path_allowed`
//! 白名单校验（允许根 = 已打开的工作区根 + 应用数据目录），防止被注入脚本
//! 通过 Tauri 命令读写删任意路径（架构审计候选 2 收编）。
//!
//! 不适用校验的命令必须在下方 `EXEMPTED_COMMANDS` 豁免登记表中显式登记
//! 并注明理由；实现处的注释需指向对应条目。

use std::path::{Path, PathBuf};
use tauri::Manager;

/// 豁免登记条目。
pub struct FsExemption {
    pub command: &'static str,
    pub reason: &'static str,
}

/// 命令级豁免登记表（审计线索）：新增豁免必须登记并注明理由。
pub const EXEMPTED_COMMANDS: &[FsExemption] = &[
    FsExemption {
        command: "export_text_file",
        reason: "写入路径来自前端系统 save dialog（LogViewer 导出日志），合法的工作区外写场景",
    },
    FsExemption {
        command: "path_exists",
        reason: "启动/最近记录流程需探测尚未打开的工作区路径是否存在；只读探测无读写副作用",
    },
    FsExemption {
        command: "register_asset_scope",
        reason: "授权型命令：语义即将目录加入 asset protocol 白名单，path 是新授权对象而非读写目标",
    },
    FsExemption {
        command: "watch_directory",
        reason: "授权型命令：语义即将目录注册进文件监听器，调用点均为工作区打开流程",
    },
    FsExemption {
        command: "get_home_dir",
        reason: "无路径参数，返回用户主目录供前端展开 uploadPath 的 $userRootPath 变量",
    },
    FsExemption {
        command: "read_clipboard_file_paths",
        reason: "无路径入参，读取系统剪贴板中的文件路径列表",
    },
];

/// 组装允许根列表：工作区根（若已打开）+ 应用数据目录。
/// 供批量操作预组装一次后复用（如图片批量下载）。
pub fn allowed_roots(
    app: &tauri::AppHandle,
    workspace_root: Option<&str>,
) -> Result<Vec<PathBuf>, String> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(root) = workspace_root {
        if !root.is_empty() {
            if let Ok(canonical_root) = std::fs::canonicalize(root) {
                roots.push(canonical_root);
            }
        }
    }
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    // app_data 根可能尚未创建，退回原始路径参与前缀比较
    let canonical_app_data = std::fs::canonicalize(&app_data).unwrap_or(app_data);
    roots.push(canonical_app_data);
    Ok(roots)
}

/// 校验目标路径位于允许根列表内（fail-closed：任一环节失败即拒绝）。
/// - 已存在路径：canonicalize 穿透 symlink 后校验（拒绝 symlink 逃逸）；
/// - 不存在路径（新建/重命名目标）：校验其存在的最近父目录后拼接剩余片段。
/// 返回规范化后的路径。
pub fn check_path_in_roots(
    allowed_roots: &[PathBuf],
    path: &Path,
) -> Result<PathBuf, String> {
    // 找到存在且可 canonicalize 的最近祖先（含自身），其余部分原样拼接
    let (existing, tail) = existing_ancestor(path);
    let canonical_existing = std::fs::canonicalize(&existing)
        .map_err(|e| format!("Failed to resolve path {}: {}", existing.display(), e))?;
    let canonical = if tail.as_os_str().is_empty() {
        canonical_existing
    } else {
        canonical_existing.join(tail)
    };

    if allowed_roots.iter().any(|root| canonical.starts_with(root)) {
        Ok(canonical)
    } else {
        Err(format!(
            "Path is outside allowed directories: {}",
            path.display()
        ))
    }
}

/// 校验目标路径位于允许的根目录内（工作区根或应用数据目录），
/// 防止被注入脚本通过文件命令读写删任意路径（审计 B1）。
/// 返回规范化后的路径。
pub fn ensure_path_allowed(
    app: &tauri::AppHandle,
    workspace_root: Option<&str>,
    path: &Path,
) -> Result<PathBuf, String> {
    let roots = allowed_roots(app, workspace_root)?;
    check_path_in_roots(&roots, path)
}

/// 从 target 向上找第一个存在的祖先，返回 (存在的祖先, 其下未存在部分的相对片段)
pub fn existing_ancestor(target: &Path) -> (PathBuf, PathBuf) {
    let mut cur = target.to_path_buf();
    let mut parts: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if cur.exists() || cur.symlink_metadata().is_ok() {
            let mut tail = PathBuf::new();
            for part in parts.into_iter().rev() {
                tail = tail.join(part);
            }
            return (cur, tail);
        }
        match (cur.parent(), cur.file_name()) {
            (Some(parent), Some(name)) => {
                parts.push(name.to_os_string());
                cur = parent.to_path_buf();
            }
            _ => return (cur, PathBuf::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exempted_commands_unique() {
        // 登记表条目不得重复，防止登记漂移
        let mut seen = std::collections::HashSet::new();
        for e in EXEMPTED_COMMANDS {
            assert!(seen.insert(e.command), "duplicate exemption: {}", e.command);
            assert!(!e.reason.is_empty(), "exemption {} missing reason", e.command);
        }
    }
}
