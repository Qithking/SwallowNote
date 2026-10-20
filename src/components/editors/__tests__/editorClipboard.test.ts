/**
 * editorClipboard 测试：BlockNote 复制到剪贴板 text/plain 的纯文本修正。
 *
 * 根因（fix/blocknote-copy-plain-text）：BlockNote 0.55 复制时向 text/plain 写入
 * markdown 序列化结果，粘贴到纯文本目标应用带 **、[]() 等符号。
 * 回归目标：copy/cut 冒泡后 text/plain 必须被重写为选区纯文本；
 * 非 BlockNote 触发（无 blocknote/html 类型）与空选区不得重写。
 */
import { describe, it, expect, vi } from 'vitest'
import { rewritePlainTextFromSelection, attachPlainTextCopyHandling } from '../editorClipboard'

/** 构造模拟剪贴板：模拟 BlockNote 插件已写入的三种格式 */
function makeClipboardData(initial: Record<string, string>) {
  const store = new Map(Object.entries(initial))
  return {
    types: Array.from(store.keys()),
    getData: (type: string) => store.get(type) ?? '',
    setData: (type: string, value: string) => {
      store.set(type, value)
    },
  }
}

/** 构造模拟编辑器：_tiptapEditor.selection + doc.textBetween（与 MarkdownEditor 读取路径一致） */
function makeFakeEditor(plainText: string, selection: { from: number; to: number; empty: boolean } = { from: 1, to: 10, empty: false }) {
  return {
    _tiptapEditor: {
      state: {
        selection,
        doc: {
          textBetween: vi.fn(() => plainText),
        },
      },
    },
  }
}

/** BlockNote 复制行为：含行内格式的段落，text/plain 为 markdown 源码 */
const BLOCKNOTE_MARKDOWN = '**加粗** 与 [链接](https://example.com)'
const EXPECTED_PLAIN = '加粗 与 链接'

describe('rewritePlainTextFromSelection', () => {
  it('copy 时将 BlockNote 写入的 markdown 重写为选区纯文本', () => {
    const editor = makeFakeEditor(EXPECTED_PLAIN)
    const clipboardData = makeClipboardData({
      'blocknote/html': '<div>internal</div>',
      'text/html': '<p><strong>加粗</strong> 与 <a href="https://example.com">链接</a></p>',
      'text/plain': BLOCKNOTE_MARKDOWN,
    })

    rewritePlainTextFromSelection(editor, { clipboardData: clipboardData as unknown as DataTransfer })

    expect(clipboardData.getData('text/plain')).toBe(EXPECTED_PLAIN)
    // 其余两种格式保持 BlockNote 原值，编辑器内/富文本粘贴不回归
    expect(clipboardData.getData('text/html')).toContain('<strong>')
    expect(clipboardData.getData('blocknote/html')).toBe('<div>internal</div>')
  })

  it('非 BlockNote 触发的复制（无 blocknote/html 类型）不重写', () => {
    const editor = makeFakeEditor(EXPECTED_PLAIN)
    const clipboardData = makeClipboardData({ 'text/plain': '外部复制的内容' })

    rewritePlainTextFromSelection(editor, { clipboardData: clipboardData as unknown as DataTransfer })

    expect(clipboardData.getData('text/plain')).toBe('外部复制的内容')
  })

  it('clipboardData 缺失时不抛错且不重写', () => {
    const editor = makeFakeEditor(EXPECTED_PLAIN)
    expect(() => rewritePlainTextFromSelection(editor, { clipboardData: null })).not.toThrow()
  })

  it('空选区不重写', () => {
    const editor = makeFakeEditor(EXPECTED_PLAIN, { from: 5, to: 5, empty: true })
    const clipboardData = makeClipboardData({
      'blocknote/html': '<div>internal</div>',
      'text/plain': BLOCKNOTE_MARKDOWN,
    })

    rewritePlainTextFromSelection(editor, { clipboardData: clipboardData as unknown as DataTransfer })

    expect(clipboardData.getData('text/plain')).toBe(BLOCKNOTE_MARKDOWN)
  })

  it('选区读取异常时保持 BlockNote 原值', () => {
    const editor = {
      _tiptapEditor: {
        state: {
          selection: { from: 1, to: 10, empty: false },
          doc: {
            textBetween: vi.fn(() => {
              throw new Error('boom')
            }),
          },
        },
      },
    }
    const clipboardData = makeClipboardData({
      'blocknote/html': '<div>internal</div>',
      'text/plain': BLOCKNOTE_MARKDOWN,
    })

    expect(() =>
      rewritePlainTextFromSelection(editor, { clipboardData: clipboardData as unknown as DataTransfer }),
    ).not.toThrow()
    expect(clipboardData.getData('text/plain')).toBe(BLOCKNOTE_MARKDOWN)
  })
})

describe('attachPlainTextCopyHandling', () => {
  it('copy/cut 事件冒泡到 document 且目标在容器内时重写 text/plain', () => {
    const editor = makeFakeEditor(EXPECTED_PLAIN)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const target = document.createElement('span')
    container.appendChild(target)

    const cleanup = attachPlainTextCopyHandling(editor, () => container)

    for (const type of ['copy', 'cut'] as const) {
      const clipboardData = makeClipboardData({
        'blocknote/html': '<div>internal</div>',
        'text/plain': BLOCKNOTE_MARKDOWN,
      })
      const event = new Event(type, { bubbles: true }) as Event & { clipboardData: unknown }
      event.clipboardData = clipboardData
      Object.defineProperty(event, 'target', { value: target })
      document.dispatchEvent(event)

      expect(clipboardData.getData('text/plain')).toBe(EXPECTED_PLAIN)
    }

    cleanup()
    container.remove()
  })

  it('目标在容器外的事件不重写', () => {
    const editor = makeFakeEditor(EXPECTED_PLAIN)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const outside = document.createElement('span')
    document.body.appendChild(outside)

    const cleanup = attachPlainTextCopyHandling(editor, () => container)

    const clipboardData = makeClipboardData({
      'blocknote/html': '<div>internal</div>',
      'text/plain': BLOCKNOTE_MARKDOWN,
    })
    const event = new Event('copy', { bubbles: true }) as Event & { clipboardData: unknown }
    event.clipboardData = clipboardData
    Object.defineProperty(event, 'target', { value: outside })
    document.dispatchEvent(event)

    expect(clipboardData.getData('text/plain')).toBe(BLOCKNOTE_MARKDOWN)

    cleanup()
    container.remove()
    outside.remove()
  })

  it('清理函数移除监听后不再重写', () => {
    const editor = makeFakeEditor(EXPECTED_PLAIN)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const target = document.createElement('span')
    container.appendChild(target)

    const cleanup = attachPlainTextCopyHandling(editor, () => container)
    cleanup()

    const clipboardData = makeClipboardData({
      'blocknote/html': '<div>internal</div>',
      'text/plain': BLOCKNOTE_MARKDOWN,
    })
    const event = new Event('copy', { bubbles: true }) as Event & { clipboardData: unknown }
    event.clipboardData = clipboardData
    Object.defineProperty(event, 'target', { value: target })
    document.dispatchEvent(event)

    expect(clipboardData.getData('text/plain')).toBe(BLOCKNOTE_MARKDOWN)
    container.remove()
  })
})
