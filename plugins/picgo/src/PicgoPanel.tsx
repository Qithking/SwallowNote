/** picgo 主面板：provider 切换 + 上传/历史/设置三标签 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PluginPanelProps } from '@swallow-note/plugin-sdk'
import { resolveSettings } from './lib/settings'
import type { AllSettings, ProviderId } from './types'
import { UploadTab } from './tabs/UploadTab'
import { HistoryTab } from './tabs/HistoryTab'
import { SettingsTab } from './tabs/SettingsTab'

type TabKey = 'upload' | 'history' | 'settings'

interface TabDef {
  key: TabKey
  label: string
}

const TABS: TabDef[] = [
  { key: 'upload', label: '上传' },
  { key: 'history', label: '图床历史' },
  { key: 'settings', label: '设置' },
]

export function PicgoPanel(props: PluginPanelProps): ReactNode {
  const { getAllSettings, setSetting, isActive } = props
  const [tab, setTab] = useState<TabKey>('upload')
  const [provider, setProvider] = useState<ProviderId>('smms')
  const [refreshTick, setRefreshTick] = useState(0)
  const [settings, setSettings] = useState<AllSettings | null>(null)

  // Hydrate provider from settings on mount + when settings change.
  useEffect(() => {
    let cancelled = false
    void getAllSettings().then((raw) => {
      if (cancelled) return
      const s = resolveSettings(raw)
      setSettings(s)
      setProvider(s.defaultProvider)
    })
    return () => {
      cancelled = true
    }
  }, [getAllSettings])

  const handleProviderChange = useCallback(
    async (id: ProviderId) => {
      setProvider(id)
      try {
        await setSetting('defaultProvider', id)
        setRefreshTick((n) => n + 1)
      } catch (err) {
        console.warn('[picgo] failed to persist defaultProvider:', err)
      }
    },
    [setSetting]
  )

  const bumpRefresh = useCallback(() => {
    setRefreshTick((n) => n + 1)
  }, [])

  if (!isActive) {
    return null
  }

  return (
    <div className="flex flex-col h-full text-[var(--text-primary)]">
      {/* Tab bar */}
      <div className="flex border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex-1 px-3 py-2 text-sm transition-colors ${
              tab === t.key
                ? 'border-b-2 border-[var(--theme-color)] text-[var(--theme-color)] font-medium'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'upload' && (
          <UploadTab
            getAllSettings={getAllSettings}
            store={props.store}
            activeNoteContent={props.activeNoteContent}
            activeProvider={provider}
            onProviderChange={handleProviderChange}
            refreshTick={refreshTick}
          />
        )}
        {tab === 'history' && (
          <HistoryTab
            getAllSettings={getAllSettings}
            store={props.store}
            activeNoteContent={props.activeNoteContent}
            refreshTick={refreshTick}
            onAfterChange={bumpRefresh}
          />
        )}
        {tab === 'settings' && (
          <SettingsTab getAllSettings={getAllSettings} refreshTick={refreshTick} />
        )}
      </div>

      {/* settings 引用占位 */}
      {settings ? null : null}

      {/* toast 由宿主全局 Toaster 渲染 */}
    </div>
  )
}
