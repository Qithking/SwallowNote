<script lang="ts">
  import type { FileNode } from '../../types/file';
  import { expandedNodes, selectedNode, selectNode, loadDirectory } from '../../stores/fileStore';
  import FileTreeNode from './FileTreeNode.svelte';
  import { FolderOpen, Folder, FileText, FileCode, FileJson, FileImage, FileType, ChevronRight } from 'lucide-svelte';

  let { node, depth = 0 }: { node: FileNode; depth?: number } = $props();

  let children = $state<FileNode[]>([]);
  let isLoading = $state(false);
  let isExpanded = $state(false);

  // 监听 store 变化，同步展开状态
  $effect(() => {
    isExpanded = $expandedNodes.has(node.id);
  });

  let isSelected = $derived($selectedNode?.id === node.id);

  async function handleToggle() {
    if (!node.is_directory) return;

    // 直接在组件内管理展开状态，避免时序问题
    if (isExpanded) {
      isExpanded = false;
      expandedNodes.update(set => {
        set.delete(node.id);
        return set;
      });
    } else {
      isExpanded = true;
      isLoading = true;
      expandedNodes.update(set => {
        set.add(node.id);
        return set;
      });
      try {
        children = await loadDirectory(node.path);
      } finally {
        isLoading = false;
      }
    }
  }

  function handleClick() { selectNode(node); }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Dispatch custom event for the FileTree to handle
    const event = new CustomEvent('treenode:contextmenu', {
      detail: { node, x: e.clientX, y: e.clientY },
      bubbles: true,
    });
    document.dispatchEvent(event);
  }

  function getFileIconColor(): string {
    const n = node.name.toLowerCase();
    if (n.endsWith('.md')) return '#4fc1ff';
    if (n.endsWith('.json')) return '#ce9178';
    if (n.endsWith('.js') || n.endsWith('.jsx') || n.endsWith('.mjs')) return '#dcdcaa';
    if (n.endsWith('.ts') || n.endsWith('.tsx')) return '#569cd6';
    if (n.endsWith('.css') || n.endsWith('.scss') || n.endsWith('.less')) return '#519aba';
    if (n.endsWith('.html') || n.endsWith('.htm')) return '#e44d26';
    if (n.endsWith('.svg') || n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.webp')) return '#c586c0';
    if (n.endsWith('.yaml') || n.endsWith('.yml')) return '#6a9955';
    return '#969696';
  }

  function getFileIcon() {
    const n = node.name.toLowerCase();
    if (node.is_directory) {
      return isExpanded ? FolderOpen : Folder;
    }
    if (n.endsWith('.json')) return FileJson;
    if (n.endsWith('.js') || n.endsWith('.jsx') || n.endsWith('.ts') || n.endsWith('.tsx') || n.endsWith('.mjs')) return FileCode;
    if (n.endsWith('.svg') || n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.webp')) return FileImage;
    if (n.endsWith('.css') || n.endsWith('.scss') || n.endsWith('.less') || n.endsWith('.html') || n.endsWith('.htm') || n.endsWith('.yaml') || n.endsWith('.yml')) return FileType;
    return FileText;
  }
</script>

<div
  class="tree-node"
  class:selected={isSelected}
  style="padding-left: {depth * 12 + 4}px"
  onclick={handleClick}
  oncontextmenu={handleContextMenu}
  role="button"
  tabindex="0"
  onkeydown={(e) => e.key === 'Enter' && handleClick()}
>
  {#if node.is_directory}
    <button
      class="toggle-btn"
      onclick={(e) => { e.stopPropagation(); handleToggle(); }}
      tabindex="-1"
      title={isExpanded ? '折叠' : '展开'}
      aria-label={isExpanded ? '折叠' : '展开'}
    >
      <ChevronRight size={10} strokeWidth={1.5} class={isExpanded ? 'rotated' : ''} />
    </button>
  {:else}
    <span class="toggle-spacer"></span>
  {/if}

  <span class="node-icon">
    {#if node.is_directory}
      <svelte:component this={getFileIcon()} size={16} strokeWidth={1.5} color={isExpanded ? '#cccccc' : '#aaaaaa'} />
    {:else}
      <svelte:component this={getFileIcon()} size={16} strokeWidth={1.5} color={getFileIconColor()} />
    {/if}
  </span>
  <span class="node-name">{node.name}</span>

  {#if isLoading}
    <span class="loading-dots"></span>
  {/if}
</div>

{#if isExpanded && node.is_directory}
  <div class="children">
    {#if isLoading}
      <div class="loading-row" style="padding-left: {depth * 12 + 20}px">
        <div class="loading-dots-inline"></div>
      </div>
    {:else}
      {#each children as child (child.id)}
        <FileTreeNode node={child} depth={depth + 1} />
      {/each}
    {/if}
  </div>
{/if}

<style>
  .tree-node {
    display: flex;
    align-items: center;
    height: 22px;
    padding-right: 8px;
    cursor: pointer;
    color: #cccccc;
    font-size: 13px;
    gap: 0;
    transition: background 0.06s;
    user-select: none;
  }
  .tree-node:hover { background: #2a2d2e; }
  .tree-node.selected { background: #37373d; }
  .tree-node:focus { outline: none; }
  .tree-node:focus-visible {
    outline: 1px solid #0078d4;
    outline-offset: -1px;
  }

  .toggle-btn {
    width: 16px; height: 16px;
    border: none; background: transparent;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: #6e6e6e;
    flex-shrink: 0;
    padding: 0;
    transition: transform 0.08s;
  }
  .toggle-btn :global(svg.rotated) { transform: rotate(90deg); }
  .toggle-btn:hover { color: #969696; }

  .toggle-spacer { width: 16px; flex-shrink: 0; }

  .node-icon {
    width: 16px; height: 16px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    margin-right: 4px;
  }

  .node-icon :global(svg) {
    width: 16px; height: 16px;
  }

  .node-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .children { margin-left: 0; }

  .loading-row {
    height: 22px;
    display: flex; align-items: center;
  }

  .loading-dots, .loading-dots-inline {
    width: 10px; height: 10px;
    border: 2px solid #3c3c3c;
    border-top-color: #0078d4;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
</style>
