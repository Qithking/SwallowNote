/**
 * Sidebar Component - Left sidebar with view content
 * All panels are always mounted, visibility controlled by CSS display property
 */
import { FileTreeView } from './FileTree/FileTreeView'
import { SearchView } from './Search/SearchView'
import { GitView } from './Git/GitView'
import { SettingsView } from './Settings/SettingsView'
import { useUIStore } from '@/stores'

function Sidebar() {
  const sidebarView = useUIStore((s) => s.sidebarView)

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto w-full scrollable-area relative">
        <div className={`absolute inset-0 ${sidebarView === 'explorer' ? '' : 'hidden'}`}>
          <FileTreeView />
        </div>
        <div className={`absolute inset-0 ${sidebarView === 'search' ? '' : 'hidden'}`}>
          <SearchView />
        </div>
        <div className={`absolute inset-0 ${sidebarView === 'git' ? '' : 'hidden'}`}>
          <GitView />
        </div>
        <div className={`absolute inset-0 ${sidebarView === 'settings' ? '' : 'hidden'}`}>
          <SettingsView />
        </div>
      </div>
    </div>
  )
}

export { Sidebar }
