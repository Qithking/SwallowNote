pub mod ai;
pub mod ai_builtin_models;
pub mod ai_chat;
pub mod ai_role_prompts;
pub mod error;
pub mod file;
pub mod folder_history;
pub mod frontmatter;
pub mod git;
pub mod image_downloader;
pub mod market_sources;
pub mod plugin;
pub mod plugin_invoke;
pub mod plugin_settings;
pub mod session_state;
pub mod upgrade;

/// 创建跨平台 Command；Windows 下设置 CREATE_NO_WINDOW 避免控制台窗口闪烁。
/// 所有跨平台子进程必须用此函数。
pub fn create_command(program: &str) -> std::process::Command {
    #[cfg(not(target_os = "windows"))]
    let cmd = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    let mut cmd = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}
