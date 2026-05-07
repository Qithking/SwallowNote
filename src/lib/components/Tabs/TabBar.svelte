<script lang="ts">
  import { tabs, activeTabId, closeTab, saveTab } from '../../stores/fileStore';
  import { get } from 'svelte/store';
  import { X } from 'lucide-svelte';

  function handleTabClick(tabId: string) {
    const currentTabs = get(tabs);
    const updatedTabs = currentTabs.map(t => ({ ...t, active: t.id === tabId }));
    tabs.set(updatedTabs);
    activeTabId.set(tabId);
  }

  async function handleTabClose(tabId: string, event: Event) {
    event.stopPropagation();
    const tab = get(tabs).find(t => t.id === tabId);
    if (tab?.dirty) {
      try { await saveTab(tabId); } catch { return; }
    }
    await closeTab(tabId);
  }

  function handleMiddleClick(tabId: string, event: MouseEvent) {
    if (event.button === 1) handleTabClose(tabId, event);
  }
</script>

<div class="tab-bar">
  <div class="tabs-container">
    {#each get(tabs) as tab (tab.id)}
      <div
        class="tab"
        class:active={tab.active}
        class:dirty={tab.dirty}
        onclick={() => handleTabClick(tab.id)}
        onauxclick={(e) => handleMiddleClick(tab.id, e)}
        role="tab"
        tabindex="0"
        aria-selected={tab.active}
        onkeydown={(e) => e.key === 'Enter' && handleTabClick(tab.id)}
      >
        <span class="tab-title">{tab.title}</span>
        {#if tab.dirty}
          <span class="dirty-dot"></span>
        {:else}
          <button
            class="tab-close"
            onclick={(e) => handleTabClose(tab.id, e)}
            tabindex="-1"
            aria-label="Close"
          >
            <X size={12} strokeWidth={2} />
          </button>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .tab-bar {
    display: flex;
    background: #252526;
    flex-shrink: 0;
    height: 35px;
    overflow: hidden;
  }

  .tabs-container {
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .tabs-container::-webkit-scrollbar { height: 0; }

  .tab {
    display: flex;
    align-items: center;
    padding: 0 10px;
    min-width: 80px;
    max-width: 180px;
    height: 35px;
    background: #2d2d2d;
    border-right: 1px solid #252526;
    cursor: pointer;
    gap: 6px;
    user-select: none;
    position: relative;
    flex-shrink: 0;
    transition: background 0.08s;
    border-top: 1px solid transparent;
    border-top-width: 1px;
    border-top-style: solid;
    border-top-color: transparent;
    border-bottom: 1px solid transparent;
  }

  .tab:hover {
    background: #2a2d2e;
  }

  .tab.active {
    background: #1e1e1e;
    border-top: 1px solid #0078d4;
    border-bottom: 1px solid #1e1e1e;
  }

  .tab-title {
    flex: 1;
    font-size: 13px;
    color: #969696;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    order: 0;
  }
  .tab.active .tab-title { color: #cccccc; }

  .dirty-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #cccccc;
    flex-shrink: 0;
    order: 1;
  }

  .tab-close {
    width: 20px; height: 20px;
    border: none;
    background: transparent;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center; justify-content: center;
    color: transparent;
    flex-shrink: 0;
    transition: all 0.08s;
    order: 1;
  }

  .tab:hover .tab-close { color: #969696; }
  .tab-close:hover {
    background: rgba(255,255,255,0.1);
    color: #cccccc !important;
  }

  /* Dirty state: show dot, hide close button */
  .tab.dirty .dirty-dot { display: inline-block; }
  .tab.dirty .tab-close { display: none; }
  .tab.dirty:hover .dirty-dot { display: none; }
  .tab.dirty:hover .tab-close { display: flex; }
</style>
