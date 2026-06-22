/**
 * Plugin command-palette registry.
 *
 * Mirrors `src/lib/plugin-menu.ts` (the context-menu registry) but
 * holds entries for the global command palette (Ctrl/Cmd+P)
 * rather than per-surface context menus. Plugins call
 * `registerCommand` from their `onLoad` (or any lifecycle hook)
 * with a stable id and a trigger callback; the host:
 *
 *   - lists the entries in the command palette, grouped by
 *     `category` (falls back to the plugin's display name)
 *   - dispatches keyboard shortcuts configured in
 *     `useUIStore().pluginCommandShortcuts[<pluginId>:<id>]`
 *   - surfaces the binding UI in the settings panel
 *
 * Lifecycle ownership is symmetric with the context-menu registry:
 * `clearPluginCommands(pluginId)` is called from the plugin store
 * on unregister / `setPlugins` diff, so plugin authors do not have
 * to remember to clean up their contributions in `onUnload`.
 */
import type {
  PluginCommand,
  PluginCommandRegistry,
  PluginCommandsListener,
} from '@/types/plugin'
import { assertPermission } from './plugin-permission-guard'

/**
 * Per-plugin entry stamped on registration so a later
 * unregister / clear can find the entry without scanning by id
 * (which is plugin-id-scoped but a registry-wide snapshot is what
 * `list()` returns).
 *
 * We also keep the plugin id on the entry because `list()` filters
 * by `when()` and we want the snapshot returned to include the
 * plugin attribution for the command palette / settings UI.
 */
export interface RegisteredPluginCommand extends PluginCommand {
  /** Owning plugin id; stamped on register. */
  __pluginId: string
}

class PluginCommandRegistryImpl implements PluginCommandRegistry {
  /**
   * Internal storage: per-plugin array of entries. Iterated on
   * `list()` to keep ordering deterministic (registration order).
   * `subscribe` listeners are notified after every mutation so
   * React components re-render in the same tick.
   */
  private readonly byPlugin = new Map<string, RegisteredPluginCommand[]>()
  private readonly listeners = new Set<PluginCommandsListener>()

  register(pluginId: string, command: PluginCommand): void {
    assertPermission(pluginId, 'events', `register command "${command.id}"`)
    // Replace any prior entry with the same id from the same plugin
    // so a re-register (e.g. after a manifest reload) doesn't
    // duplicate. Cross-plugin duplicate ids are allowed and indexed
    // independently — the command palette surfaces them as separate
    // entries and the settings panel keys bindings by
    // `<pluginId>:<id>` to keep them distinct.
    this.unregister(pluginId, command.id)
    const owned: RegisteredPluginCommand = { ...command, __pluginId: pluginId }
    let list = this.byPlugin.get(pluginId)
    if (!list) {
      list = []
      this.byPlugin.set(pluginId, list)
    }
    list.push(owned)
    this.notifyListeners()
  }

  unregister(pluginId: string, commandId: string): void {
    const list = this.byPlugin.get(pluginId)
    if (!list) return
    const idx = list.findIndex((c) => c.id === commandId)
    if (idx < 0) return
    list.splice(idx, 1)
    if (list.length === 0) this.byPlugin.delete(pluginId)
    this.notifyListeners()
  }

  clearPlugin(pluginId: string): void {
    if (!this.byPlugin.has(pluginId)) return
    this.byPlugin.delete(pluginId)
    this.notifyListeners()
  }

  list(): PluginCommand[] {
    // Flatten in registration order. The command palette
    // re-sorts by category / label after the `when()` filter
    // runs, so we don't need to sort here.
    const out: PluginCommand[] = []
    for (const list of this.byPlugin.values()) {
      for (const entry of list) {
        out.push(entry)
      }
    }
    return out
  }

  subscribe(listener: PluginCommandsListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (err) {
        // Listener errors must not break the registry's mutation
        // path. Log and keep going — the next mutation will give
        // them another chance.
        // eslint-disable-next-line no-console
        console.error('[plugin-commands] listener threw:', err)
      }
    }
  }
}

/** Host singleton. Mirrors the per-plugin context-menu singleton. */
export const pluginCommandRegistry = new PluginCommandRegistryImpl()

/** Register a single command-palette entry. */
export function registerCommand(pluginId: string, command: PluginCommand): void {
  pluginCommandRegistry.register(pluginId, command)
}

/** Unregister a specific command by id. */
export function unregisterCommand(pluginId: string, commandId: string): void {
  pluginCommandRegistry.unregister(pluginId, commandId)
}

/** Drop every contribution owned by a given plugin. */
export function clearPluginCommands(pluginId: string): void {
  pluginCommandRegistry.clearPlugin(pluginId)
}

/**
 * Read-only snapshot of all currently-registered commands. The
 * command palette and the settings panel both call this inside a
 * subscription callback so they re-render on every change.
 */
export function listPluginCommands(): PluginCommand[] {
  return pluginCommandRegistry.list()
}

/** Subscribe to registry mutations. Returns an unsubscribe fn. */
export function subscribePluginCommands(listener: PluginCommandsListener): () => void {
  return pluginCommandRegistry.subscribe(listener)
}
