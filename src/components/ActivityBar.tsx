/**
 * ActivityBar Component - Narrow left icon bar for view switching
 */
import { FolderTree, Search, GitBranch, Bot, Settings } from 'lucide-react'
import { useUIStore, SidebarView } from '@/stores'

const activityItems: { id: SidebarView; icon: typeof FolderTree }[] = [
  { id: 'explorer', icon: FolderTree },
  { id: 'search', icon: Search },
  { id: 'git', icon: GitBranch },
  { id: 'ai', icon: Bot },
]

function ActivityBar() {
  const { sidebarView, setSidebarView, settingsPanelVisible, setSettingsPanelVisible } = useUIStore()

  return (
    <div
      className="w-[48px] flex flex-col items-center pt-1 shrink-0 border-r"
      style={{ backgroundColor: 'var(--activity-bg)', borderColor: 'var(--border-color)' }}
    >
      {activityItems.map((item) => {
        const Icon = item.icon
        const isActive = sidebarView === item.id
        return (
          <button
            key={item.id}
            onClick={() => {
              if (settingsPanelVisible) setSettingsPanelVisible(false)
              setSidebarView(item.id)
            }}
            className="w-[48px] h-[48px] flex items-center justify-center relative"
            style={{
              color: isActive ? 'var(--activity-foreground)' : 'var(--activity-inactive)',
            }}
            onMouseEnter={(e) => {
              if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--activity-hover)'
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
            }}
            title={item.id}
          >
            {isActive && (
              <div
                className="absolute left-0 top-0 bottom-0 w-[2px]"
                style={{ backgroundColor: 'var(--activity-activeBorder)' }}
              />
            )}
            <Icon size={22} />
          </button>
        )
      })}
      {/* Settings button - opens settings panel in main content area */}
      <button
        onClick={() => setSettingsPanelVisible(true)}
        className="w-[48px] h-[48px] flex items-center justify-center relative"
        style={{
          color: settingsPanelVisible ? 'var(--activity-foreground)' : 'var(--activity-inactive)',
        }}
        onMouseEnter={(e) => {
          if (!settingsPanelVisible) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--activity-hover)'
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
        }}
        title="settings"
      >
        {settingsPanelVisible && (
          <div
            className="absolute left-0 top-0 bottom-0 w-[2px]"
            style={{ backgroundColor: 'var(--activity-activeBorder)' }}
          />
        )}
        <Settings size={22} />
      </button>
    </div>
  )
}

export { ActivityBar }
