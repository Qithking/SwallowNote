/** 插件私有 i18n 字符串，不依赖 react-i18next */

export type ExportLocale = 'zh-CN' | 'en'

interface ExportStrings {
  wordMenu: string
  pdfMenu: string
  /** 导出为浏览器可渲染的 HTML 文档 */
  htmlMenu: string
  exportSuccess: string
  exportFailed: string
  pdfExportFailed: string
  /** HTML 导出失败（取消保存对话框不算失败） */
  htmlExportFailed: string
  /** 生成文件时的 loading toast 标题 */
  generating: string
  /** 当前笔记为空时返回 */
  emptyNote: string
  /** 后端拒绝请求时返回 */
  tooLarge: string
  /** 导出下拉触发器的 tooltip / aria-label */
  tooltip: string
}

const zhCN: ExportStrings = {
  wordMenu: '导出为 Word',
  pdfMenu: '导出为 PDF',
  htmlMenu: '导出为 HTML',
  exportSuccess: '导出成功',
  exportFailed: '导出失败',
  pdfExportFailed: 'PDF 导出失败',
  htmlExportFailed: 'HTML 导出失败',
  generating: '正在生成…',
  emptyNote: '当前笔记为空，无需导出',
  tooLarge: '文档过大，无法导出',
  tooltip: '导出当前笔记',
}

const en: ExportStrings = {
  wordMenu: 'Export as Word',
  pdfMenu: 'Export as PDF',
  htmlMenu: 'Export as HTML',
  exportSuccess: 'Export complete',
  exportFailed: 'Export failed',
  pdfExportFailed: 'PDF export failed',
  htmlExportFailed: 'HTML export failed',
  generating: 'Generating…',
  emptyNote: 'The current note is empty, nothing to export',
  tooLarge: 'Document too large to export',
  tooltip: 'Export the current note',
}

/** 返回指定 locale 的字符串，默认中文，其余回退英文 */
export function getStrings(locale: string | undefined | null): ExportStrings {
  if (!locale) return zhCN
  const normalised = locale.toLowerCase()
  if (normalised.startsWith('zh')) return zhCN
  if (normalised.startsWith('en')) return en
  return en
}
