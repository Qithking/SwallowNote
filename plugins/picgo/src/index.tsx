/**
 * PicGo image-host plugin — SwallowNote external plugin entry.
 *
 * The bundle is loaded by the host as a single ES module and
 * the host reads `manifest` to know what to render.
 *
 * Static metadata (id, name, description, version, author,
 * publishedAt, iconPosition, contentPosition, order, enabled,
 * permissions) is imported from `../manifest.json` at build
 * time — Vite inlines the JSON so the bundle carries a
 * copy. The on-disk `manifest.json` is therefore the single
 * source of truth: change it there, re-run `bash package.sh`,
 * and both the JS export and the Rust-side
 * `// @swallow-manifest {...}` header (injected by Vite's
 * `closeBundle` hook in `vite.config.ts`) pick up the new
 * values automatically. They cannot drift apart.
 *
 * Only the runtime fields live in this file: the React
 * components for `icon`, `panel`, and `toolbarButton`.
 */
/* eslint-disable react-refresh/only-export-components */
import type { PluginManifest } from '@swallow-note/plugin-sdk'
export { setHost } from '@swallow-note/plugin-sdk'
import manifestJson from '../manifest.json'
import { PicgoIcon } from './PicgoIcon'
import { PicgoPanel } from './PicgoPanel'
import { PicgoToolbarButton } from './PicgoToolbarButton'

const manifest = {
  ...manifestJson,
  icon: PicgoIcon,
  panel: PicgoPanel,
  toolbarButton: PicgoToolbarButton,
} as PluginManifest

export default manifest
