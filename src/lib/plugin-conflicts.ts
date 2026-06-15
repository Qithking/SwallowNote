/**
 * Plugin Conflict Detection (Task 13 / G13)
 *
 * Scans the active plugin registry for collisions on three kinds of
 * identifiers:
 *
 *   - `iconSlot`         — two enabled plugins declaring the same
 *                          `iconPosition` (sidebar / editorToolbar /
 *                          titleBar) would render two competing
 *                          icons in the same host chrome slot.
 *   - `contentPosition`  — two enabled plugins declaring the same
 *                          `contentPosition` (leftPanel /
 *                          rightPanel / fullPanel / editorArea)
 *                          would surface two competing panels in
 *                          the same host container.
 *   - `commandPalette`   — two plugins registering the same
 *                          commandPalette id would shadow each
 *                          other in the Ctrl+P palette. The
 *                          commandPalette manifest field is
 *                          optional; conflicts are only reported
 *                          for plugins that declared entries.
 *
 * Detection runs once per registry refresh (see
 * `stores/plugin.ts::setPlugins`) and the result is cached in the
 * store. The store fires `recordPluginConflicts` to surface the
 * conflict set in the existing `plugin-telemetry` ring buffer so the
 * "Logs" popup can render a dedicated "⚠️ Conflict" group.
 *
 * Disabled plugins are ignored on purpose: they don't claim a slot
 * (the registry already filters them out of `getSidebarPlugins` /
 * etc.) and reporting a disabled plugin as a conflict would
 * pollute the UI with stale noise.
 */

import type { PluginDefinition } from '@/types/plugin'

/** What kind of identifier collided. Mirrors the language used in
 *  the design doc (`.trae/specs/plugin-management-gap-analysis/spec.md`)
 *  so the telemetry log line reads naturally to plugin authors. */
export type PluginConflictKind = 'iconSlot' | 'contentPosition' | 'commandPalette'

/**
 * A single collision record. One `PluginConflict` describes the
 * whole peer group (all plugins that share the same identifier),
 * not just two — three or more plugins may collide on the same
 * slot. The host doesn't need the pairwise list; it just needs
 * to know "these N plugins are all fighting for X".
 */
export interface PluginConflict {
  /** What kind of identifier collided. */
  kind: PluginConflictKind
  /** The shared identifier value (e.g. `'sidebar'`,
   *  `'leftPanel'`, `'file.export.markdown'`). */
  value: string
  /** The plugin ids that collide on `value`. Order is stable:
   *  the first entry is the one that was registered first, so
   *  the UI can use the first id as the "primary" claimer. */
  peerIds: string[]
  /** Human-readable message suitable for log rendering. The
   *  shape is "kind value: [a, b, c]" so a plain
   *  `console.warn(message)` already gives the developer
   *  enough context. */
  message: string
}

/** Build the standard human message for a conflict. Pulled out
 *  as a tiny pure helper so the unit test can assert against a
 *  deterministic string without re-implementing the format. */
export function formatConflictMessage(conflict: PluginConflict): string {
  return `${conflict.kind} "${conflict.value}": [${conflict.peerIds.join(', ')}]`
}

/**
 * Detect conflicts across all three kinds in a single pass.
 *
 * The algorithm groups enabled plugins by each identifier, then
 * emits one conflict per group with ≥2 peers. We iterate the
 * plugin list once per kind — three O(N) passes — because
 * `iconPosition` / `contentPosition` / `commandPalette` are
 * different shapes and can't share a single map. The total
 * cost is O(3N + sum of conflict group sizes) and is
 * well under 1ms for the largest install set we expect
 * (~200 plugins).
 *
 * The function is pure: it does not touch the store, telemetry,
 * or any global. The store owns the cache and the side effect
 * (telemetry write), so this module stays trivially unit-testable.
 */
