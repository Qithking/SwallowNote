/**
 * Integration test: simulate the user flow
 * 1. Open the app
 * 2. Plugin loads → onLoad → registerEditor
 * 3. User opens a .smm tab → Editor.tsx renders plugin editor
 * 4. User disables plugin → unregisterEditor → editor:unregistered
 * 5. Editor.tsx must re-render and show the shim
 * 6. User re-enables plugin → onLoad + onEnable → registerEditor
 * 7. Editor.tsx must re-render and show the plugin editor
 *
 * This test mirrors the production code path in
 * `src/components/Editor.tsx` (lines 295-339 + 453-496).
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
import {
  pluginEditorRegistry,
  getEditorForExtension,
} from '@/stores/pluginEditor'
import { clearAll as clearPermissions, setGranted } from '@/lib/plugin-permission-guard'
import { pluginEventBus } from '@/lib/plugin-host'
import type { PluginDefinition } from '@/types/plugin'

const PLUGIN_ID = 'com.test.mindmap-tab-flow'

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

const PluginComponent = () => null
const ShimComponent = () => null

describe('Editor.tsx tab toggle flow', () => {
  beforeEach(() => {
    pluginEditorRegistry.unregister(PLUGIN_ID)
    clearPermissions()
    sdkClearHost()
    setGranted(PLUGIN_ID, ['editor'])
  })

  it('on re-enable, the next getEditorForExtension returns the plugin component', async () => {
    const plugin = makePlugin()
    Object.defineProperty(plugin, '__pluginModule', { value: makeMockModule(), enumerable: false })

    // Step 1: cold start, plugin loads via onLoad
    await runPluginLifecycleHook(
      plugin,
      ({ pluginId }) => sdkRegisterEditor(pluginId, '.smm', PluginComponent),
      { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
      'onLoad',
    )

    // Editor.tsx dispatch (mirrors line 460-463):
    //   const PluginEditor = getEditorForExtension('.smm')?.component
    //   const Editor = PluginEditor || MindMapEditor
    let PluginEditor = getEditorForExtension('.smm')?.component
    let Editor: React.ComponentType | typeof ShimComponent = PluginEditor || ShimComponent
    expect(Editor).toBe(PluginComponent)

    // Step 2: subscribe to bus (mirrors lines 295-339)
    setGranted('host', ['events', 'editor', 'storage'])
    let editorRegistryRev = 0
    const onChange = () => { editorRegistryRev += 1 }
    const tagged = () => onChange()
    ;(tagged as unknown as { __pluginId: string }).__pluginId = 'host'
    const off1 = pluginEventBus.on('editor:registered', tagged)
    const off2 = pluginEventBus.on('editor:unregistered', tagged)

    try {
      // Step 3: user disables → onDisable → unregisterEditor
      await runPluginLifecycleHook(
        plugin,
        ({ pluginId }) => sdkUnregisterEditor(pluginId),
        { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
        'onDisable',
      )
      // Bus event fires, editorRegistryRev bumps
      expect(editorRegistryRev).toBeGreaterThan(0)

      // Editor.tsx re-renders, dispatch picks up shim
      PluginEditor = getEditorForExtension('.smm')?.component
      Editor = PluginEditor || ShimComponent
      expect(Editor).toBe(ShimComponent)

      // Step 4: user re-enables → onLoad + onEnable → registerEditor
      await runPluginLifecycleHook(
        plugin,
        ({ pluginId }) => sdkRegisterEditor(pluginId, '.smm', PluginComponent),
        { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
        'onLoad',
      )
      await runPluginLifecycleHook(
        plugin,
        ({ pluginId }) => sdkRegisterEditor(pluginId, '.smm', PluginComponent),
        { pluginId: PLUGIN_ID, pluginPath: '/tmp/mock' } as PluginContext,
        'onEnable',
      )

      // Bus event fires, editorRegistryRev bumps
      expect(editorRegistryRev).toBeGreaterThan(1)

      // Editor.tsx re-renders, dispatch picks up plugin
      PluginEditor = getEditorForExtension('.smm')?.component
      Editor = PluginEditor || ShimComponent
      expect(Editor).toBe(PluginComponent)
    } finally {
      off1()
      off2()
    }
  })
})
