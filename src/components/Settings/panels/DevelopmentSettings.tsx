import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { SettingRow } from '../SettingRow'

export function DevelopmentSettings({
  developerMode,
  setDeveloperMode,
}: {
  developerMode: boolean
  setDeveloperMode: (v: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <section id="section-development" className="space-y-4">
      <h2 className="text-base font-semibold">{t('settings.development')}</h2>
      <Card>
        <CardContent className="p-0 divide-y divide-border">
          <div className="px-4">
            <SettingRow label={t('settings.development.developerMode')} desc={t('settings.development.developerMode.desc')}>
              <Switch checked={developerMode} onCheckedChange={setDeveloperMode} />
            </SettingRow>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
