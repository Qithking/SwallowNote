/**
 * I7 回归测试：export 插件 DOCX 导出必须向后端传递 snake_case 参数键。
 *
 * 后端 plugins/export/src-tauri/src/main.rs 读取 `image_assets` /
 * `rendered_assets`；此前前端误传 camelCase（imageAssets / renderedAssets），
 * 后端永远取到空 map → DOCX 中图片与预渲染图静默丢失。
 * 本测试挂载工具栏按钮，点击「导出为 Word」，断言 invokeBackend 传参键名
 * 与后端契约一致。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

// ── 运行环境注入 ──
// 插件从自身 node_modules 解析 @tauri-apps/api，vi.mock 无法拦截；
// 两个 API（invoke / convertFileSrc）都走 window.__TAURI_INTERNALS__，
// 故直接注入伪 internals（等价于宿主 webview 环境），见 beforeEach。
const saveDialogPath = '/tmp/notes/export-out.docx'

vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn().mockReturnValue('toast-id'),
    dismiss: vi.fn(),
  })
  return { toast }
})

import { ExportToolbarButton } from '../../plugins/export/src/index'
import type { ToolbarButtonProps } from '@swallow-note/plugin-sdk'

function makeProps(overrides: Partial<ToolbarButtonProps> = {}): ToolbarButtonProps {
  return {
    size: 18,
    isActive: true,
    pluginId: 'export',
    invokeBackend: vi.fn().mockResolvedValue('Zm9v'), // base64("foo")
    invokeBackendStream: vi.fn(),
    store: {},
    events: {},
    activate: vi.fn(),
    deactivate: vi.fn(),
    activeNoteContent: '# Hello\n\n![img](assets/pic.png)\n',
    activeNotePath: '/tmp/notes/note.md',
    activeNoteName: 'note.md',
    activeNoteExt: 'md',
    isActiveNoteMarkdown: true,
    getSetting: vi.fn().mockResolvedValue(null),
    setSetting: vi.fn().mockResolvedValue(undefined),
    getAllSettings: vi.fn().mockResolvedValue({}),
    onSettingsChange: vi.fn().mockReturnValue(() => {}),
    getActiveNoteFrontmatter: vi.fn().mockReturnValue(null),
    setActiveNoteFrontmatter: vi.fn(),
    onNoteFrontmatterChanged: vi.fn().mockReturnValue(() => {}),
    editor: {},
    files: {},
    secureStorage: {},
    ...overrides,
  } as unknown as ToolbarButtonProps
}

describe('export 插件 DOCX 参数键名契约（I7）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 伪 Tauri internals：convertFileSrc 返回可识别 URL；invoke 拦截保存对话框
    ;(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
      invoke: (cmd: string) =>
        cmd === 'plugin:dialog|save' ? Promise.resolve(saveDialogPath) : Promise.resolve(undefined),
    }
    // 插件私有 i18n 按 __SWALLOW_LOCALE__ 取文案，固定中文便于选择器断言
    ;(window as unknown as { __SWALLOW_LOCALE__?: string }).__SWALLOW_LOCALE__ = 'zh-CN'
    // collectImageAssets 通过 asset 协议 fetch 图片字节
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]),
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    delete (window as unknown as { __SWALLOW_LOCALE__?: string }).__SWALLOW_LOCALE__
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('markdown_to_docx 传参使用 snake_case 键 image_assets / rendered_assets', async () => {
    const invokeBackend = vi.fn().mockResolvedValue('Zm9v')
    render(<ExportToolbarButton {...makeProps({ invokeBackend })} />)

    // 打开下拉菜单 → 点击「导出为 Word」
    fireEvent.click(screen.getByRole('button', { name: '导出当前笔记' }))
    fireEvent.click(screen.getByRole('button', { name: /导出为 Word/ }))

    await waitFor(() => {
      expect(invokeBackend).toHaveBeenCalledWith('markdown_to_docx', expect.any(Object))
    })

    const [, args] = invokeBackend.mock.calls[0] as [string, Record<string, unknown>]
    expect(args).toHaveProperty('image_assets')
    expect(args).toHaveProperty('rendered_assets')
    // 防回归：camelCase 键不得再出现
    expect(args).not.toHaveProperty('imageAssets')
    expect(args).not.toHaveProperty('renderedAssets')
    // image_assets 内容应为 url → base64 映射，且图片字节确实被收集
    expect(Object.keys(args.image_assets as Record<string, string>)).toEqual(['assets/pic.png'])
    expect((args.image_assets as Record<string, string>)['assets/pic.png'].length).toBeGreaterThan(0)
  })
})
