//! 安全工具模块：密码安全擦除、内存锁定、文件权限、日志安全约束。
//!
//! 所有密码处理必须经过 `SecretString`（基于 `Zeroizing<String>`），
//! 密码缓冲区使用 `mlock` 锁定内存页防止被换出到 swap 文件。

use std::fs::{set_permissions, File, Permissions};
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use zeroize::Zeroizing;

/// 密码长度上限：防止 JSON-RPC 反序列化和 mlock 内存炸弹。
pub const PASSWORD_MAX_LEN: usize = 256;

/// 密码长度下限：与前端校验保持一致。
pub const PASSWORD_MIN_LEN: usize = 8;

/// 密码包装类型：作用域结束后自动清零内存。
pub type SecretString = Zeroizing<String>;

/// 校验密码长度范围 [PASSWORD_MIN_LEN, PASSWORD_MAX_LEN]。
/// 返回 `Err(String)` 时字符串为面向用户的中文提示，不含敏感信息。
pub fn validate_password_length(password: &str) -> Result<(), String> {
    let len = password.chars().count();
    if len < PASSWORD_MIN_LEN {
        return Err(format!("密码长度不能少于 {} 个字符", PASSWORD_MIN_LEN));
    }
    if len > PASSWORD_MAX_LEN {
        return Err(format!("密码长度不能超过 {} 个字符", PASSWORD_MAX_LEN));
    }
    Ok(())
}

/// 将密码包装为 `SecretString` 并锁定其底层内存页。
///
/// 返回 `(SecretString, MemoryLockGuard)`，guard 离开作用域时自动解锁。
/// 失败时返回 `Err`，调用方应视为致命错误（无法保证密码不被换出）。
pub fn protect_password(password: String) -> io::Result<(SecretString, MemoryLockGuard)> {
    let secret = SecretString::new(password);
    let lock = MemoryLockGuard::lock(secret.as_bytes())?;
    Ok((secret, lock))
}

/// 内存页锁定 guard：构造时 `mlock`，drop 时 `munlock`。
pub struct MemoryLockGuard {
    ptr: *const u8,
    len: usize,
}

impl MemoryLockGuard {
    /// 锁定 `[bytes]` 对应的内存页。失败时返回 `Err`。
    pub fn lock(bytes: &[u8]) -> io::Result<Self> {
        if bytes.is_empty() {
            return Ok(Self { ptr: std::ptr::null(), len: 0 });
        }
        let ptr = bytes.as_ptr();
        let len = bytes.len();
        // SAFETY: `mlock` 不会解引用用户指针，仅通知内核固定物理页。
        // 失败时返回非零 errno，我们转为 `io::Error`。
        let ret = unsafe { libc::mlock(ptr as *const libc::c_void, len) };
        if ret != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self { ptr, len })
    }
}

impl Drop for MemoryLockGuard {
    fn drop(&mut self) {
        if self.ptr.is_null() || self.len == 0 {
            return;
        }
        // SAFETY: 与 `lock` 中的 `mlock` 配对，参数相同。
        let _ = unsafe { libc::munlock(self.ptr as *const libc::c_void, self.len) };
    }
}

/// 设置文件权限为 0600（仅所有者可读写）。
///
/// 用于 .swl 文件创建、导入替换、备份导出。Unix 系统通过 `PermissionsExt`，
/// 非 Unix 系统无操作（spec 仅要求 Unix）。
pub fn set_secure_permissions<P: AsRef<Path>>(path: P) -> io::Result<()> {
    set_permissions(path, Permissions::from_mode(0o600))
}

/// 安全日志输出：仅输出错误类型，禁止包含密码、PRAGMA key 参数、明文内容。
///
/// 使用 `eprintln!` 输出到 stderr（stdout 留给 JSON-RPC）。
pub fn log_error(context: &str, err: &str) {
    // 严禁输出命令参数中的密码字段，仅记录错误类型和上下文。
    eprintln!("[secret-disk] {} 错误: {}", context, sanitize_for_log(err));
}

/// 启动信息日志（不含敏感信息）。
pub fn log_info(msg: &str) {
    eprintln!("[secret-disk] {}", sanitize_for_log(msg));
}

/// 清理日志字符串：移除可能的密码/密钥相关内容。
fn sanitize_for_log(s: &str) -> String {
    // 移除 `PRAGMA key = '...'` / `PRAGMA rekey = '...'` 形式的参数。
    let s = redact_pragma(s, "key");
    let s = redact_pragma(&s, "rekey");
    s
}

/// 将 `PRAGMA <name> = '...'` 中的密码值替换为 `***`。
fn redact_pragma(s: &str, name: &str) -> String {
    let pattern = format!("PRAGMA {} ", name);
    if let Some(pos) = s.find(&pattern) {
        let (head, tail) = s.split_at(pos);
        // 跳过 `PRAGMA <name> ` 部分到值结束（遇到分号或行尾）。
        let value_start = pos + pattern.len();
        let value_end = tail[value_start..]
            .find(|c: char| c == ';' || c == '\n')
            .map(|e| value_start + e)
            .unwrap_or(s.len());
        let _ = head; // 占位，避免未使用警告
        let mut out = String::with_capacity(s.len());
        out.push_str(&s[..value_start]);
        out.push_str("***");
        out.push_str(&s[value_end..]);
        out
    } else {
        s.to_string()
    }
}

/// 校验文件是否为合法的 .swl 后缀。
pub fn ensure_swl_extension<P: AsRef<Path>>(path: P) -> Result<(), String> {
    if path.as_ref().extension().and_then(|e| e.to_str()) != Some("swl") {
        return Err("文件格式错误：仅支持 .swl 文件".to_string());
    }
    Ok(())
}

/// `File` 的便捷别名，避免在调用处导入 `std::fs::File`。
#[allow(dead_code)]
pub type FileHandle = File;
