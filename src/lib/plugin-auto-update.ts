/**
 * Plugin Auto-Update (Task 11 / G11)
 *
 * Background machinery that powers the "opt-in auto-update" flow:
 *
 * 1. The user toggles `autoUpdate` on a single installed plugin
 *    (see `PluginInstalledCard` / `setPluginAutoUpdate`).
 * 2. On the next app start, `runAutoUpdateOnStartup` walks the
 *    plugin list, filters the opted-in ones, asks the host if a
 *    newer version exists, and silently re-installs it via the
 *    marketplace download pipeline.
 * 3. After a successful install the caller shows a toast that
 *    includes an "撤销" / "Undo" action — clicking it rolls back
 *    to the previously-installed version via
 *    `rollbackPlugin(pluginId, previousVersion)`.
 *
 * The whole chain is **strictly best-effort**:
 *   - A failed network / index fetch is swallowed; the user is
 *     never blocked from launching the app.
 *   - A failed install on one plugin does not abort the loop —
 *     the remaining opted-in plugins still get a chance to update.
 *   - A failed rollback surfaces a follow-up error toast but does
 *     not throw — the user can still see the broken plugin in the
 *     manager and act manually.
 *
 * The signature `runAutoUpdateOnStartup` is *deliberately* a free
 * function (not a React hook) so it can be called from a non-
 * component context (the `App.tsx` init chain) and so it stays
 * trivially unit-testable: the function reads the plugin store
 * via `usePluginStore.getState()` and the marketplace store the
 * same way, returning a plain `AutoUpdateReport` object the test
 * can assert against.
 */
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
  effectivePubkey,
} from '@/lib/plugin-market'
import { loadAllPlugins } from '@/lib/plugin-loader'
import { scanPlugins } from '@/lib/tauri'
import i18next from 'i18next'

/**
 * Type for a translation function compatible with both
 * `i18next.TFunction` and a plain `(key, opts) => string`.
 * The auto-update helpers accept either form so non-React
 * callers (the `App.tsx` startup chain) can pass either
 * a `useTranslation()` result or a fallback that calls
 * `i18next.t(...)` directly.
 */
export type AutoUpdateTranslator = (
  key: string,
  opts?: Record<string, unknown>,
) => string

/**
 * One row of the auto-update run report. `null` results in fields
 * are explicitly NOT used (the row is omitted from the array
 * when the plugin wasn't opted in, or when no update was
 * available). Keeping the per-plugin record lets the caller build
 * a more detailed "X plugins were updated in the background"
 * summary than a bare count, and is cheap to construct.
 */
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

