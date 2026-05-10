import '@/i18n'
import { useEffect } from 'react'
import { TitleBar } from '@/components/TitleBar'
import { ActivityBar } from '@/components/ActivityBar'
import { Sidebar } from '@/components/Sidebar'
import { TabBar } from '@/components/TabBar'
import { EditorToolbar } from '@/components/EditorToolbar'
import { EditorView } from '@/components/Editor'
import { StatusBar } from '@/components/StatusBar'
import { useTheme } from '@/hooks'
import { useEditorStore, useUIStore } from '@/stores'
import { demoContent, demoDirtyContent } from '@/lib/demoData'

function App() {
  useTheme()

  // Auto-open demo tabs on first launch
  useEffect(() => {
    const { tabs, addTab } = useEditorStore.getState()
    if (tabs.length === 0) {
      addTab({
        id: 'demo-tab-1',
        path: 'traeProjects/world_hello/Cargo.toml',
        name: 'markdown.md',
        content: demoContent,
        isDirty: false,
        fileSize: '13Kb',
        modifiedTime: '2026/5/16 11:12:00',
        wordCount: 180,
      })
      addTab({
        id: 'demo-tab-2',
        path: 'traeProjects/world_hello/README.md',
        name: 'draft.md',
        content: demoDirtyContent,
        isDirty: true,
        fileSize: '2.4Kb',
        modifiedTime: '2026/5/16 11:12:00',
        wordCount: 85,
      })
    }
  }, [])

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 13 }}
    >
      {/* Title Bar */}
      <TitleBar />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Activity Bar */}
        <ActivityBar />

        {/* Sidebar */}
        <Sidebar />

        {/* Editor Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <TabBar />
          <EditorToolbar />
          <EditorView />
        </div>
      </div>
    </div>
  )
}

export { App }
