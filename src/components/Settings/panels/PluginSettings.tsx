import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Upload, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
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
import { toast } from 'sonner'
import {
  exportPluginConfigs,
  importPluginConfigs,
  savePluginConfigsDialog,
  openPluginConfigsDialog,
} from '@/lib/tauri'
import { logger } from '@/lib/logger'

export function PluginSettings() {
  const { t } = useTranslation()
  const [pluginConfigsExporting, setPluginConfigsExporting] = useState(false)
  const [pluginConfigsImporting, setPluginConfigsImporting] = useState(false)
  const [pluginImportConfirm, setPluginImportConfirm] = useState<{
    srcPath: string
  } | null>(null)

  const handleExportPluginConfigs = useCallback(async () => {
    if (pluginConfigsExporting) return
    setPluginConfigsExporting(true)
    try {
      const destPath = await savePluginConfigsDialog()
      if (!destPath) return
      const manifest = await exportPluginConfigs(destPath)
      toast.success(
        t('settings.plugins.configs.exportSuccess', { count: manifest.plugin_count }),
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      toast.error(t('settings.plugins.configs.exportFailed') + ' · ' + message)
    } finally {
      setPluginConfigsExporting(false)
    }
  }, [pluginConfigsExporting, t])

  const handlePickImportBundle = useCallback(async () => {
    if (pluginConfigsImporting) return
    const srcPath = await openPluginConfigsDialog()
    if (!srcPath) return
    setPluginImportConfirm({ srcPath })
  }, [pluginConfigsImporting])

  const handleConfirmImport = useCallback(async () => {
    const target = pluginImportConfirm
    if (!target) return
    setPluginImportConfirm(null)
    setPluginConfigsImporting(true)
    try {
      const result = await importPluginConfigs(target.srcPath)
      if (result.imported === 0 && result.entries.length === 0) {
        toast.info(t('settings.plugins.configs.importNone'))
      } else {
        toast.success(
          t('settings.plugins.configs.importSuccess', {
            imported: result.imported,
            total: result.plugin_count,
            skipped: result.skipped,
          }),
        )
      }
      const ok = result.entries
        .filter((entry) => entry.status === 'ok')
        .map((entry) => entry.plugin_id)
      if (ok.length > 0) {
        const { seedPluginStorageSizes } = await import('@/lib/plugin-telemetry')
        const { getAllPluginStorageSizes } = await import('@/lib/tauri')
        try {
          const sizes = await getAllPluginStorageSizes()
          seedPluginStorageSizes(sizes)
        } catch (err) {
          logger.warn('settings', 'failed to re-seed storage sizes after import:', err)
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      toast.error(message)
    } finally {
      setPluginConfigsImporting(false)
    }
  }, [pluginImportConfirm, t])

  return (
    <>
      <section id="section-plugins" className="space-y-4">
        <h2 className="text-base font-semibold">{t('settings.plugins')}</h2>
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            <div className="px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <Label className="text-sm font-medium">{t('settings.plugins.configs')}</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('settings.plugins.configs.desc')}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pluginConfigsExporting || pluginConfigsImporting}
                    onClick={handleExportPluginConfigs}
                  >
                    {pluginConfigsExporting ? (
                      <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5 mr-1" />
                    )}
                    {t('settings.plugins.configs.export')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pluginConfigsExporting || pluginConfigsImporting}
                    onClick={handlePickImportBundle}
                  >
                    {pluginConfigsImporting ? (
                      <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5 mr-1" />
                    )}
                    {t('settings.plugins.configs.import')}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <AlertDialog
        open={!!pluginImportConfirm}
        onOpenChange={(open) => { if (!open) setPluginImportConfirm(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.plugins.configs.import')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pluginImportConfirm?.srcPath ?? ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPluginImportConfirm(null)}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmImport} disabled={pluginConfigsImporting}>
              {pluginConfigsImporting ? (
                <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : null}
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
