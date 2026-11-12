/**
 * B5（manifest 驱动编辑器注册）测试：
 *
 * 1. registerEditorsFromManifest 按清单声明逐扩展自动注册（宿主接管，
 *    插件不再需要 onLoad 手动 registerEditor）；
 * 2. 重复调用（loader 重扫 / store enable 重放）幂等——同插件同扩展
 *    为替换语义，不产生重复注册或冲突；
 * 3. store.setPluginEnabled(false) 注销该插件全部编辑器扩展，
 *    setPluginEnabled(true) 按清单声明补注册；
 * 4. unregisterPlugin（setPlugins 移除同理）注销编辑器扩展；
 * 5. P2 时序缺陷回归：安装时 onLoad 先于权限授权执行导致注册被拒，
 *    权限首次授予后 replayPluginRegistration 补注册并重放 onLoad。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getEditorForExtension,
  registerEditorsFromManifest,
  unregisterEditor,
} from '../pluginEditor'
import { usePluginStore } from '../plugin'
import { clearAll, setGranted } from '@/lib/plugin-permission-guard'
import type { PluginDefinition } from '@/types/plugin'

/** 最小编辑器组件：仅验证注册表条目引用，不实际渲染 */
const FakeEditor = () => null

/** 构造最小 PluginDefinition（manifest 声明 .foo 编辑器扩展） */
function makeDef(overrides: Partial<PluginDefinition> = {}): PluginDefinition {
  return {
    id: 'test.editor-plugin',
    name: 'test-editor-plugin',
    description: '',
    version: '0.0.1',
    author: '',
    publishedAt: '',
    order: 1,
    enabled: true,
    pluginPath: '/tmp/test-editor-plugin',
    hasBackend: false,
    permissions: ['editor'],
    source: '',
    editorFileExtensions: ['.foo'],
    editorComponent: FakeEditor,
    ...overrides,
  }
}

describe('B5: manifest 声明自动注册编辑器', () => {
  beforeEach(() => {
    // 隔离：清空权限授予缓存、编辑器注册表与插件列表
    clearAll()
    unregisterEditor('test.editor-plugin')
    unregisterEditor('p.auto')
    const { plugins } = usePluginStore.getState()
    for (const p of plugins) {
      usePluginStore.getState().unregisterPlugin(p.id)
    }
  })

  it('清单声明 → 逐扩展自动注册，扩展名归一化', () => {
    setGranted('p.auto', ['editor'])
    // 模拟 loader 阶段调用：多扩展 + 未加点/大写形态
    registerEditorsFromManifest('p.auto', ['.foo', 'BAR'], FakeEditor)

    expect(getEditorForExtension('.foo')?.pluginId).toBe('p.auto')
    // 'BAR' 归一化为 '.bar' 后可命中
    expect(getEditorForExtension('.bar')?.pluginId).toBe('p.auto')
  })

  it('重复注册（loader 重扫 / enable 重放）幂等，不产生冲突', () => {
    setGranted('p.auto', ['editor'])
    registerEditorsFromManifest('p.auto', ['.foo'], FakeEditor)
    // 同插件同扩展重复注册为替换语义，不应抛「扩展被占用」冲突
    expect(() =>
      registerEditorsFromManifest('p.auto', ['.foo'], FakeEditor)
    ).not.toThrow()
    expect(getEditorForExtension('.foo')?.pluginId).toBe('p.auto')
  })

  it('未声明扩展或组件时不注册（no-op）', () => {
    registerEditorsFromManifest('p.none', undefined, FakeEditor)
    registerEditorsFromManifest('p.none', ['.x'], undefined)
    expect(getEditorForExtension('.x')).toBeNull()
  })

  it('setPluginEnabled(false) 注销编辑器，true 按清单补注册', () => {
    setGranted('test.editor-plugin', ['editor'])
    usePluginStore.getState().setPlugins([makeDef()])
    // 模拟 loader 阶段的自动注册（仅 enabled 插件）
    registerEditorsFromManifest('test.editor-plugin', ['.foo'], FakeEditor)
    expect(getEditorForExtension('.foo')?.pluginId).toBe('test.editor-plugin')

    // 禁用 → 注销，文件派发回退内建编辑器
    usePluginStore.getState().setPluginEnabled('test.editor-plugin', false)
    expect(getEditorForExtension('.foo')).toBeNull()

    // 重新启用 → 按清单声明补注册
    usePluginStore.getState().setPluginEnabled('test.editor-plugin', true)
    expect(getEditorForExtension('.foo')?.pluginId).toBe('test.editor-plugin')
  })

  it('unregisterPlugin 时注销该插件的全部编辑器扩展', () => {
    setGranted('test.editor-plugin', ['editor'])
    usePluginStore.getState().setPlugins([makeDef()])
    registerEditorsFromManifest('test.editor-plugin', ['.foo'], FakeEditor)

    usePluginStore.getState().unregisterPlugin('test.editor-plugin')
    expect(getEditorForExtension('.foo')).toBeNull()
  })

  it('权限首次授予后 replayPluginRegistration 补注册并重放 onLoad', async () => {
    // 复现真实安装时序：onLoad / loader 先于权限弹窗执行，注册被权限守卫拒绝
    const onLoad = vi.fn()
    usePluginStore.getState().setPlugins([makeDef({ hooks: { onLoad } })])
    registerEditorsFromManifest('test.editor-plugin', ['.foo'], FakeEditor)
    expect(getEditorForExtension('.foo')).toBeNull()

    // 用户授权后权限弹窗调用补偿重放
    setGranted('test.editor-plugin', ['editor'])
    usePluginStore.getState().replayPluginRegistration('test.editor-plugin')

    expect(getEditorForExtension('.foo')?.pluginId).toBe('test.editor-plugin')
    // setPlugins added 分支触发一次（失败但 hook 本身不抛错），replay 再触发一次
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalledTimes(2))
  })

  it('replayPluginRegistration 对未注册/禁用插件 no-op', () => {
    usePluginStore.getState().replayPluginRegistration('nonexistent')
    // 禁用插件：setPlugins added 分支跳过，replay 同样不注册
    usePluginStore.getState().setPlugins([makeDef({ enabled: false })])
    usePluginStore.getState().replayPluginRegistration('test.editor-plugin')
    expect(getEditorForExtension('.foo')).toBeNull()
  })
})
