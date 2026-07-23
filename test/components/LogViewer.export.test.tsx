/**
 * Bug fix: LogViewer 导出按钮点击无效
 *
 * Root cause: handleExport 用 document.createElement('a') + Blob + URL.createObjectURL，
 * Tauri v2 webview 不支持 <a download> 触发文件保存。
 *
 * Expected: 点击导出按钮应调用 @tauri-apps/plugin-dialog save() 获取路径，
 * 再调用后端 write_file 命令写入 JSONL 内容。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockSave = vi.fn().mockResolvedValue(null)
const mockInvoke = vi.fn().mockResolvedValue(undefined)

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: (...args: unknown[]) => mockSave(...args),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { logStore } from '@/lib/logger'
import { LogViewer } from '@/components/LogViewer'

describe('Bug: LogViewer 导出按钮无效', () => {
  beforeEach(() => {
    logStore.clear()
    mockSave.mockClear()
    mockInvoke.mockClear()
    mockSave.mockResolvedValue(null)
  })

  it('点击导出按钮应调用 save dialog + write_file', async () => {
    logStore.push({ timestamp: 1, level: 'info', source: 'test', message: 'hello' })

    render(<LogViewer open={true} onOpenChange={() => {}} />)

    const exportBtn = screen.getByTitle('logViewer.export')
    fireEvent.click(exportBtn)

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledOnce()
    })

    // save() 返回 null（用户取消）时不调用 write_file
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('用户选择路径后应调用 write_file 写入 JSONL', async () => {
    logStore.push({ timestamp: 1, level: 'info', source: 'app', message: 'test log' })

    mockSave.mockResolvedValue('/tmp/export.jsonl')

    render(<LogViewer open={true} onOpenChange={() => {}} />)

    const exportBtn = screen.getByTitle('logViewer.export')
    fireEvent.click(exportBtn)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('write_file', {
        path: '/tmp/export.jsonl',
        content: expect.stringContaining('test log'),
      })
    })
  })
})
