import { useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Settings as SettingsIcon,
  Palette,
  Keyboard,
  RefreshCw,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
} from 'lucide-react'
import { useUIStore, Theme, NoteWidth, CustomThemeColors } from '@/stores'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { setAppLocale } from '@/lib/tauri'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { DEFAULT_SHORTCUTS } from '@/lib/shortcuts'
import { ShortcutRecorder } from './ShortcutRecorder'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'

type SettingsSection = 'general' | 'sync' | 'appearance' | 'shortcuts'

function SettingRow({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 mr-4">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
      {children}
    </div>
  )
}

function SettingsView() {
  const { t, i18n } = useTranslation()
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const contentRef = useRef<HTMLDivElement>(null)
  const {
    theme, setTheme,
    autoStart, setAutoStart,
    closeWithoutExit, setCloseWithoutExit,
    noteWidth, setNoteWidth,
    showAllFiles, setShowAllFiles,
    markdownOnly, setMarkdownOnly,
    syncInterval, setSyncInterval,
    uploadPath, setUploadPath,
    customThemes, activeLightCustomThemeId, activeDarkCustomThemeId,
    setActiveCustomThemeId, addCustomTheme, deleteCustomTheme, renameCustomTheme, updateCustomThemeColor,
  } = useUIStore()

  const [customThemeTab, setCustomThemeTab] = useState<'light' | 'dark'>('light')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const activeCustomThemeId = customThemeTab === 'light' ? activeLightCustomThemeId : activeDarkCustomThemeId

  const sections: { id: SettingsSection; icon: typeof SettingsIcon; labelKey: string }[] = [
    { id: 'general', icon: SettingsIcon, labelKey: 'settings.general' },
    { id: 'sync', icon: RefreshCw, labelKey: 'settings.sync' },
    { id: 'appearance', icon: Palette, labelKey: 'settings.appearance' },
    { id: 'shortcuts', icon: Keyboard, labelKey: 'settings.shortcuts' },
  ]

  const scrollToSection = useCallback((sectionId: SettingsSection) => {
    setActiveSection(sectionId)
    const el = document.getElementById(`section-${sectionId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const themes: { value: Theme; labelKey: string; emoji: string }[] = [
    { value: 'light', labelKey: 'settings.appearance.theme.light', emoji: '\u2600\uFE0F' },
    { value: 'dark', labelKey: 'settings.appearance.theme.dark', emoji: '\uD83C\uDF19' },
    { value: 'system', labelKey: 'settings.appearance.theme.system', emoji: '\uD83D\uDCBB' },
  ]

  const languages = [
    { value: 'en', labelKey: 'English' },
    { value: 'zh-CN', labelKey: '中文' },
  ]

  const noteWidthOptions: { value: NoteWidth; labelKey: string }[] = [
    { value: 'normal', labelKey: 'settings.general.noteWidth.normal' },
    { value: 'wide', labelKey: 'settings.general.noteWidth.wide' },
  ]

  const syncIntervalOptions = [
    { value: 5, label: '5' },
    { value: 10, label: '10' },
    { value: 15, label: '15' },
    { value: 30, label: '30' },
    { value: 60, label: '60' },
  ]

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
            {/* ===== 通用 ===== */}
            <section id="section-general" className="space-y-4">
              <h2 className="text-base font-semibold">{t('settings.general')}</h2>
              
              <Card>
                <CardContent className="p-0 divide-y divide-border">
                  <div className="px-4">
                    <SettingRow label={t('settings.general.autoStart')} desc={t('settings.general.autoStart.desc')}>
                      <Switch checked={autoStart} onCheckedChange={setAutoStart} />
                    </SettingRow>
                  </div>                  
                  <div className="px-4">
                    <SettingRow label={t('settings.general.closeWithoutExit')} desc={t('settings.general.closeWithoutExit.desc')}>
                      <Switch checked={closeWithoutExit} onCheckedChange={setCloseWithoutExit} />
                    </SettingRow>
                  </div>                 
                  <div className="px-4">
                    <SettingRow label={t('settings.general.language')} desc={t('settings.general.language.desc')}>
                      <Select value={i18n.language} onValueChange={(v) => { i18n.changeLanguage(v); setAppLocale(v); }}>
                        <SelectTrigger className="w-[160px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {languages.map((lang) => (
                            <SelectItem key={lang.value} value={lang.value}>
                              {lang.labelKey}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </SettingRow>
                  </div>                  
                  <div className="px-4">
                    <SettingRow label={t('settings.general.noteWidth')} desc={t('settings.general.noteWidth.desc')}>
                      <Tabs value={noteWidth} onValueChange={(v) => setNoteWidth(v as NoteWidth)}>
                        <TabsList>
                          {noteWidthOptions.map((opt) => (
                            <TabsTrigger key={opt.value} value={opt.value}>
                              {t(opt.labelKey)}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </Tabs>
                    </SettingRow>
                  </div>                  
                  <div className="px-4">
                    <SettingRow label={t('settings.general.showAllFiles')} desc={t('settings.general.showAllFiles.desc')}>
                      <Switch checked={showAllFiles} onCheckedChange={setShowAllFiles} />
                    </SettingRow>
                  </div>
                  <div className="px-4">
                    <SettingRow label={t('settings.general.markdownOnly')} desc={t('settings.general.markdownOnly.desc')}>
                      <Switch checked={markdownOnly} onCheckedChange={setMarkdownOnly} />
                    </SettingRow>
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* ===== 同步 ===== */}
            <section id="section-sync" className="space-y-4">
              <h2 className="text-base font-semibold">{t('settings.sync')}</h2>
              
              <Card>
                <CardContent className="p-0 divide-y divide-border">
                  <div className="px-4">
                    <SettingRow label={t('settings.sync.interval')} desc={t('settings.sync.interval.desc')}>
                      <Select value={String(syncInterval)} onValueChange={(v) => setSyncInterval(Number(v))}>
                        <SelectTrigger className="w-[160px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {syncIntervalOptions.map((opt) => (
                            <SelectItem key={opt.value} value={String(opt.value)}>
                              {opt.label} {t('settings.sync.interval.minute')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </SettingRow>
                  </div>
                  <div className="px-4">
                    <SettingRow label={t('settings.sync.uploadPath')} desc={t('settings.sync.uploadPath.desc')}>
                      <Input
                        className="w-[220px]"
                        placeholder={t('settings.sync.uploadPath.placeholder')}
                        value={uploadPath}
                        onChange={(e) => setUploadPath(e.target.value)}
                      />
                    </SettingRow>
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* ===== 外观 ===== */}
            <section id="section-appearance" className="space-y-4">
              <h2 className="text-base font-semibold">{t('settings.appearance')}</h2>
              
              <Card>
                <CardContent className="p-0">
                  <div className="py-3 px-4 border-b border-border">
                    <div className="flex items-start justify-between">
                      <div className="mr-4 pt-1">
                        <Label className="text-sm font-medium">{t('settings.appearance.theme')}</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">{t('settings.appearance.theme.desc')}</p>
                      </div>
                      <Tabs value={theme} onValueChange={(v) => setTheme(v as Theme)}>
                        <TabsList>
                          {themes.map((themeOption) => (
                            <TabsTrigger key={themeOption.value} value={themeOption.value} className="gap-1.5">
                              <span>{themeOption.emoji}</span>
                              {t(themeOption.labelKey)}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </Tabs>
                    </div>
                  </div>
                  <div className="px-4 py-2 border-b border-border">
                    <Tabs value={customThemeTab} onValueChange={(v) => setCustomThemeTab(v as 'light' | 'dark')}>
                      <TabsList>
                        <TabsTrigger value="light">{t('settings.appearance.customTheme.lightTab')}</TabsTrigger>
                        <TabsTrigger value="dark">{t('settings.appearance.customTheme.darkTab')}</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                  <div className="flex min-h-[280px]">
                    <div className="w-44 border-r border-border py-2 px-2 flex flex-col">
                      <div className="flex-1 overflow-y-auto space-y-0.5">
                        {customThemes
                          .filter((ct) => !ct.isBuiltIn || (customThemeTab === 'light' ? ct.id === 'builtin-light' : ct.id === 'builtin-dark'))
                          .map((ct) => (
                          <div
                            key={ct.id}
                            className={cn(
                              'flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer group',
                              activeCustomThemeId === ct.id ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                            )}
                            onClick={() => setActiveCustomThemeId(customThemeTab, ct.id)}
                          >
                            <div className={cn(
                              'w-3.5 h-3.5 rounded-full border shrink-0',
                              activeCustomThemeId === ct.id ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                            )} />
                            {renamingId === ct.id ? (
                              <div className="flex items-center gap-1 flex-1 min-w-0">
                                <input
                                  className="flex-1 min-w-0 bg-background border border-border rounded px-1 py-0.5 text-xs"
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      renameCustomTheme(ct.id, renameValue)
                                      setRenamingId(null)
                                    } else if (e.key === 'Escape') {
                                      setRenamingId(null)
                                    }
                                  }}
                                  autoFocus
                                />
                                <button onClick={() => { renameCustomTheme(ct.id, renameValue); setRenamingId(null) }}><Check size={12} /></button>
                                <button onClick={() => setRenamingId(null)}><X size={12} /></button>
                              </div>
                            ) : (
                              <span className="truncate flex-1">{ct.name}</span>
                            )}
                            {!ct.isBuiltIn && renamingId !== ct.id && (
                              <div className="hidden group-hover:flex items-center gap-0.5">
                                <button
                                  className="p-0.5 hover:text-primary"
                                  onClick={(e) => { e.stopPropagation(); setRenamingId(ct.id); setRenameValue(ct.name) }}
                                >
                                  <Pencil size={11} />
                                </button>
                                <button
                                  className="p-0.5 hover:text-destructive"
                                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(ct.id) }}
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2 w-full justify-start gap-1.5 text-xs"
                        onClick={() => addCustomTheme(t('settings.appearance.customTheme.add'), customThemeTab)}
                      >
                        <Plus size={12} />
                        {t('settings.appearance.customTheme.add')}
                      </Button>
                    </div>
                    <div className="flex-1 p-4">
                      {(() => {
                        const activeTheme = customThemes.find((ct) => ct.id === activeCustomThemeId)
                        if (!activeTheme) return <div className="text-sm text-muted-foreground">{t('settings.appearance.customTheme.comingSoon')}</div>
                        const colors = customThemeTab === 'light' ? activeTheme.light : activeTheme.dark
                        const colorFields: { key: keyof CustomThemeColors; labelKey: string; descKey: string }[] = [
                          { key: 'themeColor', labelKey: 'settings.appearance.customTheme.themeColor', descKey: 'settings.appearance.customTheme.themeColor.desc' },
                          { key: 'appBg', labelKey: 'settings.appearance.customTheme.appBg', descKey: 'settings.appearance.customTheme.appBg.desc' },
                          { key: 'contentBg', labelKey: 'settings.appearance.customTheme.contentBg', descKey: 'settings.appearance.customTheme.contentBg.desc' },
                          { key: 'textColor', labelKey: 'settings.appearance.customTheme.textColor', descKey: 'settings.appearance.customTheme.textColor.desc' },
                          { key: 'borderColor', labelKey: 'settings.appearance.customTheme.borderColor', descKey: 'settings.appearance.customTheme.borderColor.desc' },
                          { key: 'tooltipColor', labelKey: 'settings.appearance.customTheme.tooltipColor', descKey: 'settings.appearance.customTheme.tooltipColor.desc' },
                        ]
                        return (
                          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                            {colorFields.map((field) => (
                              <div key={field.key} className="flex items-center justify-between">
                                <div className="mr-2 min-w-0">
                                  <Label className="text-xs font-medium">{t(field.labelKey)}</Label>
                                  <p className="text-[10px] text-muted-foreground leading-tight">{t(field.descKey)}</p>
                                </div>
                                <input
                                  type="color"
                                  value={colors[field.key]}
                                  onChange={(e) => updateCustomThemeColor(activeTheme.id, customThemeTab, field.key, e.target.value)}
                                  disabled={activeTheme.isBuiltIn}
                                  className={cn(
                                    'w-7 h-7 rounded cursor-pointer border border-border bg-background shrink-0',
                                    activeTheme.isBuiltIn && 'opacity-50 cursor-not-allowed'
                                  )}
                                />
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* ===== 快捷键 ===== */}
            <section id="section-shortcuts" className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">{t('settings.shortcuts.title')}</h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => useUIStore.getState().resetAllShortcuts()}
                >
                  {t('settings.shortcuts.resetAll')}
                </Button>
              </div>
              <Card>
                <CardContent className="divide-y divide-border p-0">
                  {DEFAULT_SHORTCUTS.map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <div className="flex-1 mr-4">
                        <Label className="text-sm font-medium">{t(`settings.shortcuts.${item.key}`)}</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">{t(`settings.shortcuts.${item.key}.desc`)}</p>
                      </div>
                      <ShortcutRecorder shortcutKey={item.key} />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>
          </div>
        </ScrollArea>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.appearance.customTheme.delete')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.appearance.customTheme.deleteConfirm', { name: customThemes.find((ct) => ct.id === deleteTarget)?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (deleteTarget) deleteCustomTheme(deleteTarget)
              setDeleteTarget(null)
            }}>
              {t('common.confirm', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { SettingsView }
