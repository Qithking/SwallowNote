import { useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Settings as SettingsIcon,
  Palette,
  Keyboard,
} from 'lucide-react'
import { useUIStore, Theme, NoteWidth } from '@/stores'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { DEFAULT_SHORTCUTS } from '@/lib/shortcuts'
import { ShortcutRecorder } from './ShortcutRecorder'

type SettingsSection = 'general' | 'appearance' | 'shortcuts'

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
    themeColor, setThemeColor,
    autoStart, setAutoStart,
    closeWithoutExit, setCloseWithoutExit,
    noteWidth, setNoteWidth,
    showAllFiles, setShowAllFiles,
    markdownOnly, setMarkdownOnly,
  } = useUIStore()

  const sections: { id: SettingsSection; icon: typeof SettingsIcon; labelKey: string }[] = [
    { id: 'general', icon: SettingsIcon, labelKey: 'settings.general' },
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
                      <Select value={i18n.language} onValueChange={(v) => i18n.changeLanguage(v)}>
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

            {/* ===== 外观 ===== */}
            <section id="section-appearance" className="space-y-4">
              <h2 className="text-base font-semibold">{t('settings.appearance')}</h2>
              
              <Card>
                <CardContent className="p-0 divide-y divide-border">
                  <div className="px-4">
                    <SettingRow label={t('settings.appearance.themeColor')} desc={t('settings.appearance.themeColor.desc')}>
                      <input
                        type="color"
                        value={themeColor}
                        onChange={(e) => setThemeColor(e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border border-border bg-background"
                      />
                    </SettingRow>
                  </div>
                  
                  <div className="py-3 px-4">
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
    </div>
  )
}

export { SettingsView }
