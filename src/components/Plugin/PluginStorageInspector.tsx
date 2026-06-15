/**
 * PluginStorageInspector — per-plugin storage browser.
 *
 * Lists every key in a plugin's storage namespace along with the
 * estimated JSON-encoded size of its value, sorted by size
 * descending. The user can:
 *   - Hover a key to see the full path (long keys are truncated
 *     visually so the table doesn't wrap).
 *   - Clear a single key (with confirmation).
 *   - Clear the entire namespace (with confirmation).
 *
 * The dialog is opened by `PluginInstalledCard`'s "Storage" button
 * (Task 6 / SubTask 6.5) and is mounted from `PluginManagerView`
 * in the same way as the other plugin popups (Activity /
 * Diagnostics / Logs) — but unlike those it is *scoped* to a
 * specific plugin, so the open/close state carries the plugin
 * reference rather than just a boolean.
 *
 * Visual shell mirrors `.pa-popup` so it matches the other plugin
 * dialogs. The body uses a custom table layout (`.psi-table`) so
 * the key column can truncate cleanly and the size column stays
 * right-aligned; styles are added to `index.css`.
 */
import { useEffect, useState, useCallback } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import {
  Database,
  Trash2,
  RefreshCw,
  AlertTriangle,
  HardDrive,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import type { PluginDefinition } from '@/types/plugin'
import {
  getPluginStorageEntries,
  deletePluginStorageEntry,
  clearPluginStorage,
} from '@/lib/plugin-host'

export interface PluginStorageInspectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The plugin whose storage we're inspecting. Required while
   *  `open` is true; ignored otherwise. We pass the full
   *  `PluginDefinition` (not just the id) so the header can show
   *  the localised name and description without a store lookup. */
  plugin: PluginDefinition | null
}

interface StorageEntry {
  key: string
  size: number
}

/**
 * Stage of the in-flight destructive action. We keep a small
 * state machine in the dialog body so the same `<Dialog>` can be
 * used for both "are you sure?" confirmation and the real work
 * without spawning a second modal (which is a common a11y trap).
 */
type ConfirmKind = null | 'all' | { single: string }

