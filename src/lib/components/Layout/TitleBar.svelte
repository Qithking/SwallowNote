<script lang="ts">
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { setRootPath } from '../../stores/fileStore';
  import { FileText, Minus, Square, Copy, X } from 'lucide-svelte';
  import * as Menubar from '$lib/components/ui/menubar';

  let appWindow: Awaited<ReturnType<typeof import('@tauri-apps/api/window').getCurrentWindow>> | null = null;

  let isMaximized = $state(false);

  onMount(async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    appWindow = getCurrentWindow();
    isMaximized = await appWindow.isMaximized();
    appWindow.onResized(async () => {
      isMaximized = await appWindow!.isMaximized();
    });
  });

  async function handleMinimize() {
    if (!appWindow) return;
    await appWindow.minimize();
  }

  async function handleToggleMaximize() {
    if (!appWindow) return;
    await appWindow.toggleMaximize();
  }

  async function handleClose() {
    if (!appWindow) return;
    await appWindow.close();
  }

  async function handleStartDrag() {
    if (!appWindow) return;
    try {
      await appWindow.startDragging();
    } catch (err) {
      console.error('Failed to start dragging:', err);
    }
  }

  async function handleOpenFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Open Folder',
      });
      if (selected) {
        await setRootPath(selected as string);
      }
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  }

  function handleAction(action: () => void) {
    action();
  }

  function stopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="title-bar" role="toolbar" ondblclick={handleToggleMaximize} onmousedown={handleStartDrag}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="title-left" title="SwallowNote">

    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="app-icon" title="SwallowNote">
      <FileText size={16} strokeWidth={1.5} />
    </div>

    <!-- Menu items -->
    <Menubar.Root class="menubar-root">
      <Menubar.Menu>
        <Menubar.Trigger class="menu-trigger">文件</Menubar.Trigger>
        <Menubar.Content>
          <Menubar.Item onclick={handleOpenFolder}>
            打开文件夹
            <Menubar.Shortcut>Ctrl+K Ctrl+O</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Separator />
          <Menubar.Item onclick={() => handleAction(() => document.dispatchEvent(new Event('app:save')))}>
            保存
            <Menubar.Shortcut>Ctrl+S</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Item onclick={() => handleAction(() => document.dispatchEvent(new Event('app:save-all')))}>
            全部保存
            <Menubar.Shortcut>Ctrl+Shift+S</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Separator />
          <Menubar.Item onclick={() => handleAction(() => document.dispatchEvent(new Event('app:close-tab')))}>
            关闭编辑器
            <Menubar.Shortcut>Ctrl+W</Menubar.Shortcut>
          </Menubar.Item>
        </Menubar.Content>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger class="menu-trigger">编辑</Menubar.Trigger>
        <Menubar.Content>
          <Menubar.Item onclick={() => handleAction(() => document.execCommand('undo'))}>
            撤销
            <Menubar.Shortcut>Ctrl+Z</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Item onclick={() => handleAction(() => document.execCommand('redo'))}>
            重做
            <Menubar.Shortcut>Ctrl+Shift+Z</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Separator />
          <Menubar.Item onclick={() => handleAction(() => document.execCommand('cut'))}>
            剪切
            <Menubar.Shortcut>Ctrl+X</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Item onclick={() => handleAction(() => document.execCommand('copy'))}>
            复制
            <Menubar.Shortcut>Ctrl+C</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Item onclick={() => handleAction(() => document.execCommand('paste'))}>
            粘贴
            <Menubar.Shortcut>Ctrl+V</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Separator />
          <Menubar.Item onclick={() => handleAction(() => document.execCommand('findAll'))}>
            查找
            <Menubar.Shortcut>Ctrl+F</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Item onclick={() => handleAction(() => document.dispatchEvent(new Event('app:search')))}>
            快速打开文件
            <Menubar.Shortcut>Ctrl+P</Menubar.Shortcut>
          </Menubar.Item>
        </Menubar.Content>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger class="menu-trigger">视图</Menubar.Trigger>
        <Menubar.Content>
          <Menubar.Item onclick={() => handleAction(() => document.dispatchEvent(new Event('app:toggle-sidebar')))}>
            切换侧边栏
            <Menubar.Shortcut>Ctrl+B</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Item onclick={() => handleAction(() => document.dispatchEvent(new Event('app:search')))}>
            快速打开
            <Menubar.Shortcut>Ctrl+P</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Separator />
          <Menubar.Item onclick={() => handleAction(() => { document.body.style.zoom = String((parseFloat(document.body.style.zoom || '1') + 0.1)); })}>
            放大
            <Menubar.Shortcut>Ctrl++</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Item onclick={() => handleAction(() => { document.body.style.zoom = String((parseFloat(document.body.style.zoom || '1') - 0.1)); })}>
            缩小
            <Menubar.Shortcut>Ctrl+-</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Item onclick={() => handleAction(() => { document.body.style.zoom = '1'; })}>
            重置缩放
            <Menubar.Shortcut>Ctrl+0</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Separator />
          <Menubar.Item onclick={handleToggleMaximize}>
            {isMaximized ? '退出全屏' : '全屏'}
            <Menubar.Shortcut>F11</Menubar.Shortcut>
          </Menubar.Item>
        </Menubar.Content>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger class="menu-trigger">帮助</Menubar.Trigger>
        <Menubar.Content>
          <Menubar.Item onclick={() => handleAction(() => document.dispatchEvent(new Event('app:settings')))}>
            设置
            <Menubar.Shortcut>Ctrl+,</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Separator />
          <Menubar.Item onclick={() => handleAction(() => { window.open('https://github.com/swallownote', '_blank'); })}>
            关于 SwallowNote
          </Menubar.Item>
        </Menubar.Content>
      </Menubar.Menu>
    </Menubar.Root>
  </div>

  <div class="title-right" onmousedown={stopPropagation}>
    <button type="button" class="window-btn minimize" onclick={handleMinimize} title="最小化">
      <Minus size={10} strokeWidth={1.5} />
    </button>
    <button type="button" class="window-btn maximize" onclick={handleToggleMaximize} title={isMaximized ? '向下还原' : '最大化'}>
      {#if isMaximized}
        <Copy size={10} strokeWidth={1.5} />
      {:else}
        <Square size={10} strokeWidth={1.5} />
      {/if}
    </button>
    <button type="button" class="window-btn close" onclick={handleClose} title="关闭" aria-label="关闭">
      <X size={10} strokeWidth={1.5} />
    </button>
  </div>
</div>

<style>
  .title-bar {
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: 12px;
    user-select: none;
    flex-shrink: 0;
    cursor: default;
  }

  .title-left {
    display: flex;
    align-items: center;
    height: 100%;
  }

  .app-icon {
    -webkit-app-region: no-drag;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 100%;
  }

  /* Menubar root - explicitly non-draggable so clicks work */
  :global(.menubar-root) {
    -webkit-app-region: no-drag;
    height: 100%;
  }

  /* Menu trigger */
  :global(.menu-trigger) {
    font-size: 13px;
    -webkit-app-region: no-drag;
  }

  .title-center {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    color: var(--text-secondary);
    font-size: 11px;
    pointer-events: none;
    white-space: nowrap;
  }

  .title-right {
    display: flex;
    align-items: center;
    height: 100%;
    -webkit-app-region: no-drag;
  }

  .window-btn {
    width: 46px;
    height: 100%;
    border: none;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.1s, color 0.1s;
  }

  .window-btn:hover {
    background: rgba(255,255,255,0.1);
  }

  .window-btn.close:hover {
    background: #e81123;
    color: #ffffff;
  }
</style>
