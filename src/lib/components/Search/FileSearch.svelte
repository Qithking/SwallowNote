<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { rootPath, openFile } from '../../stores/fileStore';
  import { FileService } from '../../services/fileService';
  import type { FileNode } from '../../types/file';
  import Fuse from 'fuse.js';

  let { onclose }: { onclose: () => void } = $props();

  let query = $state('');
  let results = $state<FileNode[]>([]);
  let selectedIndex = $state(0);
  let allFiles = $state<FileNode[]>([]);
  let searchInput: HTMLInputElement;
  let fuse: Fuse<{ name: string; path: string }> | null = $state(null);

  onMount(async () => {
    searchInput?.focus();
    const root = get(rootPath);
    if (!root) return;
    const files: FileNode[] = [];
    await collectFiles(root, files);
    allFiles = files;
    fuse = new Fuse(
      files.map((f) => ({ name: f.name, path: f.path })),
      { keys: ['name', 'path'], threshold: 0.4, includeScore: true }
    );
  });

  async function collectFiles(dirPath: string, files: FileNode[]) {
    try {
      const nodes = await FileService.listDirectory(dirPath);
      for (const node of nodes) {
        if (!node.is_directory) files.push(node);
        else await collectFiles(node.path, files);
      }
    } catch {}
  }

  $effect(() => {
    if (query && fuse) {
      const fuseResults = fuse.search(query);
      results = fuseResults
        .filter((r) => r.score !== undefined && r.score < 0.5)
        .slice(0, 20)
        .map((r) => allFiles.find((f) => f.path === r.item.path)!);
      selectedIndex = 0;
    } else if (!query) {
      results = allFiles.slice(0, 20);
      selectedIndex = 0;
    } else {
      results = [];
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex = Math.min(selectedIndex + 1, results.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex = Math.max(selectedIndex - 1, 0); }
    else if (e.key === 'Enter' && results[selectedIndex]) { e.preventDefault(); handleSelect(results[selectedIndex]); }
    else if (e.key === 'Escape') onclose();
  }

  async function handleSelect(node: FileNode) {
    await openFile(node);
    onclose();
  }

  function highlightMatch(text: string, q: string): string {
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return text.slice(0, idx) + '<strong>' + text.slice(idx, idx + q.length) + '</strong>' + text.slice(idx + q.length);
  }

  function fileIcon(name: string): string {
    if (name.endsWith('.md')) return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#4fc1ff" stroke-width="1.2"><path d="M2 1h8l4 4v9.5a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 14.5V1z"/><path d="M10 1v4h4" stroke="#4fc1ff"/><path d="M5 8h6M5 10h4" stroke="#4fc1ff" opacity="0.6"/></svg>`;
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2 1h8l4 4v9.5a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 14.5V1z"/><path d="M10 1v4h4"/></svg>`;
  }
</script>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="quick-open-overlay" onclick={onclose} role="dialog" aria-modal="true" aria-label="Quick open" tabindex="-1">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="quick-open-dialog" onclick={(e) => e.stopPropagation()} onkeydown={handleKeydown} role="document">
    <div class="quick-open-input-wrapper">
      <svg class="quick-open-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input
        bind:this={searchInput}
        type="text"
        class="quick-open-input"
        placeholder="搜索文件..."
        bind:value={query}
        onkeydown={handleKeydown}
      />
    </div>

    {#if results.length > 0}
      <div class="quick-open-results">
        {#each results as result, i}
          <div
            class="result-row"
            class:selected={i === selectedIndex}
            onclick={() => handleSelect(result)}
            role="button"
            tabindex="-1"
          >
            <span class="result-icon">{@html fileIcon(result.name)}</span>
            <div class="result-info">
              <span class="result-name">{@html highlightMatch(result.name, query)}</span>
              <span class="result-path">{@html highlightMatch(result.path, query)}</span>
            </div>
          </div>
        {/each}
        <div class="result-count">{results.length} 个文件</div>
      </div>
    {:else if query}
      <div class="no-results">
        <p>未找到 "{query}"</p>
      </div>
    {:else if allFiles.length === 0}
      <div class="no-results">
        <div class="loading-spin"></div>
        <p>索引文件中...</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .quick-open-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    z-index: 10000;
    background: rgba(0,0,0,0.4);
    padding-top: 8vh;
  }

  .quick-open-dialog {
    width: 500px;
    max-height: 60vh;
    background: #2d2d2d;
    border: 1px solid #454545;
    box-shadow: 0 8px 30px rgba(0,0,0,0.6);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .quick-open-input-wrapper {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid #3c3c3c;
    gap: 8px;
  }

  .quick-open-search-icon { color: #6e6e6e; flex-shrink: 0; }

  .quick-open-input {
    flex: 1;
    border: none; outline: none;
    font-size: 14px;
    color: #cccccc;
    background: transparent;
  }

  .quick-open-input::placeholder { color: #6e6e6e; }

  .quick-open-results {
    overflow-y: auto;
    flex: 1;
  }

  .result-row {
    display: flex;
    align-items: center;
    padding: 6px 12px;
    gap: 8px;
    cursor: pointer;
    transition: background 0.06s;
  }

  .result-row:hover,
  .result-row.selected { background: #37373d; }

  .result-icon {
    width: 16px; height: 16px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }

  .result-info { flex: 1; min-width: 0; }

  .result-name {
    display: block;
    font-size: 13px;
    color: #cccccc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .result-name :global(strong) { color: #4fc1ff; }

  .result-path {
    display: block;
    font-size: 11px;
    color: #6e6e6e;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }
  .result-path :global(strong) { color: #4fc1ff; }

  .result-count {
    padding: 4px 12px;
    font-size: 11px;
    color: #6e6e6e;
    border-top: 1px solid #3c3c3c;
    text-align: center;
  }

  .no-results {
    padding: 32px 12px;
    text-align: center;
    color: #6e6e6e;
    font-size: 13px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .loading-spin {
    width: 18px; height: 18px;
    border: 2px solid #3c3c3c;
    border-top-color: #0078d4;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
</style>