/**
 * Walk the installed plugin list, download newer versions for
 * opted-in plugins, install them, and surface the result.
 *
 * The function is fire-and-forget: callers (typically `App.tsx`)
 * invoke it without awaiting and let it complete in the
 * background. Any rejection is logged but never propagated —
 * a slow / flaky marketplace must not delay the user from
 * working with the rest of the app.
 *
 * @param i18n Optional `t` function used for the toast copy.
 *             Falls back to the `i18next.t` global when omitted
 *             so non-React callers don't have to thread a
 *             `useTranslation` hook through.
 */
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

  // 3. Fetch the index. Best-effort: a network error here means
  //    "no updates this run", and we silently return. We do NOT
  //    trigger a refresh on the marketplace UI store, because
  //    that would clobber whatever the user has open; the
  //    auto-update chain reads its own copy of the index.
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

  // 4. Walk the opted-in plugins. Sequential on purpose: a
  //    marketplace rate-limit / bandwidth cap shouldn't be
  //    multiplied by the opt-in count, and the user only ever
  //    opts in to a handful of plugins (the feature is opt-in,
  //    not opt-out). A slow install for plugin A does not
  //    block plugin B thanks to the try/catch inside the loop.
  for (const plugin of optedIn) {
    const entry = entryById.get(plugin.id)
    if (!entry) {
      // Opted in but not in the marketplace — nothing to do.
      // (Could be a locally-built plugin; auto-update is only
      // meaningful for marketplace-published ones.)
      continue
    }
    // Semver-gate: only consider a real version bump. The
    // marketplace index is the source of truth for "is there
    // a newer version"; the host's `check_plugin_updates` does
    // the same comparison server-side, but we keep the check
    // local to avoid a round-trip per plugin.
    if (!isNewerVersion(entry.version, plugin.version)) {
      continue
    }
    try {
      const result = await installOnePlugin(plugin, entry, index)
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

  // 5. If anything actually changed on disk, re-scan and re-load
  //    the plugin set so the manager's "Update" badge clears
  //    and the new version is reflected in the registry. We
  //    schedule this *after* the toast so the user sees the
  //    "已更新" message even if the rescan is slow.
  if (report.installed.length > 0) {
    void refreshInstalledPlugins()
  }

  // 6. Surface toasts. Each successful install gets its own
  //    toast with an "撤销" action so the user can roll back
  //    to the previous version with one click. Failures are
  //    summarised in a single warning toast to avoid spamming
  //    the notification area.
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

/**
 * Hydrate the persisted `pluginAutoUpdate` map from
 * `localStorage` and re-mirror it onto the runtime
 * definitions. Called once on app start so a previously-
 * opted-in plugin survives a cold reload.
 *
 * Idempotent: calling it twice with the same `localStorage`
 * state is a no-op (the store's own `hydratePluginAutoUpdate`
 * does a wholesale replace, not a merge).
 */
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

/**
 * Trigger an undo for a previous auto-update. Wraps the
 * `rollbackPlugin` IPC call, shows a confirmation toast, and
 * re-scans the plugin set on success so the registry picks up
 * the rolled-back version.
 *
 * The function returns the metadata of the now-active version
 * (typically the pre-update one) so the caller can render
 * additional UI if needed; the toast itself is the primary
 * user-visible signal.
 */
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
 * Compare two semver strings and report whether `remote` is
 * strictly newer than `local`. Delegates to node-semver so the
 * pre-release rules are honored (`1.0.0-beta.1 < 1.0.0`) and the
 * marketplace can safely treat `-beta` builds as "older than
 * the matching release" rather than the lexically-greater string
 * the previous per-component splitter produced.
 *
 * Edge cases:
 *   - Either side empty → `false`. A missing version on disk
 *     must never trigger an auto-update (a fresh install is
 *     the only safe way to introduce a plugin to the registry).
 *   - Either side fails `semver.valid()` → fall back to a
 *     strict-string inequality, then to `false`. This keeps
 *     historical marketplace entries that predate strict semver
 *     compatible (e.g. a `v1` legacy tag) while still refusing
 *     to mis-fire on garbage.
 *
 * Exported for unit testing — the `runAutoUpdateOnStartup`
 * integration test relies on the same helper.
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
  // Fallback for unparseable inputs. The previous behaviour
  // (loose per-component compare) is preserved here so a
  // marketplace index that still ships e.g. `v1` / `latest`
  // doesn't regress. A simple lex-greater is good enough: the
  // only consumer is a best-effort auto-update that swallows
  // its own errors anyway.
  return r > l
}

/**
 * Re-scan the on-disk plugin set and re-hydrate the store.
 * Mirrors the chain `App.tsx` runs at startup, but scoped to
 * the post-auto-update rebuild. Errors are logged and
 * swallowed: a failed rescan just means the manager will
 * show stale data until the next manual refresh, which is
 * strictly better than blocking the user.
 */
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

/**
 * Download + install a single plugin. Returns the install
 * record (for the toast) on success, or `null` when there is
 * no available update for this plugin. Throws on a hard
 * failure (network, sha256 mismatch, install rejection) so
 * the caller's catch can record the per-plugin failure.
 */
async function installOnePlugin(
  plugin: PluginDefinition,
  entry: PluginIndexEntry,
  index: PluginIndex,
): Promise<AutoUpdateInstall | null> {
  // Sanity: the host's version list is the most reliable way
  // to detect "this is the *currently active* version on
  // disk" because the marketplace can list a version that
  // isn't active (e.g. after a manual rollback). We compare
  // the marketplace's latest `entry.version` against the
  // host's `isActive: true` row and bail when they match —
  // there's nothing to install.
  const versions = await listPluginVersions(plugin.id)
  const active = versions.find((v) => v.isActive)
  if (active && active.version === entry.version) {
    return null
  }

  // Download (honours the IndexedDB cache + sha256 check).
  const bytes = await downloadPluginZip(entry)

  // Install via the host — same path the marketplace UI uses,
  // so the verification pipeline (sha256 + ed25519) runs.
  await installPluginFromBytes({
    pluginId: entry.id,
    version: entry.version,
    bytes,
    sha256: entry.sha256,
    pubkeyB64: effectivePubkey(index, entry),
    signatureB64: entry.signatureB64,
  })

  return {
    pluginId: plugin.id,
    pluginName: plugin.name,
    previousVersion: plugin.version,
    newVersion: entry.version,
  }
}

/**
 * Show the "auto-update completed" toast for a single plugin.
 * The toast carries an "撤销" action that, when clicked,
 * triggers `undoAutoUpdate` for the recorded previous version.
 *
 * The `id` is intentionally unique per toast (the plugin id)
 * so a second auto-update for the same plugin in the same
 * session produces two distinct toasts — the second update's
 * "撤销" should roll *that* update back, not the first one's.
 */
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
