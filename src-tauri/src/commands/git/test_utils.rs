use std::path::Path;

pub fn git_cmd(repo: &Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .current_dir(repo)
        .args(args)
        .status()
        .expect("failed to run git");
    assert!(status.success(), "git {:?} failed in {:?}", args, repo);
}

pub fn setup_conflict_repo() -> tempfile::TempDir {
    let tmp = tempfile::tempdir().unwrap();
    let repo = tmp.path();
    git_cmd(repo, &["init", "-q", "-b", "main"]);
    git_cmd(repo, &["config", "user.email", "test@example.com"]);
    git_cmd(repo, &["config", "user.name", "Test"]);
    std::fs::write(repo.join("file.txt"), "line1\nbase\n").unwrap();
    git_cmd(repo, &["add", "file.txt"]);
    git_cmd(repo, &["commit", "-q", "-m", "base"]);
    tmp
}

pub fn normalize(s: &str) -> String {
    s.replace("\r\n", "\n")
}
