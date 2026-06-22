/** PluginMarketView - 应用内插件市场浏览（Plugin Atlas）。类名 .pa-market-* 限定在 .pa-root 内。 */
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { useTranslation } from 'react-i18next'
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
  Settings2,
  Plus,
  Trash2,
  ChevronDown,
} from 'lucide-react'
import { usePluginMarketStore, usePluginStore } from '@/stores'
import { OFFICIAL_REPO_URL } from '@/stores/plugin-market'
import type { RepoSource } from '@/stores'
import { PluginMarketDetail } from './PluginMarketDetail'
import { PluginPermissionDialog } from './PluginPermissionDialog'
import { VirtualizedCardGrid } from './VirtualizedCardGrid'
import { initializePluginPermissions, getPluginPermissions } from '@/lib/plugin-permissions'
import { setActiveMarketSource } from '@/lib/tauri'
import type {
  PluginIndexEntry,
  PluginPermission,
  PluginPermissionStatus,
} from '@/types/plugin'
import type { PluginMetadataRust } from '@/lib/tauri'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

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
  // Actions are stable refs from Zustand — safe to select individually.
  const setRepoUrl = usePluginMarketStore((s) => s.setRepoUrl)
  const refreshIndex = usePluginMarketStore((s) => s.refreshIndex)
  const refreshIndexWithProgress = usePluginMarketStore((s) => s.refreshIndexWithProgress)
  const setSearchQuery = usePluginMarketStore((s) => s.setSearchQuery)
  const refreshUpdates = usePluginMarketStore((s) => s.refreshUpdates)
  const pendingDetailId = usePluginMarketStore((s) => s.pendingDetailId)
  const setPendingDetailId = usePluginMarketStore((s) => s.setPendingDetailId)
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


  const repoSources = usePluginMarketStore((s) => s.repoSources)
  const loadRepoSources = usePluginMarketStore((s) => s.loadRepoSources)
  const addRepoSource = usePluginMarketStore((s) => s.addRepoSource)
  const removeRepoSource = usePluginMarketStore((s) => s.removeRepoSource)

  const [showSourceManager, setShowSourceManager] = useState(false)

  // 启动时从 SQLite 加载来源列表
  useEffect(() => {
    void loadRepoSources()
  }, [loadRepoSources])

  // 切换来源：更新 store + 持久化到 SQLite
  const handleSourceChange = useCallback(
    (url: string) => {
      setRepoUrl(url)
      void setActiveMarketSource(url)
    },
    [setRepoUrl],
  )
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

  return (
    <div className="pa-flex-col pa-market" style={{ height: '100%', gap: 0 }}>
      {/* marketplace 独立视觉外壳 */}
     

      {/* ── Search toolbar: 左侧来源下拉 + 搜索框，右侧来源管理 ── */}
      <div className="pa-market-toolbar">
        <div className="pa-market-toolbar-left">
          {/* 来源下拉框：官网始终在首位，其余为用户添加的来源 */}
          <div className="pa-source-select">
            <select
              value={repoUrl}
              onChange={(e) => handleSourceChange(e.target.value)}
              aria-label={t('plugin.market.sourceSelect', { defaultValue: '选择来源' })}
            >
              <option value={OFFICIAL_REPO_URL}>官网</option>
              {repoSources.map((source) => (
                <option key={source.url} value={source.url}>
                  {source.name}
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="pa-source-select-arrow" />
          </div>
          {/* 搜索框 */}
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
          {/* 刷新按钮 */}
          <button
            type="button"
            className="pa-icon-btn"
            onClick={() => {
              void refreshIndexWithProgress()
              void refreshUpdates()
            }}
            disabled={!repoUrl || isFetchingIndex}
            title={t('plugin.market.refresh', { defaultValue: '刷新' })}
          >
            <RefreshCw size={14} className={isFetchingIndex ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="pa-market-toolbar-right">
          <button
            type="button"
            className="pa-icon-btn"
            title={t('plugin.market.manageSources', { defaultValue: '来源管理' })}
            onClick={() => setShowSourceManager(true)}
          >
            <Settings2 size={14} />
          </button>
        </div>
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

      {/* ── Source manager dialog ─────────────────────── */}
      {showSourceManager && (
        <SourceManagerDialog
          sources={repoSources}
          currentUrl={repoUrl}
          onSelect={(url) => {
            handleSourceChange(url)
            setShowSourceManager(false)
          }}
          onAdd={(source) => addRepoSource(source)}
          onRemove={(url) => removeRepoSource(url)}
          onClose={() => setShowSourceManager(false)}
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
  onClick,
}: {
  entry: PluginIndexEntry
  localVersion: string | undefined
  onClick: () => void
}) {
  const { t } = useTranslation()
  const isInstalled = !!localVersion
  const isUpdateAvailable = isInstalled && localVersion !== entry.version

  // 最新版本为 versions[0]
  const publishedAt =
    entry.versions?.[0]?.publishedAt ?? entry.publishedAt ?? ''
  // memoize 日期字符串
  const dateText = useMemo(
    () => (publishedAt ? formatDate(publishedAt) : ''),
    [publishedAt],
  )
  const version = entry.version || '—'

  // 显示最多 3 个 tag + deps 计数器
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
    return result
  }, [entry.tags, entry.dependencies])

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
              {entry.author}
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
          {isUpdateAvailable && localVersion && (
            <span className="pa-market-card-local-ver">
              已安装：v{localVersion}
            </span>
          )}
          <div className="pa-icon-row" style={{ marginLeft: 'auto' }}>
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

/** 来源管理弹窗 */
function SourceManagerDialog({
  sources,
  currentUrl,
  onSelect,
  onAdd,
  onRemove,
  onClose,
}: {
  sources: RepoSource[]
  currentUrl: string
  onSelect: (url: string) => void
  onAdd: (source: RepoSource) => void
  onRemove: (url: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')

  const handleAdd = () => {
    const name = newName.trim()
    const url = newUrl.trim()
    if (!name || !url) return
    onAdd({ name, url })
    setNewName('')
    setNewUrl('')
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="pa-popup" style={{ maxWidth: 520, maxHeight: '70vh', display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div className="pmd-header">
          <span className="pmd-header-icon">
            <Store size={18} />
          </span>
          <span className="pmd-header-info">
            <span className="pmd-header-title">
              {t('plugin.market.sourceManager', { defaultValue: '来源管理' })}
            </span>
          </span>
        </div>

        <div className="pmd-body">
          {sources.length === 0 ? (
            <div className="pmd-empty">
              <span className="pmd-empty-icon"><Package size={28} /></span>
              <div className="pmd-empty-title">
                {t('plugin.market.sourceEmpty', { defaultValue: '暂无自定义来源' })}
              </div>
              <div className="pmd-empty-hint">
                {t('plugin.market.sourceEmptyHint', { defaultValue: '点击下方添加新的插件来源。' })}
              </div>
            </div>
          ) : (
            <ul className="pa-source-list">
              {sources.map((source) => (
                <li
                  key={source.url}
                  className={`pa-source-item ${source.url === currentUrl ? 'is-active' : ''}`}
                >
                  <div className="pa-source-item-info">
                    <span className="pa-source-item-name">{source.name}</span>
                    <span className="pa-source-item-url">{source.url}</span>
                  </div>
                  {source.url !== currentUrl && (
                    <button
                      type="button"
                      className="pa-btn pa-btn-sm"
                      onClick={() => onSelect(source.url)}
                    >
                      {t('plugin.market.sourceSwitch', { defaultValue: '切换' })}
                    </button>
                  )}
                  {source.url === currentUrl && (
                    <span className="pa-market-badge is-installed is-xs">
                      {t('plugin.market.sourceCurrent', { defaultValue: '当前' })}
                    </span>
                  )}
                  <button
                    type="button"
                    className="pa-icon-btn is-danger"
                    style={{ width: 24, height: 24 }}
                    title={t('plugin.market.sourceRemove', { defaultValue: '删除来源' })}
                    onClick={() => onRemove(source.url)}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* 添加新来源 */}
          <div className="pa-source-add">
            <div className="pa-source-add-title">
              {t('plugin.market.sourceAdd', { defaultValue: '添加来源' })}
            </div>
            <div className="pa-source-add-row">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('plugin.market.sourceNamePlaceholder', { defaultValue: '名称' })}
                className="pa-source-add-input"
              />
              <input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder={t('plugin.market.sourceUrlPlaceholder', { defaultValue: 'https://…/repo.json' })}
                className="pa-source-add-input"
                style={{ flex: 2 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd()
                }}
              />
              <button
                type="button"
                className="pa-icon-btn"
                disabled={!newName.trim() || !newUrl.trim()}
                onClick={handleAdd}
                title={t('plugin.market.sourceAddBtn', { defaultValue: '添加' })}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="pmd-footer">
          <Button variant="outline" onClick={onClose}>
            <X size={14} />
            {t('common.close', { defaultValue: '关闭' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { PluginMarketView }
