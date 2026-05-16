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
import { EditorSettings } from '@/components/EditorSettings/EditorSettings'
import { useUIStore, useWorkspaceStore } from '@/stores'
import { useTheme } from '@/hooks'
import { TooltipProvider } from '@/components'
import { Toaster } from 'sonner'
import { useState, useCallback, useEffect } from 'react'
import { enableModernWindowStyle } from '@cloudworxx/tauri-plugin-mac-rounded-corners'

function App() {
  useTheme()
  const { settingsPanelVisible, rightPanelType } = useUIStore()
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [rightPanelWidth, setRightPanelWidth] = useState(288)
  const [isDraggingLeft, setIsDraggingLeft] = useState(false)
  const [isDraggingRight, setIsDraggingRight] = useState(false)
  const [isHoveringLeft, setIsHoveringLeft] = useState(false)
  const [isHoveringRight, setIsHoveringRight] = useState(false)

  useEffect(() => {
    const { initMode, loadLatestByMode } = useWorkspaceStore.getState()
    initMode().then(() => loadLatestByMode())
  }, [])

  useEffect(() => {
    const initRoundedCorners = async () => {
      try {
        const platform = await import('@tauri-apps/plugin-os').then(m => m.platform())
        if (platform === 'linux') {
          document.documentElement.style.borderRadius = '12px'
          document.documentElement.style.overflow = 'hidden'
          document.body.style.borderRadius = '12px'
          document.body.style.overflow = 'hidden'
        } else {
          await enableModernWindowStyle({ cornerRadius: 12 })
        }
      } catch {
        await enableModernWindowStyle({ cornerRadius: 12 })
      }
    }
    initRoundedCorners()
  }, [])

  const handleMouseDownLeft = useCallback(() => {
    setIsDraggingLeft(true)
  }, [])

  const handleMouseMoveLeft = useCallback((e: MouseEvent) => {
    if (!isDraggingLeft) return
    const newWidth = e.clientX - 48
    const maxWidth = window.innerWidth * 0.5
    if (newWidth >= 200 && newWidth <= maxWidth) {
      setSidebarWidth(newWidth)
    }
  }, [isDraggingLeft])

  const handleMouseDownRight = useCallback(() => {
    setIsDraggingRight(true)
  }, [])

  const handleMouseMoveRight = useCallback((e: MouseEvent) => {
    if (!isDraggingRight) return
    const newWidth = window.innerWidth - e.clientX
    const maxWidth = window.innerWidth * 0.5
    if (newWidth >= 250 && newWidth <= maxWidth) {
      setRightPanelWidth(newWidth)
    }
  }, [isDraggingRight])

  const handleMouseUp = useCallback(() => {
    setIsDraggingLeft(false)
    setIsDraggingRight(false)
  }, [])

  useEffect(() => {
    if (isDraggingLeft) {
      document.addEventListener('mousemove', handleMouseMoveLeft)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMoveLeft)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
    if (isDraggingRight) {
      document.addEventListener('mousemove', handleMouseMoveRight)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMoveRight)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDraggingLeft, isDraggingRight, handleMouseMoveLeft, handleMouseMoveRight, handleMouseUp])

  const renderRightPanel = () => {
    switch (rightPanelType) {
      case 'ai': return <AIView />
      case 'directory': return <DirectoryView />
      case 'history': return <HistoryView />
      case 'editorSettings': return <EditorSettings />
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
        <div className="flex-1 flex overflow-hidden gap-x-0.5 pr-0.5">
          {/* Activity Bar */}
          <ActivityBar />

          {/* Sidebar - hidden when settings panel is open */}
          {!settingsPanelVisible && (
            <div 
              className="flex-shrink-0 flex flex-col overflow-hidden rounded-[var(--radius)]" 
              style={{ width: sidebarWidth, background: 'var(--bg-secondary)' }}
            >
              <Sidebar />
            </div>
          )}

          {/* Left Resize Handle */}
          {!settingsPanelVisible && (
            <div
              className="flex-shrink-0 w-[1px] h-full flex items-center justify-center cursor-col-resize"
              onMouseDown={handleMouseDownLeft}
              onMouseEnter={() => setIsHoveringLeft(true)}
              onMouseLeave={() => setIsHoveringLeft(false)}
            >
              <div 
                className="w-[1px] h-[100%] rounded-full transition-opacity duration-200"
                style={{ 
                  backgroundColor: 'var(--theme-color)',
                  opacity: isHoveringLeft || isDraggingLeft ? 1 : 0
                }}
              />
            </div>
          )}

          {/* Editor Area */}
          <div className="flex-1 flex flex-col overflow-hidden rounded-[var(--radius)]" style={{ background: 'var(--bg-secondary)'}}>
            {settingsPanelVisible ? (
              <SettingsView />
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                <TabBar />
                <EditorToolbar />
                <EditorView />
              </div>
            )}
          </div>

          {/* Right Resize Handle */}
          {rightPanelType && (
            <div
              className="flex-shrink-0 w-[1px] h-full flex items-center justify-center cursor-col-resize"
              onMouseDown={handleMouseDownRight}
              onMouseEnter={() => setIsHoveringRight(true)}
              onMouseLeave={() => setIsHoveringRight(false)}
            >
              <div 
                className="w-[1px] h-[100%] rounded-full transition-opacity duration-200"
                style={{ 
                  backgroundColor: 'var(--theme-color)',
                  opacity: isHoveringRight || isDraggingRight ? 1 : 0
                }}
              />
            </div>
          )}

          {/* Right Panel - moved outside editor, same level as sidebar */}
          {rightPanelType && (
            <div className="shrink-0 flex flex-col overflow-hidden rounded-[var(--radius)] " style={{ width: rightPanelWidth, background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
              {renderRightPanel()}
            </div>
          )}
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
