<script lang="ts">
  import type { FileNode } from '../../types/file';
  import { expandedNodes, selectedNode, selectNode, loadDirectory } from '../../stores/fileStore';
  import FileTreeNode from './FileTreeNode.svelte';

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

  function getIcon() {
    const n = node.name.toLowerCase();
    if (node.is_directory) {
      return isExpanded
        ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1H2.5A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 13.5 3H9L8 1z" opacity="0.8"/></svg>`
        : `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1H2.5A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 13.5 3H9L8 1z" opacity="0.6"/></svg>`;
    }
    // File icons per extension
    if (n.endsWith('.md')) {
      return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#4fc1ff" stroke-width="1.2"><path d="M2 1h8l4 4v9.5a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 14.5V1z"/><path d="M10 1v4h4" stroke="#4fc1ff"/><path d="M5 8h6M5 10h4" stroke="#4fc1ff" opacity="0.6"/></svg>`;
    }
    if (n.endsWith('.json')) {
      return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#ce9178" stroke-width="1.2"><path d="M2 1h8l4 4v9.5a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 14.5V1z"/><path d="M10 1v4h4" stroke="#ce9178"/><path d="M6 9l-1 1 1 1M10 9l1 1-1 1" opacity="0.7"/></svg>`;
    }
    if (n.endsWith('.js') || n.endsWith('.jsx') || n.endsWith('.mjs')) {
      return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#dcdcaa" stroke-width="1.2"><path d="M2 1h8l4 4v9.5a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 14.5V1z"/><path d="M10 1v4h4" stroke="#dcdcaa"/><text x="4" y="12" font-size="8" fill="#dcdcaa" font-weight="bold">JS</text></svg>`;
    }
    if (n.endsWith('.ts') || n.endsWith('.tsx')) {
      return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#569cd6" stroke-width="1.2"><path d="M2 1h8l4 4v9.5a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 14.5V1z"/><path d="M10 1v4h4" stroke="#569cd6"/><text x="4" y="11" font-size="7" fill="#569cd6" font-weight="bold">TS</text></svg>`;
    }
    if (n.endsWith('.css') || n.endsWith('.scss') || n.endsWith('.less')) {
      return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#519aba" stroke-width="1.2"><path d="M2 1h8l4 4v9.5a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 14.5V1z"/><path d="M10 1v4h4" stroke="#519aba"/><text x="4" y="12" font-size="8" fill="#519aba" font-weight="bold">#</text></svg>`;
    }
    if (n.endsWith('.html') || n.endsWith('.htm')) {
      return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#e44d26" stroke-width="1.2"><path d="M2 1h8l4 4v9.5a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 14.5V1z"/><path d="M10 1v4h4" stroke="#e44d26"/><text x="4" y="12" font-size="7" fill="#e44d26" font-weight="bold">H</text></svg>`;
    }
    if (n.endsWith('.svg') || n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.webp')) {
      return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#c586c0" stroke-width="1.2"><path d="M2 1h8l4 4v9.5a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 14.5V1z"/><path d="M10 1v4h4" stroke="#c586c0"/><circle cx="8" cy="9" r="2" fill="#c586c0" opacity="0.5"/></svg>`;
    }
    if (n.endsWith('.yaml') || n.endsWith('.yml')) {
      return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#6a9955" stroke-width="1.2"><path d="M2 1h8l4 4v9.5a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 14.5V1z"/><path d="M10 1v4h4" stroke="#6a9955"/><path d="M5 11l3-5 3 5" opacity="0.7"/></svg>`;
    }
    // Default file icon
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#969696" stroke-width="1.2"><path d="M2 1h8l4 4v9.5a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 14.5V1z"/><path d="M10 1v4h4" stroke="#969696"/></svg>`;
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
      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" class:rotated={isExpanded}>
        <path d="M3 1l5 4-5 4" stroke="currentColor" stroke-width="1.2" fill="none"/>
      </svg>
    </button>
  {:else}
    <span class="toggle-spacer"></span>
  {/if}

  <span class="node-icon">{@html getIcon()}</span>
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
  .toggle-btn svg.rotated { transform: rotate(90deg); }
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
