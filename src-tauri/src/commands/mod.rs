pub mod ai;
pub mod ai_builtin_models;
pub mod ai_chat;
pub mod ai_role_prompts;
pub mod file;
pub mod git;
pub mod folder_history;
pub mod plugin;
pub mod plugin_invoke;
pub mod session_state;
pub mod upgrade;

/// Create a new `std::process::Command` with platform-specific configuration.
///
/// **On Windows**, this sets the `CREATE_NO_WINDOW` creation flag to prevent
/// the child process from creating a visible console window. Without this flag,
/// spawning any console-based executable (e.g., `git`, `cmd`, `powershell`)
/// will briefly flash a black command prompt window, which is disruptive to
/// the user experience.
///
/// **IMPORTANT**: Always use this function instead of `std::process::Command::new()`
/// when spawning child processes that may run on Windows. The only exceptions are:
/// - macOS-specific commands (`open`, `hdiutil`, `ditto`, `osascript`, `ioreg`)
///   that are gated behind `#[cfg(target_os = "macos")]`
/// - Linux-specific commands (`xdg-open`, `xclip`, `sh`) gated behind
///   `#[cfg(target_os = "linux")]`
///
/// Any command that runs on Windows **must** use `create_command()`.
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
