//! 日志管理命令：导出日志 zip、打开日志目录。
//! Source: spec/settings-log-export-update-channel AC-2/AC-3

use std::path::{Path, PathBuf};

/// 无可导出日志的错误码（前端按字符串 'NO_LOGS' 匹配以提示「暂无日志」，跨语言契约仅此一处）。
const NO_LOGS_ERR: &str = "NO_LOGS";

/// 过滤日志目录：仅保留 swallownote.log* 轮转文件（排除 .DS_Store 等无关文件），按文件名排序。
fn filter_log_files(dir: &Path) -> Vec<PathBuf> {
    const LOG_FILE_PREFIX: &str = "swallownote.log";
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.file_name()
                    .map(|n| n.to_string_lossy().starts_with(LOG_FILE_PREFIX))
                    .unwrap_or(false)
        })
        .collect();
    files.sort();
    files
}

/// 将日志文件打包为 zip 写入 dest，返回写入条目数。zip 内条目名为原文件名（不含路径）。
fn zip_logs_into(dest: &Path, log_files: &[PathBuf]) -> Result<usize, String> {
    use std::io::Write;
    let file =
        std::fs::File::create(dest).map_err(|e| format!("无法创建导出文件 {}: {}", dest.display(), e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options: zip::write::FileOptions<()> = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for f in log_files {
        let name = f
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let data = std::fs::read(f).map_err(|e| format!("读取日志失败 {}: {}", f.display(), e))?;
        zip.start_file(&name, options)
            .map_err(|e| format!("写入 zip 条目 {} 失败: {}", name, e))?;
        zip.write_all(&data).map_err(|e| format!("写入 zip 条目 {} 失败: {}", name, e))?;
    }
    zip.finish().map_err(|e| format!("关闭 zip 失败: {}", e))?;
    Ok(log_files.len())
}

/// 导出日志内部逻辑（纯同步，可测）：目录无日志文件时返回 NO_LOGS 错误码。
fn export_logs_inner(log_dir: &Path, dest: &Path) -> Result<usize, String> {
    let log_files = filter_log_files(log_dir);
    if log_files.is_empty() {
        return Err(NO_LOGS_ERR.to_string());
    }
    zip_logs_into(dest, &log_files)
}

/// 导出日志：打包日志目录下全部 swallownote.log* 文件为 zip 写入 dest，返回导出文件数。
/// dest 由前端系统保存对话框选定。
#[tauri::command]
pub async fn export_logs(dest: String) -> Result<usize, String> {
    let log_dir = crate::resolve_log_dir(
        std::env::current_exe().ok().as_deref(),
        std::env::var("SWALLOWNOTE_LOG_DIR").ok().as_deref(),
    );
    export_logs_inner(&log_dir, Path::new(&dest))
}

/// 打开日志目录（系统文件管理器）。
/// 薄封装：解析日志目录 → 目录不存在时先创建（首次使用/尚无日志）→ 复用 open_in_finder。
/// Source: spec AC-2
#[tauri::command]
pub async fn open_log_dir() -> Result<(), String> {
    let log_dir = crate::resolve_log_dir(
        std::env::current_exe().ok().as_deref(),
        std::env::var("SWALLOWNOTE_LOG_DIR").ok().as_deref(),
    );
    if !log_dir.exists() {
        std::fs::create_dir_all(&log_dir).map_err(|e| format!("创建日志目录失败: {}", e))?;
    }
    crate::commands::file::open_in_finder(log_dir.to_string_lossy().to_string()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use tempfile::TempDir;

    // Source: spec AC-3（仅导出 swallownote.log* 轮转文件，过滤 .DS_Store 等无关文件）
    #[test]
    fn filter_log_files_keeps_only_swallownote_log_files() {
        let dir = TempDir::new().unwrap();
        for name in ["swallownote.log", "swallownote.log.1", ".DS_Store", "other.txt"] {
            std::fs::write(dir.path().join(name), b"x").unwrap();
        }
        let files = filter_log_files(dir.path());
        let names: Vec<String> = files
            .iter()
            .map(|f| f.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["swallownote.log", "swallownote.log.1"]);
    }

    // Source: spec AC-3（确认后生成 zip，内含目录下全部 swallownote.log* 文件）
    #[test]
    fn zip_logs_into_writes_all_log_files() {
        let dir = TempDir::new().unwrap();
        let a = dir.path().join("swallownote.log");
        let b = dir.path().join("swallownote.log.1");
        std::fs::write(&a, b"AAA").unwrap();
        std::fs::write(&b, b"BBB").unwrap();
        let dest = dir.path().join("out.zip");
        let count = zip_logs_into(&dest, &[a, b]).unwrap();
        assert_eq!(count, 2);
        // 校验 zip 内容：条目数与首个条目内容
        let file = std::fs::File::open(&dest).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        assert_eq!(archive.len(), 2);
        let mut content = String::new();
        archive
            .by_name("swallownote.log")
            .unwrap()
            .read_to_string(&mut content)
            .unwrap();
        assert_eq!(content, "AAA");
    }

    // Source: spec Edge cases（目录内无日志文件 → 返回「暂无日志」错误码）
    #[test]
    fn export_logs_inner_errors_when_no_log_files() {
        let dir = TempDir::new().unwrap();
        let dest = dir.path().join("out.zip");
        let result = export_logs_inner(dir.path(), &dest);
        assert_eq!(result, Err(NO_LOGS_ERR.to_string()));
    }
}
