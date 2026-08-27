import { useTranslation } from 'react-i18next'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'

interface SaveConfirmDialogProps {
  open: boolean
  dirtyFileNames: string[]
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

export function SaveConfirmDialog({ open, dirtyFileNames, onSave, onDiscard, onCancel }: SaveConfirmDialogProps) {
  const { t } = useTranslation()
  return (
    <AlertDialog open={open} onOpenChange={(o: boolean) => { if (!o) onCancel() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('dialog.saveChanges')}</AlertDialogTitle>
          <AlertDialogDescription className="text-left">
            <div className="mb-2">{t('dialog.unsavedFiles', { count: dirtyFileNames.length })}</div>
            <div className="max-h-32 overflow-y-auto">
              {dirtyFileNames.map((name, i) => (
                <p key={i} className="truncate text-xs font-mono" title={name}>
                  {name.length > 20 ? name.slice(0, 20) + '...' : name}
                </p>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onDiscard}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onSave}>{t('common.save')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
