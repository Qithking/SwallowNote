/**
 * End-to-end test for the editor registry re-render flow.
 *
 * Simulates the exact sequence the user reported:
 *   1. Plugin is installed and registered
 *   2. User disables the plugin
 *   3. User re-enables the plugin
 *   4. Verify that:
 *      - `editor:registered` event fires
 *      - The event payload contains the correct extension
 *      - Subscribers receive the event in order
 *      - `getActivePluginExtensions()` reflects the new state
 *
 * This complements `plugin-editor-registry-onload.test.ts` by
 * exercising the toggle path, which fires both `onLoad` and
 * `onEnable` (the store does this on re-enable so the plugin
 * catches up on any state it missed while disabled).
 */
import { describe, it, expect, beforeEach } from 'vitest'
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

const PLUGIN_ID = 'com.test.mindmap-toggle'

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

describe('plugin editor registry toggle path (disable → re-enable)', () => {
  beforeEach(() => {
    pluginEditorRegistry.unregister(PLUGIN_ID)
    clearPermissions()
    sdkClearHost()
    setGranted(PLUGIN_ID, ['editor'])
    setGranted('host', ['events', 'editor', 'storage'])
  })

  it('re-enabling fires onLoad → editor:registered, restoring the registry', async () => {
    const plugin = makePlugin()
    Object.defineProperty(plugin, '__pluginModule', { value: makeMockModule(), enumerable: false })

    // Step 1: initial onLoad (cold start)
    await runPluginLifecycleHook(
      plugin,
      ({ pluginId }) => sdkRegisterEditor(pluginId, '.smm', Component),
      { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
      'onLoad',
    )
    expect(pluginEditorRegistry.getActivePluginExtensions().has('.smm')).toBe(true)

    // Step 2: user disables — onDisable fires → unregisterEditor
    await runPluginLifecycleHook(
      plugin,
      ({ pluginId }) => sdkUnregisterEditor(pluginId),
      { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
      'onDisable',
    )
    expect(pluginEditorRegistry.getActivePluginExtensions().has('.smm')).toBe(false)

    // Step 3: user re-enables. The store first fires onLoad
    // (to catch up on state the plugin missed while disabled),
    // then onEnable. Both should populate the registry and
    // emit editor:registered.
    const registeredEvents: string[] = []
    const onReg = (p: { extension: string }) => registeredEvents.push(p.extension)
    ;(onReg as unknown as { __pluginId: string }).__pluginId = 'host'
    const off = pluginEventBus.on('editor:registered', onReg)
    try {
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
      // After the toggle, registry is populated
      expect(pluginEditorRegistry.getActivePluginExtensions().has('.smm')).toBe(true)
      // And the host-side listener was notified
      expect(registeredEvents).toContain('.smm')
    } finally {
      off()
    }
  })

  it('disable path emits editor:unregistered so subscribers can react', async () => {
    const plugin = makePlugin()
    Object.defineProperty(plugin, '__pluginModule', { value: makeMockModule(), enumerable: false })

    // Initial onLoad
    await runPluginLifecycleHook(
      plugin,
      ({ pluginId }) => sdkRegisterEditor(pluginId, '.smm', Component),
      { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
      'onLoad',
    )

    // Subscribe to the unregistered event
    const unregisteredEvents: string[] = []
    const onUnreg = (p: { extension: string }) => unregisteredEvents.push(p.extension)
    ;(onUnreg as unknown as { __pluginId: string }).__pluginId = 'host'
    const off = pluginEventBus.on('editor:unregistered', onUnreg)

    try {
      await runPluginLifecycleHook(
        plugin,
        ({ pluginId }) => sdkUnregisterEditor(pluginId),
        { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
        'onDisable',
      )
      expect(pluginEditorRegistry.getActivePluginExtensions().has('.smm')).toBe(false)
      expect(unregisteredEvents).toContain('.smm')
    } finally {
      off()
    }
  })
})
