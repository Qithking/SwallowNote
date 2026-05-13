/**
 * Sidebar Component - Left sidebar with view content
 * Switches content based on ActivityBar selection
 */
import { FileTreeView } from './FileTree/FileTreeView'
import { SearchView } from './Search/SearchView'
import { GitView } from './Git/GitView'
import { SettingsView } from './Settings/SettingsView'
import { useUIStore } from '@/stores'

function Sidebar() {
  const { sidebarView } = useUIStore()

  const renderContent = () => {
    switch (sidebarView) {
      case 'explorer': return <FileTreeView />
      case 'search': return <SearchView />
      case 'git': return <GitView />
      case 'settings': return <SettingsView />
      default: return <FileTreeView />
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto w-full">
        {renderContent()}
      </div>
    </div>
  )
}

export { Sidebar }
