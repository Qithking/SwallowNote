/**
 * ActivityBar Component - Narrow left icon bar for view switching
 * Supports built-in views, sidebar plugins, plugin manager, and settings
 */
import { FolderTree, Search, GitBranch, Settings, Puzzle } from 'lucide-react'
import { useUIStore, useGitStore, usePluginStore, useEditorStore, SidebarView } from '@/stores'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { useTranslation } from 'react-i18next'
import { pluginSidebarView, pluginRightPanelType, isFullPanelPluginActive, renderPluginIcon, createToolbarButtonProps, renderPluginToolbarButton } from '@/lib/plugin-utils'
import type { PluginDefinition } from '@/types/plugin'
import { PluginErrorBoundary } from '@/components/Plugin/PluginErrorBoundary'

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
  plugins: 'activityBar.plugins',
  settings: 'activityBar.settings',
}

function ActivityBar() {
  const sidebarView = useUIStore((s) => s.sidebarView)
  const setSidebarView = useUIStore((s) => s.setSidebarView)
  const sidebarVisible = useUIStore((s) => s.sidebarVisible)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const settingsPanelVisible = useUIStore((s) => s.settingsPanelVisible)
  const setSettingsPanelVisible = useUIStore((s) => s.setSettingsPanelVisible)
  const rightPanelType = useUIStore((s) => s.rightPanelType)
  const setRightPanelType = useUIStore((s) => s.setRightPanelType)
  const showConflictBadge = useUIStore((s) => s.showConflictBadge)
  const conflictRepos = useGitStore((s) => s.conflictRepos)
  const sidebarPlugins = usePluginStore((s) => s.registry.sidebar)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const tabs = useEditorStore((s) => s.tabs)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const { t } = useTranslation()

  const conflictCount = conflictRepos.length

  const isPluginActive = (plugin: PluginDefinition) => {
    const pluginViewId = pluginSidebarView(plugin.id)
    if (plugin.contentPosition === 'fullPanel') {
      return isFullPanelPluginActive(settingsPanelVisible, sidebarView, plugin.id)
    }
    return sidebarView === pluginViewId && sidebarVisible
  }

  const handlePluginClick = (plugin: PluginDefinition) => {
    const pluginViewId = pluginSidebarView(plugin.id)
    if (plugin.contentPosition === 'rightPanel') {
      const pluginPanelType = pluginRightPanelType(plugin.id)
      if (rightPanelType === pluginPanelType) {
        setRightPanelType(null)
        usePluginStore.getState().setActivePlugin(null, 'rightPanel')
      } else {
        setRightPanelType(pluginPanelType)
        usePluginStore.getState().setActivePlugin(plugin.id, 'rightPanel')
      }
    } else if (plugin.contentPosition === 'fullPanel') {
      if (isFullPanelPluginActive(settingsPanelVisible, sidebarView, plugin.id)) {
        setSettingsPanelVisible(false)
        // setActivePlugin(null, ...) below also resets sidebarView; the
        // explicit setSidebarView is kept for snappier local state.
        setSidebarView('explorer')
        usePluginStore.getState().setActivePlugin(null, 'fullPanel')
      } else {
        setSettingsPanelVisible(true)
        setSidebarView(pluginViewId)
        usePluginStore.getState().setActivePlugin(plugin.id, 'fullPanel')
      }
    } else {
      if (settingsPanelVisible) setSettingsPanelVisible(false)
      if (sidebarView === pluginViewId && sidebarVisible) {
        toggleSidebar()
        // setActivePlugin(null, ...) below also resets sidebarView = 'explorer'
        // via the cross-store coupling in the plugin store.
        usePluginStore.getState().setActivePlugin(null, 'leftPanel')
      } else {
        if (!sidebarVisible) {
          useUIStore.getState().setSidebarVisible(true)
        }
        setSidebarView(pluginViewId)
        usePluginStore.getState().setActivePlugin(plugin.id, 'leftPanel')
      }
    }
  }

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

      {/* Plugin icons with iconPosition === 'sidebar' */}
      {sidebarPlugins.map((plugin) => {
        const active = isPluginActive(plugin)

        // If the plugin provides a custom toolbarButton, render it
        if (plugin.toolbarButton) {
          const toolbarProps = createToolbarButtonProps(plugin.id, active, 18, () => handlePluginClick(plugin), () => {
            // Deactivate: reverse the click logic
            if (plugin.contentPosition === 'rightPanel') {
              setRightPanelType(null)
              usePluginStore.getState().setActivePlugin(null, 'rightPanel')
            } else if (plugin.contentPosition === 'fullPanel') {
              setSettingsPanelVisible(false)
              setSidebarView('explorer')
              usePluginStore.getState().setActivePlugin(null, 'fullPanel')
            } else {
              if (sidebarVisible) toggleSidebar()
              usePluginStore.getState().setActivePlugin(null, 'leftPanel')
            }
          }, activeTab?.content ?? '', activeTab?.path ?? '')
          return (
            <PluginErrorBoundary key={plugin.id} pluginId={plugin.id} resetKey={plugin.id}>
              {renderPluginToolbarButton(plugin.toolbarButton, toolbarProps)}
            </PluginErrorBoundary>
          )
        }

        return (
          <Tooltip key={plugin.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => handlePluginClick(plugin)}
                className={`w-[36px] h-[36px] flex items-center justify-center relative cursor-pointer rounded-lg ${active ? 'bg-primary/10' : ''}`}
                style={{
                  color: active ? 'var(--activity-foreground)' : 'var(--activity-inactive)',
                }}
              >
                {renderPluginIcon(plugin.icon, 18)}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{plugin.name}</TooltipContent>
          </Tooltip>
        )
      })}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Plugin Manager button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => {
              if (settingsPanelVisible && sidebarView === 'plugin:__plugin_manager') {
                setSettingsPanelVisible(false)
                // Reset sidebarView so the next time the user opens the
                // sidebar (leftPanel) the default explorer view appears
                // rather than this stale plugin-manager view.
                setSidebarView('explorer')
              } else {
                setSettingsPanelVisible(true)
                setSidebarView('plugin:__plugin_manager' as SidebarView)
              }
            }}
            className={`w-[36px] h-[36px] flex items-center justify-center relative cursor-pointer rounded-lg ${settingsPanelVisible && sidebarView === 'plugin:__plugin_manager' ? 'bg-primary/10' : ''}`}
            style={{
              color: settingsPanelVisible && sidebarView === 'plugin:__plugin_manager' ? 'var(--activity-foreground)' : 'var(--activity-inactive)',
            }}
          >
            <Puzzle size={18} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('activityBar.plugins')}</TooltipContent>
      </Tooltip>

      {/* Settings button - bottom */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => {
              if (settingsPanelVisible && sidebarView === 'settings') {
                setSettingsPanelVisible(false)
                setSidebarView('explorer')
              } else {
                setSettingsPanelVisible(true)
                setSidebarView('settings')
              }
            }}
            className={`w-[36px] h-[36px] flex items-center justify-center relative cursor-pointer rounded-lg ${settingsPanelVisible && sidebarView === 'settings' ? 'bg-primary/10' : ''}`}
            style={{
              color: settingsPanelVisible && sidebarView === 'settings' ? 'var(--activity-foreground)' : 'var(--activity-inactive)',
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
