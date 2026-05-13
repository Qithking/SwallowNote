import '@/i18n'
import { TitleBar } from '@/components/TitleBar'
import { ActivityBar } from '@/components/ActivityBar'
import { Sidebar } from '@/components/Sidebar'
import { TabBar } from '@/components/TabBar'
import { EditorToolbar } from '@/components/EditorToolbar'
import { EditorView } from '@/components/Editor'
import { SettingsView } from '@/components/Settings/SettingsView'
import { AIView } from '@/components/AI/AIView'
import { DirectoryView } from '@/components/Directory/DirectoryView'
import { HistoryView } from '@/components/History/HistoryView'
import { useUIStore } from '@/stores'
import { useTheme } from '@/hooks'
import { TooltipProvider } from '@/components'
import { ToastProvider, ToastViewport, Toast, ToastClose, ToastDescription, toastVariants, toastViewportVariants, toastCloseVariants, toastDescriptionVariants } from '@/components/ui/toast'
import { AlertCircle, CheckCircle, Info } from 'lucide-react'

function App() {
  useTheme()
  const { settingsPanelVisible, toasts, dismissToast, rightPanelType } = useUIStore()

  const renderRightPanel = () => {
    switch (rightPanelType) {
      case 'ai': return <AIView />
      case 'directory': return <DirectoryView />
      case 'history': return <HistoryView />
      default: return null
    }
  }

  return (
    <TooltipProvider>
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

        {/* Editor Area with optional AI Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {settingsPanelVisible ? (
            <SettingsView />
          ) : (
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 flex flex-col overflow-hidden">
                <TabBar />
                <EditorToolbar />
                <EditorView />
              </div>
              {rightPanelType && (
                <div className="shrink-0 border-l" style={{ borderColor: 'var(--border-color)' }}>
                  {renderRightPanel()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Toast Notification */}
      <ToastProvider>
        <ToastViewport className={toastViewportVariants}>
          {toasts.map((toast) => (
            <Toast key={toast.id} className={toastVariants}>
              {toast.type === 'error' && (
                <AlertCircle className="w-4 h-4 mr-2 text-red-500 shrink-0" />
              )}
              {toast.type === 'success' && (
                <CheckCircle className="w-4 h-4 mr-2 text-green-500 shrink-0" />
              )}
              {toast.type === 'info' && (
                <Info className="w-4 h-4 mr-2 text-blue-500 shrink-0" />
              )}
              <ToastDescription className={toastDescriptionVariants}>{toast.message}</ToastDescription>
              <ToastClose className={toastCloseVariants} onClick={() => dismissToast(toast.id)} />
            </Toast>
          ))}
        </ToastViewport>
      </ToastProvider>
    </div>
    </TooltipProvider>
  )
}

export { App }
