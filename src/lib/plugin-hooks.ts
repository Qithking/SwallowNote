/**
 * React hook wrappers around the plugin host APIs.
 *
 * These hooks exist so plugin authors can write idiomatic React code
 * (`const [theme, setTheme] = usePluginStorage(panel, 'theme', 'light')`)
 * without manually wiring up the storage / event bus plumbing.
 *
 * All hooks are designed for use inside a plugin panel component,
 * which is the only place `PluginPanelProps` is passed. Lifecycles
 * outside of panels (e.g. inside `onMount`) should use the
 * `pluginEventBus` / `getPluginStorage` exports from
 * `@/lib/plugin-host` directly.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PluginCommand,
  PluginEvent,
  PluginEventBus,
  PluginEventHandler,
  PluginEventPayloadMap,
  PluginPanelProps,
  PluginStorage,
} from '@/types/plugin'
import {
  listPluginCommands,
  subscribePluginCommands,
} from './plugin-commands'

// ─── Storage hook ──────────────────────────────────────────────────────────────

/**
 * React state backed by the plugin's persistent storage.
 *
 * Reads the value on mount and writes any change back to disk
 * asynchronously. The in-memory state updates synchronously so the
 * UI stays responsive; the disk write is fire-and-forget (the host
 * serializes writes internally).
 *
 * Usage:
 *   const [theme, setTheme] = usePluginStorage(panel, 'theme', 'light')
 *
 * `setValue` accepts either a new value or a function (like
 * `setState`), so plugins can compose updates safely:
 *   setTheme(prev => prev === 'light' ? 'dark' : 'light')
 *
 * The JSON serialisation means values must be JSON-safe (no functions,
 * no cycles). Pass `null` to delete the key.
 */
export function usePluginStorage<T = unknown>(
  panel: PluginPanelProps,
  key: string,
  initialValue: T
): [T, (next: T | ((prev: T) => T) | null) => void] {
  const { store } = panel
  const [value, setValue] = useState<T>(initialValue)
  // Track the latest value in a ref so the `set` callback always
  // reads the current state instead of a stale closure capture.
  // Without this, rapid consecutive calls like
  //   set(v => v + 1); set(v => v + 1)
  // would both read the same `value` snapshot and the second
  // increment would be lost.
  const valueRef = useRef(value)
  valueRef.current = value

  useEffect(() => {
    let cancelled = false
    void store.get<T>(key).then((stored) => {
      if (cancelled) return
      if (stored !== null) setValue(stored)
    })
    return () => {
      cancelled = true
    }
    // The key/store identity shouldn't change for the lifetime of a
    // mounted panel, so we depend on `key` only. `initialValue` is
    // intentionally NOT a dep – otherwise a parent re-render with a
    // new object identity would clobber stored state.
  }, [key, store])

  const set = useCallback(
    (next: T | ((prev: T) => T) | null) => {
      // Resolve the new value first, then update React state and
      // persist. We treat `null` as "delete the key" so the storage
      // hook mirrors the `useState` API: callers never have to think
      // about the persistence layer.
      if (next === null) {
        setValue(initialValue)
        void store.delete(key)
        return
      }
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(valueRef.current) : next
      setValue(resolved)
      valueRef.current = resolved
      void store.set(key, resolved)
    },
    // `valueRef` is stable and always current, so we don't need
    // `value` in the deps. `initialValue` is included for the
    // null-delete path – if a parent ever swaps the hook's initial
    // value, we honour that.
    [key, store, initialValue]
  )

  return [value, set]
}

// ─── Event subscription hook ──────────────────────────────────────────────────

/**
 * Subscribe to a host event from a plugin panel.
 *
 * The handler is registered on mount and unregistered on unmount
 * (and on handler/event identity change). The plugin author doesn't
 * need to think about cleanup – React's effect return callback does
 * it for them.
 *
 * Usage:
 *   usePluginEvent(panel, 'theme:change', (payload) => {
 *     console.log('Theme is now', payload.theme)
 *   })
 *
 * Multiple events can be subscribed by calling the hook repeatedly.
 * For a single event with a stable handler, this is the most
 * ergonomic API.
 */
export function usePluginEvent<E extends PluginEvent>(
  panel: { pluginId: string; events: PluginEventBus },
  event: E,
  handler: PluginEventHandler<E>
): void {
  const handlerRef = useRef(handler)
  // Keep the ref pointed at the latest handler so a parent re-render
  // with a new function identity doesn't tear down & re-subscribe.
  // We still depend on `handler` in the effect deps below so the
  // bus sees the freshest closure if the plugin author really does
  // need a new identity (rare).
  handlerRef.current = handler
  const { events } = panel

  useEffect(() => {
    // Adapt the handler to the bus's loose signature: the bus stores
    // handlers as `AnyHandler` but we still get type safety on the
    // payload thanks to PluginEventHandler<E>'s generic.
    // Stash the pluginId on the wrapper handler so the bus can
    // attribute emissions to this plugin for metrics purposes.
    const wrapped = ((payload: PluginEventPayloadMap[E]) => {
      handlerRef.current(payload)
    }) as PluginEventHandler<E> & { __pluginId?: string }
    wrapped.__pluginId = panel.pluginId
    const unsubscribe = events.on(event, wrapped as PluginEventHandler<E>)
    return unsubscribe
  }, [event, events, panel.pluginId])
}

/**
 * Variant of `usePluginEvent` that subscribes to multiple events at
 * once. Useful for plugins that want a single effect block to track
 * every "settings:change" event regardless of which key changed.
 *
 * Usage:
 *   usePluginEvents(panel, ['theme:change', 'locale:change'], (event, payload) => {
 *     // ...
 *   })
 */
export function usePluginEvents<E extends PluginEvent>(
  panel: { pluginId: string; events: PluginEventBus },
  events: readonly E[],
  handler: (event: E, payload: PluginEventPayloadMap[E]) => void
): void {
  const { events: bus } = panel
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const unsubs = events.map((evt) =>
      (bus as PluginEventBus).on(evt, ((payload: PluginEventPayloadMap[typeof evt]) => {
        handlerRef.current(evt, payload)
      }) as PluginEventHandler<typeof evt>)
    )
    return () => {
      for (const u of unsubs) u()
    }
  }, [bus, events])
}

// ─── Convenience accessors ────────────────────────────────────────────────────

/**
 * Pull just the `store` and `events` handles out of a panel in one
 * line. Equivalent to `const { store, events } = panel` but type-
 * narrowed so accidental access to `close` / `invokeBackend` etc.
 * doesn't leak into a hook body.
 */
export function usePluginServices(panel: PluginPanelProps): {
  store: PluginStorage
  events: PluginEventBus
} {
  return { store: panel.store, events: panel.events }
}

// ─── Command palette hook ────────────────────────────────────────────────────

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
 */
export function usePluginCommands(): PluginCommand[] {
  const [commands, setCommands] = useState<PluginCommand[]>(() =>
    listPluginCommands()
  )

  useEffect(() => {
    // Re-read the snapshot every time the registry notifies. We
    // re-derive the filtered list (when() can change between
    // calls) rather than caching it in the registry so a plugin
    // that closes itself out of a workspace at runtime drops out
    // of the command palette in the same tick.
    const refresh = () => {
      const next = listPluginCommands().filter((cmd) => {
        if (cmd.when) {
          try {
            return cmd.when()
          } catch {
            // A buggy `when()` must not blow up the whole palette.
            // Treat it as "show" so the user can still see and
            // re-trigger the entry; the next tick will retry.
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
