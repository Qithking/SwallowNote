/**
 * Export Plugin — External plugin entry
 *
 * Exports the current Markdown document to Word (.docx) or PDF.
 * - DOCX: Uses the plugin backend (JSON-RPC subprocess) with pulldown-cmark
 *   to parse markdown and docx-rs to generate the DOCX file.
 * - PDF: Uses the backend to convert markdown to styled HTML, then renders
 *   the HTML in a hidden iframe and captures it with html2canvas + jsPDF.
 *
 * This plugin is completely self-contained:
 * - Frontend: toolbarButton component with dropdown menu
 * - Backend: Rust binary in src-tauri/ (JSON-RPC over stdin/stdout)
 * - No code in the host application is specific to this plugin
 */
/* eslint-disable react-refresh/only-export-components */
import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import type { PluginManifest, PluginPanelProps, ToolbarButtonProps } from '@swallow-note/plugin-sdk'
// Re-export setHost so the host can install SDK overrides at runtime.
export { setHost } from '@swallow-note/plugin-sdk'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { jsPDF } from 'jspdf'
import { domToCanvas } from 'modern-screenshot'

// ─── Icon component ──────────────────────────────────────────────────────────

function ExportIcon({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

// ─── PDF generation helper ───────────────────────────────────────────────────

async function generatePdfFromHtml(htmlContent: string): Promise<Uint8Array> {
  // Create a hidden container div to render the HTML.
  // modern-screenshot uses getComputedStyle() instead of parsing CSS
  // stylesheets directly, so it handles modern CSS features like color()
  // correctly without throwing parsing errors.
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-9999px'
  container.style.top = '0'
  container.style.width = '794px'
  container.style.zIndex = '-1'
  container.style.background = '#fff'
  container.innerHTML = htmlContent
  document.body.appendChild(container)

  try {
    // Wait for rendering
    await new Promise((r) => setTimeout(r, 300))

    const body = container.querySelector('body') || container

    // Use modern-screenshot to capture the rendered HTML as a canvas
    const canvas = await domToCanvas(body as HTMLElement, {
      scale: 2,
      width: 794,
      backgroundColor: '#ffffff',
    })

    // Generate PDF with jsPDF
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()
    const imgWidth = pdfWidth
    const imgHeight = (canvas.height * pdfWidth) / canvas.width

    let heightLeft = imgHeight
    let position = 0

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
    heightLeft -= pdfHeight

    while (heightLeft > 0) {
      position -= pdfHeight
      pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pdfHeight
    }

    return new Uint8Array(pdf.output('arraybuffer'))
  } finally {
    document.body.removeChild(container)
  }
}

// ─── Toolbar button component (dropdown menu) ────────────────────────────────

function ExportToolbarButton(props: ToolbarButtonProps): ReactNode {
  const { size, invokeBackend, activeNoteContent, activeNotePath } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  // Derive note name from path
  const noteName = activeNotePath ? (activeNotePath.split('/').pop() || activeNotePath) : ''

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const handleExportDocx = useCallback(async () => {
    setMenuOpen(false)
    if (isExporting) return
    setIsExporting(true)
    try {
      const b64 = await invokeBackend('markdown_to_docx', { markdown: activeNoteContent }) as string
      const fileName = noteName.replace(/\.(md|markdown)$/i, '') + '.docx'
      const selected = await save({
        defaultPath: fileName,
        filters: [{ name: 'Word Document', extensions: ['docx'] }],
      })
      if (!selected) { setIsExporting(false); return }
      const filePath = (typeof selected === 'string' ? selected : selected as string).replace(/\\/g, '/')
      await invoke('write_binary_file', { path: filePath, data: b64 })
      toast.success(t('editorToolbar.exportSuccess', { defaultValue: '导出成功' }))
    } catch (err) {
      toast.error(t('editorToolbar.exportFailed', { defaultValue: '导出失败' }), { description: String(err) })
    } finally {
      setIsExporting(false)
    }
  }, [activeNoteContent, noteName, isExporting, invokeBackend, t])

  const handleExportPdf = useCallback(async () => {
    setMenuOpen(false)
    if (isExporting) return
    setIsExporting(true)
    try {
      // Step 1: Get styled HTML from backend
      const html = await invokeBackend('markdown_to_html', { markdown: activeNoteContent }) as string
      // Step 2: Render HTML and generate PDF
      const pdfBytes = await generatePdfFromHtml(html)
      // Step 3: Save PDF file
      const fileName = noteName.replace(/\.(md|markdown)$/i, '') + '.pdf'
      const selected = await save({
        defaultPath: fileName,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      })
      if (!selected) { setIsExporting(false); return }
      const filePath = (typeof selected === 'string' ? selected : selected as string).replace(/\\/g, '/')
      // Convert Uint8Array to base64 for write_binary_file
      const b64 = btoa(String.fromCharCode(...pdfBytes))
      await invoke('write_binary_file', { path: filePath, data: b64 })
      toast.success(t('editorToolbar.exportSuccess', { defaultValue: '导出成功' }))
    } catch (err) {
      toast.error(t('editorToolbar.exportPdfFailed', { defaultValue: 'PDF 导出失败' }), { description: String(err) })
    } finally {
      setIsExporting(false)
    }
  }, [activeNoteContent, noteName, isExporting, invokeBackend, t])

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
        style={{ color: menuOpen ? 'var(--theme-color)' : 'var(--text-primary)' }}
      >
        <ExportIcon size={size} />
      </button>
      {menuOpen && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-lg py-1 min-w-[140px]"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          <button
            onClick={handleExportDocx}
            disabled={isExporting}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-50"
            style={{ color: 'var(--text-primary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <span style={{ fontSize: 10 }}>W</span>
            {t('editorToolbar.exportWord', { defaultValue: '导出为 Word' })}
          </button>
          <button
            onClick={handleExportPdf}
            disabled={isExporting}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-50"
            style={{ color: 'var(--text-primary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <span style={{ fontSize: 10 }}>P</span>
            {t('editorToolbar.exportPdf', { defaultValue: '导出为 PDF' })}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Placeholder panel ────────────────────────────────────────────────────

function ExportPanel(_props: PluginPanelProps): ReactNode {
  return null
}

// ─── Manifest ─────────────────────────────────────────────────────────────

const manifest: PluginManifest = {
  id: 'com.swallownote.export',
  name: '文档导出',
  description: '将 Markdown 文档导出为 Word (.docx) 或 PDF 格式',
  version: '0.1.0',
  author: 'SwallowNote',
  publishedAt: '2026-06-13',
  iconPosition: 'editorToolbar',
  contentPosition: 'editorArea',
  order: 50,
  enabled: true,
  hasBackend: true,
  icon: ExportIcon,
  panel: ExportPanel,
  toolbarButton: ExportToolbarButton,
  permissions: ['backend'],
}

export default manifest
