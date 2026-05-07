<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { rootPath } from '../../stores/fileStore';
  import { GitService, type GitStatus } from '../../services/gitService';

  let isRepo = $state(false);
  let isChecking = $state(true);
  let status = $state<GitStatus | null>(null);
  let commitMessage = $state('');
  let isCommitting = $state(false);
  let statusMessage = $state('');
  let initError = $state('');

  onMount(async () => {
    const root = get(rootPath);
    if (root) {
      try {
        isRepo = await GitService.isRepo(root);
        if (isRepo) await refreshStatus();
      } catch { isRepo = false; }
    }
    isChecking = false;
  });

  async function refreshStatus() {
    const root = get(rootPath);
    if (!root) return;
    try { status = await GitService.getStatus(root); }
    catch { statusMessage = '获取 Git 状态失败'; }
  }

  async function handleInit() {
    const root = get(rootPath);
    if (!root) return;
    try {
      await GitService.initRepo(root);
      isRepo = true;
      statusMessage = 'Git 仓库初始化成功';
      await refreshStatus();
    } catch { initError = '初始化仓库失败'; }
  }

  async function handleCommit() {
    if (!commitMessage.trim()) return;
    const root = get(rootPath);
    if (!root) return;
    isCommitting = true;
    try {
      await GitService.commit(root, commitMessage.trim());
      commitMessage = '';
      statusMessage = '提交成功';
      await refreshStatus();
    } catch { statusMessage = '提交失败'; }
    finally { isCommitting = false; }
  }

  const hasChanges = $derived(status && (status.modified.length > 0 || status.added.length > 0 || status.deleted.length > 0 || status.untracked.length > 0));

  const changeCount = $derived(
    status ? status.modified.length + status.added.length + status.deleted.length + status.untracked.length : 0
  );
</script>

