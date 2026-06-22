/** PluginMarketView - 应用内插件市场浏览（Plugin Atlas）。类名 .pa-market-* 限定在 .pa-root 内。 */
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import {
  Store,
  RefreshCw,
  X,
  Download,
  AlertCircle,
  Package,
  Search,
  User,
  Calendar,
  Info,
} from 'lucide-react'
import { usePluginMarketStore, usePluginStore } from '@/stores'
import { PluginMarketDetail } from './PluginMarketDetail'
import { PluginPermissionDialog } from './PluginPermissionDialog'
import { VirtualizedCardGrid } from './VirtualizedCardGrid'
import { initializePluginPermissions, getPluginPermissions } from '@/lib/plugin-permissions'
import type {
  PluginIndexEntry,
  PluginPermission,
  PluginPermissionStatus,
} from '@/types/plugin'
import type { PluginMetadataRust } from '@/lib/tauri'

// 提取为常量避免每次渲染分配新对象
const ICON_STYLE = { marginRight: 3, verticalAlign: -1 } as const

function PluginMarketView() {
  const { t } = useTranslation()
  // 合并 selector 减少求值次数
  const repoUrl = usePluginMarketStore((s) => s.repoUrl)
  const index = usePluginMarketStore((s) => s.index)
  const isFetchingIndex = usePluginMarketStore((s) => s.isFetchingIndex)
  const fetchError = usePluginMarketStore((s) => s.fetchError)
  const fetchProgress = usePluginMarketStore((s) => s.fetchProgress)
  const searchQuery = usePluginMarketStore((s) => s.searchQuery)
  const tagFilter = usePluginMarketStore((s) => s.tagFilter)
  const updates = usePluginMarketStore((s) => s.updates)
  // Actions are stable refs from Zustand — safe to select individually.
  const setRepoUrl = usePluginMarketStore((s) => s.setRepoUrl)
  const refreshIndex = usePluginMarketStore((s) => s.refreshIndex)
  const refreshIndexWithProgress = usePluginMarketStore((s) => s.refreshIndexWithProgress)
  const setSearchQuery = usePluginMarketStore((s) => s.setSearchQuery)
  const toggleTag = usePluginMarketStore((s) => s.toggleTag)
  const refreshUpdates = usePluginMarketStore((s) => s.refreshUpdates)
  const pendingDetailId = usePluginMarketStore((s) => s.pendingDetailId)
  const setPendingDetailId = usePluginMarketStore((s) => s.setPendingDetailId)
  // 用 useMemo 派生 allTags/filteredEntries，避免 selector 返回新数组导致死循环
  const allTags = useMemo(() => {
    const idx = index
    if (!idx) return []
    const set = new Set<string>()
    for (const p of idx.plugins) {
      for (const tag of p.tags) set.add(tag)
    }
    return Array.from(set).sort()
  }, [index])
  const filteredEntries = useMemo(() => {
    if (!index) return []
    const q = searchQuery.trim().toLowerCase()
    return index.plugins.filter((p) => {
      if (tagFilter.length > 0 && !tagFilter.every((t) => p.tags.includes(t))) {
        return false
      }
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [index, searchQuery, tagFilter])
  const localVersionFor = usePluginMarketStore((s) => s.localVersionFor)
  
  // Pre-compute update info map to avoid O(N) find() for every card
  const updateInfoMap = useMemo(() => {
    const map = new Map<string, { localVersion: string; remoteVersion: string; sha256: string }>()
    for (const u of updates) {
      if (u.localVersion !== u.remoteVersion) {
        map.set(u.id, { localVersion: u.localVersion, remoteVersion: u.remoteVersion, sha256: u.sha256 })
      }
    }
    return map
  }, [updates])

  const [draftUrl, setDraftUrl] = useState(repoUrl)
  const [detailEntry, setDetailEntry] = useState<PluginIndexEntry | null>(null)
  // 稳定 callback 避免新闭包
  const openDetail = useCallback(
    (id: string) => {
      const entry = index?.plugins.find((p) => p.id === id) ?? null
      setDetailEntry(entry)
    },
    [index],
  )
  // Post-install 权限授予队列：安装后弹出权限对话框
  const [pendingPermissionGrant, setPendingPermissionGrant] = useState<{
    pluginId: string
    pluginName: string
    requested: PluginPermission[]
  } | null>(null)

  // Permission dialog async-host. Mirrors the same wrapper in
  // `PluginManagerView` so we can stay declarative about when the
  // dialog mounts.
  const [permissionStatus, setPermissionStatus] = useState<PluginPermissionStatus[]>([])
  useEffect(() => {
    if (!pendingPermissionGrant) {
      setPermissionStatus([])
      return
    }
    let cancelled = false
    void getPluginPermissions(pendingPermissionGrant.pluginId).then((s) => {
      if (cancelled) return
      setPermissionStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [pendingPermissionGrant])

  /** 安装/更新成功回调：关闭详情对话框，按需弹权限对话框 */
  const handleInstalled = (meta: PluginMetadataRust) => {
    setDetailEntry(null)
    // Defer the dialog open one tick so React can finish unmounting
    // the detail dialog (focus traps / portals) before the new
    // dialog mounts. Without the defer, the new dialog inherits the
    // previous one as its trigger element and Radix logs a warning.
    queueMicrotask(() => {
      void (async () => {
        const installed = usePluginStore
          .getState()
          .plugins.find((p) => p.id === meta.id)
        const requested =
          installed?.permissions ?? []
        if (requested.length === 0) return
        await initializePluginPermissions(meta.id, requested)
        setPendingPermissionGrant({
          pluginId: meta.id,
          pluginName: meta.name || meta.id,
          requested,
        })
      })()
    })
  }

  // 同步 draftUrl 与 store URL
  useEffect(() => {
    setDraftUrl(repoUrl)
  }, [repoUrl])

  // 消费 pendingDetailId 打开详情对话框
  const consumedDetailRef = useRef<string | null>(null)
  useEffect(() => {
    if (!pendingDetailId || pendingDetailId === consumedDetailRef.current) return
    if (!index) return
    consumedDetailRef.current = pendingDetailId
    const entry = index.plugins.find((p) => p.id === pendingDetailId)
    if (entry) {
      setDetailEntry(entry)
    }
    // Defer the clear to a microtask so the `setPendingDetailId(null)`
    // doesn't run synchronously while we're still inside the effect
    // that read `pendingDetailId`.
    queueMicrotask(() => setPendingDetailId(null))
  }, [pendingDetailId, index, setPendingDetailId])

  // On first mount and whenever the repo URL changes, kick off a
  // background fetch + update check. The index cache (60s TTL) means
  // the user sees stale data immediately while fresh data loads in
  // the background — no blocking spinner, no empty state flash.
  useEffect(() => {
    if (!repoUrl) return
    // Use background refresh to avoid clearing existing index while loading
    void refreshIndex({ background: true })
    void refreshUpdates({ background: true })
    // Zustand 函数引用稳定，不放入 deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoUrl])

  const applyRepoUrl = () => {
    if (draftUrl !== repoUrl) {
      setRepoUrl(draftUrl.trim())
    }
  }

  return (
    <div className="pa-flex-col pa-market" style={{ height: '100%', gap: 0 }}>
      {/* marketplace 独立视觉外壳 */}
      <section className="pa-market-hero">
        <div className="pa-market-hero-head">
          <h3 className="pa-market-hero-title">
            {t('plugin.pa.market.heroTitle')}
          </h3>
          <p className="pa-market-hero-hint">
            {t('plugin.pa.market.heroHint')}
          </p>
        </div>
        <div className="pa-market-hero-cta">
          <div className="pa-repo-input">
            <Store />
            <input
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyRepoUrl()
              }}
              placeholder={t('plugin.market.repoPlaceholder', { defaultValue: 'https://…/repo.json' })}
              aria-label="Repository URL"
            />
            <button
              type="button"
              className="is-outline"
              onClick={() => {
                void refreshIndexWithProgress()
                void refreshUpdates()
              }}
              disabled={!repoUrl || isFetchingIndex}
              title={t('plugin.market.refresh', { defaultValue: '刷新' })}
            >
              <RefreshCw size={12} className={isFetchingIndex ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={applyRepoUrl} disabled={!draftUrl.trim()}>
              {t('plugin.market.apply', { defaultValue: '应用' })}
            </button>
          </div>
          {/* Progress bar for index fetch */}
          {isFetchingIndex && (
            <div className="pa-market-progress">
              <div className="pa-market-progress-bar">
                <div
                  className="pa-market-progress-fill"
                  style={{ width: `${fetchProgress}%` }}
                />
              </div>
              <span className="pa-market-progress-text">{fetchProgress}%</span>
            </div>
          )}
        </div>
      </section>

      {/* ── Search + tag filter (toolbar) ─────────────── */}
      <div className="pa-market-toolbar">        
        {allTags.length > 0 && (
          <div className="pa-segmented" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tagFilter.length === 0}
              className={tagFilter.length === 0 ? 'is-active' : ''}
              onClick={() => usePluginMarketStore.getState().setTagFilter([])}
            >
              all
            </button>
            {allTags.slice(0, 5).map((tag) => {
              const active = tagFilter.length === 1 && tagFilter[0] === tag
              return (
                <button
                  key={tag}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={active ? 'is-active' : ''}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              )
            })}
          </div>
        )}        
        <div className="pa-search" style={{ maxWidth: 'none' }}>
          <Search />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('plugin.market.searchPlaceholder', { defaultValue: '搜索插件名 / 描述 / 标签' })}
            aria-label="Search marketplace"
          />
          {searchQuery && (
            <button
              type="button"
              className="pa-btn pa-btn-ghost pa-btn is-icon"
              style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
              onClick={() => setSearchQuery('')}
              aria-label="clear"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div className="pa-market-meta">
          {/* 用 Trans 让 count 渲染为 <b> 子组件 */}
          <Trans
            i18nKey="plugin.pa.viewMeta.marketplace"
            values={{ count: index ? index.plugins.length : 0 }}
            components={{ b: <b /> }}
          />
        </div>
      </div>

      {/* ── Error / status row ────────────────────────── */}
      {fetchError && (
        <div className="pa-error" style={{ marginTop: 6, marginBottom: 6 }}>
          <AlertCircle size={13} />
          {fetchError}
        </div>
      )}

      {/* ── Body ──────────────────────────────────────── */}
      {!repoUrl ? (
        <EmptyState
          icon={<Store size={28} />}
          title={t('plugin.market.emptyTitle', { defaultValue: '尚未配置仓库' })}
          hint={t('plugin.market.emptyHint', {
            defaultValue: '在顶部粘贴一个 repo.json 的 URL，SwallowNote 会拉取并展示所有可用插件。',
          })}
        />
      ) : isFetchingIndex && !index ? (
        <EmptyState
          icon={<RefreshCw size={28} className="animate-spin" />}
          title={t('plugin.market.loading', { defaultValue: '正在加载仓库…' })}
        />
      ) : filteredEntries.length === 0 ? (
        <EmptyState
          icon={<Package size={28} />}
          title={t('plugin.market.noResults', { defaultValue: '没有匹配的插件' })}
          hint={
            searchQuery
              ? t('plugin.market.noResultsHint', { defaultValue: '尝试调整搜索词或清空标签过滤。' })
              : undefined
          }
        />
      ) : (
        <VirtualizedCardGrid
          items={filteredEntries}
          estimatedRowHeight={220}
          className="pa-market-grid"
          renderItem={(entry) => (
            <PluginMarketCard
              key={entry.id}
              entry={entry}
              localVersion={localVersionFor(entry.id)}
              updateInfo={updateInfoMap.get(entry.id)}
              onClick={() => openDetail(entry.id)}
            />
          )}
        />
      )}

      {/* ── Detail dialog ─────────────────────────────── */}
      {detailEntry && index ? (
        <PluginMarketDetail
          entry={detailEntry}
          index={index}
          localVersion={localVersionFor(detailEntry.id) ?? null}
          onClose={() => setDetailEntry(null)}
          onInstalled={handleInstalled}
        />
      ) : null}

      {/* ── Post-install permission dialog ────────────── */}
      {pendingPermissionGrant && (
        <PluginPermissionDialog
          pluginId={pendingPermissionGrant.pluginId}
          pluginName={pendingPermissionGrant.pluginName}
          permissions={pendingPermissionGrant.requested}
          currentStatus={permissionStatus}
          onClose={() => setPendingPermissionGrant(null)}
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
    <div className="pa-empty">
      {icon}
      <div className="pa-empty-title">{title}</div>
      {hint && <div className="pa-empty-hint">{hint}</div>}
    </div>
  )
}

/** PluginMarketCard - 市场网格中的插件卡片。复用 .pa-market-card chrome。 */
const PluginMarketCard = memo(function PluginMarketCard({
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

  // 最新版本为 versions[0]
  const publishedAt =
    entry.versions?.[0]?.publishedAt ?? entry.publishedAt ?? ''
  // memoize 日期字符串
  const dateText = useMemo(
    () => (publishedAt ? formatDate(publishedAt) : ''),
    [publishedAt],
  )
  const version = entry.version || '—'

  // 显示最多 3 个 tag + deps 计数器 + 更新徽章
  const tags = useMemo(() => {
    const result: { key: string; cls: string; label: string }[] = []
    if (entry.tags) {
      for (const tag of entry.tags.slice(0, 3)) {
        result.push({ key: `tag-${tag}`, cls: 'pa-market-badge', label: tag })
      }
    }
    if (entry.dependencies && entry.dependencies.length > 0) {
      result.push({
        key: 'deps',
        cls: 'pa-market-badge',
        label: `${entry.dependencies.length} deps`,
      })
    }
    if (isUpdateAvailable) {
      result.push({
        key: 'update',
        cls: 'pa-market-badge is-update',
        label: t('plugin.market.badgeUpdate', { defaultValue: 'Update' }),
      })
    }
    return result
  }, [entry.tags, entry.dependencies, isUpdateAvailable, t])

  // Status badge in the card head. Mirrors the `is-installed`
  // colour family of the Installed card, plus an accent colour
  // for "Update available" and a paper-3 muted colour for the
  // fresh-install case.
  const statusBadge = isUpdateAvailable
    ? { cls: 'pa-market-badge is-update', label: t('plugin.market.badgeUpdate', { defaultValue: 'Update' }) }
    : isInstalled
    ? { cls: 'pa-market-badge is-installed', label: t('plugin.market.badgeInstalled', { defaultValue: 'Installed' }) }
    : { cls: 'pa-market-badge is-install', label: t('plugin.market.badgeInstall', { defaultValue: 'Install' }) }

  // 已安装且最新时不显示下载图标，仅显示详情图标
  const showDownloadIcon = !isInstalled || isUpdateAvailable

  return (
    <article
      className="pa-market-card"
      data-plugin-id={entry.id}
      onClick={onClick}
    >
      <div className="pa-market-card-body">
        <div className="pa-market-card-head">
          <div style={{ minWidth: 0 }}>
            <div className="pa-market-card-name">
              {entry.name || t('plugin.market.unknownName', { defaultValue: '未命名插件' })}
            </div>
            <div className="pa-market-card-id">{entry.id}</div>
          </div>
          <span className={statusBadge.cls}>{statusBadge.label}</span>
        </div>

        <div className="pa-installed-byline">
          {entry.author && (
            <span className="inline-flex items-center">
              <User size={9} style={ICON_STYLE} />
              <b>{entry.author}</b>
            </span>
          )}
          {entry.author && dateText && <span className="pa-sep">·</span>}
          {dateText && (
            <span className="inline-flex items-center">
              <Calendar size={9} style={ICON_STYLE} />
              {dateText}
            </span>
          )}
          <span className="pa-sep">·</span>
          <span>v{version}</span>
          {localVersion && localVersion !== version && (
            <>
              <span className="pa-sep">·</span>
              <span>
                {t('plugin.market.local', { defaultValue: '本地' })} v{localVersion}
              </span>
            </>
          )}
        </div>

        {entry.description && (
          <div className="pa-market-card-desc">{entry.description}</div>
        )}

        <div className="pa-market-card-meta">
          {tags.map((tag) => (
            <span key={tag.key} className={tag.cls}>{tag.label}</span>
          ))}
        </div>

        {/* actions 行：stopPropagation 防止冒泡，仅保留图标按钮 */}
        <div className="pa-installed-actions" onClick={(e) => e.stopPropagation()}>
          <div className="pa-icon-row">
            <button
              type="button"
              className="pa-icon-btn"
              title={t('plugin.market.viewDetails', { defaultValue: '查看详情' })}
              onClick={onClick}
            >
              <Info />
            </button>
            {showDownloadIcon && (
              <button
                type="button"
                className="pa-icon-btn"
                title={
                  isUpdateAvailable
                    ? t('plugin.market.updateTo', { defaultValue: '更新到 v{{version}}', version })
                    : t('plugin.market.installNow', { defaultValue: '立即安装' })
                }
                onClick={onClick}
              >
                <Download />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  )
})

/** ISO 转 YYYY-MM-DD */
function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    if (Number.isNaN(d.getTime())) return dateStr
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  } catch {
    return dateStr
  }
}

export { PluginMarketView }
