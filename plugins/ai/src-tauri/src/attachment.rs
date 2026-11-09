//! 附件外置存储（P2.3，§6.5 审查决策 D14-②）：附件全文不进 DB，
//! 存 `plugin-data/com.swallownote.ai/attachments/<message_id>/<文件名>`，
//! meta_json 存 `{path, name, size}` 引用清单，防 ai_messages 膨胀。
//! 隐私边界：会话与附件均为明文存储（与主应用现状同水平，文件 0600、目录 0700）。

use base64::Engine;
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

/// attachments 根目录：`<app_data_dir>/plugin-data/com.swallownote.ai/attachments`
pub fn attachments_dir(app_data_dir: &Path) -> Result<PathBuf, String> {
    Ok(crate::db::plugin_dir(app_data_dir)?.join("attachments"))
}

/// 安全标识（message_id 用）：仅允许字母/数字/下划线/连字符，防目录名注入。
fn is_safe_id(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// 保存附件：name 仅取文件名（剥离任何目录成分），content 为 base64 解码后落盘。
/// 返回 `{path, name, size}`，path 为相对插件数据目录的引用（存入 meta_json）。
pub fn save_attachment(
    app_data_dir: &Path,
    message_id: &str,
    name: &str,
    content_base64: &str,
) -> Result<Value, String> {
    if !is_safe_id(message_id) {
        return Err("非法的消息标识".to_string());
    }
    let file_name = Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty() && *n != ".")
        .ok_or_else(|| "非法的附件名".to_string())?;
    let content = base64::engine::general_purpose::STANDARD
        .decode(content_base64)
        .map_err(|e| format!("附件内容 base64 解码失败: {}", e))?;

    let dir = attachments_dir(app_data_dir)?.join(message_id);
    fs::create_dir_all(&dir).map_err(|e| format!("创建附件目录失败: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }

    let file_path = dir.join(file_name);
    let mut f = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&file_path)
        .map_err(|e| format!("写入附件失败: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = f.set_permissions(fs::Permissions::from_mode(0o600));
    }
    f.write_all(&content)
        .map_err(|e| format!("写入附件失败: {}", e))?;

    let rel = Path::new("attachments").join(message_id).join(file_name);
    Ok(json!({
        "path": rel.to_string_lossy(),
        "name": file_name,
        "size": content.len(),
    }))
}

/// 读取附件：rel_path 为 meta_json 中的引用。拒绝绝对路径与路径穿越成分，
/// 首段必须为 attachments，canonicalize 后仍须位于 attachments 根内。
/// 返回 `{contentBase64}`。
pub fn read_attachment(app_data_dir: &Path, rel_path: &str) -> Result<Value, String> {
    let p = Path::new(rel_path);
    if p.is_absolute() {
        return Err("非法的附件路径: 不允许绝对路径".to_string());
    }
    for c in p.components() {
        if !matches!(c, Component::Normal(_)) {
            return Err("非法的附件路径: 不允许路径穿越".to_string());
        }
    }
    if p.iter().next().map(|s| s != "attachments").unwrap_or(true) {
        return Err("非法的附件路径".to_string());
    }

    let root = attachments_dir(app_data_dir)?;
    let full = root.join(p.strip_prefix("attachments").unwrap());
    let canon_full = full
        .canonicalize()
        .map_err(|_| format!("附件不存在或不可访问: {}", rel_path))?;
    let canon_root = root
        .canonicalize()
        .map_err(|e| format!("附件根目录解析失败: {}", e))?;
    if !canon_full.starts_with(&canon_root) {
        return Err("非法的附件路径: 超出范围".to_string());
    }
    let content = fs::read(&canon_full).map_err(|e| format!("读取附件失败: {}", e))?;
    Ok(json!({
        "contentBase64": base64::engine::general_purpose::STANDARD.encode(content),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ai-plugin-att-{}-{}",
            tag,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 保存后读取内容一致，引用形状 {path, name, size} 正确，文件权限 0600。
    #[test]
    fn save_and_read_roundtrip() {
        let dir = tmp_dir("roundtrip");
        let content = base64::engine::general_purpose::STANDARD.encode("附件全文内容");
        let saved = save_attachment(&dir, "msg-1", "笔记.md", &content).unwrap();
        assert_eq!(saved["path"], "attachments/msg-1/笔记.md");
        assert_eq!(saved["name"], "笔记.md");
        assert_eq!(saved["size"], 18); // 6 个中文字符 × 3 字节

        let root = attachments_dir(&dir).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let meta = fs::metadata(root.join("msg-1/笔记.md")).unwrap();
            assert_eq!(meta.permissions().mode() & 0o777, 0o600);
        }

        let read = read_attachment(&dir, "attachments/msg-1/笔记.md").unwrap();
        assert_eq!(read["contentBase64"], content);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// name 含目录成分时仅保留文件名（防目录注入），message_id 非法时拒绝。
    #[test]
    fn save_strips_directory_and_rejects_bad_id() {
        let dir = tmp_dir("sanitize");
        let content = base64::engine::general_purpose::STANDARD.encode("x");
        let saved = save_attachment(&dir, "m1", "../../etc/passwd", &content).unwrap();
        assert_eq!(saved["name"], "passwd");
        assert!(attachments_dir(&dir).unwrap().join("m1/passwd").exists());
        assert!(!dir.join("etc/passwd").exists());

        assert!(save_attachment(&dir, "../evil", "a.txt", &content).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 读取路径穿越（.. / 绝对路径 / 首段非 attachments）全部拒绝。
    #[test]
    fn read_rejects_traversal_and_absolute() {
        let dir = tmp_dir("traversal");
        let content = base64::engine::general_purpose::STANDARD.encode("secret");
        save_attachment(&dir, "m1", "secret.txt", &content).unwrap();

        assert!(read_attachment(&dir, "attachments/../db.sqlite").is_err());
        assert!(read_attachment(&dir, "../attachments/m1/secret.txt").is_err());
        assert!(read_attachment(&dir, dir.join("plugin-data/db.sqlite").to_str().unwrap()).is_err());
        assert!(read_attachment(&dir, "settings/aiModels").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 不存在的附件报错且错误信息含路径，便于前端提示。
    #[test]
    fn read_unknown_file_errors() {
        let dir = tmp_dir("unknown");
        let err = read_attachment(&dir, "attachments/m1/缺失.txt").unwrap_err();
        assert!(err.contains("缺失.txt"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
