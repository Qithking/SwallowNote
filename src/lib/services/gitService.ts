import { invoke } from '@tauri-apps/api/core';

export interface GitStatus {
  branch: string;
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
}

export class GitService {
  /**
   * Check if a directory is a git repository
   */
  static async isRepo(path: string): Promise<boolean> {
    return await invoke<boolean>('git_is_repo', { path });
  }

  /**
   * Initialize a git repository
   */
  static async initRepo(path: string): Promise<void> {
    await invoke('git_init', { path });
  }

  /**
   * Get git status
   */
  static async getStatus(path: string): Promise<GitStatus> {
    return await invoke<GitStatus>('git_status', { path });
  }

  /**
   * Get git diff for a file
   */
  static async getDiff(path: string, filePath: string): Promise<string> {
    return await invoke<string>('git_diff', { path, filePath });
  }

  /**
   * Stage all changes and commit
   */
  static async commit(path: string, message: string): Promise<void> {
    await invoke('git_commit', { path, message });
  }

  /**
   * Get commit log
   */
  static async getLog(path: string, maxCount: number): Promise<string[]> {
    return await invoke<string[]>('git_log', { path, maxCount });
  }
}
