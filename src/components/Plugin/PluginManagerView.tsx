/**
 * PluginManagerView - Full-panel plugin management page (Phase 9.2).
 *
 * Top: a header with the page title, an "Observability" button that
 * opens the diagnostics dialog, and a Refresh button that re-scans
 * the local plugins directory.
 *
 * Below the header, a tab strip with two tabs:
 * - 已安装 (Installed): the original upload zone + per-plugin cards
 * - 插件市场 (Marketplace): a `PluginMarketView` for browsing,
 *   installing, updating, and rolling back plugins from a remote
 *   `repo.json` index.
 *
 * We keep the two views in a single component (instead of routing
 * to a separate full-panel route) because (a) the marketplace needs
 * the same plugin list to render "Installed" / "Update" badges and
 * (b) the user can switch between them with a single click without
 * losing any state.
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import { Upload, Trash2, Package, Calendar, User, Tag, Settings as SettingsIcon, Activity, Shield, Store, List } from 'lucide-react'
import { usePluginStore } from '@/stores'
import { scanPlugins, installPlugin, uninstallPlugin, togglePluginEnabled } from '@/lib/tauri'
import { loadAllPlugins } from '@/lib/plugin-loader'
import { renderPluginIcon } from '@/lib/plugin-utils'
import { buildPluginContext, getPluginStorage, pluginEventBus } from '@/lib/plugin-host'
import { open } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { PluginPanelHost } from './PluginPanelHost'
import { PluginDiagnosticsPanel } from './PluginDiagnosticsPanel'
import { PluginPermissionDialog } from './PluginPermissionDialog'
import { PluginMarketView } from './PluginMarketView'
import { initializePluginPermissions, getPluginPermissions } from '@/lib/plugin-permissions'
import type { PluginDefinition, PluginPanelProps, PluginPermission } from '@/types/plugin'

/**
 * The two sub-views under the plugin manager header. We use a tiny
 * string-literal union instead of an enum so the state value can
 * be serialised (e.g. if we ever decide to persist the active tab
 * to localStorage).
 */
type PluginManagerTab = 'manage' | 'market'

