/** 插件自动更新（Task 11/G11）。启动时扫描 opted-in 插件，下载安装新版本，toast 提供撤销。best-effort：失败不阻塞启动。 */
import { toast } from 'sonner'
import semver from 'semver'
import type { PluginDefinition, PluginIndex, PluginIndexEntry } from '@/types/plugin'
import { usePluginStore, PLUGIN_AUTO_UPDATE_KEY_PREFIX } from '@/stores/plugin'
import { usePluginMarketStore } from '@/stores/plugin-market'
import {
  downloadPluginZip,
  installPluginFromBytes,
  rollbackPlugin,
  listPluginVersions,
} from '@/lib/plugin-market'
import { loadAllPlugins } from '@/lib/plugin-loader'
import { scanPlugins } from '@/lib/tauri'
import i18next from 'i18next'

/** 兼容 i18next.TFunction 和普通函数的翻译类型。 */
export type AutoUpdateTranslator = (
  key: string,
  opts?: Record<string, unknown>,
) => string

/** 自动更新运行报告：considered/installed/failed。 */
export interface AutoUpdateReport {
  /** Plugins that were considered (opted in). */
  considered: number
  /** Plugins that received a new version this run. */
  installed: AutoUpdateInstall[]
  /** Plugins where the install attempt failed; the user is
   *  never blocked from launching, but a soft warning toast
   *  is shown so they know to re-check. */
  failed: AutoUpdateFailure[]
}

export interface AutoUpdateInstall {
  pluginId: string
  pluginName: string
  previousVersion: string
  newVersion: string
}

export interface AutoUpdateFailure {
  pluginId: string
  pluginName: string
  reason: string
}

/** 启动时自动更新 opted-in 插件。fire-and-forget。 */
export async function runAutoUpdateOnStartup(
  i18n?: AutoUpdateTranslator,
): Promise<AutoUpdateReport> {
  const t: AutoUpdateTranslator =
    i18n ?? ((key, opts) => i18next.t(key, opts))
  const report: AutoUpdateReport = {
    considered: 0,
    installed: [],
    failed: [],
  }

  // 1. Snapshot the opt-in set from the store. The plugin list
  //    itself is read from the store's `plugins` slice so we
  //    use the same data the UI is showing (no parallel
  //    scanPlugins call that could disagree with the manager).
  const pluginStore = usePluginStore.getState()
  const optedIn = pluginStore.plugins.filter((p) =>
    pluginStore.getPluginAutoUpdate(p.id),
  )
  report.considered = optedIn.length
  if (optedIn.length === 0) {
    return report
  }

  // 2. Need a configured marketplace repo to check for updates.
  //    No URL → nothing to do; we deliberately do not throw,
  //    because the auto-update chain is opt-in and the absence
  //    of a repo is the common case for fresh installs.
  const marketStore = usePluginMarketStore.getState()
  const repoUrl = marketStore.repoUrl
  if (!repoUrl) {
    return report
  }

  // best-effort 拉取索引。
  let index: PluginIndex | null
  try {
    await marketStore.refreshIndex({ background: true })
    // The background refresh flips `index` inside the store,
    // so re-read it after the await.
    index = usePluginMarketStore.getState().index
  } catch (err) {
    console.warn('[auto-update] failed to fetch marketplace index:', err)
    return report
  }
  if (!index) {
    return report
  }

  // Build a lookup once so we can resolve each opted-in plugin
  // to its index entry in O(1) instead of scanning the index
  // for every iteration.
  const entryById = new Map<string, PluginIndexEntry>()
  for (const entry of index.plugins) {
    entryById.set(entry.id, entry)
  }

  // 顺序遍历避免限流。
  for (const plugin of optedIn) {
    const entry = entryById.get(plugin.id)
    if (!entry) {
      // Opted in but not in the marketplace — nothing to do.
      // (Could be a locally-built plugin; auto-update is only
      // meaningful for marketplace-published ones.)
      continue
    }
    // 本地 semver 比较避免 IPC 往返。
    if (!isNewerVersion(entry.version, plugin.version)) {
      continue
    }
    try {
      const result = await installOnePlugin(plugin, entry, repoUrl)
      if (result) {
        report.installed.push(result)
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.warn(
        `[auto-update] install failed for ${plugin.id}:`,
        reason,
      )
      report.failed.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        reason,
      })
    }
  }

  // 有安装成功时重新扫描注册表。
  if (report.installed.length > 0) {
    void refreshInstalledPlugins()
  }

  // 每个成功单独 toast，失败合并。
  for (const installed of report.installed) {
    showAutoUpdateToast(t, installed)
  }
  if (report.failed.length > 0) {
    toast.warning(
      t('plugin.pa.autoUpdate.failedTitle', {
        defaultValue: '自动更新失败 ({{count}} 个插件)',
        count: report.failed.length,
      }),
      {
        description: report.failed
          .map((f) => `${f.pluginName}: ${f.reason}`)
          .join('\n'),
      },
    )
  }

  return report
}

