/**
 * Tests for the plugin editor registry: when a plugin manifest
 * declares `editorFileExtensions` + `editorComponent`, the SDK's
 * `registerEditor` (called from a lifecycle hook like `onLoad`)
 * must populate the host's `pluginEditorRegistry` so the file-
 * open dispatcher in `Editor.tsx` can find the editor.
 *
 * The bug this guards against: a plugin author writes
 *   editorFileExtensions: ['.smm'],
 *   editorComponent: MindMapView,
 * but forgets the lifecycle hook. The host's dispatcher then sees
 * an empty registry and falls through to the compatibility shim
 * ("please install the plugin" message) even though the plugin IS
 * installed. This regression bit `com.swallownote.mindmap` at one
 * point.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runPluginLifecycleHook } from '@/lib/plugin-host-takeover'
import {
  registerEditor as sdkRegisterEditor,
  unregisterEditor as sdkUnregisterEditor,
  getEditorForExtension as sdkGetEditorForExtension,
  setHost as sdkSetHost,
  clearHost as sdkClearHost,
  type HostOverrides,
  type PluginContext,
} from '@swallow-note/plugin-sdk'
import { pluginEditorRegistry } from '@/stores/pluginEditor'
import { clearAll as clearPermissions, setGranted } from '@/lib/plugin-permission-guard'
import { pluginEventBus } from '@/lib/plugin-host'
import type { PluginDefinition } from '@/types/plugin'

const PLUGIN_ID = 'com.test.mindmap-mock'

function makePlugin(overrides: Partial<PluginDefinition> = {}): PluginDefinition {
  return {
    id: PLUGIN_ID,
    name: 'Mock mindmap',
    description: '',
    version: '0.0.1',
    author: 'test',
    publishedAt: '2026-01-01',
    iconPosition: 'titleBar',
    contentPosition: 'fullPanel',
    order: 100,
    enabled: true,
    icon: () => null,
    panel: () => null,
    editorFileExtensions: ['.smm'],
    editorComponent: () => null,
    pluginPath: '/tmp/mock',
    hasBackend: false,
    permissions: ['editor'],
    ...overrides,
  } as PluginDefinition
}

/**
 * Build a `__pluginModule` object that re-exports the SDK's
 * `registerEditor` so the host takeover layer picks it up via
 * `mod?.setHost`. This is what a real plugin's Vite bundle would
 * expose after `export { setHost } from '@swallow-note/plugin-sdk'`.
 *
 * The mock forwards `setHost` to the real SDK `setHost` so the
 * hostOverrides stack is actually populated — otherwise the
 * SDK's `registerEditor` would fall through to the in-process
 * stub and the test would not exercise the host registry.
 */
function makeMockModule() {
  return { setHost: sdkSetHost } as unknown as { setHost: (o: HostOverrides) => () => void }
}

