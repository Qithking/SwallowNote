<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { tabs, activeTabId, closeTab, saveTab, selectNodeByPath } from '../../stores/fileStore';
  import { get } from 'svelte/store';
  import { X, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

  let tabsContainer: HTMLDivElement;

  function handleTabClick(tabId: string) {
    const currentTabs = get(tabs);
    const clickedTab = currentTabs.find(t => t.id === tabId);
    const updatedTabs = currentTabs.map(t => ({ ...t, active: t.id === tabId }));
    tabs.set(updatedTabs);
    activeTabId.set(tabId);
    // Select the corresponding file in the file tree
    if (clickedTab?.fileId) {
      selectNodeByPath(clickedTab.fileId);
    }
  }

  async function handleTabClose(tabId: string, event: Event) {
    event.stopPropagation();
    event.preventDefault();
    const tab = get(tabs).find(t => t.id === tabId);
    if (tab?.dirty) {
      try {
        await saveTab(tabId);
      } catch (e) {
        console.error('Save failed:', e);
        return;
      }
    }
    closeTab(tabId);
  }

  function handleMiddleClick(tabId: string, event: MouseEvent) {
    if (event.button === 1) handleTabClose(tabId, event);
  }

  // 响应式获取 tabs
  const tabsList = $derived($tabs);

  // 检查是否有溢出需要滚动
  let hasOverflow = $state(false);
  let canScrollLeft = $state(false);
  let canScrollRight = $state(false);

  async function updateScrollState() {
    await tick(); // 等待 DOM 更新
    if (!tabsContainer) return;
    const sl = tabsContainer.scrollLeft;
    const sw = tabsContainer.scrollWidth;
    const cw = tabsContainer.clientWidth;
    canScrollLeft = sl > 0;
    canScrollRight = sl < sw - cw - 1;
    hasOverflow = sw > cw;
  }

  function scrollLeft() {
    if (!tabsContainer) return;
    tabsContainer.scrollBy({ left: -200, behavior: 'smooth' });
    setTimeout(updateScrollState, 250);
  }

  function scrollRight() {
    if (!tabsContainer) return;
    tabsContainer.scrollBy({ left: 200, behavior: 'smooth' });
    setTimeout(updateScrollState, 250);
  }

  function handleScroll() {
    updateScrollState();
  }

  // 监听 tabs 变化，更新滚动状态
  $effect(() => {
    if (tabsList && tabsContainer) {
      updateScrollState();
    }
  });

  // 初始化时也更新一次
  onMount(() => {
    setTimeout(updateScrollState, 100);
  });
</script>

<div class="tab-bar">
  {#if hasOverflow}
    <button class="scroll-btn left visible" onclick={scrollLeft} title="向左滚动">
      <ChevronLeft size={16} strokeWidth={2} />
    </button>
  {/if}

  <div
    class="tabs-container"
    bind:this={tabsContainer}
    onscroll={handleScroll}
  >
    {#each tabsList as tab (tab.id)}
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
        {/if}
        <button
          class="tab-close"
          onclick={(e) => handleTabClose(tab.id, e)}
          tabindex="-1"
          aria-label="Close"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    {/each}
  </div>

  {#if hasOverflow}
    <button class="scroll-btn right visible" onclick={scrollRight} title="向右滚动">
      <ChevronRight size={16} strokeWidth={2} />
    </button>

    <DropdownMenu.Root>
      <DropdownMenu.Trigger class="more-btn" type="button">
        <MoreHorizontal size={16} strokeWidth={2} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {#each tabsList as tab (tab.id)}
          <DropdownMenu.Item onclick={() => handleTabClick(tab.id)}>
            <span class="more-menu-title">{tab.title}</span>
            {#if tab.dirty}
              <span class="dirty-dot"></span>
            {/if}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/if}
</div>

<style>
  .tab-bar {
    display: flex;
    background: var(--tab-bg);
    flex-shrink: 0;
    height: 35px;
    overflow: hidden;
    position: relative;
    z-index: 100;
  }

  .tabs-container {
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
    flex: 1;
  }
  .tabs-container::-webkit-scrollbar { height: 0; }

  .scroll-btn {
    width: 28px;
    height: 35px;
    border: none;
    background: var(--tab-bg);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    flex-shrink: 0;
    border-right: 1px solid var(--tab-border);
    transition: background 0.1s, color 0.1s, opacity 0.15s;
    opacity: 0;
    pointer-events: none;
  }
  .scroll-btn.visible {
    opacity: 1;
    pointer-events: auto;
  }
  .scroll-btn:hover:not(:disabled) {
    background: var(--tab-hover-bg);
    color: var(--text-primary);
  }
  .scroll-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .scroll-btn.left {
    border-left: 1px solid var(--tab-border);
    border-right: none;
  }

  :global(.more-btn) {
    width: 28px;
    height: 35px;
    border: none;
    background: var(--tab-bg);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    flex-shrink: 0;
    opacity: 1;
    pointer-events: auto;
    border-left: 1px solid var(--tab-border);
    border-right: none;
  }
  :global(.more-btn:hover) {
    background: var(--tab-hover-bg);
    color: var(--text-primary);
  }

  :global(.more-menu-title) {
    flex: 1;
    font-size: 13px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab {
    display: flex;
    align-items: center;
    padding: 0 10px;
    min-width: 80px;
    max-width: 180px;
    height: 35px;
    background: var(--tab-bg);
    border-right: 1px solid var(--tab-border);
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
    background: var(--tab-hover-bg);
  }

  .tab.active {
    background: var(--tab-active-bg);
    border-top: 1px solid var(--tab-activeBorderTop);
    border-bottom: 1px solid var(--tab-activeBorder);
  }

  .tab-title {
    flex: 1;
    font-size: 13px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    order: 0;
  }
  .tab.active .tab-title { color: var(--text-primary); }

  .dirty-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--text-secondary);
    flex-shrink: 0;
    order: 1;
  }

  .tab-close {
    width: 22px; height: 22px;
    border: none;
    background: transparent;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center; justify-content: center;
    color: var(--text-muted);
    flex-shrink: 0;
    transition: background 0.1s, color 0.1s;
    order: 1;
    margin-left: auto;
  }

  .tab:hover .tab-close { color: var(--text-primary); }
  .tab-close:hover {
    background: rgba(255,255,255,0.15);
  }

  /* Dirty state: show dot */
  .tab.dirty .dirty-dot { display: inline-block; }
</style>