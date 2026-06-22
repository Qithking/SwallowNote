/**
 * React hook wrappers around the plugin host APIs.
 *
 * All hooks in this file are **thin re-exports** of
 * `@swallow-note/plugin-sdk`. The original implementations lived
 * here and were duplicated against the SDK's; the SDK versions are
 * the canonical source of truth now (single-file self-contained,
 * stub-aware, host-takeover aware). We keep this file as a
 * compatibility layer so any host-side import (`@/lib/plugin-hooks`)
 * keeps working — but plugins should import from the SDK directly.
 *
 * The host retains a small number of host-only exports:
 *  - `usePluginCommands` — depends on the host's live command
 *    registry snapshot, not the SDK's stub.
 *  - `usePluginServices` — SDK-equivalent, kept here for compat.
 */
import type { PluginCommand, PluginEvent, PluginEventPayloadMap } from '@/types/plugin'
import {
  usePluginStorage as sdkUsePluginStorage,
  usePluginEvent as sdkUsePluginEvent,
  usePluginEvents as sdkUsePluginEvents,
  usePluginServices as sdkUsePluginServices,
  type PluginPanelProps,
  type PluginEventBus,
} from '@swallow-note/plugin-sdk'
import { useEffect, useState } from 'react'
import {
  listPluginCommands,
  subscribePluginCommands,
} from './plugin-commands'

export const usePluginStorage = sdkUsePluginStorage
export const usePluginEvent = sdkUsePluginEvent
export const usePluginServices = sdkUsePluginServices

/**
 * `usePluginEvents` is a re-export, but the host's typing is
 * slightly different (the host accepts a stricter `(event, payload)`
 * pair signature). Wrap to preserve the original signature so
 * existing call sites in core-plugins keep working.
 */
export function usePluginEvents<E extends PluginEvent>(
  panel: PluginPanelProps,
  events: readonly E[],
  handler: (event: E, payload: PluginEventPayloadMap[E]) => void
): void {
  // SDK signature takes `event: E, payload: unknown`; the host's
  // stricter signature is just a generic-narrowing wrapper.
  sdkUsePluginEvents(
    panel,
    events,
    handler as unknown as (event: E, payload: unknown) => void
  )
}

// ─── Command palette hook (host-only) ────────────────────────────────────────

/**
 * Live snapshot of every plugin command currently registered.
 *
 * The host's `pluginCommandRegistry` is a singleton that lives
 * outside React; this hook re-renders on every register /
 * unregister / clearPlugin by subscribing to the registry's
 * notifier. Callers (the command palette, the settings panel)
 * use this to render plugin contributions without having to
 * import the registry singleton directly.
 *
 * Filters out entries whose `when()` predicate returns false
 * (e.g. a "Commit" command hiding outside a git workspace). The
 * registry keeps the hidden entry so a later re-render with a
 * changed `when()` flips visibility back on without re-registering.
 *
 * Note: this is the *host* version — it queries the live host
 * registry. The SDK's `usePluginCommands` is the equivalent
 * standalone hook (works in plugin previews); for any code that
 * wants to run inside the host and see *all* commands (including
 * ones plugins registered through the host's permission-checked
 * registry), use this version.
 */
export function usePluginCommands(): PluginCommand[] {
  const [commands, setCommands] = useState<PluginCommand[]>(() =>
    listPluginCommands()
  )

  useEffect(() => {
    const refresh = () => {
      const next = listPluginCommands().filter((cmd) => {
        if (cmd.when) {
          try {
            return cmd.when()
          } catch {
            return true
          }
        }
        return true
      })
      setCommands(next)
    }
    refresh()
    return subscribePluginCommands(refresh)
  }, [])

  return commands
}

// Re-export the type so existing imports of this file's types
// keep resolving without an extra import line.
export type { PluginPanelProps, PluginEventBus }
