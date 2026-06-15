/**
 * SwallowNote Typist Plugin — External plugin entry.
 *
 * Adds a WeChat Official Account / Xiaohongshu / etc. typist
 * workflow to the editor. The plugin:
 *   - Watches the active note (`activeNoteContent`) and renders a
 *     themed HTML preview.
 *   - Copies the styled HTML to the clipboard via the modern
 *     `ClipboardItem` API so the user can paste it directly into
 *     the WeChat Official Account editor.
 *   - Falls back to plain text or a PNG screenshot of the preview
 *     when the modern clipboard is unavailable.
 *
 * The plugin is fully self-contained:
 *   - Frontend: toolbar dropdown + editorArea floating panel.
 *   - Backend:  Rust binary in `src-tauri/` over JSON-RPC.
 *   - No host code references this plugin.
 */
/* eslint-disable react-refresh/only-export-components */
import type { PluginManifest } from '@swallow-note/plugin-sdk'
// Re-export setHost so the host can install SDK overrides at runtime.
export { setHost } from '@swallow-note/plugin-sdk'
import { TypistPanel } from './panel/TypistPanel'
import { TypistToolbarButton } from './toolbar/TypistToolbarButton'
import { TypistIcon } from './panel/icons'

const manifest: PluginManifest = {
  id: 'com.swallownote.typist',
  name: '公众号排版',
  description: '将 Markdown 文档按微信公众号等平台主题排版，一键复制带样式的富文本',
  version: '0.1.0',
  author: 'SwallowNote',
  publishedAt: '2026-06-14',
  iconPosition: 'editorToolbar',
  contentPosition: 'rightPanel',
  order: 40,
  enabled: true,
  // Note: `hasBackend` is read from `manifest.json` on disk by the host;
  // it is intentionally not part of the SDK's PluginManifest type, so
  // we omit it from the in-memory manifest. See `manifest.json`.
  icon: TypistIcon,
  // The host renders this inside the editorArea floating container
  // when the user activates the plugin via the toolbar dropdown.
  panel: TypistPanel,
  toolbarButton: TypistToolbarButton,
  permissions: ['storage', 'events', 'backend', 'clipboard'],
}

export default manifest
