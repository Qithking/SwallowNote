/**
 * TitleBar Component - Custom window title bar
 * Styled with CSS variables for proper dark/light theme
 */
import { Minus, Square, X, Sun, Moon, Monitor, Bot, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useUIStore } from '@/stores'
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

function TitleBar() {
  const { theme, setTheme, rightPanelType, setRightPanelType, workspaceMode, sidebarVisible, setSidebarVisible } = useUIStore()
  const { switchMode } = useWorkspaceStore()
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

      {/* Right: AI button + Theme toggle + Window controls */}
      <div className="flex items-center h-full">
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
