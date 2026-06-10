/**
 * PluginMarketView — in-app plugin marketplace browser (Phase 9.2).
 *
 * Renders a search/filter bar on top, then a responsive card grid
 * of `PluginMarketCard`. The repo URL is set via a small input in
 * the header; a Refresh button re-fetches the index. Clicking a
 * card opens `PluginMarketDetail` in a dialog.
 *
 * State lives in `usePluginMarketStore` (Zustand) so the install
 * state survives navigation away from the marketplace tab.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, RefreshCw, X, Store, Download, CheckCircle2, AlertCircle, Package, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { usePluginMarketStore } from '@/stores'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PluginMarketDetail } from './PluginMarketDetail'
import type { PluginIndexEntry } from '@/types/plugin'

function PluginMarketView() {
  const { t } = useTranslation()
  const repoUrl = usePluginMarketStore((s) => s.repoUrl)
  const setRepoUrl = usePluginMarketStore((s) => s.setRepoUrl)
  const index = usePluginMarketStore((s) => s.index)
  const isFetchingIndex = usePluginMarketStore((s) => s.isFetchingIndex)
  const fetchError = usePluginMarketStore((s) => s.fetchError)
  const refreshIndex = usePluginMarketStore((s) => s.refreshIndex)
  const searchQuery = usePluginMarketStore((s) => s.searchQuery)
  const setSearchQuery = usePluginMarketStore((s) => s.setSearchQuery)
  const tagFilter = usePluginMarketStore((s) => s.tagFilter)
  const toggleTag = usePluginMarketStore((s) => s.toggleTag)
  const allTags = usePluginMarketStore((s) => s.allTags())
  const filteredEntries = usePluginMarketStore((s) => s.filteredEntries())
  const updates = usePluginMarketStore((s) => s.updates)
  const refreshUpdates = usePluginMarketStore((s) => s.refreshUpdates)
  const localVersionFor = usePluginMarketStore((s) => s.localVersionFor)

  const [draftUrl, setDraftUrl] = useState(repoUrl)
  const [detailEntry, setDetailEntry] = useState<PluginIndexEntry | null>(null)

  // On first mount and whenever the repo URL changes, kick off a
  // fetch + an update check. The update check depends on the host
  // being able to resolve app_data_dir, which is always available
  // when the marketplace tab is rendered inside the Tauri shell.
  useEffect(() => {
    if (repoUrl) {
      void refreshIndex()
      void refreshUpdates()
    }
    // We intentionally don't depend on the function identities —
    // Zustand returns stable function refs, but listing them would
    // re-run this on every store update. The deps we care about are
    // the URL itself and the *trigger* of mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoUrl])

  const applyRepoUrl = () => {
    if (draftUrl !== repoUrl) {
      setRepoUrl(draftUrl.trim())
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      {/* Repo URL bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Store size={16} style={{ color: 'var(--text-secondary)' }} />
        <Input
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyRepoUrl()
          }}
          placeholder={t('plugin.market.repoPlaceholder', { defaultValue: 'https://…/repo.json' })}
          style={{ flex: 1, fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
        />
        <Button onClick={applyRepoUrl} disabled={!draftUrl.trim()}>
          {t('plugin.market.apply', { defaultValue: '应用' })}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            void refreshIndex()
            void refreshUpdates()
          }}
          disabled={!repoUrl || isFetchingIndex}
        >
          <RefreshCw size={14} className={isFetchingIndex ? 'animate-spin' : ''} />
          {t('plugin.market.refresh', { defaultValue: '刷新' })}
        </Button>
      </div>

      {/* Search + tag filter */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-secondary)',
            }}
          />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('plugin.market.searchPlaceholder', { defaultValue: '搜索插件名 / 描述 / 标签' })}
            style={{ paddingLeft: 28 }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              aria-label="clear"
              style={{
                position: 'absolute',
                right: 6,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
        {allTags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {allTags.map((tag) => {
              const active = tagFilter.includes(tag)
              return (
                <Badge
                  key={tag}
                  variant={active ? 'default' : 'outline'}
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleTag(tag)}
                >
                  <Tag size={10} />
                  {tag}
                </Badge>
              )
            })}
          </div>
        )}
      </div>

      {/* Error / status row */}
      {fetchError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--danger, #c0392b)',
            fontSize: 12,
          }}
        >
          <AlertCircle size={14} />
          {fetchError}
        </div>
      )}

      {/* Body */}
      <ScrollArea style={{ flex: 1 }}>
        {!repoUrl ? (
          <EmptyState
            icon={<Store size={32} />}
            title={t('plugin.market.emptyTitle', { defaultValue: '尚未配置仓库' })}
            hint={t('plugin.market.emptyHint', {
              defaultValue: '在顶部粘贴一个 repo.json 的 URL，SwallowNote 会拉取并展示所有可用插件。',
            })}
          />
        ) : isFetchingIndex && !index ? (
          <EmptyState
            icon={<RefreshCw size={32} className="animate-spin" />}
            title={t('plugin.market.loading', { defaultValue: '正在加载仓库…' })}
          />
        ) : filteredEntries.length === 0 ? (
          <EmptyState
            icon={<Package size={32} />}
            title={t('plugin.market.noResults', { defaultValue: '没有匹配的插件' })}
            hint={
              searchQuery
                ? t('plugin.market.noResultsHint', { defaultValue: '尝试调整搜索词或清空标签过滤。' })
                : undefined
            }
          />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 12,
              padding: '4px 0',
            }}
          >
            {filteredEntries.map((entry) => (
              <PluginMarketCard
                key={entry.id}
                entry={entry}
                localVersion={localVersionFor(entry.id)}
                updateInfo={updates.find((u) => u.id === entry.id)}
                onClick={() => setDetailEntry(entry)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Detail dialog */}
      {detailEntry && index && (
        <PluginMarketDetail
          entry={detailEntry}
          index={index}
          localVersion={localVersionFor(detailEntry.id) ?? null}
          onClose={() => setDetailEntry(null)}
        />
      )}
    </div>
  )
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode
  title: string
  hint?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 200,
        color: 'var(--text-secondary)',
        gap: 8,
        textAlign: 'center',
        padding: 24,
      }}
    >
      {icon}
      <div style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
      {hint && <div style={{ fontSize: 12, maxWidth: 360 }}>{hint}</div>}
    </div>
  )
}

