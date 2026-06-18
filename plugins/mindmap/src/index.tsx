/**
 * Mind Map Editor Plugin — External plugin entry.
 *
 * Provides a self-contained `.smm` file editor powered by
 * `simple-mind-map`. The plugin declares:
 *
 *   - `editorFileExtensions: ['.smm']` + `editorComponent` so
 *     the host delegates rendering of any `.smm` note to this
 *     plugin's React component instead of the built-in Markdown
 *     / code editor.
 *
 * The plugin has no title-bar icon and no standalone panel: it
 * is only triggered when the user opens a `.smm` file from the
 * file tree.
 *
 * Lifecycle wiring: declaring `editorFileExtensions` +
 * `editorComponent` in the manifest is **not enough** to take
 * over the file-open dispatcher. The host's editor registry
 * (`src/stores/pluginEditor.ts`) is populated only when the
 * plugin calls `registerEditor(...)` from a lifecycle hook —
 * outside a hook, `currentHostOverrides()` is unset and the
 * SDK's call would fall through to the in-process stub, which
 * the host's `Editor.tsx` dispatcher can't see. So we register
 * the editor from `onLoad` (and unregister from `onUnload`)
 * with the host override live.
 *
 * Frontend-only plugin — no Rust backend, no file system writes
 * beyond the host's normal note-persist pipeline (the editor
 * pushes new content back through `onChange`).
 */
/* eslint-disable react-refresh/only-export-components */
import type { PluginContext, PluginManifest } from '@swallow-note/plugin-sdk'
import { registerEditor, unregisterEditor } from '@swallow-note/plugin-sdk'
export { setHost } from '@swallow-note/plugin-sdk'
import { MindMapEditorView } from './MindMapEditorView'

const manifest: PluginManifest = {
  id: 'com.swallownote.mindmap',
  name: '思维导图',
  description:
    '基于 simple-mind-map 的独立 .smm 文件编辑器，提供逻辑结构图/思维导图/组织结构/时间轴/鱼骨图等多种布局',
  version: '0.1.0',
  author: 'SwallowNote',
  publishedAt: '2026-06-17',
  order: 50,
  enabled: true,
  editorFileExtensions: ['.smm'],
  editorComponent: MindMapEditorView as PluginManifest['editorComponent'],
  permissions: ['editor', 'events', 'storage'],
  /**
   * Register the `.smm` editor with the host's editor registry
   * on every load / enable. The host bridge calls `setHost`
   * before invoking this hook, so the SDK's `registerEditor`
   * forwards into the host's `pluginEditorRegistry` instead
   * of the in-process stub. Idempotent: re-registering from
   * the same plugin just replaces the component reference.
   */
  onLoad: ({ pluginId }: PluginContext) => {
    registerEditor(pluginId, '.smm', MindMapEditorView)
  },
  onEnable: ({ pluginId }: PluginContext) => {
    // The store's enable-toggle path re-fires onLoad before
    // onEnable, so by the time we get here the editor is
    // already registered. Re-registering is a no-op for
    // duplicate-extension from the same plugin.
    registerEditor(pluginId, '.smm', MindMapEditorView)
  },
  /**
   * Drop the editor from the host's registry on uninstall /
   * disable so the dispatcher falls back to the built-in
   * Markdown / code editor (or the compatibility shim) once
   * the plugin's module is gone.
   */
  onUnload: ({ pluginId }: PluginContext) => {
    unregisterEditor(pluginId)
  },
  onDisable: ({ pluginId }: PluginContext) => {
    unregisterEditor(pluginId)
  },
}

export default manifest