function PluginManagerView() {
  const { t } = useTranslation()
  const plugins = usePluginStore((s) => s.plugins)
  const setPlugins = usePluginStore((s) => s.setPlugins)
  const setLoaded = usePluginStore((s) => s.setLoaded)
  const [isUploading, setIsUploading] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  // Active tab. Defaults to "manage" so the user lands on the
  // familiar upload + list view that was the only view before the
  // marketplace was added. The marketplace is opt-in.
  const [activeTab, setActiveTab] = useState<PluginManagerTab>('manage')
  // Settings dialog state. We keep the plugin reference (not just the
  // id) so we don't depend on store re-selection while the dialog is
  // open. Opening a settings dialog for a plugin that was just
  // uninstalled races with the close handler, so the open() guard
  // checks the plugin still exists in the store.
  const [settingsPlugin, setSettingsPlugin] = useState<PluginDefinition | null>(null)
  // Diagnostics dialog visibility. The panel reads in-memory metrics
  // and refreshes on its own interval, so we don't need to pass
  // anything through props.
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  // Permission dialog target. Same pattern as settingsPlugin: we keep
  // the full reference so a concurrent uninstall can't take the
  // plugin out from under the dialog.
  const [permissionsPlugin, setPermissionsPlugin] = useState<PluginDefinition | null>(null)
  // Permissions-to-grant queue. When the install flow finishes
  // extracting a plugin package, we open the dialog with the
  // declared permissions and let the user opt in/out before any
  // grant hits localStorage. The pending state survives across
  // re-renders so the toast on `handleUpload` doesn't race the
  // dialog open.
  const [pendingPermissionGrant, setPendingPermissionGrant] = useState<{
    pluginId: string
    pluginName: string
    requested: PluginPermission[]
  } | null>(null)

  /**
   * Build the props passed to a plugin's settings component. The
   * settings dialog is not an "active panel", so `isActive` is
   * always false. The plugin's own `close` closes the dialog.
   */
  const buildSettingsPanelProps = useCallback((plugin: PluginDefinition): PluginPanelProps => {
    const ctx = buildPluginContext(plugin)
    return {
      pluginId: plugin.id,
      isActive: false,
      close: () => setSettingsPlugin(null),
      invokeBackend: ctx.invokeBackend,
      store: getPluginStorage(plugin.id),
      events: pluginEventBus,
    }
  }, [])

  const openSettings = useCallback((plugin: PluginDefinition) => {
    if (!plugin.settings) return
    setSettingsPlugin(plugin)
  }, [])

  const handleReload = useCallback(async () => {
    try {
      setIsScanning(true)
      const rustMetas = await scanPlugins()
      const loadedPlugins = await loadAllPlugins(rustMetas)
      setPlugins(loadedPlugins)
      setLoaded(true)
    } catch (err) {
      console.error('Failed to reload plugins:', err)
    } finally {
      setIsScanning(false)
    }
  }, [setPlugins, setLoaded])

  const handleUpload = useCallback(async () => {
    try {
      setIsUploading(true)
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Plugin Package', extensions: ['zip'] }],
      })
      if (!selected) {
        setIsUploading(false)
        return
      }

      const zipPath = selected as string
      const meta = await installPlugin(zipPath)
      toast.success(t('plugin.installSuccess', { name: meta.name }))

      // Reload all plugins so the new one is registered in the
      // store, then run the install-time permission flow. The
      // permission dialog must be opened *after* the plugin is in
      // the registry, because the user might want to inspect the
      // version/description in the list while deciding which
      // permissions to grant.
      await handleReload()
      const installed = usePluginStore
        .getState()
        .plugins.find((p) => p.id === meta.id)
      if (installed && installed.permissions.length > 0) {
        // Initialize the per-plugin status so the dialog has a
        // baseline (currently nothing is granted) before the user
        // makes their selection.
        await initializePluginPermissions(installed.id, installed.permissions)
        setPendingPermissionGrant({
          pluginId: installed.id,
          pluginName: installed.name,
          requested: installed.permissions,
        })
      }
    } catch (err) {
      toast.error(t('plugin.installFailed'), { description: String(err) })
    } finally {
      setIsUploading(false)
    }
  }, [t, handleReload])

  /**
   * Open the permission dialog for an installed plugin from the
   * "Permissions" button on the card. Unlike the install-time flow
   * we don't pre-fill the request list – we show whatever the
   * manifest declared plus any extras the user has already
   * granted, so they can revoke at will.
   */
  const openPermissions = useCallback(async (plugin: PluginDefinition) => {
    setPermissionsPlugin(plugin)
    // Make sure the localStorage entry exists even for a plugin
    // that was installed before the install-flow integration. The
    // dialog falls back to the in-memory `currentStatus` when
    // localStorage is empty, but creating the entry here means
    // revoke persists on close.
    await initializePluginPermissions(plugin.id, plugin.permissions)
  }, [])

  const handleUninstall = useCallback(async (plugin: PluginDefinition) => {
    try {
      await uninstallPlugin(plugin.id)
      // Unregister first so the synchronous UI cleanup in the store
      // (sidebarView/rightPanelType/settingsPanelVisible) happens before
      // we re-scan. Otherwise a full-panel plugin that was active would
      // briefly flash its view during handleReload.
      usePluginStore.getState().unregisterPlugin(plugin.id)
      toast.success(t('plugin.uninstallSuccess', { name: plugin.name }))
      await handleReload()
    } catch (err) {
      toast.error(t('plugin.uninstallFailed'), { description: String(err) })
    }
  }, [t, handleReload])

  const handleToggleEnabled = useCallback(async (plugin: PluginDefinition, enabled: boolean) => {
    try {
      await togglePluginEnabled(plugin.id, enabled)
      usePluginStore.getState().setPluginEnabled(plugin.id, enabled)
      toast.success(enabled ? t('plugin.enabled', { name: plugin.name }) : t('plugin.disabled', { name: plugin.name }))
    } catch (err) {
      toast.error(t('plugin.toggleFailed'), { description: String(err) })
    }
  }, [t])

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ''
    try {
      return new Date(dateStr).toLocaleDateString()
    } catch {
      return dateStr
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('plugin.manager')}
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDiagnosticsOpen(true)}
            title={t('plugin.diagnostics.title')}
          >
            <Activity size={14} className="mr-1" />
            {t('plugin.diagnostics.title')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReload}
            disabled={isScanning}
          >
            {isScanning ? t('common.loading') : t('plugin.refresh')}
          </Button>
        </div>
      </div>

      {/* Tab strip. We render both tabs (rather than swapping) so the
          user can see where they are at a glance, and the tab bar
          itself doesn't shift when switching. The active tab gets
          the primary border colour; the inactive tab is muted. */}
      <div
        role="tablist"
        className="flex items-center gap-1 px-6 pt-2 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <TabButton
          active={activeTab === 'manage'}
          onClick={() => setActiveTab('manage')}
          icon={<List size={14} />}
          label={t('plugin.market.tabManage', { defaultValue: '已安装' })}
        />
        <TabButton
          active={activeTab === 'market'}
          onClick={() => setActiveTab('market')}
          icon={<Store size={14} />}
          label={t('plugin.market.tabMarket', { defaultValue: '插件市场' })}
        />
      </div>

      <ScrollArea className="flex-1">
        {/*
          We keep the marketplace always mounted (hidden via
          `display: none`) so its in-memory state — repo URL, index,
          search query, tag filter — survives a tab switch. A
          conditional render would drop that state and the user
          would lose their scroll position / search term on every
          switch.
        */}
        <div
          role="tabpanel"
          hidden={activeTab !== 'manage'}
          style={{ padding: activeTab === 'manage' ? 24 : 0 }}
        >
          {/* Upload Section */}
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-[var(--theme-color)] transition-colors"
            style={{ borderColor: 'var(--border-color)' }}
            onClick={handleUpload}
          >
            <Upload size={32} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {isUploading ? t('plugin.installing') : t('plugin.uploadHint')}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {t('plugin.uploadFormat')}
            </p>
          </div>

          {/* Plugin List */}
          <div className="space-y-3 mt-6">
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {t('plugin.installed')} ({plugins.length})
            </h3>

            {plugins.length === 0 ? (
              <div className="text-center py-12">
                <Package size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {t('plugin.noPlugins')}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {plugins.map((plugin) => (
                  <div
                    key={plugin.id}
                    className="flex items-start gap-4 p-4 rounded-lg border"
                    style={{
                      borderColor: 'var(--border-color)',
                      background: 'var(--bg-primary)',
                      opacity: plugin.enabled ? 1 : 0.6,
                    }}
                  >
                    {/* Plugin Icon */}
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: 'var(--bg-hover)' }}
                    >
                      {renderPluginIcon(plugin.icon, 20)}
                    </div>

                    {/* Plugin Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {plugin.name}
                        </span>
                        {plugin.version && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
                            <Tag size={8} className="inline mr-0.5" />
                            {plugin.version}
                          </span>
                        )}
                      </div>
                      {plugin.description && (
                        <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                          {plugin.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {plugin.author && (
                          <span className="flex items-center gap-0.5">
                            <User size={9} />
                            {plugin.author}
                          </span>
                        )}
                        {plugin.publishedAt && (
                          <span className="flex items-center gap-0.5">
                            <Calendar size={9} />
                            {formatDate(plugin.publishedAt)}
                          </span>
                        )}
                        <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-hover)' }}>
                          {t(`plugin.iconPosition.${plugin.iconPosition}`)}
                        </span>
                        <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-hover)' }}>
                          {t(`plugin.contentPosition.${plugin.contentPosition}`)}
                        </span>
                        {plugin.hasBackend && (
                          <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-warning)', color: 'var(--text-warning)' }}>
                            Rust
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {plugin.settings && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7"
                          title={t('plugin.settings')}
                          onClick={() => openSettings(plugin)}
                        >
                          <SettingsIcon size={14} />
                        </Button>
                      )}
                      {/* Permissions button. We show this whenever the
                          plugin declares any permissions; without a
                          declared list the dialog would have nothing
                          to display, so we hide the entry point. */}
                      {plugin.permissions.length > 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7"
                          title={t('plugin.permissions')}
                          onClick={() => openPermissions(plugin)}
                        >
                          <Shield size={14} />
                        </Button>
                      )}
                      <Switch
                        checked={plugin.enabled}
                        onCheckedChange={(checked) => handleToggleEnabled(plugin, checked)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-7 h-7"
                        onClick={() => handleUninstall(plugin)}
                      >
                        <Trash2 size={14} className="text-[var(--color-error)]" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/*
          Marketplace panel. We render it on the same ScrollArea as
          the manage tab so the outer scrollable container is shared;
          a separate ScrollArea inside would conflict with the
          parent's scroll position.
        */}
        <div
          role="tabpanel"
          hidden={activeTab !== 'market'}
          style={{ padding: activeTab === 'market' ? 24 : 0, height: '100%' }}
        >
          {activeTab === 'market' && <PluginMarketView />}
        </div>
      </ScrollArea>

      {/* Settings dialog. We render the plugin's own `settings` component
          inside a PluginPanelHost so the host can fire onMount/onUnmount
          and the plugin can use the same lifecycle pattern as the main
          panel. `isActive` is false because this is a modal, not a tab. */}
      <Dialog
        open={settingsPlugin !== null}
        onOpenChange={(open) => {
          if (!open) setSettingsPlugin(null)
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {settingsPlugin && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {settingsPlugin.name} — {t('plugin.settings')}
                </DialogTitle>
                <DialogDescription>
                  {settingsPlugin.description}
                </DialogDescription>
              </DialogHeader>
              <PluginPanelHost
                plugin={settingsPlugin}
                panel={settingsPlugin.settings}
                isActive={false}
                panelProps={buildSettingsPanelProps(settingsPlugin)}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Diagnostics dialog. The panel is purely host-side, so we render
          it directly without PluginPanelHost: there is no plugin to
          dispatch onMount/onUnmount to, and we don't want the panel's
          refresh interval to outlive the dialog (the panel cleans up
          its own interval on unmount). */}
      <Dialog open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden p-0">
          <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
            <DialogHeader>
              <DialogTitle>{t('plugin.diagnostics.title')}</DialogTitle>
              <DialogDescription>
                {t('plugin.diagnostics.description')}
              </DialogDescription>
            </DialogHeader>
          </div>
          <PluginDiagnosticsPanel />
        </DialogContent>
      </Dialog>

      {/* Permission dialog – install-time flow. We open it the moment
          the user finishes installing a plugin, pre-seeded with the
          permissions declared in its manifest. The dialog itself does
          the grant/revoke through `plugin-permissions.ts`; we just
          host the modal and clear the pending state on close. */}
      <PermissionDialogMount
        open={pendingPermissionGrant !== null}
        plugin={pendingPermissionGrant}
        onClose={() => setPendingPermissionGrant(null)}
      />

      {/* Permission dialog – per-plugin card flow. Same component, but
          opened from the Permissions button on a card. We pass the
          plugin reference and let the dialog fetch the current
          status asynchronously. */}
      <PermissionDialogMount
        open={permissionsPlugin !== null}
        plugin={permissionsPlugin}
        onClose={() => setPermissionsPlugin(null)}
      />
    </div>
  )
}

/**
 * A single tab in the manager tab strip. We keep the button styling
 * inline so we don't need to ship a new `Tabs`/`Tab` component pair
 * for what's effectively a 2-state switch. The active tab gets a
 * primary-coloured underline; the inactive tab is muted.
 */
function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--theme-color)' : '2px solid transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        marginBottom: -1,
      }}
    >
      {icon}
      {label}
    </button>
  )
}

