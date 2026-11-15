/**
 * I10 回归测试：历史记录点击打开 diff 失败必须有提示。
 *
 * 此前 HistoryView 直接调用 `openDiffTab(...)` 无 catch——gitShowDiff
 * 拒绝时 unhandled rejection，既无 diff tab 也无任何提示。
 * 修复后 catch 并 toast 提示用户。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('sonner', () => ({ toast: vi.fn(), Toaster: () => null }))
vi.mock('@/lib/tauri', () => ({
  gitFileLog: vi.fn().mockResolvedValue([
    { hash: 'abc123def456', message: 'first commit', date: '2026-11-14', insertions: 1, deletions: 0 },
  ]),
  gitShowDiff: vi.fn().mockRejectedValue(new Error('refusing to diff')),
  gitShowFileContent: vi.fn().mockResolvedValue(''),
  gitPullFileLatest: vi.fn().mockResolvedValue(undefined),
  gitForceUploadFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { HistoryView } from '@/components/History/HistoryView'
import { useEditorStore } from '@/stores'

function setActiveTab() {
  useEditorStore.setState({
    activeTabId: 'tab-1',
    tabs: [{
      id: 'tab-1',
      path: '/repo/note.md',
      name: 'note.md',
      content: 'x',
      isDirty: false,
      isEdited: false,
      viewMode: 'preview' as const,
    }],
  })
}

describe('HistoryView diff 打开失败提示（I10）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActiveTab()
  })

  it('gitShowDiff 拒绝时弹 toast 而不是静默失败', async () => {
    render(<TooltipProvider><HistoryView visible={true} /></TooltipProvider>)
    // 等历史条目加载完成
    await waitFor(() => screen.getByText('first commit'))

    fireEvent.click(screen.getByText('first commit'))

    await waitFor(() => {
      expect(toast).toHaveBeenCalled()
    })
    // i18n 为真实实例（zh-CN 默认语言），断言实际文案
    expect(toast).toHaveBeenCalledWith(
      '打开历史 diff 失败',
      expect.objectContaining({ description: 'refusing to diff' })
    )
  })

  it('gitShowDiff 成功时不弹 toast（回归保护）', async () => {
    const { gitShowDiff } = await import('@/lib/tauri')
    vi.mocked(gitShowDiff).mockResolvedValueOnce('diff --git a/x b/x')
    render(<TooltipProvider><HistoryView visible={true} /></TooltipProvider>)
    await waitFor(() => screen.getByText('first commit'))
    fireEvent.click(screen.getByText('first commit'))

    // 打开 diff 属于 store 行为，此处仅断言无错误 toast
    await new Promise((r) => setTimeout(r, 20))
    expect(toast).not.toHaveBeenCalled()
  })
})
