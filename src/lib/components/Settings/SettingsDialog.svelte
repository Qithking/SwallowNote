<script lang="ts">
  import { currentLang, setLanguage } from '../../stores/i18n';
  import { get } from 'svelte/store';
  import { X } from 'lucide-svelte';

  let { onclose }: { onclose: () => void } = $props();

  let currentLangValue = $state(get(currentLang));

  $effect(() => { currentLangValue = get(currentLang); });

  function handleLangChange(e: Event) {
    setLanguage((e.target as HTMLSelectElement).value);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="settings-overlay" onclick={onclose} role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="settings-dialog" onclick={(e) => e.stopPropagation()} role="document">
    <div class="settings-header">
      <h2>设置</h2>
      <button class="close-btn" onclick={onclose} type="button" aria-label="关闭设置">
        <X size={16} strokeWidth={2} />
      </button>
    </div>
    <div class="settings-body">
      <div class="setting-section">
        <div class="setting-label">语言 / Language</div>
        <div class="setting-row">
          <select
            value={currentLangValue}
            onchange={handleLangChange}
          >
            <option value="zh-CN">中文 (简体)</option>
            <option value="en-US">English</option>
          </select>
        </div>
      </div>
      <div class="setting-section">
        <div class="setting-label">关于</div>
        <div class="setting-row about">
          <span class="about-name">SwallowNote</span>
          <span class="about-version">v0.1.0</span>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .settings-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }

  .settings-dialog {
    width: 420px;
    background: #2d2d2d;
    border: 1px solid #454545;
    box-shadow: 0 8px 30px rgba(0,0,0,0.6);
    overflow: hidden;
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  .settings-header h2 { font-size: 13px; font-weight: 600; color: #cccccc; }

  .close-btn {
    width: 28px; height: 28px;
    border: none; background: transparent;
    border-radius: 4px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: #6e6e6e;
    transition: all 0.1s;
  }

  .close-btn:hover { background: rgba(255,255,255,0.1); color: #cccccc; }

  .settings-body { padding: 8px 0; }

  .setting-section {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  .setting-section:last-child { border-bottom: none; }

  .setting-label {
    font-size: 11px; font-weight: 600;
    color: #969696;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .setting-row select {
    width: 100%;
    padding: 5px 8px;
    border: 1px solid var(--border);
    font-size: 13px;
    color: #cccccc;
    background: #3c3c3c;
    cursor: pointer;
    outline: none;
  }

  .setting-row select:focus { border-color: #0078d4; }

  .about {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .about-name { font-size: 13px; color: #cccccc; }
  .about-version { font-size: 12px; color: #6e6e6e; font-family: var(--font-mono); }
</style>
