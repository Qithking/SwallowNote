<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView, basicSetup } from 'codemirror';
  import { markdown } from '@codemirror/lang-markdown';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { tabs, activeTabId, updateTabContent } from '../../stores/fileStore';
  import { theme } from '../../stores/theme';
  import { get } from 'svelte/store';

  let editorContainer: HTMLDivElement;
  let view: EditorView | null = null;

  function getThemeExtensions() {
    return get(theme) === 'dark' ? [oneDark] : [];
  }

  function createEditor(content: string) {
    return new EditorView({
      doc: content,
      extensions: [
        basicSetup,
        markdown(),
        ...getThemeExtensions(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const tabId = get(activeTabId);
            if (tabId) {
              const newContent = update.state.doc.toString();
              updateTabContent(tabId, newContent);
            }
          }
        }),
      ],
      parent: editorContainer,
    });
  }

  onMount(() => {
    if (!editorContainer) return;

    const currentTabId = get(activeTabId);
    const currentTabs = get(tabs);
    const tab = currentTabs.find(t => t.id === currentTabId);
    const initialContent = tab?.content || '';

    view = createEditor(initialContent);

    // 监听 theme store 变化，动态切换编辑器主题
    const unsubscribe = theme.subscribe(() => {
      if (!view) return;
      const content = view.state.doc.toString();
      const scrollTop = view.scrollDOM.scrollTop;
      view.destroy();
      view = createEditor(content);
      view.scrollDOM.scrollTop = scrollTop;
    });

    return () => {
      unsubscribe();
    };
  });

  // 响应式订阅 store 变化
  let currentTabId = $derived($activeTabId);
  let currentTabs = $derived($tabs);

  $effect(() => {
    if (!view) return;
    if (!currentTabId) return;
    const tab = currentTabs.find(t => t.id === currentTabId);
    if (!tab) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== tab.content) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: tab.content },
      });
    }
  });

  onMount(() => {
    return () => {
      if (view) { view.destroy(); view = null; }
    };
  });
</script>

<div class="editor-wrapper" bind:this={editorContainer}></div>

<style>
  .editor-wrapper { 
    height: 100%; 
    overflow: auto; 
    background: var(--bg-primary);
  }
</style>
