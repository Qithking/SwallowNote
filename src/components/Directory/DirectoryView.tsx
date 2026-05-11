/**
 * DirectoryView Component - Document outline/TOC panel
 */
import { useState, useEffect } from 'react'
import { FileText } from 'lucide-react'
import { useEditorStore } from '@/stores'

interface TocItem {
  id: string
  text: string
  level: number
}

function extractToc(content: string): TocItem[] {
  const lines = content.split('\n')
  const toc: TocItem[] = []
  
  lines.forEach((line, index) => {
    // Match markdown headers (# ## ### etc.)
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      toc.push({
        id: `heading-${index}`,
        text: match[2],
        level: match[1].length,
      })
    }
  })
  
  return toc
}

function DirectoryView() {
  const { tabs, activeTabId } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const [toc, setToc] = useState<TocItem[]>([])

  useEffect(() => {
    if (activeTab?.content) {
      setToc(extractToc(activeTab.content))
    }
  }, [activeTab?.content])

  if (!activeTab) {
    return (
      <div className="flex flex-col h-full w-[300px]">
        <div className="flex items-center h-10 px-3 shrink-0 border-b" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
          <div className="flex items-center gap-2">
            <FileText size={14} style={{ color: 'var(--text-muted)' }} />
            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>目录</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
          <p className="text-sm">未打开文件</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full w-[300px]">
      <div className="flex items-center h-10 px-3 shrink-0 border-b" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
        <div className="flex items-center gap-2">
          <FileText size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>目录</span>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {toc.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
            <p className="text-sm">无目录</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {toc.map((item) => (
              <li
                key={item.id}
                className="text-sm cursor-pointer hover:text-[var(--text-primary)] truncate"
                style={{
                  paddingLeft: `${(item.level - 1) * 12 + 4}px`,
                  color: 'var(--text-secondary)',
                }}
              >
                {item.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export { DirectoryView }