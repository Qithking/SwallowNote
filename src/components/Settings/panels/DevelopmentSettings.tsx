import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { exportLogs, openLogDir, saveLogExportDialog } from '@/lib/tauri/file-dialogs'
import { SettingRow } from '../SettingRow'

// 日志占用上限档位（MB），与 spec 一致：5/10/20/50
const logSizeOptions = [5, 10, 20, 50]

export function DevelopmentSettings({
  developerMode,
  setDeveloperMode,
  logMaxFileSize,
  setLogMaxFileSize,
}: {
  developerMode: boolean
  setDeveloperMode: (v: boolean) => void
  logMaxFileSize: number
  setLogMaxFileSize: (mb: number) => void
}) {
  const { t } = useTranslation()
  // 导出日志 loading 态，防重复点击（spec Mitigation）
  const [exporting, setExporting] = useState(false)

  // 导出日志：保存对话框（默认名 SwallowNote-logs-YYYYMMDD.zip）→ 后端打包 → 结果提示
  const handleExportLogs = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const dest = await saveLogExportDialog()
      if (!dest) return // 用户取消
      const count = await exportLogs(dest)
      toast.success(t('settings.development.log.exportSuccess', { count }))
    } catch (e) {
      if (String(e).includes('NO_LOGS')) {
        toast.info(t('settings.development.log.exportNone'))
      } else {
        toast.error(t('settings.development.log.exportFailed'))
      }
    } finally {
      setExporting(false)
    }
  }

  // 打开日志目录：Linux 无文件管理器等失败场景给出错误提示
  const handleOpenLogDir = async () => {
    try {
      await openLogDir()
    } catch {
      toast.error(t('settings.development.log.openFailed'))
    }
  }

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
          <div className="px-4">
            <SettingRow label={t('settings.development.log.maxFileSize')} desc={t('settings.development.log.maxFileSize.desc')}>
              <Select value={String(logMaxFileSize)} onValueChange={(v) => setLogMaxFileSize(Number(v))}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {logSizeOptions.map((mb) => (
                    <SelectItem key={mb} value={String(mb)}>
                      {mb} MB
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
          </div>
          <div className="px-4">
            <SettingRow label={t('settings.development.log.actions')} desc={t('settings.development.log.actions.desc')}>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleOpenLogDir}>
                  {t('settings.development.log.openDir')}
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportLogs} disabled={exporting}>
                  {exporting ? t('settings.development.log.exporting') : t('settings.development.log.export')}
                </Button>
              </div>
            </SettingRow>
          </div>
        </CardContent>        
      </Card>
    </section>
  )
}
