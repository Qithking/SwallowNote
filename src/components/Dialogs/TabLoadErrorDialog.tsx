import { useTranslation } from 'react-i18next'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction } from '@/components/ui/alert-dialog'

interface TabLoadErrorDialogProps {
  open: boolean
  failedTabInfo: { id: string; path: string; name: string } | null
  onClose: () => void
}

export function TabLoadErrorDialog({ open, failedTabInfo, onClose }: TabLoadErrorDialogProps) {
  const { t } = useTranslation()
  return (
    <AlertDialog open={open} onOpenChange={(o: boolean) => { if (!o) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('dialog.fileLoadFailed')}</AlertDialogTitle>
          <AlertDialogDescription className="text-left">
            <p className="mb-2">{t('dialog.fileLoadFailedDesc')}</p>
            <p className="font-mono text-xs truncate" title={failedTabInfo?.path}>
              {failedTabInfo?.name}
            </p>
            <p className="text-xs text-muted-foreground mt-1 truncate" title={failedTabInfo?.path}>
              {failedTabInfo?.path}
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction>{t('common.close')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
