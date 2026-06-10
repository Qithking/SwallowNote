/**
 * PluginMarketDetail — modal detail view for a marketplace entry.
 *
 * Shows:
 * - Header: name, id, version, author, tags.
 * - Long description.
 * - Version history (collapsible).
 * - Dependency list.
 * - Action footer: Install / Update / Rollback (per installed
 *   version), and a Close button.
 *
 * Install/update/rollback actions go through `src/lib/plugin-market.ts`
 * (which wraps the Tauri commands). After a successful install we
 * re-trigger the marketplace store's `refreshUpdates` and notify the
 * parent to close.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, RotateCcw, X, Package, User, Tag, History, Link2, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  downloadPluginZip,
  installPluginFromBytes,
  effectivePubkey,
  listPluginVersions,
  rollbackPlugin,
} from '@/lib/plugin-market'
import { usePluginMarketStore, usePluginStore } from '@/stores'
import { loadAllPlugins } from '@/lib/plugin-loader'
import { scanPlugins } from '@/lib/tauri'
import type { PluginIndex, PluginIndexEntry, PluginVersionInfo } from '@/types/plugin'
import type { PluginMetadataRust } from '@/lib/tauri'
export function PluginMarketDetail({
  entry,
  index,
  localVersion,
  onClose,
  onInstalled,
}: {
  entry: PluginIndexEntry
  index: PluginIndex
  localVersion: string | null
  onClose: () => void
  /**
   * Called by the dialog right before closing, after a successful
   * install / update / rollback. The parent (`PluginMarketView`)
   * uses the returned `PluginMetadataRust` to open the post-install
   * permission grant dialog — the same affordance the user-upload
   * path in `PluginManagerView` provides. Without this callback the
   * marketplace install would silently skip the permission step and
   * the user would have to discover the per-card "Permissions"
   * button before they could grant the first permission.
   *
   * Only the metadata is forwarded (id, name, etc.) — we don't pass
   * the full `PluginDefinition` because the registry might not have
   * picked the new entry up yet by the time the callback runs.
   */
  onInstalled?: (meta: PluginMetadataRust) => void
}) {
  const { t } = useTranslation()
  const refreshUpdates = usePluginMarketStore((s) => s.refreshUpdates)

  const [versions, setVersions] = useState<PluginVersionInfo[]>([])
  const [isInstalling, setIsInstalling] = useState(false)
  const [isRolling, setIsRolling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load the list of locally-installed versions so the rollback UI
  // is populated before the user clicks anything.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (localVersion == null) {
        setVersions([])
        return
      }
      try {
        const v = await listPluginVersions(entry.id)
        if (!cancelled) setVersions(v)
      } catch {
        if (!cancelled) setVersions([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [entry.id, localVersion])

  const onInstall = async () => {
    setError(null)
    setIsInstalling(true)
    let installedMeta: PluginMetadataRust | null = null
    try {
      const bytes = await downloadPluginZip(entry)
      const pubkeyB64 = effectivePubkey(index, entry)
      installedMeta = await installPluginFromBytes({
        pluginId: entry.id,
        version: entry.version,
        bytes,
        sha256: entry.sha256,
        pubkeyB64,
        signatureB64: entry.signatureB64,
      })
      // The host successfully wrote the plugin. Run the full reload
      // path (scan → loadAllPlugins → setPlugins) so the new entry
      // is registered with the store *and* gets its `onLoad` hook
      // fired by the host-takeover layer. A shortcut like
      // `setPlugins(list as any)` would skip `loadAllPlugins` and
      // the onLoad hook would never run, leaving the plugin's
      // event subscriptions / storage seeding silent.
      try {
        const list = await scanPlugins()
        const defs = await loadAllPlugins(list)
        usePluginStore.getState().setPlugins(defs)
      } catch (e) {
        console.warn('post-install reload failed', e)
      }
      await refreshUpdates()
      toast.success(
        t('plugin.market.installed', {
          defaultValue: '已安装 {{name}} v{{version}}',
          name: entry.name,
          version: entry.version,
        })
      )
      // Hand off to the parent so the post-install permission
      // dialog can open with the freshly-loaded plugin's declared
      // permission list. The parent closes this dialog and opens
      // the permission modal in a follow-up tick so the two
      // dialogs don't stack.
      if (onInstalled && installedMeta) {
        onInstalled(installedMeta)
      } else {
        onClose()
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setIsInstalling(false)
    }
  }

  const onRollback = async (version: string) => {
    setError(null)
    setIsRolling(version)
    try {
      await rollbackPlugin(entry.id, version)
      // Same full-reload path as install. Rolling back to a previous
      // version is conceptually a fresh plugin load, so we want
      // onLoad/onUnload to fire cleanly.
      try {
        const list = await scanPlugins()
        const defs = await loadAllPlugins(list)
        usePluginStore.getState().setPlugins(defs)
      } catch (e) {
        console.warn('post-rollback reload failed', e)
      }
      await refreshUpdates()
      toast.success(
        t('plugin.market.rolledBack', {
          defaultValue: '已回滚到 {{version}}',
          version,
        })
      )
      // A rollback is a re-activation of an already-installed
      // plugin whose permissions were set on the original install.
      // We don't re-open the permission dialog here — the user
      // has already made their decision on the prior install, and
      // re-prompting on every rollback would be a regression.
      // (The post-install path is purely a "first install" affordance.)
      onClose()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setIsRolling(null)
    }
  }

  const isInstalled = localVersion != null
  const isUpdateAvailable = isInstalled && localVersion !== entry.version

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent style={{ maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <DialogHeader>
          <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Package size={18} />
            {entry.name || t('plugin.market.unknownName', { defaultValue: '未命名插件' })}
            <Badge variant="outline" style={{ marginLeft: 4 }}>
              v{entry.version}
            </Badge>
            {isUpdateAvailable && (
              <Badge style={{ background: 'var(--accent, #4f46e5)', color: 'white' }}>
                <Download size={10} />
                {t('plugin.market.badgeUpdate', { defaultValue: 'Update' })}
              </Badge>
            )}
            {isInstalled && !isUpdateAvailable && (
              <Badge variant="secondary">
                <CheckCircle2 size={10} />
                {t('plugin.market.badgeInstalled', { defaultValue: 'Installed' })}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}>
            {entry.id}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea style={{ flex: 1, paddingRight: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0' }}>
            {/* Author + tags */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)' }}>
                <User size={12} />
                {entry.author || t('plugin.market.unknownAuthor', { defaultValue: '未知作者' })}
              </span>
              {entry.tags.length > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  <Tag size={12} style={{ color: 'var(--text-secondary)' }} />
                  {entry.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" style={{ fontSize: 10 }}>
                      {tag}
                    </Badge>
                  ))}
                </span>
              )}
            </div>

            {/* Description */}
            <p style={{ fontSize: 13, lineHeight: 1.5 }}>
              {entry.description || t('plugin.market.noDescription', { defaultValue: '暂无描述' })}
            </p>

            {/* Dependencies */}
            {entry.dependencies.length > 0 && (
              <section>
                <h4
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  <Link2 size={12} />
                  {t('plugin.market.dependencies', { defaultValue: '依赖' })}
                </h4>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: 'var(--text-secondary)' }}>
                  {entry.dependencies.map((d) => (
                    <li key={d} style={{ fontFamily: 'var(--font-mono, monospace)' }}>
                      {d}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Version history (from index) */}
            {entry.versions.length > 1 && (
              <section>
                <h4
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  <History size={12} />
                  {t('plugin.market.versionHistory', { defaultValue: '版本历史' })}
                </h4>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {entry.versions.map((v) => (
                    <li
                      key={v.version}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        padding: '6px 8px',
                        border: '1px solid var(--border, #e5e5e5)',
                        borderRadius: 4,
                        marginBottom: 4,
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 600 }}>v{v.version}</span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                          {v.publishedAt}
                        </span>
                      </div>
                      {v.changelog && (
                        <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{v.changelog}</div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Local versions + rollback (only when installed) */}
            {isInstalled && versions.length > 1 && (
              <section>
                <h4
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  <RotateCcw size={12} />
                  {t('plugin.market.localVersions', { defaultValue: '已安装版本' })}
                </h4>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {versions.map((v) => (
                    <li
                      key={v.version}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '6px 8px',
                        border: '1px solid var(--border, #e5e5e5)',
                        borderRadius: 4,
                        marginBottom: 4,
                        fontSize: 12,
                        gap: 8,
                      }}
                    >
                      <span>
                        v{v.version}
                        {v.isActive && (
                          <Badge variant="secondary" style={{ marginLeft: 6, fontSize: 10 }}>
                            {t('plugin.market.active', { defaultValue: 'active' })}
                          </Badge>
                        )}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={v.isActive || isRolling === v.version}
                        onClick={() => onRollback(v.version)}
                      >
                        {isRolling === v.version ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RotateCcw size={12} />
                        )}
                        {t('plugin.market.rollback', { defaultValue: '回滚' })}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 6,
                  padding: 8,
                  background: 'rgba(192, 57, 43, 0.08)',
                  border: '1px solid rgba(192, 57, 43, 0.3)',
                  borderRadius: 4,
                  color: 'var(--danger, #c0392b)',
                  fontSize: 12,
                }}
              >
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{error}</span>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter style={{ display: 'flex', gap: 8 }}>
          <Button variant="outline" onClick={onClose} disabled={isInstalling}>
            <X size={14} />
            {t('common.close', { defaultValue: '关闭' })}
          </Button>
          {!isInstalled && (
            <Button onClick={onInstall} disabled={isInstalling}>
              {isInstalling ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {t('plugin.market.install', { defaultValue: '安装' })}
            </Button>
          )}
          {isUpdateAvailable && (
            <Button onClick={onInstall} disabled={isInstalling}>
              {isInstalling ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {t('plugin.market.updateTo', {
                defaultValue: '更新到 v{{version}}',
                version: entry.version,
              })}
            </Button>
          )}
          {isInstalled && !isUpdateAvailable && (
            <Button variant="outline" disabled>
              <CheckCircle2 size={14} />
              {t('plugin.market.upToDate', { defaultValue: '已是最新' })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
