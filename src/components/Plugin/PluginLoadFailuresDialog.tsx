/**
 * PluginLoadFailuresDialog — surfaces per-plugin load failures
 * captured by `loadAllPlugins` (Task 2 / G2).
 *
 * The host's `loadAllPlugins` uses an "allSettled" pattern: a
 * single broken manifest no longer aborts the rest of the batch.
 * The other plugins load normally; the failures are kept in
 * `usePluginStore.loadFailures` (keyed by plugin id). This dialog
 * gives the user a way to act on those failures:
 *
 *   - **View logs** — closes this dialog and asks the parent
 *     (the manager view) to open the existing logs popup. We
 *     reuse the manager's `openDialog` slot so we don't mount a
 *     second logs instance.
 *   - **Uninstall** — calls `uninstallPlugin` for the broken
 *     package and re-scans + re-loads so the failure record
 *     disappears along with the on-disk package.
 *   - **Dismiss** — clears the failure record without
 *     uninstalling (useful when the user already knows about
 *     the problem and doesn't want the banner to nag).
 *
 * Visual shell mirrors the other plugin popups (`.pa-popup` /
 * `.pa-popup-head` / `.pa-popup-body` / `.pa-popup-foot`) so the
 * chrome stays consistent.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  X,
  ScrollText,
  Trash2,
  EyeOff,
  PlugZap,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { uninstallPlugin, scanPlugins } from '@/lib/tauri'
import { loadAllPlugins } from '@/lib/plugin-loader'
import { usePluginStore, useUIStore } from '@/stores'
import { useShallow } from 'zustand/react/shallow'
import type { PluginLoadFailure } from '@/types/plugin'

export interface PluginLoadFailuresDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Forwarded "View logs" handler. Called when the user clicks
   * the View logs button on a row (or the dialog footer). The
   * parent is expected to close this dialog and open the
   * manager's existing `PluginLogsDialog`. We pass a callback
   * instead of a global event so the dialog stays a pure
   * controlled component — the parent decides how to surface
   * the logs popup.
   */
  onViewLogs?: () => void
}

/**
 * Which destructive action the user is currently confirming in
 * the in-dialog confirm strip. `null` means no confirmation is
 * pending and the row is in its normal state. The string is the
 * id of the plugin to act on. We keep the state local to the
 * dialog so the manager view doesn't have to know about per-row
 * "are you sure" UI.
 */
type ConfirmingUninstall = string | null

