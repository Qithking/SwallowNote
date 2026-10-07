import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock 原生窗口样式包：enableModernWindowStyle 会触发 Tauri IPC 修改 NSWindow，
// 单测只验证调用与否（调用即意味着恢复系统红绿灯按钮）
vi.mock('@cloudworxx/tauri-plugin-mac-rounded-corners', () => ({
  enableModernWindowStyle: vi.fn().mockResolvedValue(undefined),
}))

import { enableModernWindowStyle } from '@cloudworxx/tauri-plugin-mac-rounded-corners'
import { applyWindowStyle } from '@/lib/window-style'

describe('窗口样式按平台应用', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 重置 jsdom 上残留的内联圆角样式，避免用例间串扰
    document.documentElement.style.borderRadius = ''
    document.body.style.borderRadius = ''
  })

  it('macOS 下不启用原生窗口样式（系统红绿灯按钮不应显示，窗口控制使用 TitleBar 自定义按钮）', async () => {
    await applyWindowStyle('macos')
    expect(enableModernWindowStyle).not.toHaveBeenCalled()
  })

  it('Windows 下保持启用原生窗口样式并设置 8px CSS 圆角（现有行为保护）', async () => {
    await applyWindowStyle('windows')
    expect(enableModernWindowStyle).toHaveBeenCalledWith({ cornerRadius: 12 })
    expect(document.documentElement.style.borderRadius).toBe('8px')
    expect(document.body.style.borderRadius).toBe('8px')
  })

  it('Linux 下仅设置 12px CSS 圆角（现有行为保护）', async () => {
    await applyWindowStyle('linux')
    expect(enableModernWindowStyle).not.toHaveBeenCalled()
    expect(document.documentElement.style.borderRadius).toBe('12px')
    expect(document.body.style.borderRadius).toBe('12px')
  })
})
