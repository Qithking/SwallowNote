import { describe, it, expect, vi, afterEach } from 'vitest'
import type { EditorTab } from '@/stores/editor'
import {
  registerBuiltinEditors,
  builtinEditorRegistry,
  syncPluginEditors,
} from '@/components/editors/builtin-editors'
import { pluginEditorRegistry } from '@/stores/pluginEditor'
import type { EditorMatchContext } from '@/components/editors/editor-registry'

function makeTab(partial: Partial<EditorTab>): EditorTab {
  return {
    id: 't1',
    path: 'test.md',
    name: 'test.md',
    content: '',
    isDirty: false,
    isEdited: false,
    viewMode: 'preview',
    type: 'file',
    ...partial,
  } as EditorTab
}

function ctx(partial: Partial<EditorMatchContext>): EditorMatchContext {
  return {
    tab: makeTab({}),
    fileType: 'markdown',
    pluginExtensions: new Set<string>(),
    ...partial,
  }
}

describe('builtin editors registration', () => {
  it('注册后 registry 有 6 个内置编辑器', () => {
    registerBuiltinEditors()
    const ids = builtinEditorRegistry
      .listDescriptors()
      .map((d) => d.id)
      .sort()
    expect(ids).toContain('markdown-blocknote')
    expect(ids).toContain('markdown-source-codemirror')
    expect(ids).toContain('code-codemirror')
    expect(ids).toContain('diff-viewer')
    expect(ids).toContain('conflict-resolver')
    expect(ids).toContain('mindmap-shim')
  })

  it('diff tab → resolve 到 diff-viewer', () => {
    registerBuiltinEditors()
    const c = ctx({
      tab: makeTab({ type: 'diff', diffContent: '@@ diff @@' }),
    })
    const result = builtinEditorRegistry.resolve(c)
    expect(result?.id).toBe('diff-viewer')
  })

  it('conflict tab → resolve 到 conflict-resolver', () => {
    registerBuiltinEditors()
    const c = ctx({
      tab: makeTab({
        type: 'conflict',
        conflictRepoPath: '/repo',
        conflictRepoName: 'repo',
      }),
    })
    const result = builtinEditorRegistry.resolve(c)
    expect(result?.id).toBe('conflict-resolver')
  })

  it('markdown + viewMode=preview → resolve 到 markdown-blocknote', () => {
    registerBuiltinEditors()
    const c = ctx({ fileType: 'markdown' })
    expect(c.tab.viewMode).toBe('preview')
    const result = builtinEditorRegistry.resolve(c)
    expect(result?.id).toBe('markdown-blocknote')
  })

  it('markdown + viewMode=source → resolve 到 markdown-source-codemirror', () => {
    registerBuiltinEditors()
    const c = ctx({
      fileType: 'markdown',
      tab: makeTab({ viewMode: 'source' }),
    })
    const result = builtinEditorRegistry.resolve(c)
    expect(result?.id).toBe('markdown-source-codemirror')
  })

  it('code fileType → resolve 到 code-codemirror', () => {
    registerBuiltinEditors()
    const c = ctx({
      fileType: 'code',
      tab: makeTab({ name: 'main.js', path: 'main.js' }),
    })
    const result = builtinEditorRegistry.resolve(c)
    expect(result?.id).toBe('code-codemirror')
  })

  it('mindmap + 无插件 → resolve 到 mindmap-shim', () => {
    registerBuiltinEditors()
    const c = ctx({
      fileType: 'mindmap',
      tab: makeTab({ name: 'test.smm', path: 'test.smm' }),
      pluginExtensions: new Set<string>(),
    })
    const result = builtinEditorRegistry.resolve(c)
    expect(result?.id).toBe('mindmap-shim')
  })

  it('mindmap + 有插件 → 不 resolve 到 shim(留给插件编辑器)', () => {
    registerBuiltinEditors()
    const c = ctx({
      fileType: 'mindmap',
      tab: makeTab({ name: 'test.smm', path: 'test.smm' }),
      pluginExtensions: new Set(['.smm']),
    })
    const result = builtinEditorRegistry.resolve(c)
    // shim 的 match 应在 pluginExtensions 包含扩展时返回 false
    expect(result?.id).not.toBe('mindmap-shim')
  })

  it('binary fileType → resolve 返回 null(内置不处理,走 fallback)', () => {
    registerBuiltinEditors()
    const c = ctx({ fileType: 'binary' })
    expect(builtinEditorRegistry.resolve(c)).toBeNull()
  })

  it('adapter 产出统一 EditorProps 含 tab + onChange', () => {
    registerBuiltinEditors()
    const tab = makeTab({ content: 'hello', name: 'a.md' })
    const c = ctx({ tab })
    const desc = builtinEditorRegistry.resolve(c)
    expect(desc).not.toBeNull()
    const onChange = vi.fn()
    const props = desc!.adapter({ tab, onChange })
    expect(props.tab).toBe(tab)
    expect(typeof props.onChange).toBe('function')
  })

  it('source mode adapter 合成 frontmatter + body 为完整源码', () => {
    registerBuiltinEditors()
    const tab = makeTab({
      content: 'body text',
      name: 'a.md',
      viewMode: 'source',
      frontmatter: { title: 'Test' },
    })
    const c = ctx({ tab })
    const desc = builtinEditorRegistry.resolve(c)
    expect(desc?.id).toBe('markdown-source-codemirror')
    const onChange = vi.fn()
    const props = desc!.adapter({ tab, onChange })
    // content 应包含 frontmatter + body
    expect(props.tab.content).toContain('title')
    expect(props.tab.content).toContain('Test')
    expect(props.tab.content).toContain('body text')
  })

  it('source mode adapter onChange 解析 frontmatter 并分离存储', () => {
    registerBuiltinEditors()
    const tab = makeTab({
      content: 'body text',
      name: 'a.md',
      viewMode: 'source',
      frontmatter: {},
    })
    const c = ctx({ tab })
    const desc = builtinEditorRegistry.resolve(c)
    const onChange = vi.fn()
    const props = desc!.adapter({ tab, onChange })
    const rawContent = '---\ntitle: Hello\n---\nnew body'
    props.onChange(rawContent)
    // onChange 应收到 body 部分(不含 frontmatter)
    expect(onChange).toHaveBeenCalledWith('new body')
  })
})

