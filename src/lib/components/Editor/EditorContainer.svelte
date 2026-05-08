<script lang="ts">
  import SourceEditor from './SourceEditor.svelte';
  import PreviewRenderer from './PreviewRenderer.svelte';
  import { tabs, activeTabId } from '../../stores/fileStore';

  // 响应式获取当前 tab 的内容
  const currentTab = $derived.by(() => {
    const tabId = $activeTabId;
    if (!tabId) return null;
    return $tabs.find(t => t.id === tabId) || null;
  });

  const tabContent = $derived(currentTab?.content || '');
  const tabPath = $derived(currentTab?.fileId || '');
  const isMarkdown = $derived(tabPath.toLowerCase().endsWith('.md'));
</script>

<div class="editor-container">
  <div class="editor-main">
    {#if isMarkdown}
      <PreviewRenderer content={tabContent} isMarkdown={true} />
    {:else}
      <SourceEditor />
    {/if}
  </div>
</div>

<style>
  .editor-container {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .editor-main {
    flex: 1;
    overflow: hidden;
  }
</style>
