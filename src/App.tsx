import '@/i18n'
import { TitleBar } from '@/components/TitleBar'
import { ActivityBar } from '@/components/ActivityBar'
import { Sidebar } from '@/components/Sidebar'
import { TabBar } from '@/components/TabBar'
import { EditorToolbar } from '@/components/EditorToolbar'
import { EditorView } from '@/components/Editor'
import { useTheme } from '@/hooks'

function App() {
  useTheme()

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
