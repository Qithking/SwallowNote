/**
 * PluginManagerView - Full-panel plugin management page
 *
 * Upper section: Upload plugin package (.zip)
 * Lower section: Plugin card list
 * Header: Refresh + Diagnostics buttons
 */
import { useState, useCallback } from 'react'
import { Upload, Trash2, Package, Calendar, User, Tag, Settings as SettingsIcon, Activity } from 'lucide-react'
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
import type { PluginDefinition, PluginPanelProps } from '@/types/plugin'

function PluginManagerView() {
  const { t } = useTranslation()
  const plugins = usePluginStore((s) => s.plugins)
  const setPlugins = usePluginStore((s) => s.setPlugins)
  const setLoaded = usePluginStore((s) => s.setLoaded)
  const [isUploading, setIsUploading] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
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

      // Reload all plugins
      await handleReload()
    } catch (err) {
      toast.error(t('plugin.installFailed'), { description: String(err) })
    } finally {
      setIsUploading(false)
    }
  }, [t, handleReload])

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

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">
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
          <div className="space-y-3">
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
    </div>
  )
}

export { PluginManagerView }
