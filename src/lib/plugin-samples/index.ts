/**
 * Bundled reference plugins shipped with the host.
 *
 * These are *not* auto-loaded — they exist so plugin authors (and
 * the host's smoke tests) have a small, well-commented library of
 * working plugins to copy from. Every file here is a complete
 * `PluginDefinition` that can be installed via "Install from folder"
 * after dropping it into a directory alongside a `manifest.json`.
 *
 * The three samples cover different parts of the public API:
 *
 *   1. `recent-notes-counter` — basic lifecycle + storage + context-menu
 *      and the *full* 8-hook lifecycle. Best starting point.
 *
 *   2. `word-counter` — `editorToolbar` icon position, `editorArea`
 *      content position, `usePluginStorage` with a numeric threshold
 *      and a settings dialog that validates user input. Shows how
 *      a panel that lives *inside* the editor looks.
 *
 *   3. `theme-watcher` — multi-event subscription via
 *      `usePluginEvents`, reading host state from localStorage, and
 *      emitting follow-up events from inside a handler.
 *
 * To install any of them in dev:
 *
 *   1. Copy the file into `<plugins>/com.example.<name>/index.js`
 *      (or a `.tsx` if your build is configured for it).
 *   2. Open the plugin manager and click "Install from folder".
 *   3. Grant the requested permissions when prompted.
 */
import recentNotesManifest from './recent-notes-counter'
import wordCounterManifest from './word-counter'
import themeWatcherManifest from './theme-watcher'

import type { PluginDefinition } from '@/types/plugin'

/** all bundled sample manifests, in display order. */
export const SAMPLE_PLUGINS: readonly PluginDefinition[] = [
  recentNotesManifest,
  wordCounterManifest,
  themeWatcherManifest,
] as const

export default SAMPLE_PLUGINS
