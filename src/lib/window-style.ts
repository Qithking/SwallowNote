/**
 * 按平台应用窗口样式（圆角等）。
 * 从 App.tsx init 流程抽取为独立函数，便于单测覆盖。
 */
import { enableModernWindowStyle } from '@cloudworxx/tauri-plugin-mac-rounded-corners'

/**
 * 根据平台应用窗口样式。
 * - linux：CSS 圆角 12px
 * - windows：原生圆角 + CSS 圆角 8px（匹配 Win11 DWM 圆角避免黑角）
 * - macos：不启用原生窗口样式——enableModernWindowStyle 会通过
 *   NSTitledWindowMask 恢复系统红绿灯按钮（与自定义窗口控制冲突），
 *   圆角由 index.css 的 html/body border-radius + 透明窗口提供
 */
export async function applyWindowStyle(platform: string): Promise<void> {
  if (platform === 'linux') {
    document.documentElement.style.borderRadius = '12px'
    document.body.style.borderRadius = '12px'
  } else if (platform === 'windows') {
    await enableModernWindowStyle({ cornerRadius: 12 })
    // Windows 11 圆角需匹配 border-radius 避免黑角
    document.documentElement.style.borderRadius = '8px'
    document.body.style.borderRadius = '8px'
  }
}