export function PluginLoadFailuresDialog({
  open,
  onOpenChange,
  onViewLogs,
}: PluginLoadFailuresDialogProps) {
  const { t } = useTranslation()
  // Subscribe to the failure map as a *value* (useShallow) so the
  // dialog only re-renders when the map actually changes —
  // otherwise every `setLoadFailures` call in the store would
  // re-render every component that touched `loadFailures`.
  const failures = usePluginStore(useShallow((s) => s.loadFailures))
  const clearLoadFailure = usePluginStore((s) => s.clearLoadFailure)
  const clearLoadFailures = usePluginStore((s) => s.clearLoadFailures)

  // Sorted snapshot: most recent failure on top, stable order for
  // the rest so a re-render doesn't shuffle rows around under the
  // user's cursor. The store's `setLoadFailures` replaces the map
  // atomically so this list is internally consistent.
  const rows = useMemo<PluginLoadFailure[]>(() => {
    return Object.values(failures).sort((a, b) => b.ts - a.ts)
  }, [failures])

  // The id of the row whose "Uninstall" button is currently in
  // confirm mode. We use a small strip (Cancel / Confirm) below
  // the row instead of a nested `AlertDialog` because the dialog
  // is already modal — opening a second modal for confirmation
  // is a well-known a11y trap (focus loss, ESC chain) and adds
  // no value here.
  const [confirming, setConfirming] = useState<ConfirmingUninstall>(null)
  // Per-row in-flight flag for the Uninstall confirm path. We
  // disable the confirm button while the tauri call is pending so
  // a double-click doesn't trigger two uninstalls (Rust's
  // `uninstall_plugin` is idempotent at the FS level but we'd
  // rather not rely on that).
  const [busy, setBusy] = useState<string | null>(null)

  // When the dialog opens, clear the local confirm state so a
  // half-confirmed row from a previous open doesn't bleed into
  // the new view.
  useEffect(() => {
    if (open) {
      setConfirming(null)
      setBusy(null)
    }
  }, [open])

  /**
   * Run the tauri uninstall and rebuild the registry, mirroring
   * the same flow as `PluginManagerView.handleUninstall`. We
   * inline the steps (rather than call back to the parent) so
   * the dialog is self-contained: the parent only needs to
   * mount it once and forward `open` / `onOpenChange`.
   */
  const performUninstall = async (id: string) => {
    setBusy(id)
    try {
      await uninstallPlugin(id)
      // Drop the stale UI state the same way `handleUninstall`
      // does — without this, removing a plugin that owned a
      // sidebar/right-panel slot would leave the view stuck on
      // a now-empty chrome.
      const ui = useUIStore.getState()
      if (ui.sidebarView === `plugin:${id}`) {
        ui.setSidebarView('explorer')
        if (ui.settingsPanelVisible) ui.setSettingsPanelVisible(false)
      }
      if (ui.rightPanelType === `plugin:${id}`) {
        ui.setRightPanelType(null)
      }
      // Find the row in the current failure list to grab the
      // display name for the success toast. Falling back to
      // the id keeps the toast usable even if the row was
      // removed from the failure map mid-flight.
      const row = rows.find((r) => r.id === id)
      const name = row?.name ?? id
      toast.success(t('plugin.uninstallSuccess', { name }))

      // Rebuild the plugin registry so the now-missing package
      // stops appearing in the main grid. Same shape as
      // `handleUninstall`'s follow-up call.
      const rustMetas = await scanPlugins()
      const { plugins: loaded, failures: nextFailures } = await loadAllPlugins(rustMetas)
      usePluginStore.getState().setPlugins(loaded)
      usePluginStore.getState().setLoadFailures(nextFailures)
      // Drop the per-plugin failure record for the id we just
      // uninstalled (the rescan above will normally have done
      // this, but we clear explicitly so a race where Rust
      // re-emits a transient failure doesn't resurrect the
      // banner).
      clearLoadFailure(id)
    } catch (err) {
      toast.error(t('plugin.uninstallFailed'), { description: String(err) })
    } finally {
      setBusy(null)
      setConfirming(null)
    }
  }

  const handleDismissAll = () => {
    clearLoadFailures()
    toast.info(t('plugin.pa.loadFailures.dismissed'))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pa-popup is-wide">
        <header className="pa-popup-head">
          <div>
            <div className="pa-popup-eyebrow">
              {t('plugin.pa.loadFailures.banner', { count: rows.length })}
            </div>
            <DialogTitle asChild>
              <h2 className="pa-popup-title">
                {t('plugin.pa.loadFailures.dialogTitle')}
              </h2>
            </DialogTitle>
            <DialogDescription className="pa-popup-desc">
              {rows.length === 0
                ? t('plugin.pa.loadFailures.empty')
                : ''}
            </DialogDescription>
          </div>
          <button
            type="button"
            className="pa-popup-close"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X />
          </button>
        </header>

        <div className="pa-popup-body pa-loadfailures-body">
          {rows.length === 0 ? (
            <div className="pa-loadfailures-empty">
              <PlugZap size={18} />
              <span>{t('plugin.pa.loadFailures.empty')}</span>
            </div>
          ) : (
            <ul className="pa-loadfailures-list" role="list">
              {rows.map((f) => {
                const isConfirming = confirming === f.id
                const isBusy = busy === f.id
                return (
                  <li
                    key={f.id}
                    className={`pa-loadfailures-row${isConfirming ? ' is-confirming' : ''}`}
                  >
                    <div className="pa-loadfailures-icon" aria-hidden="true">
                      <AlertTriangle size={14} />
                    </div>
                    <div className="pa-loadfailures-main">
                      <div className="pa-loadfailures-name" title={f.id}>
                        {f.name}
                      </div>
                      <div className="pa-loadfailures-reason" title={f.reason}>
                        {f.reason}
                      </div>
                      <div className="pa-loadfailures-meta">
                        <span className="pa-loadfailures-meta-id">{f.id}</span>
                        <span className="pa-loadfailures-meta-sep">·</span>
                        <span className="pa-loadfailures-meta-time">
                          {formatTs(f.ts)}
                        </span>
                      </div>
                    </div>
                    <div className="pa-loadfailures-actions">
                      {isConfirming ? (
                        <>
                          <button
                            type="button"
                            className="pa-btn pa-btn-ghost"
                            onClick={() => setConfirming(null)}
                            disabled={isBusy}
                          >
                            {t('common.cancel', { defaultValue: '取消' })}
                          </button>
                          <button
                            type="button"
                            className="pa-btn pa-btn-danger"
                            onClick={() => void performUninstall(f.id)}
                            disabled={isBusy}
                          >
                            <Trash2 size={12} />
                            {isBusy
                              ? t('common.loading')
                              : t('plugin.pa.loadFailures.uninstall')}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="pa-btn"
                            onClick={() => clearLoadFailure(f.id)}
                            title={t('plugin.pa.loadFailures.dismiss')}
                          >
                            <EyeOff size={12} />
                            {t('plugin.pa.loadFailures.dismiss')}
                          </button>
                          <button
                            type="button"
                            className="pa-btn pa-btn-danger"
                            onClick={() => setConfirming(f.id)}
                          >
                            <Trash2 size={12} />
                            {t('plugin.pa.loadFailures.uninstall')}
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <footer className="pa-popup-foot">
          <span className="pa-loadfailures-count">
            {t('plugin.pa.loadFailures.banner', { count: rows.length })}
          </span>
          <div className="pa-right">
            <button
              type="button"
              className="pa-btn"
              onClick={handleDismissAll}
              disabled={rows.length === 0}
              title={t('plugin.pa.loadFailures.dismiss')}
            >
              <EyeOff size={12} />
              {t('plugin.pa.loadFailures.dismiss')}
            </button>
            <button
              type="button"
              className="pa-btn"
              onClick={() => {
                onOpenChange(false)
                onViewLogs?.()
              }}
              disabled={rows.length === 0}
              title={t('plugin.pa.loadFailures.viewLogs')}
            >
              <ScrollText size={12} />
              {t('plugin.pa.loadFailures.viewLogs')}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

/** Format a failure timestamp into a compact locale string. */
function formatTs(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}
