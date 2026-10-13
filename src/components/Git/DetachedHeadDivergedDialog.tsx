import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

/**
 * detached HEAD 分叉决策对话框。
 *
 * 触发场景：仓库 HEAD 处于游离状态，且本地分支与 HEAD 已双向分叉
 * （本地分支有 N 个提交、当前 HEAD 有 M 个提交，互不包含）。
 * 此时任何自动切换都可能丢数据，由用户在两个明确选项中决策。
 *
 * 注意：这里不使用 AlertDialogAction/Cancel，避免 Radix 点击即关闭导致
 * 异步操作未完成就卸载对话框；关闭动作统一由父组件控制 open。
 */
interface DetachedHeadDivergedDialogProps {
  open: boolean
  repoName: string
  branch: string
  /** 本地分支独有的提交数 */
  localCommits: number
  /** 当前 HEAD（通常等于远端）独有的提交数 */
  remoteCommits: number
  isLoading: boolean
  /** 选项一：以当前 HEAD 为准，重建本地分支（丢弃本地独有提交） */
  onAttachToHead: () => void
  /** 选项二：保留本地分支提交，切回该分支 */
  onKeepLocal: () => void
  onCancel: () => void
}

export function DetachedHeadDivergedDialog({
  open,
  repoName,
  branch,
  localCommits,
  remoteCommits,
  isLoading,
  onAttachToHead,
  onKeepLocal,
  onCancel,
}: DetachedHeadDivergedDialogProps) {
  const { t } = useTranslation()

  return (
    <AlertDialog open={open} onOpenChange={(o: boolean) => { if (!o && !isLoading) onCancel() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500 shrink-0" />
            {t('dialog.detachedHeadDivergedTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-left space-y-2">
            <div>
              {t('dialog.detachedHeadDivergedDesc', {
                repo: repoName,
                branch,
                local: localCommits,
                remote: remoteCommits,
              })}
            </div>
            <div className="text-xs text-muted-foreground">
              <div>{t('dialog.detachedHeadDivergedAttachHint', { branch, local: localCommits })}</div>
              <div>{t('dialog.detachedHeadDivergedKeepLocalHint', { branch })}</div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row sm:justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={isLoading}>
            {t('common.cancel')}
          </Button>
          <Button variant="outline" size="sm" onClick={onKeepLocal} disabled={isLoading}>
            {isLoading && <Loader2 size={12} className="animate-spin" />}
            {t('dialog.detachedHeadDivergedKeepLocal')}
          </Button>
          <Button variant="destructive" size="sm" onClick={onAttachToHead} disabled={isLoading}>
            {isLoading && <Loader2 size={12} className="animate-spin" />}
            {t('dialog.detachedHeadDivergedAttach')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}