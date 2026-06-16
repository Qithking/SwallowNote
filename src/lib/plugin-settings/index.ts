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
} from '@/lib/tauri'

export type {
  PluginSettingsField,
  PluginSettingsFieldOption,
  PluginSettingsFieldType,
  PluginSettingsSchema,
  PluginSettingsView,
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

/** Drop the cache entry and the SQLite table (irreversible). */
export async function resetSettings(pluginId: string): Promise<void> {
  await deletePluginSettings(pluginId)
  cache.delete(cacheKey(pluginId))
}

/** `true` when this plugin ships a `settings.json` schema. */
export function hasSettings(view: PluginSettingsView | null | undefined): boolean {
  return !!view?.schema
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