export function PluginStorageInspector({
  open,
  onOpenChange,
  plugin,
}: PluginStorageInspectorProps) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<StorageEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmKind>(null)

  // Load (or reload) the entry list. Re-runs every time the
  // destructive-action callbacks below finish; the `plugin?.id`
  // dep guards against firing for a stale reference. The
  // `cancelled` guard for the *open* path lives in the
  // `useEffect` below (self-invoke IIFE) because that's the
  // path that actually races — the user can switch plugins
  // between open() and the response landing. A delete/clear
  // always runs in the context of a still-open dialog, so the
  // `cancelled` flag would be a no-op here.
  const refresh = useCallback(async () => {
    if (!plugin) return
    setLoading(true)
    try {
      const list = await getPluginStorageEntries(plugin.id)
      setEntries(list)
    } catch (err) {
      // Permission denied or read error — surface as a toast
      // instead of an inline error so the dialog can still be
      // closed cleanly. The next refresh after a permission fix
      // will repopulate the table.
      console.error('[PluginStorageInspector] failed to read storage:', err)
      toast.error(t('plugin.pa.dialog.storageInspector.loadFailed'), {
        description: String(err),
      })
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [plugin, t])

  useEffect(() => {
    if (!open || !plugin) {
      // Reset transient state when the dialog closes so a fresh
      // open starts from a clean slate (no stale confirm prompt
      // or pending busy spinner).
      setEntries([])
      setConfirm(null)
      return
    }
    // Self-invoke async IIFE with a `cancelled` guard so the
    // in-flight `getPluginStorageEntries` is invalidated if the
    // user closes the dialog or switches to a different plugin
    // before the response lands. Mirrors the proven pattern in
    // `PluginMarketDetail.listPluginVersions` — the only
    // material difference is we already have a `refresh`
    // callback we want to reuse for the destructive-action
    // refresh path, so the IIFE is the thin wrapper.
    let cancelled = false
    void (async () => {
      if (!plugin) return
      setLoading(true)
      try {
        const list = await getPluginStorageEntries(plugin.id)
        if (cancelled) return
        setEntries(list)
      } catch (err) {
        if (cancelled) return
        console.error('[PluginStorageInspector] failed to read storage:', err)
        toast.error(t('plugin.pa.dialog.storageInspector.loadFailed'), {
          description: String(err),
        })
        setEntries([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, plugin, t])

  // ── Destructive actions ───────────────────────────────────────

  const handleDeleteKey = useCallback(
    async (key: string) => {
      if (!plugin) return
      setBusy(true)
      try {
        await deletePluginStorageEntry(plugin.id, key)
        toast.success(t('plugin.pa.dialog.storageInspector.keyDeleted', { key }))
        // Refresh the list so the size column and totals stay
        // accurate. We could do an optimistic update instead,
        // but `getEntries` is cheap and a real reload also
        // catches any side effects from a buggy `set()`.
        await refresh()
      } catch (err) {
        console.error('[PluginStorageInspector] delete failed:', err)
        toast.error(t('plugin.pa.dialog.storageInspector.deleteFailed'), {
          description: String(err),
        })
      } finally {
        setBusy(false)
        setConfirm(null)
      }
    },
    [plugin, t, refresh]
  )

  const handleClearAll = useCallback(async () => {
    if (!plugin) return
    setBusy(true)
    try {
      await clearPluginStorage(plugin.id)
      toast.success(t('plugin.pa.dialog.storageInspector.allCleared', {
        name: plugin.name,
      }))
      await refresh()
    } catch (err) {
      console.error('[PluginStorageInspector] clear failed:', err)
      toast.error(t('plugin.pa.dialog.storageInspector.clearFailed'), {
        description: String(err),
      })
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }, [plugin, t, refresh])

  // Totals for the footer. Computed off the in-memory list so
  // the count is always consistent with what the user sees.
  const totalBytes = entries.reduce((sum, e) => sum + e.size, 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pa-popup is-wide">
        <header className="pa-popup-head">
          <div>
            <div className="pa-popup-eyebrow">
              {t('plugin.pa.dialog.storageInspector.eyebrow')}
            </div>
            <DialogTitle asChild>
              <h2 className="pa-popup-title">
                {plugin?.name ?? ''} — {t('plugin.pa.dialog.storageInspector.title')}
              </h2>
            </DialogTitle>
          </div>
        </header>

        <div className="pa-popup-body">
          {confirm ? (
            <ConfirmPanel
              kind={confirm}
              pluginName={plugin?.name ?? ''}
              busy={busy}
              onCancel={() => setConfirm(null)}
              onConfirm={() => {
                if (confirm === 'all') {
                  void handleClearAll()
                } else if (typeof confirm === 'object') {
                  void handleDeleteKey(confirm.single)
                }
              }}
            />
          ) : entries.length === 0 && !loading ? (
            <div className="pa-empty">
              <Database size={20} />
              <div className="pa-empty-title">—</div>
              <div className="pa-empty-hint">
                {t('plugin.pa.dialog.storageInspector.empty')}
              </div>
            </div>
          ) : (
            <div className="psi-table" role="table" aria-label="Storage entries">
              <div className="psi-head" role="row">
                <div className="psi-cell psi-cell-key" role="columnheader">
                  {t('plugin.pa.dialog.storageInspector.colKey')}
                </div>
                <div className="psi-cell psi-cell-size" role="columnheader">
                  {t('plugin.pa.dialog.storageInspector.colSize')}
                </div>
                <div className="psi-cell psi-cell-action" role="columnheader">
                  <span className="sr-only">Actions</span>
                </div>
              </div>
              {entries.map((entry) => (
                <div className="psi-row" role="row" key={entry.key}>
                  <div
                    className="psi-cell psi-cell-key"
                    role="cell"
                    title={entry.key}
                  >
                    <span className="psi-key-text">{entry.key}</span>
                  </div>
                  <div className="psi-cell psi-cell-size" role="cell">
                    {formatBytes(entry.size)}
                  </div>
                  <div className="psi-cell psi-cell-action" role="cell">
                    <button
                      type="button"
                      className="psi-row-del"
                      disabled={busy}
                      onClick={() => setConfirm({ single: entry.key })}
                      aria-label={t('plugin.pa.dialog.storageInspector.deleteKey', { key: entry.key })}
                      title={t('plugin.pa.dialog.storageInspector.deleteKey', { key: entry.key })}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="pa-popup-foot">
          <span>
            <HardDrive size={10} style={{ verticalAlign: -1, marginRight: 3 }} />
            <Trans
              i18nKey="plugin.pa.dialog.storageInspector.footer"
              values={{
                count: entries.length,
                bytes: formatBytes(totalBytes),
              }}
              components={{ b: <b /> }}
            />
          </span>
          <div className="pa-right">
            <button
              className="pa-btn pa-btn-ghost"
              onClick={() => void refresh()}
              disabled={loading || busy}
            >
              <RefreshCw size={11} />
              {t('plugin.pa.dialog.storageInspector.refresh')}
            </button>
            <button
              className="pa-btn pa-btn-outline psi-danger"
              onClick={() => setConfirm('all')}
              disabled={busy || entries.length === 0}
            >
              <Trash2 size={11} />
              {t('plugin.pa.dialog.storageInspector.clearAll')}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Inline confirmation panel. Re-using the same `<Dialog>` for
 * the confirm step avoids spawning a second modal — that's both
 * an a11y win (one focus trap) and a visual win (no double
 * backdrop). The destructive button is enabled only while
 * `!busy`, so a double-click can't fire the same action twice.
 */
function ConfirmPanel({
  kind,
  pluginName,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: ConfirmKind
  pluginName: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const isAll = kind === 'all'
  return (
    <div className="psi-confirm" role="alertdialog" aria-modal="true">
      <div className="psi-confirm-icon">
        <AlertTriangle size={18} />
      </div>
      <div className="psi-confirm-text">
        <div className="psi-confirm-title">
          {isAll
            ? t('plugin.pa.dialog.storageInspector.confirmClearAllTitle', { name: pluginName })
            : t('plugin.pa.dialog.storageInspector.confirmDeleteKeyTitle', {
                key: kind && typeof kind === 'object' ? kind.single : '',
              })}
        </div>
        <div className="psi-confirm-hint">
          {isAll
            ? t('plugin.pa.dialog.storageInspector.confirmClearAllHint')
            : t('plugin.pa.dialog.storageInspector.confirmDeleteKeyHint')}
        </div>
      </div>
      <div className="psi-confirm-actions">
        <button
          type="button"
          className="pa-btn pa-btn-ghost"
          onClick={onCancel}
          disabled={busy}
        >
          {t('plugin.pa.dialog.storageInspector.confirmCancel')}
        </button>
        <button
          type="button"
          className="pa-btn pa-btn-outline psi-danger"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? t('common.loading') : t('plugin.pa.dialog.storageInspector.confirmProceed')}
        </button>
      </div>
    </div>
  )
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(2)} MB`
}
