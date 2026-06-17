/**
 * Plugin file-editor registry.
 *
 * Plugins can claim rendering responsibility for one or more file
 * extensions by declaring `editorFileExtensions` + `editorComponent`
 * in their manifest. The host keeps the live mapping in this module
 * and exposes a small API that the SDK's `registerEditor` /
 * `unregisterEditor` / `getEditorForExtension` functions forward
 * into.
 *
 * Lifecycle ownership is symmetric with `src/lib/plugin-menu.ts`
 * and `src/lib/plugin-commands.ts`: the plugin store calls
 * `unregisterEditor(pluginId)` on uninstall / `setPlugins` diff so
 * a removed plugin's editor doesn't keep claiming extensions
 * after the module is gone.
 *
 * Permission model: the host bridge (`plugin-host-takeover.ts`)
 * re-asserts the `editor` permission before every call, but we
 * also do a defence-in-depth check here against
 * `usePluginStore().plugins` so an install that bypassed the
 * bridge (e.g. a host-side programmatic install) still respects
 * the user's grant. A plugin whose `permissions` array omits
 * `'editor'` is rejected outright — being *granted* the
 * permission is necessary but not sufficient.
 *
 * Conflict resolution: each extension can be owned by exactly one
 * plugin at a time. A second registration of the same extension
 * throws an `Error` so the install path can surface a clear
 * failure; the runtime `unregisterEditor` then dispatches the
 * `editor:unregistered` event so any open editors can fall back
 * to the built-in Markdown / code editor.
 */
import type { ComponentType } from 'react'
import { useEffect, useState } from 'react'
import { usePluginStore } from './plugin'
import { useUIStore } from './ui'
import { pluginEventBus } from '@/lib/plugin-host'
import { assertPermission } from '@/lib/plugin-permission-guard'

/**
 * Resolved shape of a registered editor. The component is
 * captured by the host's bridge before being placed in the map
 * — the registry itself doesn't try to validate the React shape
 * because the same component has already been accepted by the
 * `PluginDefinition` type-check.
 */
export interface PluginEditorEntry {
  pluginId: string
  component: ComponentType<{
    content: string
    onChange: (content: string) => void
  }>
}

class PluginEditorRegistryImpl {
  /** Map<extension, entry> — only one plugin per extension. */
  private readonly byExtension = new Map<string, PluginEditorEntry>()

  /**
   * Register a component for the given extension. The caller is
   * expected to have already run the `editor` permission check
   * (this is what the host bridge does); we re-assert here as a
   * safety net and additionally verify the extension isn't owned
   * by a different plugin.
   *
   * @throws Error("extension ... already registered by ...")
   *         when a *different* plugin already owns the extension.
   *         Re-registering from the same plugin is allowed and
   *         replaces the previous component.
   * @throws PluginPermissionDeniedError when the calling plugin
   *         lacks the `editor` grant.
   */
  register(
    pluginId: string,
    extension: string,
    component: ComponentType<{
      content: string
      onChange: (content: string) => void
    }>,
  ): void {
    const ext = this.normaliseExtension(extension)
    if (!ext) {
      throw new Error('[plugin-editor] registerEditor: extension is empty')
    }
    // Permission gate (defence in depth). The bridge already
    // called this, but a programmatic install that bypassed the
    // bridge would skip the check. We re-read the grant from the
    // authority (the host's `assertPermission` reads
    // `plugin_permissions_<id>` localStorage via the same cache
    // the bridge uses), so the result is consistent.
    assertPermission(pluginId, 'editor', `register editor for "${ext}"`)
    // Sanity check: the plugin must also have *declared* the
    // `editor` permission in its manifest. A plugin can be
    // granted a permission it didn't request through the
    // settings dialog, but for the editor registry we want a
    // hard contract — the manifest's `editorFileExtensions`
    // and `'editor'` grant are designed to travel together.
    const plugin = usePluginStore.getState().plugins.find((p) => p.id === pluginId)
    if (plugin && !plugin.permissions?.includes('editor')) {
      throw new Error(
        `[plugin-editor] plugin "${pluginId}" did not declare the "editor" permission in its manifest`,
      )
    }
    const existing = this.byExtension.get(ext)
    if (existing && existing.pluginId !== pluginId) {
      // Surface a toast so the user sees the conflict in the
      // UI (the throw is for the install path; the toast is
      // for the runtime case where a plugin's `onLoad` was
      // reached even though another plugin had already won
      // the race for the same extension).
      useUIStore.getState().showToast(
        `Extension "${ext}" is already registered by plugin "${existing.pluginId}" — "${pluginId}" cannot take it over`,
        'error',
      )
      throw new Error(
        `extension "${ext}" already registered by plugin "${existing.pluginId}"`,
      )
    }
    this.byExtension.set(ext, { pluginId, component })
    // Dispatch the registered event so the UI can refresh any
    // extension-aware panels (e.g. the file tree icon
    // decorator). The event is host-bus only — it does not
    // reach plugin code on its own, matching the one-way
    // semantics of the other host events.
    pluginEventBus.emit('editor:registered', { pluginId, extension: ext })
  }

