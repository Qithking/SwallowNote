/**
 * TitleBar Component - Custom window title bar
 * Styled with CSS variables for proper dark/light theme
 */
import { useTranslation } from 'react-i18next'
import { Minus, Square, X, Sun, Moon, Monitor } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useUIStore } from '@/stores'

function TitleBar() {
  const { t } = useTranslation()
  const { theme, setTheme } = useUIStore()

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

  const cycleTheme = () => {
    const themes: Array<'light' | 'dark'> = ['dark', 'light']
    const currentIndex = themes.indexOf(theme as 'light' | 'dark')
    setTheme(themes[(currentIndex + 1) % themes.length])
  }

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor

  return (
    <div
      data-tauri-drag-region
      className="h-[30px] flex items-center justify-between select-none"
      style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}
    >
      {/* Left: App name */}
      <div className="flex items-center gap-1 px-3" data-tauri-drag-region>
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          SwallowNote
        </span>
      </div>

      {/* Right: Theme toggle + Window controls */}
      <div className="flex items-center h-full">
        <button
          onClick={cycleTheme}
          className="h-full px-2 flex items-center justify-center"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
          title={`Theme: ${theme}`}
        >
          <ThemeIcon size={14} />
        </button>

        <div className="flex items-center h-full">
          <button
            onClick={handleMinimize}
            className="h-full w-[46px] flex items-center justify-center"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className="h-full w-[46px] flex items-center justify-center"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
          >
            <Square size={12} />
          </button>
          <button
            onClick={handleClose}
            className="h-full w-[46px] flex items-center justify-center"
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
