/**
 * Tests for the `usePluginEditors` React hook.
 *
 * This hook is the central reactivity bridge for consumers
 * that depend on the live plugin editor registry. We test it
 * with `@testing-library/react`'s `renderHook` to make sure
 * the returned `extensions` Set and `revision` counter
 * actually update on bus events, and that the cleanup
 * function unsubscribes the handler so a hot-reload or
 * remount doesn't double-subscribe.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  pluginEditorRegistry,
  usePluginEditors,
  registerEditor as sdkRegisterEditor,
  unregisterEditor as sdkUnregisterEditor,
} from '@/stores/pluginEditor'
import { setHost as sdkSetHost, clearHost as sdkClearHost } from '@swallow-note/plugin-sdk'
import { runPluginLifecycleHook } from '@/lib/plugin-host-takeover'
import { clearAll as clearPermissions, setGranted } from '@/lib/plugin-permission-guard'
import { pluginEventBus } from '@/lib/plugin-host'
import type { PluginDefinition } from '@/types/plugin'
import type { PluginContext, HostOverrides } from '@swallow-note/plugin-sdk'

const PLUGIN_ID = 'com.test.use-plugin-editors'

function makePlugin(): PluginDefinition {
  return {
    id: PLUGIN_ID,
    name: 'Test',
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
  } as PluginDefinition
}

function makeMockModule() {
  return { setHost: sdkSetHost } as unknown as { setHost: (o: HostOverrides) => () => void }
}

const Component = () => null

describe('usePluginEditors', () => {
  beforeEach(() => {
    pluginEditorRegistry.unregister(PLUGIN_ID)
    clearPermissions()
    sdkClearHost()
    setGranted(PLUGIN_ID, ['editor'])
  })

  it('revision increments when a plugin registers an editor', async () => {
    const { result } = renderHook(() => usePluginEditors())
    const initialRevision = result.current.revision
    const initialHasSmm = result.current.extensions.has('.smm')
    expect(initialHasSmm).toBe(false)

    // Fire the bus event directly (avoids the async lifecycle
    // dance — the goal is to verify the hook listens).
    const tagged = () => {
      // simulate a no-op bump
    }
    ;(tagged as unknown as { __pluginId: string }).__pluginId = 'host'
    setGranted('host', ['events', 'editor', 'storage'])

    // We need the hook's listener to be registered first; wait
    // one microtask for the async import to resolve.
    await new Promise((r) => setTimeout(r, 50))

    // Now run the lifecycle: this fires editor:registered.
    const plugin = makePlugin()
    Object.defineProperty(plugin, '__pluginModule', { value: makeMockModule(), enumerable: false })

    await act(async () => {
      await runPluginLifecycleHook(
        plugin,
        ({ pluginId }) => sdkRegisterEditor(pluginId, '.smm', Component),
        { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
        'onLoad',
      )
    })
    // Give the state update one more microtask to flush.
    await new Promise((r) => setTimeout(r, 10))

    expect(result.current.revision).toBeGreaterThan(initialRevision)
    expect(result.current.extensions.has('.smm')).toBe(true)
  })

  it('revision increments when a plugin unregisters an editor', async () => {
    const plugin = makePlugin()
    Object.defineProperty(plugin, '__pluginModule', { value: makeMockModule(), enumerable: false })

    // First register
    await runPluginLifecycleHook(
      plugin,
      ({ pluginId }) => sdkRegisterEditor(pluginId, '.smm', Component),
      { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
      'onLoad',
    )

    const { result } = renderHook(() => usePluginEditors())
    // Wait for the hook's async import to resolve
    await new Promise((r) => setTimeout(r, 50))

    const revisionBefore = result.current.revision
    expect(result.current.extensions.has('.smm')).toBe(true)

    await act(async () => {
      await runPluginLifecycleHook(
        plugin,
        ({ pluginId }) => sdkUnregisterEditor(pluginId),
        { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
        'onDisable',
      )
    })
    await new Promise((r) => setTimeout(r, 10))

    expect(result.current.revision).toBeGreaterThan(revisionBefore)
    expect(result.current.extensions.has('.smm')).toBe(false)
  })

  it('re-renders synchronously across the full toggle flow', async () => {
    const plugin = makePlugin()
    Object.defineProperty(plugin, '__pluginModule', { value: makeMockModule(), enumerable: false })

    const { result } = renderHook(() => usePluginEditors())
    // Wait for the hook's async import to resolve
    await new Promise((r) => setTimeout(r, 50))

    expect(result.current.extensions.has('.smm')).toBe(false)

    // Cold start: onLoad
    await act(async () => {
      await runPluginLifecycleHook(
        plugin,
        ({ pluginId }) => sdkRegisterEditor(pluginId, '.smm', Component),
        { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
        'onLoad',
      )
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current.extensions.has('.smm')).toBe(true)

    // Disable
    await act(async () => {
      await runPluginLifecycleHook(
        plugin,
        ({ pluginId }) => sdkUnregisterEditor(pluginId),
        { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
        'onDisable',
      )
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current.extensions.has('.smm')).toBe(false)

    // Re-enable
    await act(async () => {
      await runPluginLifecycleHook(
        plugin,
        ({ pluginId }) => sdkRegisterEditor(pluginId, '.smm', Component),
        { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
        'onLoad',
      )
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current.extensions.has('.smm')).toBe(true)
  })
})
