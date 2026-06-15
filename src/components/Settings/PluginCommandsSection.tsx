/**
 * Plugin commands settings section (Task 9 / G9).
 *
 * Renders one row per registered plugin command with a click-to-
 * record shortcut UI. Conflicts are detected via
 * `findShortcutConflictDetailed` and shown inline; the binding
 * is still written to the store (the keyboard handler resolves
 * ties with a defined precedence order, so a "conflicting"
 * plugin command simply doesn't fire while a built-in also holds
 * the key).
 *
 * Commands whose `when()` predicate returns false are dimmed but
 * kept in the list so the user can still manage their binding
 * without needing to flip the predicate first.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Puzzle, Zap, AlertCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { usePluginCommands } from '@/lib/plugin-hooks'
import { usePluginStore } from '@/stores/plugin'
import { PluginCommandRecorder } from './PluginCommandRecorder'
import type { PluginCommand } from '@/types/plugin'

/** Format a plugin id (`com.foo.bar`) as a short, friendly label. */
function pluginDisplayName(id: string, fallback: string): string {
  // Plugin manifests already carry a `name`; the registry only
  // exposes the id. We fall back to a beautified id when the
  // store doesn't have a matching entry.
  return fallback || id
}

export function PluginCommandsSection() {
  const { t } = useTranslation()
  const commands = usePluginCommands()
  const plugins = usePluginStore((s) => s.plugins)

  // Build a quick `pluginId → name` map so each row can show the
  // owning plugin's display name. We tolerate a missing entry
  // (e.g. a freshly-registered command whose plugin hasn't yet
  // been recorded in the store) by falling back to the id.
  const pluginNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of plugins) map.set(p.id, p.name)
    return map
  }, [plugins])

  // Sort by plugin name then command label so the user gets a
  // stable, predictable order — the registry's insertion order
  // is not stable across plugin re-loads.
  const ordered = useMemo(() => {
    return [...commands].sort((a, b) => {
      const aEntry = a as PluginCommand & { __pluginId: string }
      const bEntry = b as PluginCommand & { __pluginId: string }
      const pluginCmp = aEntry.__pluginId.localeCompare(bEntry.__pluginId)
      if (pluginCmp !== 0) return pluginCmp
      return a.label.localeCompare(b.label)
    })
  }, [commands])

  return (
    <Card>
      <CardContent className="p-0 divide-y divide-border">
        {ordered.length === 0 ? (
          <div className="px-4 py-6 text-xs text-muted-foreground flex items-center gap-2">
            <AlertCircle size={14} />
            {t('settings.pluginCommands.empty')}
          </div>
        ) : (
          ordered.map((cmd) => {
            const entry = cmd as PluginCommand & { __pluginId: string }
            const bindingKey = `${entry.__pluginId}:${cmd.id}`
            const pluginName = pluginDisplayName(
              entry.__pluginId,
              pluginNameById.get(entry.__pluginId) ?? ''
            )
            // Run `when()` lazily (already filtered in
            // `usePluginCommands`); the registry only emits visible
            // entries, so this is a UI hint rather than a filter.
            const visible = !cmd.when
              ? true
              : (() => {
                  try {
                    return cmd.when()
                  } catch {
                    return true
                  }
                })()
            return (
              <div
                key={bindingKey}
                className={`flex items-center justify-between px-4 py-3 ${
                  visible ? '' : 'opacity-60'
                }`}
              >
                <div className="flex-1 mr-4 min-w-0">
                  <div className="flex items-center gap-2">
                    <Zap size={13} className="text-primary shrink-0" />
                    <Label className="text-sm font-medium truncate">
                      {cmd.label}
                    </Label>
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                      <Puzzle size={10} />
                      {pluginName}
                    </span>
                  </div>
                  {cmd.category && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 ml-5">
                      {cmd.category}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-0.5 ml-5">
                    <code className="font-mono">{entry.__pluginId}</code>
                    <span className="mx-1">·</span>
                    <code className="font-mono">{cmd.id}</code>
                  </p>
                </div>
                <PluginCommandRecorder bindingKey={bindingKey} command={cmd} />
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
