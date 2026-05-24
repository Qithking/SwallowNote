pub mod ai;
pub mod ai_builtin_models;
pub mod ai_chat;
pub mod ai_role_prompts;
pub mod file;
pub mod git;
pub mod folder_history;
pub mod session_state;
pub mod upgrade;

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
