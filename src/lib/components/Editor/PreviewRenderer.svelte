<script lang="ts">
  import MarkdownIt from 'markdown-it';
  import { FileText } from 'lucide-svelte';

  let { content = '', scrollSync = false } = $props();

  const md = new MarkdownIt({
    html: true, linkify: true, typographer: true, breaks: true,
  });

  let previewHtml = $derived(md.render(content));
</script>

<div class="preview-renderer" class:scroll-sync={scrollSync}>
  <div class="preview-content">
    {#if content}
      <div class="markdown-body">{@html previewHtml}</div>
    {:else}
      <div class="empty-preview">
        <FileText size={28} strokeWidth={1} opacity={0.4} />
        <p>打开 Markdown 文件查看预览</p>
      </div>
    {/if}
  </div>
</div>

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

  .markdown-body {
    font-size: 15px;
    line-height: 1.8;
    color: #d4d4d4;
  }

  .markdown-body :global(h1) {
    font-size: 2em; margin: 0.8em 0 0.5em;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.3em;
    font-weight: 500;
    color: #e0e0e0;
  }
  .markdown-body :global(h2) {
    font-size: 1.5em; margin: 0.8em 0 0.5em;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.2em;
    font-weight: 500;
    color: #e0e0e0;
  }
  .markdown-body :global(h3) { font-size:1.17em; margin:1em 0 0.5em; font-weight:500; color:#d4d4d4; }
  .markdown-body :global(h4) { font-size:1em; margin:1.2em 0 0.5em; font-weight:500; color:#d4d4d4; }
  .markdown-body :global(p) { margin: 0.8em 0; }
  .markdown-body :global(ul), .markdown-body :global(ol) { margin:0.8em 0; padding-left:2em; }
  .markdown-body :global(li) { margin: 0.3em 0; }
  .markdown-body :global(blockquote) {
    margin:1em 0; padding:0.5em 1.2em;
    border-left:3px solid #0078d4;
    background: rgba(255,255,255,0.03);
    color: #969696;
  }
  .markdown-body :global(code) {
    background: rgba(255,255,255,0.06);
    padding:2px 6px; border-radius:3px;
    font-family: var(--font-mono);
    color: #ce9178; font-size:0.9em;
  }
  .markdown-body :global(pre) {
    background: #1a1a1a; padding:16px;
    border-radius:6px; overflow-x:auto;
    margin:1em 0; border:1px solid var(--border);
  }
  .markdown-body :global(pre code) { background:none; padding:0; font-size:13px; color:#d4d4d4; line-height:1.5; }
  .markdown-body :global(table) { border-collapse:collapse; margin:1em 0; width:100%; font-size:14px; }
  .markdown-body :global(th), .markdown-body :global(td) { border:1px solid var(--border); padding:8px 12px; text-align:left; }
  .markdown-body :global(th) { background:rgba(255,255,255,0.04); font-weight:600; color:#d4d4d4; }
  .markdown-body :global(tr:nth-child(even)) { background:rgba(255,255,255,0.02); }
  .markdown-body :global(img) { max-width:100%; height:auto; border-radius:4px; }
  .markdown-body :global(a) { color:#4fc1ff; text-decoration:none; }
  .markdown-body :global(a:hover) { text-decoration:underline; }
  .markdown-body :global(hr) { border:none; border-top:1px solid var(--border); margin:2em 0; }
  .markdown-body :global(strong) { font-weight:500; color:#e0e0e0; }
  .markdown-body :global(em) { color:#c586c0; }
  .markdown-body :global(del) { color:#6e6e6e; }

  /* ===========================================================
     Dark theme overrides
     =========================================================== */
  :global([data-theme="dark"]) .preview-renderer { background: #1e1e1e; }
  :global([data-theme="dark"]) .markdown-body { color: #d4d4d4; }
  :global([data-theme="dark"]) .markdown-body :global(h1),
  :global([data-theme="dark"]) .markdown-body :global(h2),
  :global([data-theme="dark"]) .markdown-body :global(h3),
  :global([data-theme="dark"]) .markdown-body :global(h4),
  :global([data-theme="dark"]) .markdown-body :global(strong) { color: #e0e0e0; }
  :global([data-theme="dark"]) .markdown-body :global(blockquote) { background: rgba(255,255,255,0.03); color: #969696; }
  :global([data-theme="dark"]) .markdown-body :global(code) { background: rgba(255,255,255,0.06); color: #ce9178; }
  :global([data-theme="dark"]) .markdown-body :global(pre) { background: #1a1a1a; }
  :global([data-theme="dark"]) .markdown-body :global(pre code) { color: #d4d4d4; }
  :global([data-theme="dark"]) .markdown-body :global(th) { background: rgba(255,255,255,0.04); color: #d4d4d4; }
  :global([data-theme="dark"]) .markdown-body :global(a) { color: #4fc1ff; }
  :global([data-theme="dark"]) .markdown-body :global(em) { color: #c586c0; }
  :global([data-theme="dark"]) .markdown-body :global(del) { color: #6e6e6e; }

  /* ===========================================================
     Light theme overrides
     =========================================================== */
  :global([data-theme="light"]) .preview-renderer { background: #ffffff; }
  :global([data-theme="light"]) .markdown-body { color: #1f1f1f; }
  :global([data-theme="light"]) .markdown-body :global(h1),
  :global([data-theme="light"]) .markdown-body :global(h2),
  :global([data-theme="light"]) .markdown-body :global(h3),
  :global([data-theme="light"]) .markdown-body :global(h4),
  :global([data-theme="light"]) .markdown-body :global(strong) { color: #111111; }
  :global([data-theme="light"]) .markdown-body :global(blockquote) { background: #f5f5f5; color: #616161; }
  :global([data-theme="light"]) .markdown-body :global(code) { background: #f0f0f0; color: #a31515; }
  :global([data-theme="light"]) .markdown-body :global(pre) { background: #f6f8fa; }
  :global([data-theme="light"]) .markdown-body :global(pre code) { color: #1f1f1f; }
  :global([data-theme="light"]) .markdown-body :global(th) { background: #f0f0f0; color: #1f1f1f; }
  :global([data-theme="light"]) .markdown-body :global(a) { color: #0078d4; }
  :global([data-theme="light"]) .markdown-body :global(em) { color: #795e26; }
  :global([data-theme="light"]) .markdown-body :global(del) { color: #999999; }
</style>
