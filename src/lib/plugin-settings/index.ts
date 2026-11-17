/**
 * Frontend wrapper around the host's plugin-settings IPC.
 *
 * Plugin settings are stored in a per-plugin SQLite table
 * (`plugin_settings_<id>`) and described by an on-disk
 * `settings.json` shipped with the plugin zip. This module:
 *   - re-exports the host-facing types so the settings dialog and
 *     the plugin SDK share one source of truth
 *   - provides a thin client for read / write / delete
 *   - caches the latest values in memory so multiple `getSetting`
 *     calls don't re-hit the host
 *
 * The cache is intentionally a `Map` keyed on plugin id; clearing
 * the cache (e.g. after a manual `writeSettings` from a different
 * tab) is a one-line call.
 */
import {
  readPluginSettings,
  writePluginSettings,
  deletePluginSettings,
  type PluginSettingsField,
  type PluginSettingsFieldOption,
  type PluginSettingsFieldType,
  type PluginSettingsSchema,
  type PluginSettingsView,
  type PluginSettingsVisibleWhen,
} from '@/lib/tauri'

export type {
  PluginSettingsField,
  PluginSettingsFieldOption,
  PluginSettingsFieldType,
  PluginSettingsSchema,
  PluginSettingsView,
  PluginSettingsVisibleWhen,
}

/** Per-plugin cache. The host is the source of truth, this is just a hot path. */
const cache = new Map<string, PluginSettingsView>()

function cacheKey(pluginId: string) {
  return pluginId
}

/**
 * Load a plugin's settings. Cached per `pluginId`. Pass `force: true`
 * to skip the cache and round-trip to the host.
 */
export async function loadSettings(
  pluginId: string,
  force = false
): Promise<PluginSettingsView> {
  if (!force) {
    const hit = cache.get(cacheKey(pluginId))
    if (hit) return hit
  }
  const view = await readPluginSettings(pluginId)
  cache.set(cacheKey(pluginId), view)
  return view
}

/**
 * Persist the supplied values to the host and refresh the cache.
 * Throws on IPC failure so the settings dialog can toast.
 */
export async function saveSettings(
  pluginId: string,
  values: Record<string, unknown>
): Promise<void> {
  await writePluginSettings(pluginId, values)
  const existing = cache.get(cacheKey(pluginId))
  if (existing) {
    cache.set(cacheKey(pluginId), { ...existing, values })
  }
}

/** Per-plugin 设置写串行队列（PL-4）：队尾 promise 即最新一次写。 */
const settingsWriteQueues = new Map<string, Promise<Record<string, unknown>>>()

/**
 * 串行化的单键设置写入（PL-4 修复）。
 *
 * 读-改-写序列（force 读快照 → 合并单键 → 全量写回）按插件依次执行：
 * 并发 set('a',1) / set('b',2) 不再各自读取同一快照互相覆盖丢键。
 * 前一次写失败不阻塞后续写（每次 op 都从最新快照重读）；本次写入的
 * 合并结果返回给调用方用于广播 `plugin-settings:change`。
 */
export async function writeSettingKey(
  pluginId: string,
  key: string,
  value: unknown
): Promise<Record<string, unknown>> {
  const prev = settingsWriteQueues.get(pluginId) ?? Promise.resolve()
  const op = async (): Promise<Record<string, unknown>> => {
    const view = await loadSettings(pluginId, true)
    const next = { ...view.values, [key]: value }
    await saveSettings(pluginId, next)
    return next
  }
  const queued = prev.then(op, op)
  settingsWriteQueues.set(pluginId, queued)
  // 本次写已是队尾且完成时清掉条目，避免长期驻留的 Map 泄漏。
  void queued.finally(() => {
    if (settingsWriteQueues.get(pluginId) === queued) {
      settingsWriteQueues.delete(pluginId)
    }
  })
  return queued
}

/** Drop the cache entry and the SQLite table (irreversible). */
export async function resetSettings(pluginId: string): Promise<void> {
  await deletePluginSettings(pluginId)
  cache.delete(cacheKey(pluginId))
}

/**
 * 仅清理内存缓存条目（不触碰 SQLite）。卸载插件时调用，避免缓存长期残留
 * 导致同 id 重装时读到旧值。与 resetSettings 的区别：本函数同步、无副作用，
 * 适合在卸载清理链路中与 dropPluginStorage 等一同调用。
 */
export function dropSettingsCache(pluginId: string): void {
  cache.delete(cacheKey(pluginId))
}

/** `true` when this plugin ships a `settings.json` schema. */
export function hasSettings(view: PluginSettingsView | null | undefined): boolean {
  return !!view?.schema
}

/**
 * Decide whether a field should be rendered given the current
 * values map. A field with no `visibleWhen` is always shown.
 * Otherwise the field shows only when the controller field's
 * current value strictly equals the predicate's `equals`. A
 * predicate whose `key` is missing from the values map evaluates
 * to "hidden" on purpose — see
 * {@link PluginSettingsVisibleWhen}.
 */
export function isFieldVisible(
  field: PluginSettingsField,
  values: Record<string, unknown>
): boolean {
  if (!field.visibleWhen) return true
  return values[field.visibleWhen.key] === field.visibleWhen.equals
}

/** Return a single setting value, falling back to the schema default. */
export function readSetting(
  view: PluginSettingsView,
  key: string
): unknown {
  if (key in view.values) {
    return view.values[key]
  }
  const field = view.schema?.fields.find((f) => f.key === key)
  return field?.default ?? null
}

/** Type guard – narrows to the supported field types. */
export function isKnownFieldType(
  t: string
): t is PluginSettingsFieldType {
  return (
    t === 'string' ||
    t === 'string-multiline' ||
    t === 'number' ||
    t === 'boolean' ||
    t === 'select' ||
    t === 'color' ||
    t === 'directory' ||
    t === 'password'
  )
}
