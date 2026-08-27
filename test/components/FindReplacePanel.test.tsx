/**
 * FindReplacePanel 组件测试
 * Source: plan/editor-find-replace step 3
 *
 * AC-3, AC-4, AC-5: CodeMirror 完整版(查找+替换+三选项)
 * AC-6, AC-7, AC-8: BlockNote 简化版(查找+替换+大小写敏感)
 * AC-9: Enter 下一个, Shift+Enter 上一个, Esc 关闭
 * AC-10: 关闭时调用 onClose
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'editorToolbar.findReplace.matchCount' && params) {
        return `${params.current}/${params.total}`
      }
      return key
    },
  }),
}))

import { FindReplacePanel } from '@/components/FindReplacePanel'

describe('FindReplacePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('CodeMirror editor type', () => {
    it('AC-4: 应渲染替换输入框与替换/全部替换按钮', () => {
      render(
        <FindReplacePanel
          visible={true}
          editorType="codemirror"
          matchCount={{ current: 0, total: 0 }}
          onClose={vi.fn()}
          onQueryChange={vi.fn()}
          onReplaceTextChange={vi.fn()}
          onFindNext={vi.fn()}
          onFindPrev={vi.fn()}
          onReplaceNext={vi.fn()}
          onReplaceAll={vi.fn()}
        />,
      )
      expect(screen.getByPlaceholderText('editorToolbar.findReplace.replace')).toBeInTheDocument()
      expect(screen.getByTitle('editorToolbar.findReplace.replaceAll')).toBeInTheDocument()
    })

    it('CM 正则无效时应显示 error 提示', () => {
      render(
        <FindReplacePanel
          visible={true}
          editorType="codemirror"
          matchCount={{ current: 0, total: 0 }}
          error="editorToolbar.findReplace.invalidRegex"
          onClose={vi.fn()}
          onQueryChange={vi.fn()}
          onReplaceTextChange={vi.fn()}
          onFindNext={vi.fn()}
          onFindPrev={vi.fn()}
          onReplaceNext={vi.fn()}
          onReplaceAll={vi.fn()}
        />,
      )
      expect(screen.getByText('editorToolbar.findReplace.invalidRegex')).toBeInTheDocument()
    })

    it('AC-5: 应渲染三个选项 toggle (大小写敏感/全词匹配/正则表达式)', () => {
      render(
        <FindReplacePanel
          visible={true}
          editorType="codemirror"
          matchCount={{ current: 0, total: 0 }}
          onClose={vi.fn()}
          onQueryChange={vi.fn()}
          onReplaceTextChange={vi.fn()}
          onFindNext={vi.fn()}
          onFindPrev={vi.fn()}
          onReplaceNext={vi.fn()}
          onReplaceAll={vi.fn()}
        />,
      )
      expect(screen.getByTitle('editorToolbar.findReplace.caseSensitive')).toBeInTheDocument()
      expect(screen.getByTitle('editorToolbar.findReplace.wholeWord')).toBeInTheDocument()
      expect(screen.getByTitle('editorToolbar.findReplace.regexp')).toBeInTheDocument()
    })

    it('AC-9: 输入框按 Enter 应触发 onFindNext', () => {
      const onFindNext = vi.fn()
      render(
        <FindReplacePanel
          visible={true}
          editorType="codemirror"
          matchCount={{ current: 0, total: 0 }}
          onClose={vi.fn()}
          onQueryChange={vi.fn()}
          onReplaceTextChange={vi.fn()}
          onFindNext={onFindNext}
          onFindPrev={vi.fn()}
          onReplaceNext={vi.fn()}
          onReplaceAll={vi.fn()}
        />,
      )
      const input = screen.getByPlaceholderText('editorToolbar.findReplace.find')
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onFindNext).toHaveBeenCalled()
    })

    it('AC-9: 输入框按 Shift+Enter 应触发 onFindPrev', () => {
      const onFindPrev = vi.fn()
      render(
        <FindReplacePanel
          visible={true}
          editorType="codemirror"
          matchCount={{ current: 0, total: 0 }}
          onClose={vi.fn()}
          onQueryChange={vi.fn()}
          onReplaceTextChange={vi.fn()}
          onFindNext={vi.fn()}
          onFindPrev={onFindPrev}
          onReplaceNext={vi.fn()}
          onReplaceAll={vi.fn()}
        />,
      )
      const input = screen.getByPlaceholderText('editorToolbar.findReplace.find')
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
      expect(onFindPrev).toHaveBeenCalled()
    })

    it('AC-9: 按 Esc 应触发 onClose', () => {
      const onClose = vi.fn()
      render(
        <FindReplacePanel
          visible={true}
          editorType="codemirror"
          matchCount={{ current: 0, total: 0 }}
          onClose={onClose}
          onQueryChange={vi.fn()}
          onReplaceTextChange={vi.fn()}
          onFindNext={vi.fn()}
          onFindPrev={vi.fn()}
          onReplaceNext={vi.fn()}
          onReplaceAll={vi.fn()}
        />,
      )
      const input = screen.getByPlaceholderText('editorToolbar.findReplace.find')
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(onClose).toHaveBeenCalled()
    })

    it('应显示匹配计数 current/total', () => {
      render(
        <FindReplacePanel
          visible={true}
          editorType="codemirror"
          matchCount={{ current: 3, total: 7 }}
          onClose={vi.fn()}
          onQueryChange={vi.fn()}
          onReplaceTextChange={vi.fn()}
          onFindNext={vi.fn()}
          onFindPrev={vi.fn()}
          onReplaceNext={vi.fn()}
          onReplaceAll={vi.fn()}
        />,
      )
      expect(screen.getByText('3/7')).toBeInTheDocument()
    })

    it('visible=false 时不渲染', () => {
      const { container } = render(
        <FindReplacePanel
          visible={false}
          editorType="codemirror"
          matchCount={{ current: 0, total: 0 }}
          onClose={vi.fn()}
          onQueryChange={vi.fn()}
          onReplaceTextChange={vi.fn()}
          onFindNext={vi.fn()}
          onFindPrev={vi.fn()}
          onReplaceNext={vi.fn()}
          onReplaceAll={vi.fn()}
        />,
      )
      expect(container.firstChild).toBeNull()
    })
  })

  describe('BlockNote editor type', () => {
    it('AC-7: BN 模式应渲染替换输入框与替换/全部替换按钮', () => {
      render(
        <FindReplacePanel
          visible={true}
          editorType="blocknote"
          matchCount={{ current: 0, total: 0 }}
          onClose={vi.fn()}
          onQueryChange={vi.fn()}
          onReplaceTextChange={vi.fn()}
          onFindNext={vi.fn()}
          onFindPrev={vi.fn()}
          onReplaceNext={vi.fn()}
          onReplaceAll={vi.fn()}
        />,
      )
      expect(screen.getByPlaceholderText('editorToolbar.findReplace.replace')).toBeInTheDocument()
      expect(screen.getByTitle('editorToolbar.findReplace.replace')).toBeInTheDocument()
      expect(screen.getByTitle('editorToolbar.findReplace.replaceAll')).toBeInTheDocument()
    })

    it('AC-8: 仅显示大小写敏感 toggle,不显示全词匹配与正则', () => {
      render(
        <FindReplacePanel
          visible={true}
          editorType="blocknote"
          matchCount={{ current: 0, total: 0 }}
          onClose={vi.fn()}
          onQueryChange={vi.fn()}
          onReplaceTextChange={vi.fn()}
          onFindNext={vi.fn()}
          onFindPrev={vi.fn()}
          onReplaceNext={vi.fn()}
          onReplaceAll={vi.fn()}
        />,
      )
      expect(screen.getByTitle('editorToolbar.findReplace.caseSensitive')).toBeInTheDocument()
      expect(screen.queryByTitle('editorToolbar.findReplace.wholeWord')).toBeNull()
      expect(screen.queryByTitle('editorToolbar.findReplace.regexp')).toBeNull()
    })

    it('AC-6: 应显示匹配计数', () => {
      render(
        <FindReplacePanel
          visible={true}
          editorType="blocknote"
          matchCount={{ current: 2, total: 5 }}
          onClose={vi.fn()}
          onQueryChange={vi.fn()}
          onReplaceTextChange={vi.fn()}
          onFindNext={vi.fn()}
          onFindPrev={vi.fn()}
          onReplaceNext={vi.fn()}
          onReplaceAll={vi.fn()}
        />,
      )
      expect(screen.getByText('2/5')).toBeInTheDocument()
    })
  })

  describe('query input', () => {
    it('输入文本应触发 onQueryChange', () => {
      const onQueryChange = vi.fn()
      render(
        <FindReplacePanel
          visible={true}
          editorType="codemirror"
          matchCount={{ current: 0, total: 0 }}
          onClose={vi.fn()}
          onQueryChange={onQueryChange}
          onReplaceTextChange={vi.fn()}
          onFindNext={vi.fn()}
          onFindPrev={vi.fn()}
          onReplaceNext={vi.fn()}
          onReplaceAll={vi.fn()}
        />,
      )
      const input = screen.getByPlaceholderText('editorToolbar.findReplace.find')
      fireEvent.change(input, { target: { value: 'hello' } })
      expect(onQueryChange).toHaveBeenCalledWith('hello', { caseSensitive: false, wholeWord: false, regexp: false })
    })

    it('输入框应能输入并显示内容', () => {
      render(
        <FindReplacePanel
          visible={true}
          editorType="codemirror"
          matchCount={{ current: 0, total: 0 }}
          onClose={vi.fn()}
          onQueryChange={vi.fn()}
          onReplaceTextChange={vi.fn()}
          onFindNext={vi.fn()}
          onFindPrev={vi.fn()}
          onReplaceNext={vi.fn()}
          onReplaceAll={vi.fn()}
        />,
      )
      const input = screen.getByPlaceholderText('editorToolbar.findReplace.find') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'world' } })
      expect(input.value).toBe('world')
    })
  })

  describe('toggle buttons', () => {
    it('点击 caseSensitive toggle 应触发 onQueryChange 并携带 caseSensitive=true', () => {
      const onQueryChange = vi.fn()
      render(
        <FindReplacePanel
          visible={true}
          editorType="codemirror"
          matchCount={{ current: 0, total: 0 }}
          onClose={vi.fn()}
          onQueryChange={onQueryChange}
          onReplaceTextChange={vi.fn()}
          onFindNext={vi.fn()}
          onFindPrev={vi.fn()}
          onReplaceNext={vi.fn()}
          onReplaceAll={vi.fn()}
        />,
      )
      fireEvent.click(screen.getByTitle('editorToolbar.findReplace.caseSensitive'))
      expect(onQueryChange).toHaveBeenCalledWith('', { caseSensitive: true, wholeWord: false, regexp: false })
    })
  })
})
