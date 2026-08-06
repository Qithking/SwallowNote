import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { useUIStore } from '@/stores'
import { DEFAULT_SHORTCUTS } from '@/lib/shortcuts'
import { ShortcutRecorder } from '../ShortcutRecorder'
import { PluginCommandsSection } from '../PluginCommandsSection'

export function ShortcutsSettings() {
  const { t } = useTranslation()
  return (
    <section id="section-shortcuts" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t('shortcuts.title')}</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => useUIStore.getState().resetAllShortcuts()}
        >
          {t('shortcuts.resetAll')}
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
                <Label className="text-sm font-medium">{t(`shortcuts.${item.key}`)}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">{t(`shortcuts.${item.key}.desc`)}</p>
              </div>
              <ShortcutRecorder shortcutKey={item.key} />
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">
              {t('settings.pluginCommands.title')}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('settings.pluginCommands.desc')}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => useUIStore.getState().resetAllPluginCommandShortcuts()}
          >
            {t('settings.pluginCommands.resetAll')}
          </Button>
        </div>
        <PluginCommandsSection />
      </div>
    </section>
  )
}