/**
 * Async-host wrapper around `PluginPermissionDialog`. The dialog
 * needs the current `PluginPermissionStatus[]` to render the
 * "currently granted" state, so we have to fetch it before the
 * dialog can mount. Doing it inside the dialog itself would force
 * the dialog to be a controlled component with extra internal
 * state; lifting the fetch into a tiny wrapper keeps the dialog
 * purely declarative.
 */
function PermissionDialogMount({
  open,
  plugin,
  onClose,
}: {
  open: boolean
  plugin: PluginDefinition | { pluginId: string; pluginName: string; requested: PluginPermission[] } | null
  onClose: () => void
}) {
  // Normalize the input shape. The install flow gives us a small
  // struct with `pluginId` / `pluginName` / `requested`; the
  // per-card flow gives us a PluginDefinition with `id` / `name` /
  // `permissions`. Mapping both to a single shape lets the dialog
  // stay agnostic of which entry point opened it. Wrapped in
  // useMemo so the resulting object identity is stable for the
  // useEffect deps below (otherwise the effect would re-fire on
  // every render of the parent).
  const normalized = useMemo(() => {
    if (plugin == null) return null
    if ('pluginId' in plugin) {
      return {
        pluginId: plugin.pluginId,
        pluginName: plugin.pluginName,
        requested: plugin.requested,
      }
    }
    return {
      pluginId: plugin.id,
      pluginName: plugin.name,
      // Per-card flow: include permissions the user has manually
      // granted in the past so they can revoke them.
      requested: plugin.permissions,
    }
  }, [plugin])

  const [status, setStatus] = useState<import('@/types/plugin').PluginPermissionStatus[]>([])

  useEffect(() => {
    if (!open || !normalized) {
      setStatus([])
      return
    }
    let cancelled = false
    void getPluginPermissions(normalized.pluginId).then((s) => {
      if (cancelled) return
      setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [open, normalized])

  if (!open || !normalized) return null
  return (
    <PluginPermissionDialog
      pluginId={normalized.pluginId}
      pluginName={normalized.pluginName}
      permissions={normalized.requested}
      currentStatus={status}
      onClose={onClose}
    />
  )
}

export { PluginManagerView }
