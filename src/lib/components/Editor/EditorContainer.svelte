<script lang="ts">
  import SourceEditor from './SourceEditor.svelte';
  import PreviewRenderer from './PreviewRenderer.svelte';
  import { tabs, activeTabId } from '../../stores/fileStore';
  import { get } from 'svelte/store';
  import type { ViewMode } from '../../types/file';
  import { Code, Eye, Columns } from 'lucide-svelte';

  let viewMode = $state<ViewMode>('split');

  function getTabContent(): string {
    const tabId = get(activeTabId);
    if (!tabId) return '';
    const currentTabs = get(tabs);
    const tab = currentTabs.find(t => t.id === tabId);
    return tab?.content || '';
  }

  function isMode(m: string): boolean {
    return viewMode === m;
  }
</script>

<div class="editor-container">
  <div class="editor-toolbar">
    <div class="toolbar-group">
      <button
        type="button"
        class="toolbar-btn"
        class:active={isMode('source')}
        onclick={() => viewMode = 'source'}
        title="仅编辑器"
      >
        <Code size={16} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        class="toolbar-btn"
        class:active={isMode('preview')}
        onclick={() => viewMode = 'preview'}
        title="仅预览"
      >
        <Eye size={16} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        class="toolbar-btn"
        class:active={isMode('split')}
        onclick={() => viewMode = 'split'}
        title="分屏"
      >
        <Columns size={16} strokeWidth={1.5} />
      </button>
    </div>
    <span class="viewmode-label">
      {isMode('source') ? '编辑器' : isMode('preview') ? '预览' : '分屏'}
    </span>
  </div>

  <div class="editor-main">
    {#if isMode('source')}
      <SourceEditor />
    {:else if isMode('preview')}
      <PreviewRenderer content={getTabContent()} />
    {:else}
      <div class="split-view">
        <div class="split-pane left">
          <SourceEditor />
        </div>
        <div class="split-divider"></div>
        <div class="split-pane right">
          <PreviewRenderer content={getTabContent()} />
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .editor-container {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .editor-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 24px;
    padding: 0 8px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .toolbar-group { display: flex; gap: 1px; }

  .toolbar-btn {
    width: 20px; height: 20px;
    border: none; background: transparent;
    border-radius: 3px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: #6e6e6e;
    transition: all 0.08s;
    padding: 0;
  }

  .toolbar-btn:hover { background: rgba(255,255,255,0.1); color: var(--text-primary); }
  .toolbar-btn.active { color: var(--accent); }

  .viewmode-label {
    font-size: 11px;
    color: var(--text-muted);
  }

  .editor-main {
    flex: 1;
    overflow: hidden;
  }

  .split-view {
    display: flex;
    height: 100%;
  }

  .split-pane {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .split-divider {
    width: 4px;
    background: var(--border);
    cursor: col-resize;
    transition: background 0.12s;
    flex-shrink: 0;
    position: relative;
  }

  .split-divider:hover { background: var(--accent); }

  .split-divider::before {
    content: '';
    position: absolute;
    left: -2px; right: -2px;
    top: 0; bottom: 0;
  }
</style>
