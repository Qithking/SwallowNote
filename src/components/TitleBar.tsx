/**
 * TitleBar Component - Custom window title bar
 * Styled with CSS variables for proper dark/light theme
 */
import { Minus, Square, X, Sun, Moon, Monitor, Bot, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useUIStore, usePluginStore, useEditorStore } from '@/stores'
import { useWorkspaceStore } from '@/stores/workspace'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import { TitleBarRecentPopover } from './TitleBarRecentPopover'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { pluginRightPanelType, pluginSidebarView, renderPluginIcon, createToolbarButtonProps, renderPluginToolbarButton } from '@/lib/plugin-utils'
import { PluginErrorBoundary } from '@/components/Plugin/PluginErrorBoundary'

function TitleBar() {
  const { theme, setTheme, rightPanelType, setRightPanelType, workspaceMode, sidebarVisible, setSidebarVisible, settingsPanelVisible, setSettingsPanelVisible, sidebarView } = useUIStore()
  const { switchMode } = useWorkspaceStore()
  const titleBarPlugins = usePluginStore((s) => s.registry.titleBar)
  // Fine-grained selectors: only re-render when the active tab's content
  // or path actually changes, not when other tabs' content changes.
  // Previously subscribed to the entire `tabs` array which triggered a
  // re-render on every keystroke in any tab.
  const activeTabContent = useEditorStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.content ?? '',
  )
  const activeTabPath = useEditorStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.path ?? '',
  )
  const { t } = useTranslation()

  const handleMinimize = async () => {
    await getCurrentWindow().minimize()
  }

  const handleMaximize = async () => {
    const win = getCurrentWindow()
    if (await win.isMaximized()) {
      await win.unmaximize()
    } else {
      await win.maximize()
    }
  }

  const handleClose = async () => {
    await getCurrentWindow().close()
  }

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor

  const themeOptions = [
    { value: 'system', label: t('titleBar.themeSystem'), icon: Monitor },
    { value: 'light', label: t('titleBar.themeLight'), icon: Sun },
    { value: 'dark', label: t('titleBar.themeDark'), icon: Moon },
  ]

  return (
    <div data-tauri-drag-region className={cn(
      'titlebar',
      'h-[35px] flex items-center justify-between select-none',
      'bg-[var(--bg-primary-gradient,var(--bg-primary))]',
      'text-[var(--text-secondary)]'
    )}>
      <div className="flex items-center gap-2 pl-3">
        <span className="text-xs font-medium text-[var(--text-primary)]">SwallowNote</span>
        <Tabs value={workspaceMode} onValueChange={(v) => switchMode(v as 'folder' | 'workspace')}>
          <TabsList className="h-6 p-0 bg-transparent border border-[var(--border)] rounded">
            <TabsTrigger value="folder" className="h-5 px-2 text-xs data-[state=active]:bg-white data-[state=active]:text-black text-[var(--text-secondary)] shadow-none">{t('titleBar.folder')}</TabsTrigger>
            <TabsTrigger value="workspace" className="h-5 px-2 text-xs data-[state=active]:bg-white data-[state=active]:text-black text-[var(--text-secondary)] shadow-none">{t('titleBar.workspace')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Separator orientation="vertical" className="h-4" />
        <TitleBarRecentPopover />
      </div>

      {/* Right: TitleBar plugins + AI button + Theme toggle + Window controls */}
      <div className="flex items-center h-full">
        {/* TitleBar plugin icons */}
        {titleBarPlugins.map((plugin) => {
          const isPluginActive = (() => {
            if (plugin.contentPosition === 'rightPanel') {
              return rightPanelType === pluginRightPanelType(plugin.id)
            } else if (plugin.contentPosition === 'fullPanel' || plugin.contentPosition === 'editorArea') {
              const pluginViewId = pluginSidebarView(plugin.id)
              return settingsPanelVisible && sidebarView === pluginViewId
            } else {
              const pluginViewId = pluginSidebarView(plugin.id)
              return sidebarView === pluginViewId && sidebarVisible
            }
          })()

          // If the plugin provides a custom toolbarButton, render it
          if (plugin.toolbarButton) {
            const activate = () => {
              const ui = useUIStore.getState()
              if (plugin.contentPosition === 'rightPanel') {
                setRightPanelType(pluginRightPanelType(plugin.id))
                usePluginStore.getState().setActivePlugin(plugin.id, 'rightPanel')
              } else if (plugin.contentPosition === 'leftPanel') {
                ui.setSidebarVisible(true)
                ui.setSidebarView(pluginSidebarView(plugin.id))
                usePluginStore.getState().setActivePlugin(plugin.id, 'leftPanel')
              } else if (plugin.contentPosition === 'fullPanel' || plugin.contentPosition === 'editorArea') {
                setSettingsPanelVisible(true)
                ui.setSidebarView(pluginSidebarView(plugin.id))
                usePluginStore.getState().setActivePlugin(plugin.id, 'fullPanel')
              }
            }
            const deactivate = () => {
              const ui = useUIStore.getState()
              if (plugin.contentPosition === 'rightPanel') {
                setRightPanelType(null)
                usePluginStore.getState().setActivePlugin(null, 'rightPanel')
              } else if (plugin.contentPosition === 'leftPanel') {
                ui.toggleSidebar()
                usePluginStore.getState().setActivePlugin(null, 'leftPanel')
              } else if (plugin.contentPosition === 'fullPanel' || plugin.contentPosition === 'editorArea') {
                setSettingsPanelVisible(false)
                ui.setSidebarView('explorer')
                usePluginStore.getState().setActivePlugin(null, 'fullPanel')
              }
            }
            const toolbarProps = createToolbarButtonProps(plugin.id, isPluginActive, 14, activate, deactivate, activeTabContent, activeTabPath)
            return (
              <PluginErrorBoundary key={plugin.id} pluginId={plugin.id} resetKey={plugin.id}>
                {renderPluginToolbarButton(plugin.toolbarButton, toolbarProps)}
              </PluginErrorBoundary>
            )
          }

          const handleClick = () => {
            const ui = useUIStore.getState()
            if (plugin.contentPosition === 'rightPanel') {
              const pluginPanelType = pluginRightPanelType(plugin.id)
              if (rightPanelType === pluginPanelType) {
                setRightPanelType(null)
                usePluginStore.getState().setActivePlugin(null, 'rightPanel')
              } else {
                setRightPanelType(pluginPanelType)
                usePluginStore.getState().setActivePlugin(plugin.id, 'rightPanel')
              }
            } else if (plugin.contentPosition === 'leftPanel') {
              const pluginViewId = pluginSidebarView(plugin.id)
              if (sidebarView === pluginViewId && sidebarVisible) {
                ui.toggleSidebar()
                // setActivePlugin(null, ...) below also resets sidebarView
                // to 'explorer' through the cross-store coupling in the
                // plugin store.
                usePluginStore.getState().setActivePlugin(null, 'leftPanel')
              } else {
                ui.setSidebarVisible(true)
                ui.setSidebarView(pluginViewId)
                usePluginStore.getState().setActivePlugin(plugin.id, 'leftPanel')
              }
            } else if (plugin.contentPosition === 'fullPanel' || plugin.contentPosition === 'editorArea') {
              const pluginViewId = pluginSidebarView(plugin.id)
              if (settingsPanelVisible && sidebarView === pluginViewId) {
                setSettingsPanelVisible(false)
                // Reset sidebarView to explorer so the next time the user
                // opens the sidebar (leftPanel), the default view appears
                // rather than this plugin's stale view.
                ui.setSidebarView('explorer')
                usePluginStore.getState().setActivePlugin(null, 'fullPanel')
              } else {
                setSettingsPanelVisible(true)
                ui.setSidebarView(pluginViewId)
                usePluginStore.getState().setActivePlugin(plugin.id, 'fullPanel')
              }
            }
          }

          return (
            <Tooltip key={plugin.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={handleClick}
                  className="h-full px-2 flex items-center justify-center cursor-pointer"
                  style={{ color: isPluginActive ? 'var(--text-primary)' : 'var(--text-muted)' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
                >
                  {renderPluginIcon(plugin.icon, 14)}
                </button>
              </TooltipTrigger>
              <TooltipContent>{plugin.name}</TooltipContent>
            </Tooltip>
          )
        })}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setRightPanelType(rightPanelType === 'ai' ? null : 'ai')}
              className="h-full px-2 flex items-center justify-center cursor-pointer"
              style={{ color: rightPanelType === 'ai' ? 'var(--text-primary)' : 'var(--text-muted)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
            >
              <Bot size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>AI Assistant</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <Tooltip>
            <DropdownMenuTrigger asChild>
              <button
                className="h-full px-2 flex items-center justify-center cursor-pointer"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
              >
                <ThemeIcon size={14} />
              </button>
            </DropdownMenuTrigger>
            <TooltipContent>{t('titleBar.themeSystem')}: {theme === 'light' ? t('titleBar.themeLight') : theme === 'dark' ? t('titleBar.themeDark') : t('titleBar.themeSystem')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="min-w-[140px]">
            <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as typeof theme)}>
              {themeOptions.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value} className="cursor-pointer">
                  <option.icon size={14} className="mr-2" />
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Separator before window controls */}
        <Separator orientation="vertical" className="h-4 mx-1" />

        {/* Left panel toggle button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setSidebarVisible(!sidebarVisible)}
              className="h-full px-2 flex items-center justify-center cursor-pointer"
              style={{ color: sidebarVisible ? 'var(--text-primary)' : 'var(--text-muted)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
            >
              {sidebarVisible ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{sidebarVisible ? t('titleBar.hideSidebar') : t('titleBar.showSidebar')}</TooltipContent>
        </Tooltip>

        {/* Right panel toggle button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setRightPanelType(rightPanelType ? null : 'ai')}
              className="h-full px-2 flex items-center justify-center cursor-pointer"
              style={{ color: rightPanelType ? 'var(--text-primary)' : 'var(--text-muted)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
            >
              {rightPanelType ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{rightPanelType ? t('titleBar.hideRightPanel') : t('titleBar.showRightPanel')}</TooltipContent>
        </Tooltip>

        {/* Window controls */}
        <div className="flex items-center h-full">
          <button
            onClick={handleMinimize}
            className="h-full w-[40px] flex items-center justify-center"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className="h-full w-[40px] flex items-center justify-center"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
          >
            <Square size={12} />
          </button>
          <button
            onClick={handleClose}
            className="h-full w-[40px] flex items-center justify-center"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#c42b1c'; (e.currentTarget as HTMLElement).style.color = '#ffffff' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLElement).style.color = '' }}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

export { TitleBar }
