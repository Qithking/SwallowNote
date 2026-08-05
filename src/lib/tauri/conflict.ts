import { invoke } from '@tauri-apps/api/core'

// 冲突解决 API
export interface ConflictFile {
  path: string
  abs_path: string
}

export async function gitGetConflictFiles(repoPath: string): Promise<ConflictFile[]> {
  return await invoke('git_get_conflict_files', { repoPath })
}

export async function gitGetConflictLocalContent(repoPath: string, filePath: string): Promise<string> {
  return await invoke('git_get_conflict_local_content', { repoPath, filePath })
}

export async function gitGetConflictRemoteContent(repoPath: string, filePath: string): Promise<string> {
  return await invoke('git_get_conflict_remote_content', { repoPath, filePath })
}

export async function gitResolveConflictFile(repoPath: string, filePath: string, side: string): Promise<void> {
  await invoke('git_resolve_conflict_file', { repoPath, filePath, side })
}

export async function gitSaveConflictFileContent(repoPath: string, filePath: string, content: string): Promise<void> {
  await invoke('git_save_conflict_file_content', { repoPath, filePath, content })
}

export async function gitAbortConflict(repoPath: string): Promise<void> {
  await invoke('git_abort_conflict', { repoPath })
}

// 冲突仓库记录 API
export interface ConflictRepoRecord {
  repo_path: string
  repo_name: string
  conflict_file_count: number
  detected_at: string
  updated_at: string
}

export async function getConflictRepoRecords(): Promise<ConflictRepoRecord[]> {
  return await invoke('get_conflict_repo_records')
}

export async function removeConflictRepoRecord(repoPath: string): Promise<void> {
  await invoke('remove_conflict_repo_record', { repoPath })
}

export async function syncConflictRepoRecords(
  conflictRepos: [string, string, number][] // [repo_path, repo_name, file_count][]
): Promise<ConflictRepoRecord[]> {
  return await invoke('sync_conflict_repo_records', { conflictRepos })
}

export async function checkAndUpdateConflictRepo(
  repoPath: string,
  repoName: string
): Promise<number> {
  return await invoke('check_and_update_conflict_repo', { repoPath, repoName })
}

// Word Diff API（Rust 计算）
export interface WordDiffPart {
  value: string
  removed: boolean
  added: boolean
}

export interface WordDiffResult {
  old_parts: WordDiffPart[]
  new_parts: WordDiffPart[]
}

export async function computeWordDiff(oldText: string, newText: string): Promise<WordDiffResult> {
  return await invoke('compute_word_diff', { oldText, newText })
}
