/**
 * ActivityBar Component - Narrow left icon bar for view switching
 */
import { FolderTree, Search, GitBranch, Settings } from 'lucide-react'
import { useUIStore, SidebarView } from '@/stores'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'

const activityItems: { id: SidebarView; icon: typeof FolderTree }[] = [
  { id: 'explorer', icon: FolderTree },
  { id: 'search', icon: Search },
  { id: 'git', icon: GitBranch },
]

const titleMap: Record<string, string> = {
  explorer: '资源管理器',
  search: '搜索',
  git: '源代码管理',
  ai: 'AI 助手',
  settings: '设置',
}

function ActivityBar() {
  const { sidebarView, setSidebarView, settingsPanelVisible, setSettingsPanelVisible } = useUIStore()

  return (
    <div className="w-[40px] flex flex-col items-center pt-1 shrink-0" >
      {activityItems.map((item) => {
        const Icon = item.icon
        const isActive = sidebarView === item.id
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  if (settingsPanelVisible) setSettingsPanelVisible(false)
                  setSidebarView(item.id)
                }}
                className={`w-[36px] h-[36px] flex items-center justify-center relative cursor-pointer rounded-lg ${isActive ? 'bg-primary/10' : ''}`}
                style={{
                  color: isActive ? 'var(--activity-foreground)' : 'var(--activity-inactive)',
                }}                
              >               
                <Icon size={18} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{titleMap[item.id]}</TooltipContent>
          </Tooltip>
        )
      })}
      {/* Settings button - opens settings panel in main content area */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => {setSettingsPanelVisible(true);setSidebarView('settings')}}
            className={`w-[36px] h-[36px] flex items-center justify-center relative cursor-pointer rounded-lg ${settingsPanelVisible ? 'bg-primary/10' : ''}`}
            style={{
              color: settingsPanelVisible ? 'var(--activity-foreground)' : 'var(--activity-inactive)',
            }}            
          >            
            <Settings size={18} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">设置</TooltipContent>
      </Tooltip>
    </div>
  )
}

export { ActivityBar }
