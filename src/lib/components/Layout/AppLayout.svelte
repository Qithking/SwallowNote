<script lang="ts">
  import { onMount } from 'svelte';
  import FileTree from '../FileTree/FileTree.svelte';
  import TabBar from '../Tabs/TabBar.svelte';
  import EditorContainer from '../Editor/EditorContainer.svelte';
  import FileSearch from '../Search/FileSearch.svelte';
  import SettingsDialog from '../Settings/SettingsDialog.svelte';
  import GitSidebar from '../Git/GitSidebar.svelte';
  import TitleBar from './TitleBar.svelte';
  import { tabs, activeTabId, setRootPath, saveTab, closeTab, nextTab, prevTab } from '../../stores/fileStore';
  import { isRepo, gitStatus, getTotalChanges } from '../../stores/gitStore';
  import { rootPath } from '../../stores/fileStore';
  import { t } from '../../stores/i18n';
  import { open } from '@tauri-apps/plugin-dialog';
  import { get } from 'svelte/store';

  onMount(() => {
    const handler = () => handleOpenFolder();
    document.addEventListener('app:open-folder', handler);
    return () => document.removeEventListener('app:open-folder', handler);
  });

  type ActivityView = 'explorer' | 'search' | 'git' | 'settings';

  let activeActivity = $state<ActivityView>('explorer');
  let showSearch = $state(false);
  let showSettings = $state(false);

  function setExplorer() { activeActivity = 'explorer'; }
  function openSearch() { showSearch = true; }
  function setGit() { activeActivity = 'git'; }
  function openSettings() { showSettings = true; }

  async function handleOpenFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Open Folder',
      });
      if (selected) {
        await setRootPath(selected as string);
        activeActivity = 'explorer';
      }
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  }

  async function handleSaveCurrent() {
    const tabId = get(activeTabId);
    if (tabId) {
      await saveTab(tabId);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 'p') {
      e.preventDefault();
      showSearch = true;
    }
    if (ctrl && e.key === 's') {
      e.preventDefault();
      handleSaveCurrent();
    }
    if (ctrl && e.key === 'b') {
      e.preventDefault();
      activeActivity = activeActivity === 'explorer' ? 'git' : 'explorer';
    }
    if (ctrl && e.key === 'w') {
      e.preventDefault();
      const tabId = get(activeTabId);
      if (tabId) closeTab(tabId);
    }
    if (ctrl && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      // Ctrl+Shift+T: restore closed tab - currently shows info, full restore needs stored content
      console.info('Ctrl+Shift+T: restore closed tab');
    }
    if (ctrl && e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) prevTab();
      else nextTab();
    }
    if (e.key === 'Escape') {
      showSearch = false;
      showSettings = false;
    }
  }

  const hasTabs = $derived($tabs.length > 0);
  const currentTab = $derived(
    hasTabs ? $tabs.find(t => t.id === $activeTabId) : null
  );

  const rootName = $derived($rootPath ? $rootPath.split('/').pop() || $rootPath : '');

  const gitRepo = $derived($isRepo);
  const gitBranch = $derived($gitStatus?.branch || '');
  const totalChanges = $derived(getTotalChanges());
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="app-layout">
  <!-- ===== Custom Title Bar ===== -->
  <TitleBar />

  <div class="layout-body">
    <!-- ===== Activity Bar ===== -->
    <nav class="activity-bar">
      <div class="activity-top">
        <button
          type="button"
          class="activity-btn"
          class:active={activeActivity === 'explorer'}
          onclick={setExplorer}
          title="资源管理器 (Ctrl+Shift+E)"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        <button
          type="button"
          class="activity-btn"
          class:active={showSearch}
          onclick={openSearch}
          title="搜索 (Ctrl+P)"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
        <button
          type="button"
          class="activity-btn"
          class:active={activeActivity === 'git'}
          onclick={setGit}
          title="源代码管理 (Ctrl+Shift+G)"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>
            <path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/>
          </svg>
        </button>
      </div>
      <div class="activity-bottom">
        <button
          type="button"
          class="activity-btn"
          onclick={handleOpenFolder}
          title="打开文件夹"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            <line x1="12" y1="11" x2="12" y2="17"/>
            <line x1="9" y1="14" x2="15" y2="14"/>
          </svg>
        </button>
        <button
          type="button"
          class="activity-btn"
          onclick={openSettings}
          title="设置 (Ctrl+,)"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </nav>

    <!-- ===== Sidebar ===== -->
    <aside class="sidebar">
      {#if activeActivity === 'git'}
        <GitSidebar />
      {:else}
        <FileTree />
      {/if}
    </aside>

    <!-- ===== Main Content ===== -->
    <main class="main-content">
      {#if hasTabs}
        <TabBar />
        <div class="editor-area">
          <EditorContainer />
        </div>
      {:else}
        <div class="empty-state">
          <div class="empty-state-content">
            <div class="empty-logo">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <h1 class="empty-title">SwallowNote</h1>
            <p class="empty-subtitle">{get(t)('welcome.subtitle')}</p>

            {#if !$rootPath}
              <div class="empty-actions">
                <button class="action-button primary" onclick={handleOpenFolder}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  {get(t)('welcome.openFolder')}
                </button>
              </div>
            {/if}

            <div class="shortcuts-section">
              <h3 class="shortcuts-title">键盘快捷键</h3>
              <div class="shortcuts-grid">
                <div class="shortcut-row">
                  <kbd>Ctrl</kbd><span>+</span><kbd>P</kbd>
                  <span class="shortcut-desc">快速搜索文件</span>
                </div>
                <div class="shortcut-row">
                  <kbd>Ctrl</kbd><span>+</span><kbd>S</kbd>
                  <span class="shortcut-desc">保存当前文件</span>
                </div>
                <div class="shortcut-row">
                  <kbd>Ctrl</kbd><span>+</span><kbd>Tab</kbd>
                  <span class="shortcut-desc">切换到下一个标签</span>
                </div>
                <div class="shortcut-row">
                  <kbd>Ctrl</kbd><span>+</span><kbd>Shift</kbd><span>+</span><kbd>Tab</kbd>
                  <span class="shortcut-desc">切换到上一个标签</span>
                </div>
                <div class="shortcut-row">
                  <kbd>Ctrl</kbd><span>+</span><kbd>W</kbd>
                  <span class="shortcut-desc">关闭当前标签</span>
                </div>
                <div class="shortcut-row">
                  <kbd>Ctrl</kbd><span>+</span><kbd>B</kbd>
                  <span class="shortcut-desc">切换侧边栏</span>
                </div>
                <div class="shortcut-row">
                  <kbd>Ctrl</kbd><span>+</span><kbd>+</kbd>
                  <span class="shortcut-desc">放大编辑器</span>
                </div>
                <div class="shortcut-row">
                  <kbd>Ctrl</kbd><span>+</span><kbd>-</kbd>
                  <span class="shortcut-desc">缩小编辑器</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </main>
  </div>

  <!-- ===== Status Bar ===== -->
  <footer class="status-bar">
    {#if $rootPath}
      <div class="status-left">
        {#if gitRepo && gitBranch}
          <span class="status-item git-item" title="Git 分支">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>
              <path d="M13 6h3a2 2 0 0 1 2 2v7"/>
              <line x1="6" y1="9" x2="6" y2="21"/>
            </svg>
            {gitBranch}
          </span>
          {#if totalChanges > 0}
            <span class="status-item changes-item" title="未提交的更改">
              {totalChanges} 个更改
            </span>
          {/if}
        {:else}
          <span class="status-item" title="当前仓库">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            {rootName}
          </span>
        {/if}
      </div>
      <div class="status-right">
          {#if currentTab}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span class="status-item clickable" onclick={handleSaveCurrent} title="保存 (Ctrl+S)" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && handleSaveCurrent()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>
            </svg>
            {currentTab.title}
          </span>
          <span class="status-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
            Markdown
          </span>
        {/if}
        <span class="status-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          UTF-8
        </span>
      </div>
    {/if}
  </footer>
</div>

{#if showSearch}
  <FileSearch onclose={() => { showSearch = false; }} />
{/if}

{#if showSettings}
  <SettingsDialog onclose={() => { showSettings = false; }} />
{/if}

<style>
  /* ==================== Layout ==================== */
  .app-layout {
    position: absolute;
    inset: 0;
    display: flex; flex-direction: column;
    overflow: hidden;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    background: var(--bg-primary);
  }
  .layout-body {
    flex: 1; display: flex;
    overflow: hidden; min-height: 0;
  }

  /* ==================== Activity Bar ==================== */
  .activity-bar {
    width: 48px; min-width: 48px;
    background: var(--activity-bg);
    display: flex; flex-direction: column;
    align-items: center;
    justify-content: space-between;
    padding: 0;
    flex-shrink: 0;
    position: relative;
  }
  /* subtle divider between activity bar and sidebar */
  .activity-bar::after {
    content: '';
    position: absolute;
    right: 0; top: 0; bottom: 0;
    width: 1px;
    background: var(--border-light);
  }

  .activity-top, .activity-bottom {
    display: flex; flex-direction: column;
    align-items: center; gap: 0;
  }

  .activity-btn {
    width: 48px; height: 48px;
    border: none;
    background: transparent;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: var(--activity-inactive);
    transition: color 0.1s;
    position: relative;
    flex-shrink: 0;
  }
  /* Left border on hover */
  .activity-btn:hover {
    color: var(--activity-foreground);
    background: rgba(255,255,255,0.04);
  }
  .activity-btn:hover::before {
    content: '';
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 2px;
    background: rgba(255,255,255,0.2);
  }

  /* Active state: white left border + white icon */
  .activity-btn.active {
    color: var(--activity-foreground);
  }
  .activity-btn.active::before {
    content: '';
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 2px;
    background: var(--activity-foreground);
  }

  /* ==================== Sidebar ==================== */
  .sidebar {
    width: 270px; min-width: 170px; max-width: 400px;
    resize: horizontal;
    overflow: hidden;
    display: flex; flex-direction: column;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    flex-shrink: 0;
  }

  /* ==================== Main Content ==================== */
  .main-content {
    flex: 1; display: flex; flex-direction: column;
    overflow: hidden; min-width: 0;
  }
  .editor-area { flex: 1; overflow: hidden; }

  /* ==================== Empty State ==================== */
  .empty-state {
    flex: 1; display: flex;
    align-items: center; justify-content: center;
    background: var(--bg-primary);
  }
  .empty-state-content {
    text-align: center; max-width: 360px;
  }
  .empty-logo {
    margin-bottom: 24px;
    opacity: 0.3;
  }
  .empty-title {
    font-size: 28px; font-weight: 300;
    color: var(--text-primary);
    margin-bottom: 8px;
    letter-spacing: -0.5px;
  }
  .empty-subtitle {
    font-size: 13px; color: var(--text-muted);
    margin-bottom: 28px;
  }
  .empty-actions { margin-bottom: 0; }

  .action-button {
    display: inline-flex; align-items: center;
    gap: 8px;
    padding: 8px 20px;
    border: none; border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.15s;
  }
  .action-button.primary {
    background: var(--accent);
    color: #fff;
  }
  .action-button.primary:hover {
    background: var(--accent-hover);
  }

  /* ==================== Shortcuts ==================== */
  .shortcuts-section {
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px solid var(--border);
    width: 100%;
  }

  .shortcuts-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 12px;
    margin-top: 0;
  }

  .shortcuts-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px 6px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    font-family: inherit;
    font-size: 11px;
    color: var(--text-primary);
    min-width: 24px;
    border: 1px solid var(--border);
  }

  .shortcut-desc {
    color: var(--text-muted);
    margin-left: 8px;
    flex: 1;
  }

  /* ==================== Status Bar ==================== */
  .status-bar {
    height: 22px; flex-shrink: 0;
    background: var(--status-bg);
    color: var(--status-fg);
    display: flex; align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    font-size: 12px;
    user-select: none;
    border-radius: 0 0 8px 8px;
  }
  .status-left, .status-right {
    display: flex; align-items: center; gap: 0;
  }
  .status-item {
    display: inline-flex; align-items: center;
    gap: 4px;
    padding: 0 6px;
    height: 22px;
    cursor: default;
    transition: background 0.1s;
  }
  .status-item:hover {
    background: rgba(255,255,255,0.12);
  }
  .status-item.clickable {
    cursor: pointer;
  }

  .git-item {
    color: #4ec9b0;
  }

  .changes-item {
    color: #e8ab4f;
  }

  :global([data-theme="dark"]) .git-item { color: #4ec9b0; }
  :global([data-theme="dark"]) .changes-item { color: #e8ab4f; }
  :global([data-theme="light"]) .git-item { color: #008000; }
  :global([data-theme="light"]) .changes-item { color: #a31515; }
</style>
