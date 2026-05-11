import '@/i18n'
import { TitleBar } from '@/components/TitleBar'
import { ActivityBar } from '@/components/ActivityBar'
import { Sidebar } from '@/components/Sidebar'
import { TabBar } from '@/components/TabBar'
import { EditorToolbar } from '@/components/EditorToolbar'
import { EditorView } from '@/components/Editor'
import { SettingsView } from '@/components/Settings/SettingsView'
import { useUIStore } from '@/stores'
import { useTheme } from '@/hooks'

function App() {
  useTheme()
  const { settingsPanelVisible, toastMessage } = useUIStore()

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

        {/* Sidebar - hidden when settings panel is open */}
        {!settingsPanelVisible && <Sidebar />}

        {/* Editor Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {settingsPanelVisible ? (
            <SettingsView />
          ) : (
            <>
              <TabBar />
              <EditorToolbar />
              <EditorView />
            </>
          )}
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[99999] px-4 py-2 rounded-md text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
          }}
        >
          {toastMessage}
        </div>
      )}
    </div>
  )
}

export { App }
