/**
 * H3 装载链路 harness：loadAllPlugins 四大分支
 * ① host_compatible=false 跳过加载 ② bundled React 拒载
 * ③ 模块加载成功 → manifest 字段映射 + installHostTakeover
 * ④ B5：enabled + editorFileExtensions → registerEditorsFromManifest
 *
 * 模块加载技巧：jsdom 无 Blob URL 模块加载能力，用 data: URL 替身
 * （Node ESM 原生支持 import data: URL），由 stub 的 URL.createObjectURL
 * 返回预置模块源码。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/tauri', () => ({
  readFile: vi.fn(),
  getFileMetadata: vi.fn(),
}))
vi.mock('../plugin-host-takeover', () => ({
  installHostTakeover: vi.fn(),
}))
vi.mock('@/stores/pluginEditor', () => ({
  registerEditorsFromManifest: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/i18n', () => ({
  // 透传插值参数（JSON 拼接），failure reason 中的底层错误信息可被断言
  default: {
    t: (k: string, params?: Record<string, unknown>) =>
      k + (params ? ' ' + JSON.stringify(params) : ''),
    language: 'en',
    on: vi.fn(),
    off: vi.fn(),
  },
}))

import { loadAllPlugins } from '../plugin-loader'
import { readFile, getFileMetadata } from '@/lib/tauri'
import { installHostTakeover } from '../plugin-host-takeover'
import { registerEditorsFromManifest } from '@/stores/pluginEditor'
import type { PluginMetadataRust } from '@/lib/tauri'

/** 下一个被 import 的"插件模块"源码（由 createObjectURL 替身注入 data: URL） */
let nextModuleSource = ''

beforeEach(() => {
  vi.clearAllMocks()
  nextModuleSource = ''
  // jsdom 未实现 createObjectURL；替身返回 data: URL 承载预置模块源码
  ;(URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () =>
    `data:text/javascript;charset=utf-8,${encodeURIComponent(nextModuleSource)}`
  ;(URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {}
  vi.mocked(getFileMetadata).mockRejectedValue(new Error('mtime unavailable'))
})

function makeMeta(overrides: Partial<PluginMetadataRust> = {}): PluginMetadataRust {
  return {
    id: 'com.test.ok',
    name: '测试插件',
    description: 'desc',
    version: '1.0.0',
    author: '',
    published_at: '',
    icon_position: null,
    content_position: null,
    order: 0,
    enabled: true,
    plugin_path: '/data/plugins/com.test.ok/current',
    has_backend: false,
    source: 'market',
    host_compatible: null,
    min_host_version: null,
    has_settings_schema: false,
    ...overrides,
  } as PluginMetadataRust
}

describe('H3 装载链路：loadAllPlugins 分支', () => {
  it('① host_compatible=false → 跳过加载（不读文件），仅 failure 含最低宿主版本', async () => {
    const result = await loadAllPlugins([
      makeMeta({ id: 'p-new', host_compatible: false, min_host_version: '9.9.9' }),
    ])
    expect(result.plugins).toHaveLength(0)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.id).toBe('p-new')
    // i18n 为 mock，reason 中含未插值的 key 即证明走了"宿主不兼容"分支
    expect(result.failures[0]?.reason).toContain('pluginLoader.hostIncompatibleBase')
    expect(result.failures[0]?.reason).toContain('pluginLoader.hostIncompatibleDetail')
    expect(readFile).not.toHaveBeenCalled()
    expect(installHostTakeover).not.toHaveBeenCalled()
  })

  it('② bundled React 拒载：failure 提示需外置 react，返回占位定义便于卸载', async () => {
    vi.mocked(readFile).mockResolvedValue('var x = "react.production.min.js";')
    const result = await loadAllPlugins([makeMeta()])
    // 拒载后仍返回占位定义（便于在管理页卸载损坏插件）
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0]?.panel).toBeTypeOf('function')
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.reason).toContain('externalized')
    expect(installHostTakeover).not.toHaveBeenCalled()
  })

  it('③ 模块加载成功：manifest 字段映射到定义，installHostTakeover 恰好一次', async () => {
    nextModuleSource = [
      'export const manifest = {',
      "  id: 'com.test.ok',",
      "  name: 'manifest 名',",
      "  version: '2.0.0',",
      "  permissions: ['fs.read'],",
      '}',
    ].join('\n')
    vi.mocked(readFile).mockResolvedValue('export const manifest = null;')
    const result = await loadAllPlugins([makeMeta()])
    expect(result.failures).toHaveLength(0)
    const def = result.plugins[0]
    expect(def).toBeDefined()
    expect(def?.name).toBe('manifest 名')
    expect(def?.version).toBe('2.0.0')
    expect(def?.permissions).toEqual(['fs.read'])
    expect(def?.pluginPath).toBe('/data/plugins/com.test.ok/current')
    expect(def?.enabled).toBe(true)
    expect(installHostTakeover).toHaveBeenCalledTimes(1)
    expect(installHostTakeover).toHaveBeenCalledWith(def)
  })

  it('③b 模块无 manifest 导出 → 占位定义 + failure（可卸载损坏插件）', async () => {
    nextModuleSource = 'export const notManifest = true;'
    vi.mocked(readFile).mockResolvedValue('export const notManifest = true;')
    const result = await loadAllPlugins([makeMeta()])
    expect(result.plugins).toHaveLength(1) // 占位定义也返回，便于卸载
    expect(result.failures).toHaveLength(1)
    expect(result.plugins[0]?.panel).toBeTypeOf('function')
    expect(installHostTakeover).not.toHaveBeenCalled()
  })

  it('④ B5：enabled 且声明 editorFileExtensions → registerEditorsFromManifest 接线', async () => {
    nextModuleSource = [
      'export default {',
      "  id: 'com.test.ok',",
      "  editorFileExtensions: ['md', 'canvas'],",
      "  editorComponent: 'CanvasEditor',",
      '}',
    ].join('\n')
    vi.mocked(readFile).mockResolvedValue('export default null;')
    const result = await loadAllPlugins([makeMeta({ enabled: true })])
    expect(result.failures).toHaveLength(0)
    expect(registerEditorsFromManifest).toHaveBeenCalledWith(
      'com.test.ok',
      ['md', 'canvas'],
      'CanvasEditor',
    )
  })

  it('④b disabled 插件不注册编辑器（启用路径才补注册）', async () => {
    nextModuleSource = [
      'export default { id: "com.test.ok", editorFileExtensions: ["md"], editorComponent: "E" }',
    ].join('\n')
    vi.mocked(readFile).mockResolvedValue('export default null;')
    await loadAllPlugins([makeMeta({ enabled: false })])
    expect(registerEditorsFromManifest).not.toHaveBeenCalled()
  })
})
