<script lang="ts">
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import FileTreeNode from './FileTreeNode.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import { rootPath, loadDirectory, onFileChanged, refreshDirectory } from '../../stores/fileStore';
  import { FileService } from '../../services/fileService';
  import type { FileNode } from '../../types/file';
  import { get } from 'svelte/store';
  import { FilePlus, FolderPlus, RefreshCw, FolderOpen } from 'lucide-svelte';

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
    <span class="section-title">资源管理器</span>
    <div class="section-actions">
      <button
        type="button"
        class="action-btn"
        onclick={handleNewFile}
        title="新建文件"
        disabled={!$rootPath}
      >
        <FilePlus size={14} strokeWidth={2} />
      </button>
      <button
        type="button"
        class="action-btn"
        onclick={handleNewFolder}
        title="新建文件夹"
        disabled={!$rootPath}
      >
        <FolderPlus size={14} strokeWidth={2} />
      </button>
      <button
        type="button"
        class="action-btn"
        onclick={handleRefresh}
        title="刷新"
        disabled={!$rootPath}
      >
        <RefreshCw size={14} strokeWidth={2} />
      </button>
    </div>
  </div>

  <div class="tree-content">
    {#if !$rootPath}
      <div class="empty-state">
        <FolderOpen size={32} strokeWidth={1} color="#6e6e6e" />
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
    background: var(--bg-secondary);
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
    color: var(--text-muted);
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
    color: var(--text-muted);
    border-radius: 4px;
    transition: background 0.1s, color 0.1s;
    padding: 0;
    flex-shrink: 0;
  }
  .action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .action-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .action-btn:disabled:hover {
    background: transparent;
    color: var(--text-muted);
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
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .empty-message {
    padding: 20px 16px;
    text-align: center;
    color: var(--text-muted);
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
    color: var(--text-muted);
    font-size: 12px;
    margin: 0;
    text-align: center;
  }

  .open-folder-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 14px;
    background: var(--accent);
    color: #ffffff;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .open-folder-btn:hover { background: var(--accent-hover); }
</style>
