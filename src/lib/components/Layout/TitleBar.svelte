<script lang="ts">
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { setRootPath } from '../../stores/fileStore';

  let appWindow: Awaited<ReturnType<typeof import('@tauri-apps/api/window').getCurrentWindow>> | null = null;

  let isMaximized = $state(false);
  let openMenu = $state<string | null>(null);

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

  function toggleMenu(menu: string) {
    openMenu = openMenu === menu ? null : menu;
  }

  function closeMenu() {
    openMenu = null;
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
    closeMenu();
  }

  function stopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }

  function handleAction(action: () => void) {
    return (e: MouseEvent) => {
      e.stopPropagation();
      action();
      closeMenu();
    };
  }
</script>

<svelte:window onclick={closeMenu} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="title-bar" role="toolbar" ondblclick={handleToggleMaximize}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="title-left drag-region" onmousedown={handleStartDrag}>
    <!-- App icon -->
    <div class="app-icon" title="SwallowNote">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    </div>

    <!-- Menu items -->
    <nav class="menu-bar">
      <div class="menu-item" class:active={openMenu === 'file'}>
        <button type="button" class="menu-btn" onclick={() => toggleMenu('file')}>文件</button>
        {#if openMenu === 'file'}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="menu-dropdown" onclick={stopPropagation}>
            <button type="button" class="menu-action" onclick={handleOpenFolder}>
              <span>打开文件夹</span>
              <span class="menu-shortcut">Ctrl+K Ctrl+O</span>
            </button>
            <div class="menu-separator"></div>
            <button type="button" class="menu-action" onclick={handleAction(() => document.dispatchEvent(new Event('app:save')))}>
              <span>保存</span>
              <span class="menu-shortcut">Ctrl+S</span>
            </button>
            <button type="button" class="menu-action" onclick={handleAction(() => document.dispatchEvent(new Event('app:save-all')))}>
              <span>全部保存</span>
              <span class="menu-shortcut">Ctrl+Shift+S</span>
            </button>
            <div class="menu-separator"></div>
            <button type="button" class="menu-action" onclick={handleAction(() => document.dispatchEvent(new Event('app:close-tab')))}>
              <span>关闭编辑器</span>
              <span class="menu-shortcut">Ctrl+W</span>
            </button>
          </div>
        {/if}
      </div>

      <div class="menu-item" class:active={openMenu === 'edit'}>
        <button type="button" class="menu-btn" onclick={() => toggleMenu('edit')}>编辑</button>
        {#if openMenu === 'edit'}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="menu-dropdown" onclick={stopPropagation}>
            <button type="button" class="menu-action" onclick={handleAction(() => document.execCommand('undo'))}>
              <span>撤销</span>
              <span class="menu-shortcut">Ctrl+Z</span>
            </button>
            <button type="button" class="menu-action" onclick={handleAction(() => document.execCommand('redo'))}>
              <span>重做</span>
              <span class="menu-shortcut">Ctrl+Shift+Z</span>
            </button>
            <div class="menu-separator"></div>
            <button type="button" class="menu-action" onclick={handleAction(() => document.execCommand('cut'))}>
              <span>剪切</span>
              <span class="menu-shortcut">Ctrl+X</span>
            </button>
            <button type="button" class="menu-action" onclick={handleAction(() => document.execCommand('copy'))}>
              <span>复制</span>
              <span class="menu-shortcut">Ctrl+C</span>
            </button>
            <button type="button" class="menu-action" onclick={handleAction(() => document.execCommand('paste'))}>
              <span>粘贴</span>
              <span class="menu-shortcut">Ctrl+V</span>
            </button>
            <div class="menu-separator"></div>
            <button type="button" class="menu-action" onclick={handleAction(() => document.execCommand('findAll'))}>
              <span>查找</span>
              <span class="menu-shortcut">Ctrl+F</span>
            </button>
            <button type="button" class="menu-action" onclick={handleAction(() => document.dispatchEvent(new Event('app:search')))}>
              <span>快速打开文件</span>
              <span class="menu-shortcut">Ctrl+P</span>
            </button>
          </div>
        {/if}
      </div>

      <div class="menu-item" class:active={openMenu === 'view'}>
        <button type="button" class="menu-btn" onclick={() => toggleMenu('view')}>视图</button>
        {#if openMenu === 'view'}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="menu-dropdown" onclick={stopPropagation}>
            <button type="button" class="menu-action" onclick={handleAction(() => document.dispatchEvent(new Event('app:toggle-sidebar')))}>
              <span>切换侧边栏</span>
              <span class="menu-shortcut">Ctrl+B</span>
            </button>
            <button type="button" class="menu-action" onclick={handleAction(() => document.dispatchEvent(new Event('app:search')))}>
              <span>快速打开</span>
              <span class="menu-shortcut">Ctrl+P</span>
            </button>
            <div class="menu-separator"></div>
            <button type="button" class="menu-action" onclick={handleAction(() => { document.body.style.zoom = String((parseFloat(document.body.style.zoom || '1') + 0.1)); })}>
              <span>放大</span>
              <span class="menu-shortcut">Ctrl++</span>
            </button>
            <button type="button" class="menu-action" onclick={handleAction(() => { document.body.style.zoom = String((parseFloat(document.body.style.zoom || '1') - 0.1)); })}>
              <span>缩小</span>
              <span class="menu-shortcut">Ctrl+-</span>
            </button>
            <button type="button" class="menu-action" onclick={handleAction(() => { document.body.style.zoom = '1'; })}>
              <span>重置缩放</span>
              <span class="menu-shortcut">Ctrl+0</span>
            </button>
            <div class="menu-separator"></div>
            <button type="button" class="menu-action" onclick={handleToggleMaximize}>
              <span>{isMaximized ? '退出全屏' : '全屏'}</span>
              <span class="menu-shortcut">F11</span>
            </button>
          </div>
        {/if}
      </div>

      <div class="menu-item" class:active={openMenu === 'help'}>
        <button type="button" class="menu-btn" onclick={() => toggleMenu('help')}>帮助</button>
        {#if openMenu === 'help'}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="menu-dropdown" onclick={stopPropagation}>
            <button type="button" class="menu-action" onclick={handleAction(() => document.dispatchEvent(new Event('app:settings')))}>
              <span>设置</span>
              <span class="menu-shortcut">Ctrl+,</span>
            </button>
            <div class="menu-separator"></div>
            <button type="button" class="menu-action" onclick={handleAction(() => { window.open('https://github.com/swallownote', '_blank'); })}>
              <span>关于 SwallowNote</span>
            </button>
          </div>
        {/if}
      </div>
    </nav>
  </div>

  <div class="title-center drag-region">SwallowNote</div>

  <div class="title-right" onclick={stopPropagation}>
    <button type="button" class="window-btn minimize" onclick={handleMinimize} title="最小化">
      <svg width="10" height="10" viewBox="0 0 10 10">
        <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" stroke-width="1"/>
      </svg>
    </button>
    <button type="button" class="window-btn maximize" onclick={handleToggleMaximize} title={isMaximized ? '向下还原' : '最大化'}>
      {#if isMaximized}
        <!-- svelte-ignore a11y_missing_attribute -->
        <svg width="10" height="10" viewBox="0 0 10 10">
          <rect x="1.5" y="2.5" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1"/>
          <polyline points="3,2.5 3,1 9,1 9,7 7.5,7" fill="none" stroke="currentColor" stroke-width="1"/>
        </svg>
      {:else}
        <!-- svelte-ignore a11y_missing_attribute -->
        <svg width="10" height="10" viewBox="0 0 10 10">
          <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/>
        </svg>
      {/if}
    </button>
    <button type="button" class="window-btn close" onclick={handleClose} title="关闭" aria-label="关闭">
      <!-- svelte-ignore a11y_missing_attribute -->
      <svg width="10" height="10" viewBox="0 0 10 10">
        <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/>
        <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/>
      </svg>
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
    border-radius: 8px 8px 0 0;
  }

  .title-left {
    display: flex;
    align-items: center;
    height: 100%;
  }

  .drag-region {
    flex: 1;
    height: 100%;
    -webkit-app-region: drag;
    cursor: default;
  }

  .app-icon {
    width: 46px;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
  }

  .menu-bar {
    display: flex;
    align-items: center;
    height: 100%;
    gap: 0;
  }

  .menu-item {
    position: relative;
    height: 100%;
    display: flex;
    align-items: center;
  }

  .menu-btn {
    height: 100%;
    padding: 0 8px;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    transition: background 0.08s;
    font-family: inherit;
    -webkit-text-fill-color: var(--text-primary);
  }

  .menu-btn:hover,
  .menu-item.active .menu-btn {
    background: rgba(255,255,255,0.08);
  }

  .menu-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    min-width: 220px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 0;
    z-index: 1000;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  }

  .menu-action {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 20px;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    transition: background 0.08s;
  }

  .menu-action:hover {
    background: var(--accent);
    color: #ffffff;
  }

  .menu-action:hover .menu-shortcut {
    color: rgba(255,255,255,0.7);
  }

  .menu-shortcut {
    color: var(--text-secondary);
    font-size: 11px;
    margin-left: 24px;
    white-space: nowrap;
  }

  .menu-separator {
    height: 1px;
    background: var(--border);
    margin: 4px 8px;
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
