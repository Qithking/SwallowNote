import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import {
  Settings as SettingsIcon,
  Palette,
  Keyboard,
  RefreshCw,
  Bot,
  Puzzle,
  Code,
} from 'lucide-react'
import { useUIStore } from '@/stores'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent } from '@/components/ui/card'
import { GeneralSettings } from './panels/GeneralSettings'
import { SyncSettings } from './panels/SyncSettings'
import { AppearanceSettings } from './panels/AppearanceSettings'
import { AiSettings } from './panels/AiSettings'
import { ShortcutsSettings } from './panels/ShortcutsSettings'
import { PluginSettings } from './panels/PluginSettings'
import { DevelopmentSettings } from './panels/DevelopmentSettings'

type SettingsSection = 'general' | 'sync' | 'appearance' | 'ai' | 'shortcuts' | 'plugins' | 'development'

function SettingsView() {
  const { t } = useTranslation()
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const contentRef = useRef<HTMLDivElement>(null)
  const settingsSection = useUIStore((s) => s.settingsSection)
  const setSettingsSection = useUIStore((s) => s.setSettingsSection)
  const {
    theme, setTheme,
    autoStart, setAutoStart,
    autoCheckUpdate, setAutoCheckUpdate,
    closeWithoutExit, setCloseWithoutExit,
    noteWidth, setNoteWidth,
    showAllFiles, setShowAllFiles,
    markdownOnly, setMarkdownOnly,
    syncInterval, setSyncInterval,
    autoSyncPush, setAutoSyncPush,
    uploadPath, setUploadPath,
    showConflictBadge, setShowConflictBadge,
    aiPort, setAiPort,
    aiModels, activeAiModelId, defaultAiModelId,
    addAiModel, removeAiModel, setActiveAiModel, setDefaultAiModel, updateAiModelApiKey,
    customThemes, activeLightCustomThemeId, activeDarkCustomThemeId,
    setActiveCustomThemeId, addCustomTheme, deleteCustomTheme, renameCustomTheme, updateCustomThemeColor,
    developerMode, setDeveloperMode,
  } = useUIStore(
    useShallow((s) => ({
      theme: s.theme, setTheme: s.setTheme,
      autoStart: s.autoStart, setAutoStart: s.setAutoStart,
      autoCheckUpdate: s.autoCheckUpdate, setAutoCheckUpdate: s.setAutoCheckUpdate,
      closeWithoutExit: s.closeWithoutExit, setCloseWithoutExit: s.setCloseWithoutExit,
      noteWidth: s.noteWidth, setNoteWidth: s.setNoteWidth,
      showAllFiles: s.showAllFiles, setShowAllFiles: s.setShowAllFiles,
      markdownOnly: s.markdownOnly, setMarkdownOnly: s.setMarkdownOnly,
      syncInterval: s.syncInterval, setSyncInterval: s.setSyncInterval,
      autoSyncPush: s.autoSyncPush, setAutoSyncPush: s.setAutoSyncPush,
      uploadPath: s.uploadPath, setUploadPath: s.setUploadPath,
      showConflictBadge: s.showConflictBadge, setShowConflictBadge: s.setShowConflictBadge,
      aiPort: s.aiPort, setAiPort: s.setAiPort,
      aiModels: s.aiModels, activeAiModelId: s.activeAiModelId, defaultAiModelId: s.defaultAiModelId,
      addAiModel: s.addAiModel, removeAiModel: s.removeAiModel, setActiveAiModel: s.setActiveAiModel, setDefaultAiModel: s.setDefaultAiModel, updateAiModelApiKey: s.updateAiModelApiKey,
      customThemes: s.customThemes, activeLightCustomThemeId: s.activeLightCustomThemeId, activeDarkCustomThemeId: s.activeDarkCustomThemeId,
      setActiveCustomThemeId: s.setActiveCustomThemeId, addCustomTheme: s.addCustomTheme, deleteCustomTheme: s.deleteCustomTheme, renameCustomTheme: s.renameCustomTheme, updateCustomThemeColor: s.updateCustomThemeColor,
      developerMode: s.developerMode, setDeveloperMode: s.setDeveloperMode,
    })),
  )

  const sections: { id: SettingsSection; icon: typeof SettingsIcon; labelKey: string }[] = [
    { id: 'general', icon: SettingsIcon, labelKey: 'settings.general' },
    { id: 'sync', icon: RefreshCw, labelKey: 'settings.sync' },
    { id: 'appearance', icon: Palette, labelKey: 'settings.appearance' },
    { id: 'ai', icon: Bot, labelKey: 'settings.ai' },
    { id: 'shortcuts', icon: Keyboard, labelKey: 'settings.shortcuts' },
    { id: 'plugins', icon: Puzzle, labelKey: 'settings.plugins' },
    { id: 'development', icon: Code, labelKey: 'settings.development' },
  ]

  const scrollToSection = useCallback((sectionId: SettingsSection) => {
    setActiveSection(sectionId)
    const el = document.getElementById(`section-${sectionId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  useEffect(() => {
    if (!settingsSection) return
    const raf = requestAnimationFrame(() => {
      scrollToSection(settingsSection)
      setSettingsSection(null)
    })
    return () => cancelAnimationFrame(raf)
  }, [settingsSection, scrollToSection, setSettingsSection])

  return (
    <div className="flex flex-col h-full max-full">
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧分类导航 */}
        <Card className="w-48 rounded-none border-r border-t-0 border-b-0 border-l-0 shrink-0">
          <CardContent className="p-2">
            {sections.map((section) => {
              const Icon = section.icon
              return (
                <button
                  key={section.id}
                  onClick={() => scrollToSection(section.id)}
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
          </CardContent>
        </Card>

        {/* 右侧滚动详情区 */}
        <ScrollArea className="flex-1">
          <div ref={contentRef} className="px-[60px] py-8 space-y-8">
            <GeneralSettings
              autoStart={autoStart}
              setAutoStart={setAutoStart}
              autoCheckUpdate={autoCheckUpdate}
              setAutoCheckUpdate={setAutoCheckUpdate}
              closeWithoutExit={closeWithoutExit}
              setCloseWithoutExit={setCloseWithoutExit}
              noteWidth={noteWidth}
              setNoteWidth={setNoteWidth}
              showAllFiles={showAllFiles}
              setShowAllFiles={setShowAllFiles}
              markdownOnly={markdownOnly}
              setMarkdownOnly={setMarkdownOnly}
            />
            <SyncSettings
              syncInterval={syncInterval}
              setSyncInterval={setSyncInterval}
              autoSyncPush={autoSyncPush}
              setAutoSyncPush={setAutoSyncPush}
              uploadPath={uploadPath}
              setUploadPath={setUploadPath}
              showConflictBadge={showConflictBadge}
              setShowConflictBadge={setShowConflictBadge}
            />
            <AppearanceSettings
              theme={theme}
              setTheme={setTheme}
              customThemes={customThemes}
              activeLightCustomThemeId={activeLightCustomThemeId}
              activeDarkCustomThemeId={activeDarkCustomThemeId}
              setActiveCustomThemeId={setActiveCustomThemeId}
              addCustomTheme={addCustomTheme}
              deleteCustomTheme={deleteCustomTheme}
              renameCustomTheme={renameCustomTheme}
              updateCustomThemeColor={updateCustomThemeColor}
            />
            <AiSettings
              aiPort={aiPort}
              setAiPort={setAiPort}
              aiModels={aiModels}
              activeAiModelId={activeAiModelId}
              defaultAiModelId={defaultAiModelId}
              addAiModel={addAiModel}
              removeAiModel={removeAiModel}
              setActiveAiModel={setActiveAiModel}
              setDefaultAiModel={setDefaultAiModel}
              updateAiModelApiKey={updateAiModelApiKey}
            />
            <ShortcutsSettings />
            <PluginSettings />
            <DevelopmentSettings
              developerMode={developerMode}
              setDeveloperMode={setDeveloperMode}
            />
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

export { SettingsView }