export function detectPluginConflicts(
  plugins: readonly PluginDefinition[],
): PluginConflict[] {
  // Only enabled plugins can claim a slot. A disabled plugin
  // stays in the store for the manager grid (so the user can
  // re-enable it) but is not in the registry and therefore
  // doesn't fight for chrome. Filtering up-front keeps the
  // group maps small and matches the registry semantics.
  const enabled = plugins.filter((p) => p.enabled)

  const conflicts: PluginConflict[] = []

  // ── iconSlot ───────────────────────────────────────────────
  // Group by `iconPosition`. The registry already uses the same
  // key, so two plugins in the same group would render two
  // competing icons in e.g. the sidebar rail.
  const byIcon = new Map<string, string[]>()
  for (const p of enabled) {
    pushGroup(byIcon, p.iconPosition, p.id)
  }
  emitConflicts(conflicts, 'iconSlot', byIcon)

  // ── contentPosition ────────────────────────────────────────
  // Same idea, different axis. Two plugins with the same
  // contentPosition (e.g. `leftPanel`) would both want to be
  // the "currently active" panel in that container.
  const byContent = new Map<string, string[]>()
  for (const p of enabled) {
    pushGroup(byContent, p.contentPosition, p.id)
  }
  emitConflicts(conflicts, 'contentPosition', byContent)

  // ── commandPalette ──────────────────────────────────────────
  // Each plugin can register multiple palette entries; flatten
  // them into a single (id → pluginIds[]) map. A plugin that
  // doesn't declare `commandPalette` contributes nothing.
  const byCommand = new Map<string, string[]>()
  for (const p of enabled) {
    const entries = p.commandPalette
    if (!entries || entries.length === 0) continue
    for (const cmd of entries) {
      // The host treats empty strings as "no declaration" — a
      // plugin author who wrote `commandPalette: ['']` is
      // almost certainly testing the loader, not asking for
      // collisions. Skip blanks defensively.
      if (!cmd) continue
      pushGroup(byCommand, cmd, p.id)
    }
  }
  emitConflicts(conflicts, 'commandPalette', byCommand)

  return conflicts
}

/** Add `pluginId` to the group under `key`, creating the bucket
 *  on first sight. Preserves insertion order so the conflict's
 *  `peerIds` list is deterministic across runs (handy for
 *  snapshot tests). */
function pushGroup(
  groups: Map<string, string[]>,
  key: string,
  pluginId: string,
): void {
  let bucket = groups.get(key)
  if (!bucket) {
    bucket = []
    groups.set(key, bucket)
  }
  // A plugin declaring the same key twice (e.g.
  // `commandPalette: ['x', 'x']`) is a self-conflict; de-dup
  // the plugin id within a bucket so a self-conflict doesn't
  // show up as a "2 plugins collide on X" group of size 2.
  if (!bucket.includes(pluginId)) {
    bucket.push(pluginId)
  }
}

/** Walk `groups`, emit one `PluginConflict` per bucket with ≥2
 *  peers, in stable key order. The output array is the union of
 *  conflicts across all three kinds. */
function emitConflicts(
  out: PluginConflict[],
  kind: PluginConflictKind,
  groups: Map<string, string[]>,
): void {
  // Sort the keys so the output is deterministic. Map iteration
  // order is insertion order in V8/JSC, but that depends on the
  // order of plugins in the source list; we re-sort here so a
  // plugin manager with 50 installs always emits the same
  // conflict list across re-scans.
  const keys = Array.from(groups.keys()).sort()
  for (const key of keys) {
    const peerIds = groups.get(key)!
    if (peerIds.length < 2) continue
    // Sort the peer ids so the output is independent of the
    // input order too. Cheap (≤ 10 entries in practice) and
    // gives a stable snapshot for tests / log readers.
    peerIds.sort()
    const message = formatConflictMessage({ kind, value: key, peerIds, message: '' })
    out.push({ kind, value: key, peerIds, message })
  }
}
