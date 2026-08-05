import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { setAppLocale } from '@/lib/tauri'
import { emitLocaleChanged } from '@/lib/plugin-host'
import type { NoteWidth } from '@/stores'
import { SettingRow } from '../SettingRow'

const languages = [
  { value: 'en', labelKey: 'settings.general.language.en' },
  { value: 'zh-CN', labelKey: 'settings.general.language.zhCN' },
]

const noteWidthOptions: { value: NoteWidth; labelKey: string }[] = [
  { value: 'normal', labelKey: 'settings.general.noteWidth.normal' },
  { value: 'wide', labelKey: 'settings.general.noteWidth.wide' },
]

export function GeneralSettings({
  autoStart,
  setAutoStart,
  autoCheckUpdate,
  setAutoCheckUpdate,
  closeWithoutExit,
  setCloseWithoutExit,
  noteWidth,
  setNoteWidth,
  showAllFiles,
  setShowAllFiles,
  markdownOnly,
  setMarkdownOnly,
}: {
  autoStart: boolean
  setAutoStart: (v: boolean) => void
  autoCheckUpdate: boolean
  setAutoCheckUpdate: (v: boolean) => void
  closeWithoutExit: boolean
  setCloseWithoutExit: (v: boolean) => void
  noteWidth: NoteWidth
  setNoteWidth: (v: NoteWidth) => void
  showAllFiles: boolean
  setShowAllFiles: (v: boolean) => void
  markdownOnly: boolean
  setMarkdownOnly: (v: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  return (
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
            <SettingRow label={t('settings.general.autoCheckUpdate')} desc={t('settings.general.autoCheckUpdate.desc')}>
              <Switch checked={autoCheckUpdate} onCheckedChange={setAutoCheckUpdate} />
            </SettingRow>
          </div>
          <div className="px-4">
            <SettingRow label={t('settings.general.closeWithoutExit')} desc={t('settings.general.closeWithoutExit.desc')}>
              <Switch checked={closeWithoutExit} onCheckedChange={setCloseWithoutExit} />
            </SettingRow>
          </div>
          <div className="px-4">
            <SettingRow label={t('settings.general.language')} desc={t('settings.general.language.desc')}>
              <Select value={i18n.language} onValueChange={(v) => { i18n.changeLanguage(v); setAppLocale(v); queueMicrotask(() => emitLocaleChanged(v)); }}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {languages.map((lang) => (
                    <SelectItem key={lang.value} value={lang.value}>
                      {t(lang.labelKey)}
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
  )
}