function PluginMarketCard({
  entry,
  localVersion,
  updateInfo,
  onClick,
}: {
  entry: PluginIndexEntry
  localVersion: string | undefined
  updateInfo?: { localVersion: string; remoteVersion: string; sha256: string }
  onClick: () => void
}) {
  const { t } = useTranslation()
  const isInstalled = !!localVersion
  const isUpdateAvailable = !!updateInfo && updateInfo.localVersion !== updateInfo.remoteVersion
  const isFresh = !localVersion && !updateInfo

  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: 'var(--bg-elevated, #fafafa)',
        border: '1px solid var(--border, #e5e5e5)',
        borderRadius: 8,
        padding: 12,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        transition: 'border-color 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{entry.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono, monospace)' }}>
            {entry.id}
          </div>
        </div>
        <InstallStatus isInstalled={isInstalled} isUpdateAvailable={isUpdateAvailable} isFresh={isFresh} />
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {entry.description}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Badge variant="outline" style={{ fontSize: 10 }}>
          v{entry.version}
        </Badge>
        {localVersion && localVersion !== entry.version && (
          <Badge variant="outline" style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
            {t('plugin.market.local', { defaultValue: '本地' })} v{localVersion}
          </Badge>
        )}
        {entry.tags.slice(0, 3).map((tag) => (
          <Badge key={tag} variant="secondary" style={{ fontSize: 10 }}>
            {tag}
          </Badge>
        ))}
      </div>
    </button>
  )
}

function InstallStatus({
  isInstalled,
  isUpdateAvailable,
  isFresh,
}: {
  isInstalled: boolean
  isUpdateAvailable: boolean
  isFresh: boolean
}) {
  if (isUpdateAvailable) {
    return (
      <Badge style={{ background: 'var(--accent, #4f46e5)', color: 'white' }}>
        <Download size={10} />
        Update
      </Badge>
    )
  }
  if (isInstalled) {
    return (
      <Badge variant="secondary">
        <CheckCircle2 size={10} />
        Installed
      </Badge>
    )
  }
  if (isFresh) {
    return (
      <Badge variant="outline">
        <Download size={10} />
        Install
      </Badge>
    )
  }
  return null
}

// Suppress unused warning for the `toast` import — we keep it here
// for the future when the install flow wants to surface a non-error
// status (e.g. "already installed"). It also keeps the bundle
// consistent with the rest of the app.
void toast

export { PluginMarketView }
