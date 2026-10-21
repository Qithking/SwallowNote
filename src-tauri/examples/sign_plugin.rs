//! 插件签名工具（发布凭证管理，仅维护者使用，不参与应用构建）。
//!
//! 子命令：
//!   keygen [--key <path>]   生成 ed25519 私钥并写入密钥文件（已存在则拒绝覆盖）
//!   sign   <file>           对文件签名，stdout 输出 base64 签名（供 shell 捕获）
//!   pubkey                  输出当前私钥对应的公钥 base64（写入 repo.json 顶层）
//!
//! 私钥查找顺序：环境变量 SWALLOWNOTE_PLUGIN_SIGNING_KEY（base64 编码的
//! 32 字节 seed）→ 仓库根 `plugins/.signing-key` 文件（不入库，.gitignore 屏蔽）。

use ed25519_dalek::{Signer, SigningKey};
use rand::RngCore;
use std::path::{Path, PathBuf};
use std::{env, fs, process};

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if let Err(msg) = run(&args) {
        eprintln!("[sign_plugin] 错误: {}", msg);
        process::exit(1);
    }
}

fn run(args: &[String]) -> Result<(), String> {
    match args.first().map(String::as_str) {
        Some("keygen") => cmd_keygen(args.get(1..).unwrap_or(&[])),
        Some("sign") => cmd_sign(args.get(1).ok_or("用法: sign <file>")?),
        Some("pubkey") => cmd_pubkey(),
        _ => Err("用法: sign_plugin <keygen [--key <path>] | sign <file> | pubkey>".into()),
    }
}

/// 生成新私钥：`--key <path>` 指定输出位置，默认仓库 `plugins/.signing-key`。
fn cmd_keygen(args: &[String]) -> Result<(), String> {
    let key_path = if args.first().map(String::as_str) == Some("--key") {
        PathBuf::from(args.get(2).ok_or("--key 需要一个路径参数")?)
    } else {
        default_key_file()?
    };
    if key_path.exists() {
        return Err(format!("密钥文件已存在，拒绝覆盖: {}", key_path.display()));
    }

    // ed25519-dalek 未启用 rand_core feature，用 rand 0.8 的 OsRng 生成
    // 32 字节 seed 再构造 SigningKey。
    let mut seed = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut seed);
    let sk = SigningKey::from_bytes(&seed);

    if let Some(parent) = key_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(&key_path, format!("{}\n", b64_encode(&seed)))
        .map_err(|e| format!("写入密钥失败: {}", e))?;
    restrict_permissions(&key_path);

    eprintln!(
        "[sign_plugin] 已生成私钥: {}（请妥善备份，私钥丢失将无法为插件续签）",
        key_path.display()
    );
    println!("{}", b64_encode(&sk.verifying_key().to_bytes()));
    Ok(())
}

/// 对文件签名：stdout 只输出 base64 签名单行，过程信息走 stderr。
fn cmd_sign(file: &str) -> Result<(), String> {
    let bytes = fs::read(file).map_err(|e| format!("读取 {}: {}", file, e))?;
    let sk = load_signing_key()?;
    let signature = sk.sign(&bytes);
    eprintln!(
        "[sign_plugin] 已签名 {}（{} 字节）",
        file,
        bytes.len()
    );
    println!("{}", b64_encode(&signature.to_bytes()));
    Ok(())
}

/// 输出当前私钥对应公钥 base64。
fn cmd_pubkey() -> Result<(), String> {
    let sk = load_signing_key()?;
    println!("{}", b64_encode(&sk.verifying_key().to_bytes()));
    Ok(())
}

/// 私钥来源：env 变量优先，其次仓库 `plugins/.signing-key`。
fn load_signing_key() -> Result<SigningKey, String> {
    let seed_b64 = match env::var("SWALLOWNOTE_PLUGIN_SIGNING_KEY") {
        Ok(v) if !v.trim().is_empty() => v.trim().to_string(),
        _ => {
            let path = default_key_file()?;
            fs::read_to_string(&path)
                .map_err(|_| format!("未找到签名密钥：请设置 SWALLOWNOTE_PLUGIN_SIGNING_KEY 或生成 {}", path.display()))?
        }
    };
    let seed = b64_decode_32(&seed_b64)?;
    Ok(SigningKey::from_bytes(&seed))
}

/// 从当前目录向上查找含 `plugins` 子目录的祖先，返回 `plugins/.signing-key`。
/// 注意：必须用 `current_dir()` 的绝对路径逐级 parent 向上遍历——
/// `Path::new(".")` 的 `parent()` 是词法操作（返回空串而非 `..`），
/// 无法真实向上查找；打包脚本中途会 `cd` 进 dist/，cwd 并非仓库根。
fn default_key_file() -> Result<PathBuf, String> {
    let cwd = env::current_dir().map_err(|e| format!("读取当前目录失败: {}", e))?;
    let mut dir: Option<&Path> = Some(cwd.as_path());
    while let Some(d) = dir {
        let plugins_dir = d.join("plugins");
        if plugins_dir.is_dir() {
            return Ok(plugins_dir.join(".signing-key"));
        }
        dir = d.parent();
    }
    // 兜底：cwd 下创建（keygen 首次生成场景）
    Ok(cwd.join("plugins").join(".signing-key"))
}

/// unix 下收紧密钥文件权限到 0600。
fn restrict_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

fn b64_encode(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn b64_decode_32(s: &str) -> Result<[u8; 32], String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(s.trim())
        .map_err(|e| format!("私钥不是合法 base64: {}", e))?;
    let len = bytes.len();
    bytes
        .try_into()
        .map_err(|_| format!("私钥必须是 32 字节 seed（实际 {} 字节）", len))
}
