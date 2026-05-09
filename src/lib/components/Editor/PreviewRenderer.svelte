<script lang="ts">
  import { onMount } from 'svelte';
  import { FileText, FileCode } from 'lucide-svelte';
  import { defaultValueCtx, Editor, rootCtx, editorViewCtx } from '@milkdown/kit/core';
  import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
  import { history } from '@milkdown/kit/plugin/history';
  import { indent } from '@milkdown/kit/plugin/indent';
  import { trailing } from '@milkdown/kit/plugin/trailing';
  import { clipboard } from '@milkdown/kit/plugin/clipboard';
  import { upload } from '@milkdown/kit/plugin/upload';
  import { commonmark } from '@milkdown/kit/preset/commonmark';
  import { gfm } from '@milkdown/kit/preset/gfm';
  import { codeBlockComponent, codeBlockConfig } from '@milkdown/kit/component/code-block';
  import { languages } from '@codemirror/language-data';
  import { basicSetup } from 'codemirror';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { defaultKeymap } from '@codemirror/commands';
  import { keymap } from '@codemirror/view';
  import { activeTabId, updateTabContent } from '../../stores/fileStore';
  import { get } from 'svelte/store';
  // @ts-ignore
  import '@milkdown/kit/prose/view/style/prosemirror.css';

  let { content = '', scrollSync = false, isMarkdown = false } = $props();

  let editorInstance: any = null;
  let lastSyncedContent = '';

  // Slash menu state
  let slashMenuVisible = $state(false);
  let slashMenuX = $state(0);
  let slashMenuY = $state(0);
  let slashFilter = $state('');
  let slashSelectedIndex = $state(0);

  // Toolbar state
  let toolbarVisible = $state(false);
  let toolbarX = $state(0);
  let toolbarY = $state(0);

  const slashCommands = [
    { id: 'paragraph', label: 'Text', icon: 'T', desc: 'Plain text' },
    { id: 'h1', label: 'Heading 1', icon: 'H1', desc: 'Big heading' },
    { id: 'h2', label: 'Heading 2', icon: 'H2', desc: 'Medium heading' },
    { id: 'h3', label: 'Heading 3', icon: 'H3', desc: 'Small heading' },
    { id: 'bullet-list', label: 'Bullet List', icon: '•', desc: 'Unordered list' },
    { id: 'ordered-list', label: 'Numbered List', icon: '1.', desc: 'Ordered list' },
    { id: 'code-block', label: 'Code Block', icon: '</>', desc: 'Code block' },
    { id: 'blockquote', label: 'Quote', icon: '"', desc: 'Block quote' },
    { id: 'divider', label: 'Divider', icon: '—', desc: 'Horizontal rule' },
  ];

  const toolbarActions = [
    { id: 'bold', label: 'B', icon: 'B', command: 'toggleBold' },
    { id: 'italic', label: 'I', icon: 'I', command: 'toggleItalic' },
    { id: 'strike', label: 'S', icon: 'S', command: 'toggleStrike' },
    { id: 'code', label: '`', icon: '`', command: 'toggleCode' },
  ];

  let filteredCommands = $derived(
    slashCommands.filter((cmd) =>
      cmd.label.toLowerCase().includes(slashFilter.toLowerCase())
    )
  );

  function showSlashMenu() {
    if (!editorInstance) return;
    try {
      const view = editorInstance.action((ctx: any) => ctx.get(editorViewCtx));
      if (!view) return;
      const { from } = view.state.selection;
      const coords = view.coordsAtPos(from);
      slashMenuX = coords.left;
      slashMenuY = coords.bottom + 8;
      slashMenuVisible = true;
      slashFilter = '';
      slashSelectedIndex = 0;
    } catch (e) {
      // ignore
    }
  }

  function hideSlashMenu() {
    slashMenuVisible = false;
    slashFilter = '';
    slashSelectedIndex = 0;
  }

  function showToolbar() {
    if (!editorInstance) return;
    try {
      const view = editorInstance.action((ctx: any) => ctx.get(editorViewCtx));
      if (!view) return;
      const { from, to } = view.state.selection;
      if (from === to) {
        hideToolbar();
        return;
      }
      const coords = view.coordsAtPos(from);
      toolbarX = coords.left;
      toolbarY = coords.top - 44;
      toolbarVisible = true;
    } catch (e) {
      // ignore
    }
  }

  function hideToolbar() {
    toolbarVisible = false;
  }

  function executeToolbarAction(action: typeof toolbarActions[0]) {
    if (!editorInstance) return;
    try {
      const view = editorInstance.action((ctx: any) => ctx.get(editorViewCtx));
      if (!view) return;
      // Apply heading 1 command
      const command = view.state.schema.commands[action.command];
      if (command) {
        view.dispatch(view.state.tr.call(command));
      }
    } catch (e) {
      // ignore
    }
    hideToolbar();
    editorInstance.action((ctx: any) => ctx.get(editorViewCtx))?.focus();
  }

  function executeSlashCommand(cmd: typeof slashCommands[0]) {
    if (!editorInstance) return;
    try {
      const view = editorInstance.action((ctx: any) => ctx.get(editorViewCtx));
      if (!view) return;

      const deleteFrom = view.state.selection.from - (slashFilter.length + 1);
      view.dispatch(view.state.tr.delete(deleteFrom, view.state.selection.from));

      switch (cmd.id) {
        case 'paragraph':
          view.dispatch(view.state.tr.setBlockType(view.state.selection.from, view.state.selection.to, view.state.schema.nodes.paragraph));
          break;
        case 'h1':
          view.dispatch(view.state.tr.setBlockType(view.state.selection.from, view.state.selection.to, view.state.schema.nodes.heading, { level: 1 }));
          break;
        case 'h2':
          view.dispatch(view.state.tr.setBlockType(view.state.selection.from, view.state.selection.to, view.state.schema.nodes.heading, { level: 2 }));
          break;
        case 'h3':
          view.dispatch(view.state.tr.setBlockType(view.state.selection.from, view.state.selection.to, view.state.schema.nodes.heading, { level: 3 }));
          break;
        case 'code-block':
          view.dispatch(view.state.tr.setBlockType(view.state.selection.from, view.state.selection.to, view.state.schema.nodes.code_block));
          break;
        case 'blockquote':
          view.dispatch(view.state.tr.setBlockType(view.state.selection.from, view.state.selection.to, view.state.schema.nodes.paragraph));
          view.dispatch(view.state.tr.wrapIn(view.state.schema.nodes.blockquote));
          break;
        case 'bullet-list':
          view.dispatch(view.state.tr.wrapIn(view.state.schema.nodes.bullet_list));
          break;
        case 'ordered-list':
          view.dispatch(view.state.tr.wrapIn(view.state.schema.nodes.ordered_list));
          break;
        case 'divider':
          view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.horizontal_rule.create()));
          break;
      }
    } catch (e) {
      console.warn('Slash command failed:', e);
    }
    hideSlashMenu();
    editorInstance.action((ctx: any) => ctx.get(editorViewCtx))?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (slashMenuVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        slashSelectedIndex = (slashSelectedIndex + 1) % filteredCommands.length;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        slashSelectedIndex = (slashSelectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[slashSelectedIndex]) {
          executeSlashCommand(filteredCommands[slashSelectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideSlashMenu();
      }
    }
    if (toolbarVisible && e.key === 'Escape') {
      e.preventDefault();
      hideToolbar();
    }
  }

  async function initMilkdown(markdownContent: string) {
    if (!isMarkdown) return;

    if (editorInstance) {
      editorInstance.destroy();
      editorInstance = null;
    }

    lastSyncedContent = markdownContent;

    editorInstance = await Editor.make()
      .config((ctx: any) => {
        ctx.set(rootCtx, '#milkdown-editor');
        ctx.set(defaultValueCtx, markdownContent);
        ctx.update(codeBlockConfig.key, (defaultConfig: any) => ({
          ...defaultConfig,
          languages,
          extensions: [basicSetup, oneDark, keymap.of(defaultKeymap)],
          renderLanguage: (language: string, selected: boolean) =>
            selected ? `✔ ${language}` : language,
        }));
        ctx.get(listenerCtx).markdownUpdated((_ctx: any, markdown: string) => {
          if (markdown !== lastSyncedContent) {
            lastSyncedContent = markdown;
            const tabId = get(activeTabId);
            if (tabId) {
              updateTabContent(tabId, markdown);
            }
          }
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(indent)
      .use(trailing)
      .use(clipboard)
      .use(upload)
      .use(codeBlockComponent)
      .use(listener)
      .create();

    const editorDom = document.querySelector('#milkdown-editor .ProseMirror');
    if (editorDom) {
      editorDom.addEventListener('keydown', handleKeydown as EventListener);

      editorDom.addEventListener('input', () => {
        if (!editorInstance) return;
        try {
          const view = editorInstance.action((ctx: any) => ctx.get(editorViewCtx));
          if (!view) return;
          const { from } = view.state.selection;
          const textBefore = view.state.doc.textBetween(
            Math.max(0, from - 20),
            from,
            '\n'
          );
          const slashMatch = textBefore.match(/\/([^\s]*)$/);
          if (slashMatch) {
            slashFilter = slashMatch[1];
            showSlashMenu();
          } else {
            if (slashMenuVisible) hideSlashMenu();
          }
        } catch (e) {
          // ignore
        }
      });

      // Selection change for toolbar
      editorDom.addEventListener('mouseup', (_e: Event) => {
        setTimeout(() => showToolbar(), 0);
      });
    }
  }

  // 响应式处理内容变化
  $effect(() => {
    const currentContent = content;
    const isMd = isMarkdown;
    if (currentContent && isMd) {
      if (currentContent === lastSyncedContent && editorInstance) return;
      initMilkdown(currentContent);
    }
  });

  // 清理编辑器实例
  onMount(() => {
    return () => {
      if (editorInstance) {
        editorInstance.destroy();
        editorInstance = null;
      }
    };
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="preview-renderer" class:scroll-sync={scrollSync}>
  <div class="preview-content">
    {#if !isMarkdown}
      <div class="non-markdown-preview">
        <FileCode size={28} strokeWidth={1} opacity={0.4} />
        <p>该文件不支持预览</p>
        <span class="hint">仅 Markdown 文件支持预览</span>
      </div>
    {:else if isMarkdown}
      <div id="milkdown-editor"></div>
    {:else}
      <div class="empty-preview">
        <FileText size={28} strokeWidth={1} opacity={0.4} />
        <p>打开 Markdown 文件查看预览</p>
      </div>
    {/if}
  </div>
</div>

{#if slashMenuVisible && filteredCommands.length > 0}
  <div
    class="slash-menu"
    style="left: {slashMenuX}px; top: {slashMenuY}px;"
    role="listbox"
  >
    <div class="slash-menu-list">
      {#each filteredCommands as cmd, idx}
        <div
          class="slash-menu-item"
          class:active={idx === slashSelectedIndex}
          role="option"
          aria-selected={idx === slashSelectedIndex}
          tabindex="0"
          onclick={() => executeSlashCommand(cmd)}
          onmouseenter={() => (slashSelectedIndex = idx)}
          onkeydown={(e) => e.key === 'Enter' && executeSlashCommand(cmd)}
        >
          <span class="slash-icon">{cmd.icon}</span>
          <span class="slash-label">{cmd.label}</span>
          <span class="slash-desc">{cmd.desc}</span>
        </div>
      {/each}
    </div>
  </div>
{/if}

{#if toolbarVisible}
  <div
    class="toolbar"
    style="left: {toolbarX}px; top: {toolbarY}px;"
  >
    {#each toolbarActions as action}
      <button class="toolbar-btn" onclick={() => executeToolbarAction(action)}>
        <span class="toolbar-icon" style:font-weight={action.id === 'bold' ? '700' : '400'} style:font-style={action.id === 'italic' ? 'italic' : 'normal'} style:text-decoration={action.id === 'strike' ? 'line-through' : 'none'} style:font-family={action.id === 'code' ? 'monospace' : 'inherit'}>{action.icon}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .preview-renderer {
    height: 100%;
    overflow: auto;
    background: var(--bg-primary);
  }

  .preview-content {
    padding: 32px 40px;
    max-width: 780px;
    margin: 0 auto;
  }

  .empty-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
    font-size: 13px;
    gap: 10px;
    opacity: 0.6;
  }

  .non-markdown-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
    font-size: 13px;
    gap: 10px;
    opacity: 0.6;
  }

  .non-markdown-preview .hint {
    font-size: 11px;
    opacity: 0.6;
  }

  #milkdown-editor {
    height: 100%;
    overflow: auto;
    padding: 32px 40px;
    max-width: 780px;
    margin: 0 auto;
    box-sizing: border-box;
  }

  #milkdown-editor :global(.milkdown) {
    min-height: 100%;
  }

  #milkdown-editor :global(.ProseMirror) {
    min-height: 100%;
    outline: none;
  }

  #milkdown-editor :global(.ProseMirror p) { margin: 0.8em 0; }
  #milkdown-editor :global(.ProseMirror h1) {
    font-size: 2em; margin: 0.8em 0 0.5em;
    border-bottom: 1px solid var(--border); padding-bottom: 0.3em; font-weight: 500;
  }
  #milkdown-editor :global(.ProseMirror h2) {
    font-size: 1.5em; margin: 0.8em 0 0.5em;
    border-bottom: 1px solid var(--border); padding-bottom: 0.2em; font-weight: 500;
  }
  #milkdown-editor :global(.ProseMirror h3) {
    font-size: 1.17em; margin: 1em 0 0.5em; font-weight: 500;
  }
  #milkdown-editor :global(.ProseMirror code) {
    background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 3px;
    font-family: var(--font-mono); color: #ce9178; font-size: 0.9em;
  }
  #milkdown-editor :global(.ProseMirror pre) {
    background: #1a1a1a; padding: 16px; border-radius: 6px;
    overflow-x: auto; margin: 1em 0; border: 1px solid var(--border);
  }
  #milkdown-editor :global(.ProseMirror pre code) {
    background: none; padding: 0; font-size: 13px; color: #d4d4d4; line-height: 1.5;
  }
  #milkdown-editor :global(.ProseMirror blockquote) {
    margin: 1em 0; padding: 0.5em 1.2em;
    border-left: 3px solid #0078d4; background: rgba(255,255,255,0.03); color: #969696;
  }
  #milkdown-editor :global(.ProseMirror ul),
  #milkdown-editor :global(.ProseMirror ol) { margin: 0.8em 0; padding-left: 2em; }
  #milkdown-editor :global(.ProseMirror li) { margin: 0.3em 0; }
  #milkdown-editor :global(.ProseMirror hr) { border: none; border-top: 1px solid var(--border); margin: 2em 0; }

  /* Slash Menu */
  .slash-menu {
    position: fixed;
    z-index: 10000;
    background: var(--bg-secondary, #2d2d2d);
    border: 1px solid var(--border, #404040);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    min-width: 260px;
    max-height: 320px;
    overflow-y: auto;
    padding: 4px;
  }

  .slash-menu-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .slash-menu-item:hover,
  .slash-menu-item.active {
    background: var(--bg-hover, rgba(255,255,255,0.08));
  }

  .slash-icon {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary, #1e1e1e);
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #fff);
    border: 1px solid var(--border, #404040);
    flex-shrink: 0;
  }

  .slash-label {
    font-size: 14px;
    color: var(--text-primary, #fff);
    flex: 1;
  }

  .slash-desc {
    font-size: 12px;
    color: var(--text-muted, #888);
  }

  /* Toolbar */
  .toolbar {
    position: fixed;
    z-index: 10000;
    display: flex;
    gap: 2px;
    background: var(--bg-secondary, #2d2d2d);
    border: 1px solid var(--border, #404040);
    border-radius: 6px;
    padding: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .toolbar-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text-primary, #fff);
    transition: background 0.1s;
  }

  .toolbar-btn:hover {
    background: var(--bg-hover, rgba(255,255,255,0.1));
  }

  .toolbar-icon {
    font-size: 14px;
    line-height: 1;
  }
</style>