describe('plugin editor registry via onLoad hook', () => {
  beforeEach(() => {
    pluginEditorRegistry.unregister(PLUGIN_ID)
    clearPermissions()
    sdkClearHost()
    // Grant the `editor` permission so the registry's
    // defence-in-depth check passes.
    setGranted(PLUGIN_ID, ['editor'])
  })

  it('registerEditor called from onLoad populates the host registry', async () => {
    const plugin = makePlugin()
    const pluginModule = makeMockModule()
    Object.defineProperty(plugin, '__pluginModule', { value: pluginModule, enumerable: false })

    const onLoad = vi.fn(({ pluginId }: PluginContext) => {
      sdkRegisterEditor(pluginId, '.smm', () => null)
    })

    // Empty before the hook
    expect(pluginEditorRegistry.getEditorForExtension('.smm')).toBeNull()

    await runPluginLifecycleHook(plugin, onLoad, { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext, 'onLoad')

    // After the hook, the host's registry must have the editor
    const entry = pluginEditorRegistry.getEditorForExtension('.smm')
    expect(entry).not.toBeNull()
    expect(entry?.pluginId).toBe(PLUGIN_ID)
    expect(typeof entry?.component).toBe('function')

    // And the SDK's lookup should resolve to the same entry
    const sdkEntry = sdkGetEditorForExtension('.smm')
    expect(sdkEntry?.pluginId).toBe(PLUGIN_ID)
  })

  it('registerEditor called outside a lifecycle hook does NOT populate the host registry', async () => {
    // This documents why a plugin must wire its editor from onLoad.
    // Without the host takeover installed, `currentHostOverrides()`
    // is unset and the SDK's registerEditor falls through to its
    // own in-process stub — which `Editor.tsx` cannot see.
    sdkRegisterEditor(PLUGIN_ID, '.smm', () => null)
    // Stub path: the SDK has the entry in its own registry, but
    // the host's pluginEditorRegistry stays empty.
    expect(sdkGetEditorForExtension('.smm')?.pluginId).toBe(PLUGIN_ID)
    expect(pluginEditorRegistry.getEditorForExtension('.smm')).toBeNull()
  })

  it('onUnload unregisters the editor from the host registry', async () => {
    const plugin = makePlugin()
    const pluginModule = makeMockModule()
    Object.defineProperty(plugin, '__pluginModule', { value: pluginModule, enumerable: false })

    await runPluginLifecycleHook(
      plugin,
      ({ pluginId }) => sdkRegisterEditor(pluginId, '.smm', () => null),
      { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
      'onLoad',
    )
    expect(pluginEditorRegistry.getEditorForExtension('.smm')).not.toBeNull()

    await runPluginLifecycleHook(
      plugin,
      ({ pluginId }) => sdkUnregisterEditor(pluginId),
      { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
      'onUnload',
    )
    expect(pluginEditorRegistry.getEditorForExtension('.smm')).toBeNull()
  })

  it('rejects registerEditor when the plugin lacks the `editor` permission', async () => {
    // Ensure the `editor` permission is NOT granted.
    setGranted(PLUGIN_ID, [])
    const plugin = makePlugin()
    const pluginModule = makeMockModule()
    Object.defineProperty(plugin, '__pluginModule', { value: pluginModule, enumerable: false })

    const onLoad = vi.fn(({ pluginId }: PluginContext) => {
      sdkRegisterEditor(pluginId, '.smm', () => null)
    })

    // The hook itself swallows errors (per SDK policy "lifecycle
    // is best-effort"), so we just verify the registry stays
    // empty afterwards.
    await runPluginLifecycleHook(plugin, onLoad, { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext, 'onLoad')
    expect(pluginEditorRegistry.getEditorForExtension('.smm')).toBeNull()
  })

  it('getActivePluginExtensions reflects the live registry state for the file-tree menu', async () => {
    // The file-tree right-click menu reads this set on every
    // render to decide whether to show the "new mind map" entry.
    // It must therefore:
    //   1. be empty before the plugin's onLoad has fired
    //   2. include `.smm` once the plugin has registered
    //   3. drop `.smm` once the plugin is unloaded
    //   4. emit `editor:registered` / `editor:unregistered` so the
    //      file-tree can re-render synchronously

    const registeredEvents: string[] = []
    const unregisteredEvents: string[] = []
    // Host-side listeners tag themselves with `__pluginId: 'host'`
    // and self-grant the `events` permission — mirror that here.
    setGranted('host', ['events', 'editor', 'storage'])
    const onReg = (p: { extension: string }) => registeredEvents.push(p.extension)
    ;(onReg as unknown as { __pluginId: string }).__pluginId = 'host'
    const onUnreg = (p: { extension: string }) => unregisteredEvents.push(p.extension)
    ;(onUnreg as unknown as { __pluginId: string }).__pluginId = 'host'
    const off1 = pluginEventBus.on('editor:registered', onReg)
    const off2 = pluginEventBus.on('editor:unregistered', onUnreg)

    try {
      const plugin = makePlugin()
      const pluginModule = makeMockModule()
      Object.defineProperty(plugin, '__pluginModule', { value: pluginModule, enumerable: false })

      // 1. Empty before onLoad
      expect(pluginEditorRegistry.getActivePluginExtensions().has('.smm')).toBe(false)

      // 2. After onLoad, .smm is registered and the event fired
      await runPluginLifecycleHook(
        plugin,
        ({ pluginId }) => sdkRegisterEditor(pluginId, '.smm', () => null),
        { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
        'onLoad',
      )
      expect(pluginEditorRegistry.getActivePluginExtensions().has('.smm')).toBe(true)
      expect(registeredEvents).toContain('.smm')

      // 3. After onUnload, .smm is gone and the event fired
      await runPluginLifecycleHook(
        plugin,
        ({ pluginId }) => sdkUnregisterEditor(pluginId),
        { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
        'onUnload',
      )
      expect(pluginEditorRegistry.getActivePluginExtensions().has('.smm')).toBe(false)
      expect(unregisteredEvents).toContain('.smm')
    } finally {
      off1()
      off2()
    }
  })
})
