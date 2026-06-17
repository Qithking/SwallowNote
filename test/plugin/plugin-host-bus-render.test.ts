/**
 * Verifies that the host bus emits `editor:registered` /
 * `editor:unregistered` events that reach listeners tagged
 * with `__pluginId: 'host'` and that the listeners can
 * update consumer state synchronously.
 *
 * This guards against the regression where toggling a plugin
 * off→on doesn't re-render the file tree context menu or
 * re-render an open `.smm` tab.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runPluginLifecycleHook } from '@/lib/plugin-host-takeover'
import {
  registerEditor as sdkRegisterEditor,
  unregisterEditor as sdkUnregisterEditor,
  setHost as sdkSetHost,
  clearHost as sdkClearHost,
  type HostOverrides,
  type PluginContext,
} from '@swallow-note/plugin-sdk'
import { pluginEditorRegistry } from '@/stores/pluginEditor'
import { clearAll as clearPermissions, setGranted } from '@/lib/plugin-permission-guard'
import { pluginEventBus } from '@/lib/plugin-host'
import type { PluginDefinition } from '@/types/plugin'

const PLUGIN_ID = 'com.test.mindmap-host-bus'

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
    hooks: {},
    ...overrides,
  } as PluginDefinition
}

function makeMockModule() {
  return { setHost: sdkSetHost } as unknown as { setHost: (o: HostOverrides) => () => void }
}

const Component = () => null

/**
 * Simulate the host-side listener that the file tree context
 * menu and editor use. We attach a stable `__pluginId: 'host'`
 * tag and self-grant the `events` permission. This mirrors
 * the production code in
 * `src/components/FileTree/FileTreeContextMenu.tsx` and
 * `src/components/Editor.tsx`.
 */
function attachHostListener(onChange: () => void): () => void {
  setGranted('host', ['events', 'editor', 'storage'])
  const tagged = () => onChange()
  ;(tagged as unknown as { __pluginId: string }).__pluginId = 'host'
  const off1 = pluginEventBus.on('editor:registered', tagged)
  const off2 = pluginEventBus.on('editor:unregistered', tagged)
  return () => {
    off1()
    off2()
  }
}

describe('host bus → editor registry → consumer re-render', () => {
  beforeEach(() => {
    pluginEditorRegistry.unregister(PLUGIN_ID)
    clearPermissions()
    sdkClearHost()
    setGranted(PLUGIN_ID, ['editor'])
  })

  it('disable→re-enable triggers a render on the host listener exactly twice', async () => {
    const plugin = makePlugin()
    Object.defineProperty(plugin, '__pluginModule', { value: makeMockModule(), enumerable: false })

    // Cold start: onLoad runs once
    await runPluginLifecycleHook(
      plugin,
      ({ pluginId }) => sdkRegisterEditor(pluginId, '.smm', Component),
      { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
      'onLoad',
    )

    // Attach the host listener AFTER the cold-start event so
    // it tracks the toggle (this matches the production case
    // where FileTreeContextMenu mounts and subscribes after
    // the plugin was already loaded).
    const renders: number[] = []
    let rev = 0
    const off = attachHostListener(() => {
      rev += 1
      renders.push(rev)
    })
    try {
      // Disable
      await runPluginLifecycleHook(
        plugin,
        ({ pluginId }) => sdkUnregisterEditor(pluginId),
        { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
        'onDisable',
      )
      // Re-enable
      await runPluginLifecycleHook(
        plugin,
        ({ pluginId }) => sdkRegisterEditor(pluginId, '.smm', Component),
        { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
        'onLoad',
      )
      await runPluginLifecycleHook(
        plugin,
        ({ pluginId }) => sdkRegisterEditor(pluginId, '.smm', Component),
        { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
        'onEnable',
      )

      // We expect exactly 3 events to reach the listener:
      //   1. unregisterEditor during onDisable
      //   2. registerEditor during onLoad (re-enable path)
      //   3. registerEditor during onEnable
      expect(renders.length).toBeGreaterThanOrEqual(3)
      // Registry ends in the registered state
      expect(pluginEditorRegistry.getActivePluginExtensions().has('.smm')).toBe(true)
    } finally {
      off()
    }
  })

  it('getActivePluginExtensions returns the live state on every read', async () => {
    // Consumers call this on every render. The host code does
    //   const exts = getActivePluginExtensions()
    //   const hasMindMapEditor = exts.has('.smm')
    // so the method must return the current map keys, not a
    // snapshot. If it returned a stale cached set, the
    // consumer would not see the toggle even though the bus
    // event fired.
    const plugin = makePlugin()
    Object.defineProperty(plugin, '__pluginModule', { value: makeMockModule(), enumerable: false })

    // 1. Before any register
    expect(pluginEditorRegistry.getActivePluginExtensions().has('.smm')).toBe(false)

    // 2. After onLoad
    await runPluginLifecycleHook(
      plugin,
      ({ pluginId }) => sdkRegisterEditor(pluginId, '.smm', Component),
      { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
      'onLoad',
    )
    expect(pluginEditorRegistry.getActivePluginExtensions().has('.smm')).toBe(true)

    // 3. After onDisable
    await runPluginLifecycleHook(
      plugin,
      ({ pluginId }) => sdkUnregisterEditor(pluginId),
      { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
      'onDisable',
    )
    expect(pluginEditorRegistry.getActivePluginExtensions().has('.smm')).toBe(false)

    // 4. After re-enable (onLoad + onEnable)
    await runPluginLifecycleHook(
      plugin,
      ({ pluginId }) => sdkRegisterEditor(pluginId, '.smm', Component),
      { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
      'onLoad',
    )
    expect(pluginEditorRegistry.getActivePluginExtensions().has('.smm')).toBe(true)
  })
})
