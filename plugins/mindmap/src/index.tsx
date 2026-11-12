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
import { definePlugin, type PluginManifest } from '@swallow-note/plugin-sdk'
export { setHost } from '@swallow-note/plugin-sdk'
import manifestJson from '../manifest.json'
import { MindMapEditorView } from './MindMapEditorView'

// manifest 静态字段（id / editorFileExtensions / permissions / ...）单一来源
// 是工程根的 ../manifest.json；editorComponent 组件由 definePlugin 注入。
export default definePlugin(manifestJson, {
  editorComponent: MindMapEditorView as PluginManifest['editorComponent'],
})
