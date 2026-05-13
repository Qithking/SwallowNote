/**
 * SettingsView Component - Application settings panel
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Settings as SettingsIcon,
  Palette,
  Globe,
  Terminal,
  GitBranch,
  Cloud,
  Bot,
  Keyboard,
  Info,
  ArrowLeft,
} from 'lucide-react'
import { useUIStore, Theme } from '@/stores'
import { cn } from '@/lib/utils'

type SettingsSection = 'general' | 'appearance' | 'editor' | 'git' | 'sync' | 'ai' | 'shortcuts' | 'about'

interface SettingsViewProps {
  onClose?: () => void
}

function SettingsView({ onClose }: SettingsViewProps) {
  const { t, i18n } = useTranslation()
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const { theme, setTheme, setSettingsPanelVisible } = useUIStore()

  const handleClose = () => {
    if (onClose) {
      onClose()
    } else {
      setSettingsPanelVisible(false)
    }
  }

  const sections: { id: SettingsSection; icon: typeof SettingsIcon; labelKey: string }[] = [
    { id: 'general', icon: SettingsIcon, labelKey: 'settings.general' },
    { id: 'appearance', icon: Palette, labelKey: 'settings.appearance' },
    { id: 'editor', icon: Terminal, labelKey: 'settings.editor' },
    { id: 'git', icon: GitBranch, labelKey: 'settings.git' },
    { id: 'sync', icon: Cloud, labelKey: 'settings.sync' },
    { id: 'ai', icon: Bot, labelKey: 'settings.ai' },
    { id: 'shortcuts', icon: Keyboard, labelKey: 'settings.shortcuts' },
    { id: 'about', icon: Info, labelKey: 'settings.about' },
  ]

  const themes: { value: Theme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ]

  const languages = [
    { value: 'en', label: 'English' },
    { value: 'zh-CN', label: '简体中文' },
  ]

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'general':
        return (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium mb-3">Language</h3>
              <div className="space-y-2">
                {languages.map((lang) => (
                  <label
                    key={lang.value}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                      i18n.language === lang.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-accent'
                    )}
                  >
                    <input
                      type="radio"
                      name="language"
                      value={lang.value}
                      checked={i18n.language === lang.value}
                      onChange={() => i18n.changeLanguage(lang.value)}
                      className="sr-only"
                    />
                    <Globe size={16} />
                    <span className="text-sm">{lang.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )

      case 'appearance':
        return (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium mb-3">Theme</h3>
              <div className="grid grid-cols-3 gap-2">
                {themes.map((themeOption) => (
                  <button
                    key={themeOption.value}
                    onClick={() => setTheme(themeOption.value)}
                    className={cn(
                      'p-3 rounded-lg border text-center transition-colors',
                      theme === themeOption.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-accent'
                    )}
                  >
                    <div className="text-2xl mb-1">
                      {themeOption.value === 'light' && '☀️'}
                      {themeOption.value === 'dark' && '🌙'}
                      {themeOption.value === 'system' && '💻'}
                    </div>
                    <span className="text-xs">{themeOption.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )

      case 'about':
        return (
          <div className="space-y-4">
            <div className="text-center py-8">
              <h2 className="text-xl font-bold mb-2">SwallowNote</h2>
              <p className="text-sm text-muted-foreground mb-4">Version 0.1.0</p>
              <p className="text-xs text-muted-foreground">
                A cross-platform Markdown editor built with Tauri, React, and BlockNote
              </p>
            </div>
          </div>
        )

      default:
        return (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="text-sm">Settings coming soon</p>
          </div>
        )
    }
  }

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header with back button */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <button
          onClick={handleClose}
          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition-colors text-sm"
        >
          <ArrowLeft size={16} />
          <span>Back</span>
        </button>
        <span className="text-sm font-medium">Settings</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
      {/* Section List */}
      <div className="w-48 border-r border-border p-2">
        {sections.map((section) => {
          const Icon = section.icon
          return (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
                activeSection === section.id
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-accent'
              )}
            >
              <Icon size={14} />
              <span>{t(section.labelKey)}</span>
            </button>
          )
        })}
      </div>

      {/* Section Content */}
      <div className="flex-1 p-4 overflow-auto scrollable-area">{renderSectionContent()}</div>
      </div>
    </div>
  )
}

export { SettingsView }