describe('plugin editor bridge', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // 用真实(空)registry 清除测试中注册的插件 descriptor
    syncPluginEditors()
  })

  it('syncPluginEditors 把活跃插件编辑器注册到统一 registry(priority=100)', () => {
    registerBuiltinEditors()
    vi.spyOn(pluginEditorRegistry, 'getActivePluginExtensions').mockReturnValue(new Set(['.smm']))
    vi.spyOn(pluginEditorRegistry, 'getEditorForExtension').mockReturnValue({
      pluginId: 'test-plugin',
      component: (() => null) as any,
    })
    syncPluginEditors()
    const c = ctx({
      fileType: 'mindmap',
      tab: makeTab({ name: 'a.smm', path: 'a.smm' }),
      pluginExtensions: new Set(['.smm']),
    })
    const desc = builtinEditorRegistry.resolve(c)
    expect(desc?.id).toBe('plugin:test-plugin:.smm')
    expect(desc?.priority).toBe(100)
  })

  it('插件 descriptor(priority=100)优先于 mindmap-shim(priority=1)', () => {
    registerBuiltinEditors()
    vi.spyOn(pluginEditorRegistry, 'getActivePluginExtensions').mockReturnValue(new Set(['.smm']))
    vi.spyOn(pluginEditorRegistry, 'getEditorForExtension').mockReturnValue({
      pluginId: 'test-plugin',
      component: (() => null) as any,
    })
    syncPluginEditors()
    const c = ctx({
      fileType: 'mindmap',
      tab: makeTab({ name: 'a.smm', path: 'a.smm' }),
      pluginExtensions: new Set(['.smm']),
    })
    const desc = builtinEditorRegistry.resolve(c)
    expect(desc?.id).toBe('plugin:test-plugin:.smm')
    expect(desc?.id).not.toBe('mindmap-shim')
  })

  it('插件卸载后 sync 清除 descriptor,回退到 shim', () => {
    registerBuiltinEditors()
    vi.spyOn(pluginEditorRegistry, 'getActivePluginExtensions').mockReturnValue(new Set(['.smm']))
    vi.spyOn(pluginEditorRegistry, 'getEditorForExtension').mockReturnValue({
      pluginId: 'test-plugin',
      component: (() => null) as any,
    })
    syncPluginEditors()
    // 插件卸载:扩展名集合变空
    vi.mocked(pluginEditorRegistry.getActivePluginExtensions).mockReturnValue(new Set())
    syncPluginEditors()
    const c = ctx({
      fileType: 'mindmap',
      tab: makeTab({ name: 'a.smm', path: 'a.smm' }),
      pluginExtensions: new Set(),
    })
    const desc = builtinEditorRegistry.resolve(c)
    expect(desc?.id).toBe('mindmap-shim')
  })

  it('插件 descriptor 不匹配 diff/conflict tab(仍走内置)', () => {
    registerBuiltinEditors()
    vi.spyOn(pluginEditorRegistry, 'getActivePluginExtensions').mockReturnValue(new Set(['.smm']))
    vi.spyOn(pluginEditorRegistry, 'getEditorForExtension').mockReturnValue({
      pluginId: 'test-plugin',
      component: (() => null) as any,
    })
    syncPluginEditors()
    const c = ctx({
      tab: makeTab({ type: 'diff', name: 'a.smm', diffContent: '@@ diff @@' }),
    })
    const desc = builtinEditorRegistry.resolve(c)
    expect(desc?.id).toBe('diff-viewer')
  })
})
