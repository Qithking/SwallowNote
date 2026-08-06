import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingRow } from '../SettingRow'

const syncIntervalOptions = [
  { value: 5, label: '5' },
  { value: 10, label: '10' },
  { value: 15, label: '15' },
  { value: 30, label: '30' },
  { value: 60, label: '60' },
]

export function SyncSettings({
  syncInterval,
  setSyncInterval,
  autoSyncPush,
  setAutoSyncPush,
  uploadPath,
  setUploadPath,
  showConflictBadge,
  setShowConflictBadge,
}: {
  syncInterval: number
  setSyncInterval: (v: number) => void
  autoSyncPush: boolean
  setAutoSyncPush: (v: boolean) => void
  uploadPath: string
  setUploadPath: (v: string) => void
  showConflictBadge: boolean
  setShowConflictBadge: (v: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <section id="section-sync" className="space-y-4">
      <h2 className="text-base font-semibold">{t('settings.sync')}</h2>

      <Card>
        <CardContent className="p-0 divide-y divide-border">
          <div className="px-4">
            <SettingRow label={t('settings.sync.pullInterval')} desc={t('settings.sync.pullInterval.desc')}>
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
            <SettingRow label={t('settings.sync.autoSyncPush')} desc={t('settings.sync.autoSyncPush.desc')}>
              <Switch checked={autoSyncPush} onCheckedChange={setAutoSyncPush} />
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
          <div className="px-4">
            <SettingRow label={t('settings.sync.showConflictBadge')} desc={t('settings.sync.showConflictBadge.desc')}>
              <Switch checked={showConflictBadge} onCheckedChange={setShowConflictBadge} />
            </SettingRow>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