  /**
   * Drop every editor this plugin has registered. Called from
   * the plugin store on uninstall so a removed plugin's
   * components don't linger in the map. We dispatch one
   * `editor:unregistered` event per removed extension so
   * subscribers can refresh the affected extension only.
   */
  unregister(pluginId: string): void {
    const removed: string[] = []
    for (const [ext, entry] of Array.from(this.byExtension.entries())) {
      if (entry.pluginId === pluginId) {
        this.byExtension.delete(ext)
        removed.push(ext)
      }
    }
    for (const ext of removed) {
      pluginEventBus.emit('editor:unregistered', { pluginId, extension: ext })
    }
  }

  /**
   * Look up the editor for an extension. Returns `null` when no
   * plugin owns the extension so the caller can fall through to
   * the built-in Markdown / code editor. The returned object
   * is the live registry entry — callers must not mutate it.
   */
  getEditorForExtension(extension: string): PluginEditorEntry | null {
    return this.byExtension.get(this.normaliseExtension(extension)) ?? null
  }

  /**
   * Read-only snapshot of every currently-registered extension.
   * Used by the diagnostics panel and the conflict detector.
   */
  getActivePluginExtensions(): Set<string> {
    return new Set(this.byExtension.keys())
  }

  /**
   * Normalise the extension to a leading-dot, lower-cased form
   * (e.g. `SMM` → `.smm`). Matches the SDK's stub and the
   * manifest documentation. The empty case is rejected by the
   * caller (`register`) before this is reached.
   */
  private normaliseExtension(extension: string): string {
    let ext = extension.trim().toLowerCase()
    if (!ext) return ext
    if (!ext.startsWith('.')) ext = `.${ext}`
    return ext
  }
}

/** Singleton host-side registry. Mirrors the per-plugin
 *  `pluginMenuRegistry` and `pluginCommandRegistry` singletons. */
export const pluginEditorRegistry = new PluginEditorRegistryImpl()

/** Convenience: register one editor. */
export function registerEditor(
  pluginId: string,
  extension: string,
  component: ComponentType<{
    content: string
    onChange: (content: string) => void
  }>,
): void {
  pluginEditorRegistry.register(pluginId, extension, component)
}

/** Convenience: drop every editor owned by a plugin. */
export function unregisterEditor(pluginId: string): void {
  pluginEditorRegistry.unregister(pluginId)
}

/** Convenience: look up an editor by extension. */
export function getEditorForExtension(
  extension: string,
): PluginEditorEntry | null {
  return pluginEditorRegistry.getEditorForExtension(extension)
}

/** Convenience: snapshot every active extension. */
export function getActivePluginExtensions(): Set<string> {
  return pluginEditorRegistry.getActivePluginExtensions()
}

/**
 * React hook: subscribe to live changes in the plugin editor
 * registry. The bus fires `editor:registered` /
 * `editor:unregistered` whenever a plugin's `onLoad` /
 * `onUnload` / `onEnable` / `onDisable` runs; consumers that
 * read this hook's return value re-render synchronously on
 * the same tick so a user who toggles a plugin sees the
 * file-tree right-click menu and any open `.smm` tab swap
 * to/from the shim without a manual reload.
 *
 * Why a dedicated hook instead of inlining the bus
 * subscription: a host-side listener must be tagged with
 * `__pluginId: 'host'` and self-grant the `events`
 * permission before `pluginEventBus.on(...)` will accept it.
 * Centralising that machinery here avoids a 30-line dance in
 * every consumer (FileTreeContextMenu, Editor, future
 * extension-aware panels) and removes a class of
 * regressions where one consumer's listener fails to
 * register because the grant was missed.
 */
export function usePluginEditors(): {
  /** Reactive snapshot of active plugin extensions. */
  extensions: Set<string>
  /** Reactive count of registry mutations; useful as a
   *  `key` suffix to force a remount when the editor
   *  identity itself changes. */
  revision: number
} {
  // We use a module-level counter so every consumer observes
  // the same revision (in a Zustand store every consumer
  // would each have their own subscription; the counter is
  // simpler and the registry mutates are infrequent).
  const [revision, force] = useState(0)
  useEffect(() => {
    let cancelled = false
    let off1: (() => void) | undefined
    let off2: (() => void) | undefined
    void Promise.all([
      import('@/lib/plugin-host'),
      import('@/lib/plugin-permission-guard'),
    ]).then(([{ pluginEventBus }, { setGranted }]) => {
      if (cancelled) return
      // Tag the handler as a host-internal listener and
      // grant the events permission in memory only. The
      // bus's `on(...)` requires both; missing either
      // throws `PluginPermissionDeniedError`.
      setGranted('host', ['events', 'editor', 'storage'])
      const bump = () => {
        if (!cancelled) force((r) => r + 1)
      }
      ;(bump as unknown as { __pluginId: string }).__pluginId = 'host'
      off1 = pluginEventBus.on('editor:registered', bump)
      off2 = pluginEventBus.on('editor:unregistered', bump)
    })
    return () => {
      cancelled = true
      off1?.()
      off2?.()
    }
  }, [])
  // Return a fresh Set on every render so React's
  // dependency comparison detects the change via the
  // revision counter. The Set itself is a new object
  // reference, so any `===` comparison on the returned
  // value picks up the mutation too.
  return {
    extensions: pluginEditorRegistry.getActivePluginExtensions(),
    revision,
  }
}