<div class="git-sidebar">
  <div class="section-header">
    <span class="section-title">SOURCE CONTROL</span>
    {#if status}
      <span class="branch-badge">{status.branch}</span>
    {/if}
  </div>

  {#if isChecking}
    <div class="loading-state"><div class="spinner"></div></div>
  {:else if !isRepo}
    <div class="init-prompt">
      <p class="init-text">此文件夹尚未初始化</p>
      <p class="init-detail">初始化后将能跟踪文件更改。</p>
      <button class="init-btn" onclick={handleInit} type="button">初始化仓库</button>
      {#if initError}<p class="error-msg">{initError}</p>{/if}
    </div>
  {:else if status}
    <div class="git-content">
      <div class="changes-section">
        <div class="changes-header">
          <span>更改</span>
          {#if changeCount > 0}
            <span class="change-count">{changeCount}</span>
          {/if}
        </div>

        {#if !hasChanges}
          <div class="no-changes">当前没有更改</div>
        {:else}
          {#if status.added.length > 0}
            <div class="change-group">
              <div class="change-label">暂存</div>
              {#each status.added as file}
                <div class="change-item added">
                  <span class="change-badge">A</span>
                  <span class="change-path">{file.split('/').pop()}</span>
                </div>
              {/each}
            </div>
          {/if}
          {#if status.modified.length > 0}
            <div class="change-group">
              <div class="change-label">修改</div>
              {#each status.modified as file}
                <div class="change-item modified">
                  <span class="change-badge">M</span>
                  <span class="change-path">{file.split('/').pop()}</span>
                </div>
              {/each}
            </div>
          {/if}
          {#if status.deleted.length > 0}
            <div class="change-group">
              <div class="change-label">删除</div>
              {#each status.deleted as file}
                <div class="change-item deleted">
                  <span class="change-badge">D</span>
                  <span class="change-path">{file.split('/').pop()}</span>
                </div>
              {/each}
            </div>
          {/if}
          {#if status.untracked.length > 0}
            <div class="change-group">
              <div class="change-label">未跟踪</div>
              {#each status.untracked as file}
                <div class="change-item untracked">
                  <span class="change-badge">U</span>
                  <span class="change-path">{file.split('/').pop()}</span>
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </div>

      <div class="commit-box">
        <input
          type="text"
          class="commit-input"
          placeholder="消息 (Ctrl+Enter 提交)"
          bind:value={commitMessage}
          onkeydown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && handleCommit()}
        />
        <button
          class="commit-btn"
          onclick={handleCommit}
          disabled={!commitMessage.trim() || isCommitting || !hasChanges}
          type="button"
        >
          {isCommitting ? '提交中...' : `提交`}
        </button>
      </div>
    </div>
  {/if}

  {#if statusMessage}
    <div class="status-toast">{statusMessage}</div>
  {/if}
</div>

<style>
  .git-sidebar {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #252526;
    user-select: none;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    height: 35px;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .section-title {
    font-size: 11px; font-weight: 600;
    color: #969696;
    letter-spacing: 0.5px;
  }

  .branch-badge {
    font-size: 11px;
    color: #0078d4;
    background: rgba(0,120,212,0.15);
    padding: 1px 8px;
    border-radius: 10px;
  }

  .loading-state {
    flex: 1;
    display: flex;
    align-items: center; justify-content: center;
  }

  .spinner {
    width: 16px; height: 16px;
    border: 2px solid #3c3c3c;
    border-top-color: #0078d4;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .init-prompt {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
    gap: 8px;
    text-align: center;
  }

  .init-text { font-size: 12px; color: #969696; }
  .init-detail { font-size: 11px; color: #6e6e6e; }

  .init-btn {
    padding: 5px 12px;
    border: 1px solid #0078d4;
    background: transparent;
    color: #0078d4;
    cursor: pointer;
    font-size: 12px;
    margin-top: 8px;
    transition: all 0.15s;
  }

  .init-btn:hover { background: #0078d4; color: #fff; }

  .error-msg { font-size: 11px; color: #f44747; }

  .git-content {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .changes-section { flex: 1; padding: 8px 0; }

  .changes-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 600;
    color: #969696;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .change-count {
    background: #37373d;
    color: #969696;
    padding: 0 6px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 600;
  }

  .change-group { padding: 2px 0; }
  .change-label { padding: 3px 12px; font-size: 11px; color: #6e6e6e; }

  .change-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 12px;
    font-size: 13px;
    height: 22px;
    cursor: default;
  }

  .change-item:hover { background: #2a2d2e; }

  .change-badge {
    width: 18px; height: 14px;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 700;
    border-radius: 2px;
    flex-shrink: 0;
    letter-spacing: 0;
  }

  .added .change-badge { background: rgba(45,125,50,0.25); color: #4ec9b0; }
  .modified .change-badge { background: rgba(230,81,0,0.25); color: #d7ba7d; }
  .deleted .change-badge { background: rgba(198,40,40,0.25); color: #f44747; }
  .untracked .change-badge { background: rgba(106,27,154,0.25); color: #c586c0; }

  .change-path {
    color: #cccccc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .no-changes {
    padding: 24px 12px;
    text-align: center;
    color: #6e6e6e;
    font-size: 12px;
  }

  .commit-box {
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: #252526;
  }

  .commit-input {
    padding: 5px 8px;
    border: 1px solid var(--border);
    font-size: 12px;
    background: #3c3c3c;
    color: #cccccc;
    outline: none;
  }

  .commit-input:focus { border-color: #0078d4; }
  .commit-input::placeholder { color: #6e6e6e; }

  .commit-btn {
    padding: 5px 0;
    border: none;
    background: #0078d4;
    color: #fff;
    cursor: pointer;
    font-size: 12px;
  }

  .commit-btn:hover:not(:disabled) { background: #1a8ae8; }
  .commit-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .status-toast {
    padding: 6px 12px;
    font-size: 11px;
    color: #4ec9b0;
    background: rgba(45,125,50,0.15);
    border-top: 1px solid rgba(45,125,50,0.3);
  }
</style>
