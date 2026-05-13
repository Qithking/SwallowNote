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
import { Toaster } from 'sonner'
import { useState, useCallback, useEffect } from 'react'

function App() {
  useTheme()
  const { settingsPanelVisible, rightPanelType } = useUIStore()
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [isDragging, setIsDragging] = useState(false)
  const [isHovering, setIsHovering] = useState(false)

  const handleMouseDown = useCallback((_e: React.MouseEvent) => {
    setIsDragging(true)
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    const newWidth = e.clientX - 48
    if (newWidth >= 150 && newWidth <= 400) {
      setSidebarWidth(newWidth)
    }
  }, [isDragging])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

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
      className="h-screen w-screen flex flex-col overflow-hidden p-1"
      style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 'var(--font-size)' }}
    >
      {/* Title Bar */}
      <TitleBar />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden gap-x-1">
        {/* Activity Bar */}
        <ActivityBar />

        {/* Sidebar - hidden when settings panel is open */}
        {!settingsPanelVisible && (
          <div 
            className="flex-shrink-0 overflow-hidden rounded-[var(--radius)]" 
            style={{ width: sidebarWidth, background: 'var(--bg-secondary)' }}
          >
            <Sidebar />
          </div>
        )}

        {/* Resize Handle */}
        {!settingsPanelVisible && (
          <div
            className="flex-shrink-0 w-[2px] h-full flex items-center justify-center cursor-col-resize hover:bg-border-color/50"
            onMouseDown={handleMouseDown}
          >
            <div 
              className="w-[1px] h-[100%] bg-theme-color rounded-full"
              style={{ backgroundColor: 'var(--theme-color)' }}
            />
          </div>
        )}

        {/* Editor Area with optional AI Panel */}
              <div className="flex-1 flex flex-col overflow-hidden rounded-[var(--radius)]" style={{ background: 'var(--bg-secondary)'}}>
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

      {/* statusbar */}
      <div className='flex overflow-hidden h-6'>
          <div className='w-1/2'></div>
          <div className='flex-auto'></div>
      </div>

      {/* Toast Notification */}
      <Toaster 
        position="bottom-center"
        duration={3000}
        toastOptions={{
          style: {
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
          },
        }}
      />
    </div>
    </TooltipProvider>
  )
}

export { App }
