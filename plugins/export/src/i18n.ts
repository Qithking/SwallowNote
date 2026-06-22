/**
 * Plugin-private i18n strings.
 *
 * The plugin is shipped as a self-contained package and previously
 * looked up labels via `react-i18next`'s `t()` against the host's
 * locale catalogue. That works in dev but produces hidden
 * `defaultValue` fallbacks that the host's i18n audit tools can't
 * find. This module keeps the strings next to the plugin so
 * future locale additions don't have to round-trip through the
 * host.
 *
 * Adding a new locale: copy the `zhCN` shape, fill it in, and
 * extend the `getStrings()` switch. We don't depend on
 * `react-i18next` so the plugin bundle stays small.
 */

export type ExportLocale = 'zh-CN' | 'en'

interface ExportStrings {
  wordMenu: string
  pdfMenu: string
  /** Export the active note as a complete, browser-renderable HTML
   *  document (the same one the PDF path uses internally, but
   *  saved as a .html file the user can open in any browser). */
  htmlMenu: string
  exportSuccess: string
  exportFailed: string
  pdfExportFailed: string
  /** Shown when HTML export specifically fails (a save-dialog
   *  cancel is *not* a failure — this fires for backend errors,
   *  write errors, etc.). */
  htmlExportFailed: string
  /** Title used in the loading toast while generating a file. */
  generating: string
  /** Returned when the active note is empty and the user clicks anyway. */
  emptyNote: string
  /** Returned when the backend rejects the request. */
  tooLarge: string
  /** Toolbar tooltip / aria-label for the export dropdown trigger. */
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

/**
 * Return the strings for the given locale. We default to
 * Simplified Chinese because the host's primary user base is
 * Chinese-speaking; English is the second supported locale. Any
 * other value falls back to English.
 */
export function getStrings(locale: string | undefined | null): ExportStrings {
  if (!locale) return zhCN
  const normalised = locale.toLowerCase()
  if (normalised.startsWith('zh')) return zhCN
  if (normalised.startsWith('en')) return en
  return en
}
