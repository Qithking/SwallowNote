/**
 * 导出主题采集（宿主原语路线 C2）
 *
 * collectExportTheme() 读取当前生效的编辑器排版设置（CSS 变量）与主题色，
 * 生成与宿主 Rust `ExportTheme`（camelCase serde）同形的主题对象，
 * 经 export_docx / export_html 命令传入转换器 —— 导出样式跟随当前主题，
 * 而非固定常量。
 *
 * 挂载点：main.tsx 挂 `window.__snExportBridge`，导出插件（薄壳）经此调用。
 */
import { useEditorSettingsStore } from '@/stores/editorSettings'

/** 与 Rust ExportTheme 同形（camelCase）；数值均为 px，颜色为 CSS 颜色字符串 */
export interface ExportTheme {
  bodyFont: string
  bodySize: number
  lineHeight: number
  h1Size: number
  h2Size: number
  h3Size: number
  h4Size: number
  h5Size: number
  textColor: string
  linkColor: string
  borderColor: string
  codeFont: string
  codeSize: number
  codeBg: string
  quoteColor: string
  tableHeaderBg: string
}

/** 读取 CSS 变量的当前计算值（trim 后非空才返回） */
function cssVar(el: Element, name: string): string | null {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || null
}

/** 解析 px 数值，非法回退默认值 */
function px(el: Element, name: string, fallback: number): number {
  const v = cssVar(el, name)
  if (v) {
    const n = parseFloat(v)
    if (Number.isFinite(n) && n > 0) return n
  }
  return fallback
}

/**
 * 采集当前主题导出值。来源优先级：
 * - 排版数值：CSS 变量（editorSettings store 已同步到 :root），store 兜底
 * - 主题色：--text-primary / --text-link / --border-color / --bg-secondary /
 *   --text-secondary（useTheme 注入或 index.css :root 定义）
 * - 字体：编辑器节点 computed fontFamily（回退 documentElement）
 * - 代码：编辑器内 code 元素 computed（回退等宽栈）；底色回退 --bg-secondary
 */
export function collectExportTheme(): ExportTheme {
  const root = document.documentElement
  const editorEl =
    document.querySelector('.bn-editor') ??
    document.querySelector('.ProseMirror') ??
    root

  // 排版数值：CSS 变量优先（用户自定义后生效），store 当前值兜底
  const settings = useEditorSettingsStore.getState()

  // 代码字体：取编辑器内真实 code 元素的 computed 值，回退等宽栈
  const codeEl = editorEl.querySelector('code')
  const codeStyle = codeEl ? getComputedStyle(codeEl) : null
  const defaultCodeFont =
    '"SF Mono", Menlo, Monaco, Consolas, "Courier New", monospace'

  // 代码底色：优先代码块元素 computed 背景（排除透明），回退 --bg-secondary
  let codeBg = cssVar(root, '--bg-secondary') ?? '#f6f8fa'
  if (codeStyle && codeStyle.backgroundColor && codeStyle.backgroundColor !== 'rgba(0, 0, 0, 0)') {
    codeBg = codeStyle.backgroundColor
  }

  const getEditorFont = (el: Element): string => getComputedStyle(el).fontFamily

  return {
    bodyFont: getEditorFont(editorEl),
    bodySize: px(root, '--body-size', settings.bodySize || 14),
    lineHeight: (() => {
      const v = cssVar(root, '--line-height')
      if (v) {
        const n = parseFloat(v)
        if (Number.isFinite(n) && n > 0) return n
      }
      return settings.lineHeight || 1.6
    })(),
    h1Size: px(root, '--h1-size', settings.h1Size || 32),
    h2Size: px(root, '--h2-size', settings.h2Size || 24),
    h3Size: px(root, '--h3-size', settings.h3Size || 19),
    h4Size: px(root, '--h4-size', settings.h4Size || 16),
    h5Size: px(root, '--h5-size', settings.h5Size || 14),
    textColor: cssVar(root, '--text-primary') ?? '#333333',
    linkColor: cssVar(root, '--text-link') ?? '#0366d6',
    borderColor: cssVar(root, '--border-color') ?? '#dddddd',
    codeFont: codeStyle?.fontFamily || defaultCodeFont,
    codeSize: codeStyle
      ? parseFloat(codeStyle.fontSize) || px(root, '--font-size', 12)
      : px(root, '--font-size', 12),
    codeBg,
    quoteColor: cssVar(root, '--text-secondary') ?? '#666666',
    tableHeaderBg: cssVar(root, '--bg-secondary') ?? '#f6f8fa',
  }
}
