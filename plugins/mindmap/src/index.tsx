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
 * Lifecycle wiring (B5，宿主接管编辑器生命周期): 清单声明
 * `editorFileExtensions` + `editorComponent` 即自动生效——宿主在
 * 模块加载完成（plugin-loader，仅 enabled 插件）与启用路径
 * （plugin store 的 setPluginEnabled(true)）时自动注册，禁用 /
 * 卸载时由宿主注销。插件侧不再需要 onLoad/onUnload 手动调用
 * registerEditor/unregisterEditor，也不存在 store enable 重放
 * onLoad 导致的重复注册问题。
 *
 * Frontend-only plugin — no Rust backend, no file system writes
 * beyond the host's normal note-persist pipeline (the editor
 * pushes new content back through `onChange`).
 */
/* eslint-disable react-refresh/only-export-components */
import type { PluginManifest } from '@swallow-note/plugin-sdk'
export { setHost } from '@swallow-note/plugin-sdk'
import { MindMapEditorView } from './MindMapEditorView'

const manifest: PluginManifest = {
  id: 'com.swallownote.mindmap',
  name: '思维导图',
  description:
    '基于 simple-mind-map 的独立 .smm 文件编辑器，提供逻辑结构图/思维导图/组织结构/时间轴/鱼骨图等多种布局',
  version: '0.2.2',
  author: 'SwallowNote',
  publishedAt: '2026-06-18T06:59:47Z',
  order: 50,
  enabled: true,
  editorFileExtensions: ['.smm'],
  editorComponent: MindMapEditorView as PluginManifest['editorComponent'],
  permissions: ['editor', 'events', 'storage'],
}

export default manifest
