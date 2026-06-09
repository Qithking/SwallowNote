/**
 * ActivityBar Component - Narrow left icon bar for view switching
 */
import { FolderTree, Search, GitBranch, Settings } from 'lucide-react'
import { useUIStore, useGitStore, SidebarView } from '@/stores'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { useTranslation } from 'react-i18next'

const activityItems: { id: SidebarView; icon: typeof FolderTree }[] = [
  { id: 'explorer', icon: FolderTree },
  { id: 'search', icon: Search },
  { id: 'git', icon: GitBranch },
]

const activityKeyMap: Record<string, string> = {
  explorer: 'activityBar.explorer',
  search: 'activityBar.search',
  git: 'activityBar.git',
  ai: 'activityBar.ai',
  settings: 'activityBar.settings',
}

function ActivityBar() {
  const sidebarView = useUIStore((s) => s.sidebarView)
  const setSidebarView = useUIStore((s) => s.setSidebarView)
  const sidebarVisible = useUIStore((s) => s.sidebarVisible)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const settingsPanelVisible = useUIStore((s) => s.settingsPanelVisible)
  const setSettingsPanelVisible = useUIStore((s) => s.setSettingsPanelVisible)
  const showConflictBadge = useUIStore((s) => s.showConflictBadge)
  const conflictRepos = useGitStore((s) => s.conflictRepos)
  const { t } = useTranslation()

  const conflictCount = conflictRepos.length

  return (
    <div className="w-[40px] flex flex-col items-center pt-1 shrink-0 mr-0.5" >
      {activityItems.map((item) => {
        const Icon = item.icon
        const isActive = sidebarView === item.id && sidebarVisible
        const isGitWithBadge = item.id === 'git' && showConflictBadge && conflictCount > 0
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  if (settingsPanelVisible) setSettingsPanelVisible(false)
                  if (sidebarView === item.id && sidebarVisible) {
                    // Clicking the already-active icon toggles sidebar visibility
                    toggleSidebar()
                  } else {
                    // Switch to this view and ensure sidebar is visible
                    if (!sidebarVisible) {
                      useUIStore.getState().setSidebarVisible(true)
                    }
                    setSidebarView(item.id)
                  }
                }}
                className={`w-[36px] h-[36px] flex items-center justify-center relative cursor-pointer rounded-lg ${isActive ? 'bg-primary/10' : ''}`}
                style={{
                  color: isActive ? 'var(--activity-foreground)' : 'var(--activity-inactive)',
                }}                
              >               
                <Icon size={18} />
                {isGitWithBadge && (
                  <span
                    className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full text-[9px] font-bold leading-none px-[3px]"
                    style={{
                      background: 'var(--theme-color)',
                      color: '#fff',
                    }}
                  >
                    {conflictCount > 99 ? '99+' : conflictCount}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t(activityKeyMap[item.id])}</TooltipContent>
          </Tooltip>
        )
      })}
      {/* Settings button - opens settings panel in main content area */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => {
              if (settingsPanelVisible) {
                setSettingsPanelVisible(false)
              } else {
                setSettingsPanelVisible(true)
                setSidebarView('settings')
              }
            }}
            className={`w-[36px] h-[36px] flex items-center justify-center relative cursor-pointer rounded-lg ${settingsPanelVisible ? 'bg-primary/10' : ''}`}
            style={{
              color: settingsPanelVisible ? 'var(--activity-foreground)' : 'var(--activity-inactive)',
            }}            
          >            
            <Settings size={18} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('activityBar.settings')}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export { ActivityBar }
