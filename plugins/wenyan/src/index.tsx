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
import { definePlugin } from '@swallow-note/plugin-sdk'
export { setHost } from '@swallow-note/plugin-sdk'
import manifestJson from '../manifest.json'
import { WenyanIcon } from './WenyanIcon'
import { WenyanToolbarButton } from './WenyanToolbarButton'

// manifest.json 单一来源：静态字段（版本/权限等）只维护 manifest.json 一处，
// 组件由运行时参数注入，不再内嵌 manifest 副本
export default definePlugin(manifestJson, {
  icon: WenyanIcon,
  panel: () => null,
  toolbarButton: WenyanToolbarButton,
})
