/**
 * Editor Component - Main editor area
 * Shows the content of the active tab with appropriate editor
 */
import { useEffect, useRef } from 'react'
import { useEditorStore } from '@/stores'
import { detectFileType } from '@/lib/utils/fileTypeUtils'
import { MarkdownEditor } from './editors/MarkdownEditor'
import { CodeEditor } from './editors/CodeEditor'
import DiffViewer from './DiffViewer/DiffViewer'
import { FileCode } from 'lucide-react'
import { Progress } from '@/components/ui/progress'

interface UnsupportedEditorProps {
  filename: string
  reason: string
}

function UnsupportedEditor({ filename, reason }: UnsupportedEditorProps) {
  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--bg-primary)]">
      <div className="text-center">
        <FileCode size={48} className="mx-auto mb-4 opacity-40" />
        <p className="text-lg text-[var(--text-muted)]">无法打开此文件</p>
        <p className="text-sm text-[var(--text-muted)] mt-2">{filename}</p>
        <p className="text-xs text-[var(--text-muted)] mt-1 opacity-60">{reason}</p>
      </div>
    </div>
  )
}

function WelcomeScreen() {
  return (
    <div className="flex-1 flex items-center justify-center  text-[var(--text-muted)]">
      <div className="text-center">
        <p className="text-lg">Welcome to SwallowNote</p>
        <p className="text-sm mt-2">Open a file or create a new one to start editing</p>
      </div>
    </div>
  )
}

export function EditorView() {
  const { tabs, activeTabId, updateTabContent, scrollToLine } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const scrollToLineRef = useRef(scrollToLine)

  // Listen for scroll-to-line events
  useEffect(() => {
    const handler = (e: Event) => {
      const line = (e as CustomEvent).detail.line
      scrollToLineRef.current?.(line)
    }
    window.addEventListener('scroll-to-line', handler)
    return () => window.removeEventListener('scroll-to-line', handler)
  }, [])

  if (!activeTab) {
    return <WelcomeScreen />
  }

  // Handle diff tab
  if (activeTab.type === 'diff') {
    return (
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <DiffViewer diffContent={activeTab.diffContent || ''} />
      </div>
    )
  }

  const fileType = detectFileType(activeTab.name, activeTab.content)
  const viewMode = activeTab.viewMode

  const handleContentChange = (content: string) => {
    updateTabContent(activeTab.id, content)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {activeTab.isLoading && (
        <div className="absolute top-0 left-0 right-0 z-10">
          <Progress />
        </div>
      )}

      {fileType === 'markdown' && (
        <div className="flex-1 overflow-hidden">
          {viewMode === 'source' ? (
            <CodeEditor
              content={activeTab.content}
              filename={activeTab.name}
              onChange={handleContentChange}
              className="flex-1"
            />
          ) : (
            <MarkdownEditor
              key={activeTab.id}
              content={activeTab.content}
              onChange={handleContentChange}
            />
          )}
        </div>
      )}

      {fileType === 'code' && (
        <div className="flex-1 flex overflow-hidden">
          <CodeEditor
            content={activeTab.content}
            filename={activeTab.name}
            onChange={handleContentChange}
            className="flex-1"
          />
        </div>
      )}

      {fileType === 'binary' && (
        <UnsupportedEditor
          filename={activeTab.name}
          reason="二进制文件无法在编辑器中显示"
        />
      )}

      {(fileType === 'unknown' || !fileType) && (
        <UnsupportedEditor
          filename={activeTab.name}
          reason="不支持的文件类型"
        />
      )}
    </div>
  )
}
