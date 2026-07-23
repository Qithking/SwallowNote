use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

/// Information about the currently running git clone process.
/// Stored in Tauri managed state so it survives frontend page refreshes.
#[derive(Default, Serialize, Clone)]
pub struct CloneStateInfo {
    pub pid: Option<u32>,
    pub url: String,
    pub local_path: String,
}

/// Shared state to track the currently running git clone process.
/// This allows the frontend to cancel an in-progress clone and to query
/// whether a clone is still running after a page refresh.
pub type ClonePidState = Arc<Mutex<CloneStateInfo>>;

pub fn new_clone_pid_state() -> ClonePidState {
    Arc::new(Mutex::new(CloneStateInfo::default()))
}

#[derive(Serialize, Deserialize)]
pub struct GitRepositoryInfo {
    pub name: String,
    pub path: String,
    pub remote_url: Option<String>,
    pub has_uncommitted_changes: bool,
    pub uncommitted_count: usize,
    pub current_branch: String,
    pub is_submodule: bool,
    pub parent_path: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct GitFileLogEntry {
    pub hash: String,
    pub message: String,
    pub date: String,
    pub insertions: usize,
    pub deletions: usize,
}

/// Information about a single conflicting file in a git repository
#[derive(Serialize, Deserialize)]
pub struct ConflictFile {
    /// Relative path within the repository
    pub path: String,
    /// Absolute path of the file
    pub abs_path: String,
}

#[derive(Serialize)]
pub struct GitStatus {
    pub branch: String,
    pub modified: Vec<String>,
    pub added: Vec<String>,
    pub deleted: Vec<String>,
    pub untracked: Vec<String>,
}

/// G-02 修复：git_commit_and_push 的返回结构，让前端区分"无改动"/"已提交"/"已推送"。
/// - committed: 是否产生了新提交（false = nothing to commit）
/// - pushed: 是否成功推送到远程（false = 无远程或推送被跳过）
#[derive(Serialize)]
pub struct CommitPushResult {
    pub committed: bool,
    pub pushed: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GitCredential {
    pub username: String,
    pub password: String,
}

/// A single diff part returned by the word-level diff command.
/// Each part represents either unchanged text, text only in the old version,
/// or text only in the new version.
#[derive(Serialize, Deserialize, Clone)]
pub struct WordDiffPart {
    /// The text content of this diff part
    pub value: String,
    /// True if this text exists only in the old version (removed)
    pub removed: bool,
    /// True if this text exists only in the new version (added)
    pub added: bool,
}

/// Result of a word-level diff comparison between two texts.
/// Contains separate arrays for each side so the frontend can
/// independently render decorations on the left (remote) and right (local) panes.
#[derive(Serialize, Deserialize, Clone)]
pub struct WordDiffResult {
    /// Diff parts for the old (remote/left) side
    pub old_parts: Vec<WordDiffPart>,
    /// Diff parts for the new (local/right) side
    pub new_parts: Vec<WordDiffPart>,
}
