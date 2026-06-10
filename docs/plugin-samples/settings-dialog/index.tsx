/**
 * Settings Dialog — demonstrates manifest.settings
 *
 * Concepts shown:
 *  - manifest.settings: a separate React component
 *  - Settings dialog receives the same PluginPanelProps as the main panel
 *  - panel.close() dismisses the dialog
 *  - Settings also go through onMount / onUnmount lifecycle
 */
import type { PluginManifest, PluginPanelProps } from '@/types/plugin'
import { usePluginStorage } from '@/lib/plugin-hooks'

// ─── Icon ─────────────────────────────────────────────────────────────────────

function SettingsIconTrigger({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

// ─── Settings component ───────────────────────────────────────────────────────

interface PluginConfig {
  apiKey: string
  autoSync: boolean
  syncInterval: number
}

const defaultConfig: PluginConfig = {
  apiKey: '',
  autoSync: false,
  syncInterval: 60,
}

function SettingsDialog(panel: PluginPanelProps) {
  // Settings dialog gets the same props as the main panel.
  // We use the host's storage; the dialog is mounted on demand,
  // so changes are persisted immediately.
  const [config, setConfig] = usePluginStorage<PluginConfig>(panel, 'config', defaultConfig)

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <label style={labelStyle}>
          API Key
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
            style={inputStyle}
            placeholder="paste your API key"
          />
        </label>
      </section>

      <section>
        <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={config.autoSync}
            onChange={(e) => setConfig({ ...config, autoSync: e.target.checked })}
          />
          <span style={{ marginLeft: 8 }}>Auto-sync on save</span>
        </label>
      </section>

      <section>
        <label style={labelStyle}>
          Sync interval (seconds)
          <input
            type="number"
            min={10}
            max={3600}
            value={config.syncInterval}
            onChange={(e) => setConfig({ ...config, syncInterval: Number(e.target.value) || 60 })}
            style={inputStyle}
            disabled={!config.autoSync}
          />
        </label>
      </section>

      <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid var(--border-color)' }}>
        <button onClick={panel.close} style={buttonStyle}>
          Close
        </button>
      </footer>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
}

const inputStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid var(--border-color)',
  borderRadius: 4,
  background: 'var(--bg-secondary)',
  fontSize: 12,
}

const buttonStyle: React.CSSProperties = {
  padding: '4px 16px',
  borderRadius: 4,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-secondary)',
  cursor: 'pointer',
  fontSize: 12,
}

// ─── Main panel ───────────────────────────────────────────────────────────────

function MainPanel(panel: PluginPanelProps) {
  // The main panel can read what the user set in the settings.
  const [config] = usePluginStorage<PluginConfig>(panel, 'config', defaultConfig)

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600 }}>Configurable Plugin</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        Open the settings dialog (gear icon on the plugin card) to configure this plugin.
      </p>

      <div style={{ fontSize: 12, padding: 8, background: 'var(--bg-secondary)', borderRadius: 4 }}>
        <div>API key: {config.apiKey ? '***' + config.apiKey.slice(-4) : '(not set)'}</div>
        <div>Auto-sync: {config.autoSync ? `yes (every ${config.syncInterval}s)` : 'no'}</div>
      </div>
    </div>
  )
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

const manifest: PluginManifest = {
  id: 'com.example.settings-dialog',
  name: 'Settings Dialog',
  description: 'Plugin with a configurable settings dialog opened from the plugin manager.',
  version: '0.1.0',
  author: 'SwallowNote',
  publishedAt: '2026-06-10',
  iconPosition: 'sidebar',
  contentPosition: 'leftPanel',
  order: 70,
  enabled: true,
  icon: SettingsIconTrigger,
  panel: MainPanel,
  // Settings component. When present, the plugin manager card
  // shows a gear button. Clicking it opens a modal hosting this
  // component with the same props as the main panel.
  settings: SettingsDialog,
  pluginPath: '',
  hasBackend: false,
}

export default manifest
