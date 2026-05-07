<script lang="ts">
  import type { FileNode } from '../../types/file';
  import { FileService } from '../../services/fileService';
  import { refreshDirectory, rootPath } from '../../stores/fileStore';
  import { get } from 'svelte/store';
  import { FilePlus, FolderPlus, Pencil, Trash2, Copy, Link } from 'lucide-svelte';

  let visible = $state(false);
  let x = $state(0);
  let y = $state(0);
  let targetNode = $state<FileNode | null>(null);
  let menuEl = $state<HTMLDivElement | undefined>(undefined);

  function handleContextMenu(e: MouseEvent, node: FileNode) {
    e.preventDefault();
    e.stopPropagation();
    targetNode = node;
    x = e.clientX;
    y = e.clientY;
    visible = true;
    // Adjust position if menu would go off screen
    requestAnimationFrame(() => {
      if (menuEl && menuEl instanceof HTMLElement) {
        const rect = menuEl.getBoundingClientRect();
        if (rect.right > window.innerWidth) x = window.innerWidth - rect.width - 4;
        if (rect.bottom > window.innerHeight) y = window.innerHeight - rect.height - 4;
        if (x < 0) x = 4;
        if (y < 0) y = 4;
      }
    });
  }

  function close() {
    visible = false;
    targetNode = null;
  }

  function handleOutsideClick(e: MouseEvent) {
    if (visible && menuEl instanceof HTMLElement && !menuEl.contains(e.target as Node)) {
      close();
    }
  }

  async function handleNewFile() {
    if (!targetNode) return;
    const basePath = targetNode.is_directory ? targetNode.path : targetNode.path.replace(/\/[^/]+$/, '');
    close();
    const name = await promptInline(basePath, '新建文件', 'untitled.md');
    if (name) {
      try {
        await FileService.createFile({ path: `${basePath}/${name}`, is_directory: false });
        await refreshDirectory(basePath);
      } catch (err) {
        alert('创建文件失败：' + (err as Error).message);
      }
    }
  }

  async function handleNewFolder() {
    if (!targetNode) return;
    const basePath = targetNode.is_directory ? targetNode.path : targetNode.path.replace(/\/[^/]+$/, '');
    close();
    const name = await promptInline(basePath, '新建文件夹', 'new-folder');
    if (name) {
      try {
        await FileService.createFile({ path: `${basePath}/${name}`, is_directory: true });
        await refreshDirectory(basePath);
      } catch (err) {
        console.error('Failed to create folder:', err);
      }
    }
  }

  async function handleRename() {
    if (!targetNode) return;
    close();
    const oldPath = targetNode.path;
    const basePath = oldPath.replace(/\/[^/]+$/, '');
    const name = await promptInline(basePath, '重命名', targetNode.name);
    if (name && name !== targetNode.name) {
      try {
        await FileService.renameFile({ old_path: oldPath, new_path: `${basePath}/${name}` });
        await refreshDirectory(basePath);
      } catch (err) {
        console.error('Failed to rename:', err);
      }
    }
  }

  async function handleDelete() {
    if (!targetNode) return;
    close();
    if (confirm(`确定要删除 "${targetNode.name}" 吗？${targetNode.is_directory ? '（文件夹内所有内容将被删除）' : ''}`)) {
      try {
        const basePath = targetNode.path.replace(/\/[^/]+$/, '');
        await FileService.deleteFile(targetNode.path);
        await refreshDirectory(basePath);
      } catch (err) {
        console.error('Failed to delete:', err);
        alert('删除失败：' + (err as Error).message);
      }
    }
  }

  async function handleCopyPath() {
    if (!targetNode) return;
    close();
    await navigator.clipboard.writeText(targetNode.path);
  }

  async function handleCopyRelativePath() {
    if (!targetNode) return;
    close();
    const root = get(rootPath);
    if (root) {
      const rel = targetNode.path.replace(root + '/', '');
      await navigator.clipboard.writeText(rel);
    } else {
      await navigator.clipboard.writeText(targetNode.path);
    }
  }

  // Inline prompt using a small dialog
  function promptInline(basePath: string, title: string, defaultValue: string): Promise<string | null> {
    return new Promise((resolve) => {
      const name = window.prompt(`${title}\n路径: ${basePath}`, defaultValue);
      resolve(name && name.trim() ? name.trim() : null);
    });
  }

  export function showContextMenu(e: MouseEvent, node: FileNode) {
    handleContextMenu(e, node);
  }
</script>

<svelte:window onclick={handleOutsideClick} />

{#if visible}
  <div
    bind:this={menuEl}
    class="context-menu"
    style="left: {x}px; top: {y}px"
    role="menu"
  >
    {#if targetNode?.is_directory}
      <button class="menu-item" role="menuitem" onclick={handleNewFile}>
        <FilePlus size={14} strokeWidth={1.5} />
        新建文件
      </button>
      <button class="menu-item" role="menuitem" onclick={handleNewFolder}>
        <FolderPlus size={14} strokeWidth={1.5} />
        新建文件夹
      </button>
      <div class="menu-separator"></div>
    {/if}
    <button class="menu-item" role="menuitem" onclick={handleRename}>
      <Pencil size={14} strokeWidth={1.5} />
      重命名
    </button>
    <button class="menu-item danger" role="menuitem" onclick={handleDelete}>
      <Trash2 size={14} strokeWidth={1.5} />
      删除
    </button>
    <div class="menu-separator"></div>
    <button class="menu-item" role="menuitem" onclick={handleCopyPath}>
      <Copy size={14} strokeWidth={1.5} />
      复制路径
    </button>
    <button class="menu-item" role="menuitem" onclick={handleCopyRelativePath}>
      <Link size={14} strokeWidth={1.5} />
      复制相对路径
    </button>
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    z-index: 20000;
    min-width: 180px;
    background: #252526;
    border: 1px solid #454545;
    border-radius: 4px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    padding: 4px 0;
    user-select: none;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: transparent;
    color: #cccccc;
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    transition: background 0.06s;
  }
  .menu-item:hover { background: #094771; }
  .menu-item.danger { color: #f14c4c; }
  .menu-item.danger:hover { background: #f14c4c22; }
  .menu-item svg { flex-shrink: 0; opacity: 0.8; }

  .menu-separator {
    height: 1px;
    background: #3c3c3c;
    margin: 4px 0;
  }
</style>
