import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export interface GitStatus {
  branch: string;
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
}

export const isRepo = writable<boolean>(false);
export const gitStatus = writable<GitStatus | null>(null);
export const gitLoading = writable<boolean>(false);

/**
 * Check if a path is a git repository and load its status
 */
export async function checkGitStatus(path: string) {
  gitLoading.set(true);
  try {
    const repo = await invoke<boolean>('git_is_repo', { path });
    isRepo.set(repo);
    if (repo) {
      const status = await invoke<GitStatus>('git_status', { path });
      gitStatus.set(status);
    } else {
      gitStatus.set(null);
    }
  } catch (err) {
    isRepo.set(false);
    gitStatus.set(null);
    console.error('Failed to check git status:', err);
  } finally {
    gitLoading.set(false);
  }
}

/**
 * Refresh git status
 */
export async function refreshGitStatus(path: string) {
  const repo = get(isRepo);
  if (!repo) return;
  try {
    const status = await invoke<GitStatus>('git_status', { path });
    gitStatus.set(status);
  } catch (err) {
    console.error('Failed to refresh git status:', err);
  }
}

/**
 * Initialize a git repository
 */
export async function initGitRepo(path: string): Promise<void> {
  await invoke('git_init', { path });
  await checkGitStatus(path);
}

/**
 * Get total change count
 */
export function getTotalChanges(): number {
  const status = get(gitStatus);
  if (!status) return 0;
  return status.modified.length + status.added.length + status.deleted.length + status.untracked.length;
}
