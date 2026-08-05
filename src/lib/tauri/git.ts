import { invoke } from '@tauri-apps/api/core'

export interface GitStatus {
  branch: string
  modified: string[]
  added: string[]
  deleted: string[]
  untracked: string[]
}

/** G-02 修复：git_commit_and_push 返回结构，让前端区分"无改动"/"已提交"/"已推送" */
export interface CommitPushResult {
  committed: boolean
  pushed: boolean
}

// Git API
export async function gitInit(path: string): Promise<void> {
  await invoke('git_init', { path })
}

export async function gitStatus(path: string): Promise<GitStatus> {
  return await invoke('git_status', { path })
}

// G-02 修复：返回 boolean 表示是否有实际提交（true=已提交，false=无改动）
export async function gitCommit(path: string, message: string): Promise<boolean> {
  return await invoke('git_commit', { path, message })
}

export async function gitPush(path: string): Promise<void> {
  await invoke('git_push', { path })
}

export async function gitPushWithCredentials(path: string, username: string, password: string): Promise<void> {
  await invoke('git_push_with_credentials', { path, username, password })
}

// G-02 修复：返回 CommitPushResult 让前端区分"无改动"/"已提交"/"已推送"
export async function gitCommitAndPush(path: string, message: string): Promise<CommitPushResult> {
  return await invoke('git_commit_and_push', { path, message })
}

export async function gitPull(path: string): Promise<void> {
  await invoke('git_pull', { path })
}

export async function gitPullWithCredentials(path: string, username: string, password: string): Promise<void> {
  await invoke('git_pull_with_credentials', { path, username, password })
}

export async function gitForcePush(path: string): Promise<void> {
  await invoke('git_force_push', { path })
}

export async function gitForcePushWithCredentials(path: string, username: string, password: string): Promise<void> {
  await invoke('git_force_push_with_credentials', { path, username, password })
}

export async function gitForcePull(path: string): Promise<void> {
  await invoke('git_force_pull', { path })
}

export async function gitForcePullWithCredentials(path: string, username: string, password: string): Promise<void> {
  await invoke('git_force_pull_with_credentials', { path, username, password })
}

// Git 凭据 Keyring API
export interface GitCredential {
  username: string
  password: string
}

export async function gitCredentialSave(repoPath: string, username: string, password: string): Promise<void> {
  await invoke('git_credential_save', { repoPath, username, password })
}

export async function gitCredentialGet(repoPath: string): Promise<GitCredential | null> {
  return await invoke('git_credential_get', { repoPath })
}

export async function gitCredentialDelete(repoPath: string): Promise<void> {
  await invoke('git_credential_delete', { repoPath })
}

export async function gitAutoCommit(filePath: string): Promise<void> {
  await invoke('git_auto_commit', { filePath })
}

export async function gitDiff(path: string, filePath: string): Promise<string> {
  return await invoke('git_diff', { path, filePath })
}

export async function gitLog(path: string, maxCount: number = 50): Promise<string[]> {
  return await invoke('git_log', { path, maxCount })
}

export async function gitClone(url: string, localPath: string): Promise<string> {
  return await invoke('git_clone', { url, localPath })
}

export async function gitCloneWithCredentials(url: string, localPath: string, username: string, password: string): Promise<string> {
  return await invoke('git_clone_with_credentials', { url, localPath, username, password })
}

export async function gitCloneCancel(): Promise<boolean> {
  return await invoke('git_clone_cancel')
}

export interface GitCloneStatus {
  pid: number | null
  url: string
  local_path: string
}

export async function gitCloneStatus(): Promise<GitCloneStatus> {
  return await invoke('git_clone_status')
}

export interface GitFileLogEntry {
  hash: string
  message: string
  date: string
  insertions: number
  deletions: number
}

export async function gitFileLog(filePath: string, maxCount: number = 50, skip: number = 0): Promise<GitFileLogEntry[]> {
  return await invoke('git_file_log', { filePath, maxCount, skip })
}

export async function gitShowDiff(filePath: string, commitHash: string): Promise<string> {
  return await invoke('git_show_diff', { filePath, commitHash })
}

export async function gitShowFileContent(filePath: string, commitHash: string): Promise<string> {
  return await invoke('git_show_file_content', { filePath, commitHash })
}

export async function gitPullFileLatest(filePath: string): Promise<string> {
  return await invoke('git_pull_file_latest', { filePath })
}

export async function gitForceUploadFile(filePath: string): Promise<void> {
  await invoke('git_force_upload_file', { filePath })
}

export async function isGitRepository(path: string): Promise<boolean> {
  return await invoke('git_is_repo', { path })
}

export interface GitRepositoryInfo {
  name: string
  path: string
  remote_url: string | null
  has_uncommitted_changes: boolean
  uncommitted_count: number
  current_branch: string
  is_submodule: boolean
  parent_path: string | null
}

export async function scanGitRepos(rootPath: string): Promise<GitRepositoryInfo[]> {
  return await invoke('scan_git_repos', { rootPath })
}
