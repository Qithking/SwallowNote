/**
 * Wenyan Typesetting Plugin — External plugin entry.
 *
 * Integrates @wenyan-md/core to render Markdown into beautifully
 * typeset HTML for WeChat Official Accounts and other platforms.
 *
 * Features:
 *   - Toolbar button that opens a 90vw×90vh dialog
 *   - Theme selection (built-in GZH themes from wenyan)
 *   - Code highlight theme selection
 *   - macOS style / auto-footnote toggles
 *   - Real-time preview with debounced re-render
 *   - One-click copy styled HTML to clipboard
 *
 * Frontend plugin with a Rust backend for pushing article drafts to
 * WeChat Official Accounts (公众号草稿箱).
 */
/* eslint-disable react-refresh/only-export-components */
import type { PluginManifest } from '@swallow-note/plugin-sdk'
export { setHost } from '@swallow-note/plugin-sdk'
import { WenyanIcon } from './WenyanIcon'
import { WenyanToolbarButton } from './WenyanToolbarButton'

const manifest: PluginManifest = {
  id: 'com.swallownote.wenyan',
  name: '文颜排版',
  description: '使用文颜引擎将 Markdown 排版为微信公众号样式的富文本，支持推送到公众号草稿箱',
  version: '0.1.0',
  author: 'SwallowNote',
  publishedAt: '2026-06-16',
  iconPosition: 'editorToolbar',
  contentPosition: 'editorArea',
  order: 45,
  enabled: true,
  icon: WenyanIcon,
  panel: () => null,
  toolbarButton: WenyanToolbarButton,
  permissions: ['clipboard', 'storage', 'events', 'backend'],
}

export default manifest
