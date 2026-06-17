/**
 * Plugin Conflict Detection (Task 13/G13) — scans registry for commandPalette id collisions.
 * Runs once per registry refresh; disabled plugins ignored.
 */

import type { PluginDefinition } from '@/types/plugin'

/** What kind of identifier collided. Mirrors the language used in
 *  the design doc (`.trae/specs/plugin-management-gap-analysis/spec.md`)
 *  so the telemetry log line reads naturally to plugin authors. */
export type PluginConflictKind = 'commandPalette'

/** One collision record describing the whole peer group. */
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

/** Detect conflicts in single pass. Pure function. */
export function detectPluginConflicts(
  plugins: readonly PluginDefinition[],
): PluginConflict[] {
  // Only enabled plugins claim slots.
  const enabled = plugins.filter((p) => p.enabled)

  const conflicts: PluginConflict[] = []

  // ── commandPalette ──────────────────────────────────────────
  // Each plugin can register multiple palette entries; flatten
  // them into a single (id → pluginIds[]) map. A plugin that
  // doesn't declare `commandPalette` contributes nothing.
  const byCommand = new Map<string, string[]>()
  for (const p of enabled) {
    const entries = p.commandPalette
    if (!entries || entries.length === 0) continue
    for (const cmd of entries) {
      // Skip empty commandPalette entries.
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
  // Sort keys for deterministic output.
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
