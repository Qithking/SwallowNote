import { describe, it, expect, vi } from 'vitest'
import type { ComponentType } from 'react'

import {
  createEditorRegistry,
  type EditorDescriptor,
  type EditorMatchContext,
} from '@/components/editors/editor-registry'

// Mock 组件,避免拉起真实编辑器
const mockComponent = (() => null) as unknown as ComponentType<unknown>

// 构造测试用 context
function ctx(partial: Partial<EditorMatchContext>): EditorMatchContext {
  return {
    tab: {
      id: 't1',
      path: 'test.md',
      name: 'test.md',
      content: '',
      isDirty: false,
      isEdited: false,
      viewMode: 'preview',
      type: 'file',
    },
    fileType: 'markdown',
    pluginExtensions: new Set<string>(),
    ...partial,
  } as EditorMatchContext
}

describe('EditorRegistry', () => {
  it('register + resolve: 返回已注册的 descriptor', () => {
    const reg = createEditorRegistry()
    const desc: EditorDescriptor = {
      id: 'test-editor',
      match: (c) => c.fileType === 'markdown',
      component: mockComponent,
      adapter: () => ({ tab: ctx({}).tab, onChange: () => {} }),
      priority: 10,
    }
    reg.register(desc)
    const result = reg.resolve(ctx({}))
    expect(result?.id).toBe('test-editor')
  })

  it('多个 match 命中时返回优先级最高的', () => {
    const reg = createEditorRegistry()
    reg.register({
      id: 'low',
      match: () => true,
      component: mockComponent,
      adapter: () => ({ tab: ctx({}).tab, onChange: () => {} }),
      priority: 1,
    })
    reg.register({
      id: 'high',
      match: () => true,
      component: mockComponent,
      adapter: () => ({ tab: ctx({}).tab, onChange: () => {} }),
      priority: 100,
    })
    reg.register({
      id: 'mid',
      match: () => true,
      component: mockComponent,
      adapter: () => ({ tab: ctx({}).tab, onChange: () => {} }),
      priority: 10,
    })
    const result = reg.resolve(ctx({}))
    expect(result?.id).toBe('high')
  })

  it('无匹配时返回 null', () => {
    const reg = createEditorRegistry()
    reg.register({
      id: 'only-code',
      match: (c) => c.fileType === 'code',
      component: mockComponent,
      adapter: () => ({ tab: ctx({}).tab, onChange: () => {} }),
      priority: 10,
    })
    const result = reg.resolve(ctx({ fileType: 'markdown' }))
    expect(result).toBeNull()
  })

  it('match 函数可访问 tab.type / fileType / pluginExtensions', () => {
    const reg = createEditorRegistry()
    const matchFn = vi.fn(() => true)
    reg.register({
      id: 'probe',
      match: matchFn,
      component: mockComponent,
      adapter: () => ({ tab: ctx({}).tab, onChange: () => {} }),
      priority: 10,
    })
    const c = ctx({
      fileType: 'mindmap',
      pluginExtensions: new Set(['.smm']),
      tab: {
        id: 't2',
        path: 'a.smm',
        name: 'a.smm',
        content: '',
        isDirty: false,
        isEdited: false,
        viewMode: 'preview',
        type: 'file',
      },
    })
    reg.resolve(c)
    expect(matchFn).toHaveBeenCalledWith(c)
    expect(matchFn.mock.calls[0][0].fileType).toBe('mindmap')
    expect(matchFn.mock.calls[0][0].pluginExtensions.has('.smm')).toBe(true)
  })

  it('unregister 移除指定 descriptor', () => {
    const reg = createEditorRegistry()
    reg.register({
      id: 'removable',
      match: () => true,
      component: mockComponent,
      adapter: () => ({ tab: ctx({}).tab, onChange: () => {} }),
      priority: 10,
    })
    reg.unregister('removable')
    expect(reg.resolve(ctx({}))).toBeNull()
  })

  it('listDescriptors 返回所有已注册 descriptor 的只读快照', () => {
    const reg = createEditorRegistry()
    reg.register({
      id: 'a',
      match: () => true,
      component: mockComponent,
      adapter: () => ({ tab: ctx({}).tab, onChange: () => {} }),
      priority: 1,
    })
    reg.register({
      id: 'b',
      match: () => true,
      component: mockComponent,
      adapter: () => ({ tab: ctx({}).tab, onChange: () => {} }),
      priority: 2,
    })
    const list = reg.listDescriptors()
    expect(list.map((d) => d.id).sort()).toEqual(['a', 'b'])
  })
})
