<script lang="ts">
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import FileTreeNode from './FileTreeNode.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import { rootPath, loadDirectory, onFileChanged, refreshDirectory } from '../../stores/fileStore';
  import { FileService } from '../../services/fileService';
  import type { FileNode } from '../../types/file';
  import { get } from 'svelte/store';

  let rootNodes = $state<FileNode[]>([]);
  let isLoading = $state(false);
  let contextMenu: ContextMenu;

  onMount(() => {
    if (get(rootPath)) loadRoot();
    const unlistenPromise = listen<string>('file-changed', (event) => {
      onFileChanged(event.payload);
    });

    // Listen for context menu events from tree nodes
    const handleContextMenu = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.node) {
        contextMenu?.showContextMenu({ clientX: detail.x, clientY: detail.y, preventDefault: () => {}, stopPropagation: () => {} } as MouseEvent, detail.node);
      }
    };
    document.addEventListener('treenode:contextmenu', handleContextMenu);

    return () => {
      unlistenPromise.then((fn) => fn());
      document.removeEventListener('treenode:contextmenu', handleContextMenu);
    };
  });

  async function loadRoot() {
    const path = get(rootPath);
    if (!path) return;
    isLoading = true;
    try { rootNodes = await loadDirectory(path); }
    finally { isLoading = false; }
  }

  $effect(() => { if ($rootPath) loadRoot(); });

  async function handleRefresh() {
    const path = get(rootPath);
    if (!path) return;
    isLoading = true;
    try {
      await refreshDirectory(path);
      rootNodes = await loadDirectory(path);
    } finally { isLoading = false; }
  }

  async function handleNewFile() {
    const basePath = get(rootPath);
    if (!basePath) return;
    const name = window.prompt('新建文件\n路径: ' + basePath, 'untitled.md');
    if (name && name.trim()) {
      try {
        await FileService.createFile({ path: `${basePath}/${name.trim()}`, is_directory: false });
        await refreshDirectory(basePath);
        rootNodes = await loadDirectory(basePath);
      } catch (err) {
        alert('创建文件失败：' + (err as Error).message);
      }
    }
  }

  async function handleNewFolder() {
    const basePath = get(rootPath);
    if (!basePath) return;
    const name = window.prompt('新建文件夹\n路径: ' + basePath, 'new-folder');
    if (name && name.trim()) {
      try {
        await FileService.createFile({ path: `${basePath}/${name.trim()}`, is_directory: true });
        await refreshDirectory(basePath);
        rootNodes = await loadDirectory(basePath);
      } catch (err) {
        alert('创建文件夹失败：' + (err as Error).message);
      }
    }
  }

  function handleOpenFolder() {
    const event = new CustomEvent('app:open-folder');
    document.dispatchEvent(event);
  }
</script>

<ContextMenu bind:this={contextMenu} />

<div class="file-tree">
  <div class="section-header">
    <span class="section-title">EXPLORER</span>
    <div class="section-actions">
      <button
        type="button"
        class="action-btn"
        onclick={handleNewFile}
        title="新建文件"
        disabled={!$rootPath}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
      </button>
      <button
        type="button"
        class="action-btn"
        onclick={handleNewFolder}
        title="新建文件夹"
        disabled={!$rootPath}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          <line x1="12" y1="11" x2="12" y2="17"/>
          <line x1="9" y1="14" x2="15" y2="14"/>
        </svg>
      </button>
      <button
        type="button"
        class="action-btn"
        onclick={handleRefresh}
        title="刷新"
        disabled={!$rootPath}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
      </button>
    </div>
  </div>

  <div class="tree-content">
    {#if !$rootPath}
      <div class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6e6e6e" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <p class="empty-hint">尚未打开文件夹</p>
        <button type="button" class="open-folder-btn" onclick={handleOpenFolder}>
          打开文件夹
        </button>
      </div>
    {:else if isLoading}
      <div class="loading-indicator">
        <div class="loading-spinner"></div>
      </div>
    {:else if rootNodes.length === 0}
      <div class="empty-message">空目录</div>
    {:else}
      {#each rootNodes as node (node.id)}
        <FileTreeNode {node} depth={0} />
      {/each}
    {/if}
  </div>
</div>

<style>
  .file-tree {
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
    padding: 0 8px 0 12px;
    height: 35px;
    flex-shrink: 0;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    color: #969696;
    letter-spacing: 0.5px;
    flex: 1;
  }

  .section-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .action-btn {
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #969696;
    border-radius: 4px;
    transition: background 0.1s, color 0.1s;
    padding: 0;
    flex-shrink: 0;
  }
  .action-btn:hover {
    background: rgba(255,255,255,0.08);
    color: #cccccc;
  }
  .action-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .action-btn:disabled:hover {
    background: transparent;
    color: #969696;
  }

  .tree-content {
    flex: 1;
    overflow-y: auto;
    padding: 0;
  }

  .loading-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .loading-spinner {
    width: 16px; height: 16px;
    border: 2px solid #3c3c3c;
    border-top-color: #0078d4;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .empty-message {
    padding: 20px 16px;
    text-align: center;
    color: #6e6e6e;
    font-size: 12px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    gap: 12px;
  }

  .empty-hint {
    color: #6e6e6e;
    font-size: 12px;
    margin: 0;
    text-align: center;
  }

  .open-folder-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 14px;
    background: #0078d4;
    color: #ffffff;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .open-folder-btn:hover { background: #1a8ae8; }
</style>
