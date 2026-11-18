/**
 * 回归测试：全屏遮罩必须跟随应用窗口 12px 圆角。
 *
 * 背景：Tauri 窗口 decorations(false)+transparent(true)，应用圆角完全靠 CSS
 * （html/body 的 12px 圆角）。但 Dialog/AlertDialog 的遮罩是 portal 到 body 的
 * fixed 元素——fixed 元素包含块是 viewport，不受祖先圆角+overflow 裁剪，
 * 会直角绘制到窗口透明四角，与圆角外观不一致。
 *
 * 修复语义：所有 fixed inset-0 全屏遮罩统一携带 rounded-[var(--app-radius)]，
 * 圆角值单一来源（index.css 的 --app-radius），防止两处 12px 漂移。
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'

import { Dialog, DialogContent } from '../dialog'
import { AlertDialog, AlertDialogContent } from '../alert-dialog'

const RADIUS_CLASS = 'rounded-[var(--app-radius)]'

/** 逐行检查含 "fixed inset-0" 的 JSX 行必须携带遮罩圆角类（覆盖内联遮罩防回归） */
function expectFixedOverlayLinesHaveRadius(source: string, file: string) {
  const overlayLines = source.split('\n').filter((l) => l.includes('fixed inset-0'))
  expect(overlayLines.length, `${file} 应存在全屏遮罩行`).toBeGreaterThan(0)
  for (const line of overlayLines) {
    expect(line, `${file} 的遮罩行缺少窗口圆角类`).toContain(RADIUS_CLASS)
  }
}

describe('全屏遮罩跟随应用窗口圆角（遮罩直角回归）', () => {
  it('Dialog overlay 渲染后携带窗口圆角类', () => {
    render(
      <Dialog open>
        <DialogContent>
          <div>dialog body</div>
        </DialogContent>
      </Dialog>
    )
    const overlay = document.querySelector('div[class*="bg-black/80"]')
    expect(overlay).not.toBeNull()
    expect(overlay!.className).toContain(RADIUS_CLASS)
  })

  it('AlertDialog overlay 渲染后携带窗口圆角类', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <div>alert body</div>
        </AlertDialogContent>
      </AlertDialog>
    )
    const overlay = document.querySelector('div[class*="bg-black/50"]')
    expect(overlay).not.toBeNull()
    expect(overlay!.className).toContain(RADIUS_CLASS)
  })

  it('ConflictResolver 内联全屏遮罩携带窗口圆角类', () => {
    const source = readFileSync('src/components/DiffViewer/ConflictResolver.tsx', 'utf8')
    expectFixedOverlayLinesHaveRadius(source, 'ConflictResolver.tsx')
  })

  it('TitleBarRecentPopover 内联全屏遮罩携带窗口圆角类', () => {
    const source = readFileSync('src/components/TitleBarRecentPopover.tsx', 'utf8')
    expectFixedOverlayLinesHaveRadius(source, 'TitleBarRecentPopover.tsx')
  })
})