/** 启动时从 localStorage 恢复 autoUpdate 配置并镜像到运行时。 */
export function hydrateAutoUpdateFromLocalStorage(): void {
  const record: Record<string, boolean> = {}
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (!key || !key.startsWith(PLUGIN_AUTO_UPDATE_KEY_PREFIX)) {
        continue
      }
      const id = key.slice(PLUGIN_AUTO_UPDATE_KEY_PREFIX.length)
      if (!id) continue
      const raw = window.localStorage.getItem(key)
      record[id] = raw === 'true'
    }
  } catch {
    /* private mode / quota — start with an empty map */
  }
  usePluginStore.getState().hydratePluginAutoUpdate(record)
}

/** 撤销自动更新：rollback、toast、重新扫描。 */
export async function undoAutoUpdate(args: {
  pluginId: string
  previousVersion: string
  pluginName: string
  i18n?: AutoUpdateTranslator
}): Promise<void> {
  const t: AutoUpdateTranslator =
    args.i18n ?? ((key, opts) => i18next.t(key, opts))
  try {
    await rollbackPlugin(args.pluginId, args.previousVersion)
    toast.success(
      t('plugin.pa.autoUpdate.undone', {
        defaultValue: '已撤销 {{name}} 的更新',
        name: args.pluginName,
      }),
      {
        description: t('plugin.pa.autoUpdate.undoneDesc', {
          defaultValue: '已恢复到 v{{version}}',
          version: args.previousVersion,
        }),
      },
    )
    // Re-scan so the manager reflects the rolled-back version
    // and any state that depended on the new version is reset.
    void refreshInstalledPlugins()
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    toast.error(
      t('plugin.pa.autoUpdate.undoFailed', {
        defaultValue: '撤销 {{name}} 的更新失败',
        name: args.pluginName,
      }),
      {
        description: reason,
      },
    )
  }
}

/**
 * 比较 semver，remote 严格大于 local 时返回 true。解析失败回退字符串比较。
 */
export function isNewerVersion(remote: string, local: string): boolean {
  if (!remote || !local) return false
  const r = remote.trim()
  const l = local.trim()
  if (!r || !l) return false
  if (semver.valid(r) !== null && semver.valid(l) !== null) {
    try {
      return semver.gt(r, l)
    } catch {
      // Defensive: semver.gt should not throw when both inputs
      // are valid, but if it ever does, fall through to the
      // string-based fallback rather than crashing the
      // auto-update chain.
    }
  }
  // semver 解析失败时回退字符串比较。
  return r > l
}

/** 重新扫描磁盘并刷新 store。 */
async function refreshInstalledPlugins(): Promise<void> {
  try {
    const scanned = await scanPlugins()
    const result = await loadAllPlugins(scanned)
    const store = usePluginStore.getState()
    store.setPlugins(result.plugins)
    store.setLoadFailures(result.failures)
  } catch (err) {
    console.warn('[auto-update] post-install rescan failed:', err)
  }
}

/** 下载并安装单个插件。 */
async function installOnePlugin(
  plugin: PluginDefinition,
  entry: PluginIndexEntry,
  repoUrl: string,
): Promise<AutoUpdateInstall | null> {
  // 用 host 的 isActive 版本判断是否最新。
  const versions = await listPluginVersions(plugin.id)
  const active = versions.find((v) => v.isActive)
  if (active && active.version === entry.version) {
    return null
  }

  // 下载（走缓存 + sha256 校验）。
  const bytes = await downloadPluginZip(entry, repoUrl)

  // Install via the host — same path the marketplace UI uses.
  await installPluginFromBytes({
    pluginId: entry.id,
    version: entry.version,
    bytes,
    sha256: entry.sha256,
  })

  return {
    pluginId: plugin.id,
    pluginName: plugin.name,
    previousVersion: plugin.version,
    newVersion: entry.version,
  }
}

/** 展示自动更新完成 toast，带撤销。 */
function showAutoUpdateToast(t: AutoUpdateTranslator, installed: AutoUpdateInstall): void {
  toast.success(
    t('plugin.pa.autoUpdate.installedTitle', {
      defaultValue: '{{name}} 已更新到 v{{version}}',
      name: installed.pluginName,
      version: installed.newVersion,
    }),
    {
      description: t('plugin.pa.autoUpdate.installedDesc', {
        defaultValue: '从 v{{version}} 自动更新',
        version: installed.previousVersion,
      }),
      action: {
        label: t('plugin.pa.autoUpdate.undo', {
          defaultValue: '撤销',
        }),
        onClick: () => {
          void undoAutoUpdate({
            pluginId: installed.pluginId,
            previousVersion: installed.previousVersion,
            pluginName: installed.pluginName,
            i18n: t,
          })
        },
      },
      duration: 8000,
    },
  )
}
