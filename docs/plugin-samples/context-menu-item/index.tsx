/**
 * Context Menu Item — demonstrates registerContextMenu
 *
 * Concepts shown:
 *  - Register multiple items in onLoad, each with its own id
 *  - locations array: which surfaces the item appears on
 *  - when predicate: dynamically hide based on context
 *  - onClick: receives the resolved ContextMenuContext
 *  - Two layers of cleanup:
 *      1. Explicit unregister in onUnload (best practice)
 *      2. host's automatic clearPluginMenuItems(id) on unregister
 *
 * Note: lifecycle hooks are flat top-level fields on the manifest.
 * The host's plugin-loader copies them onto PluginDefinition.hooks.
 *
 * Plugin-internal pub/sub (e.g. menu onClick → panel refresh) uses
 * a small in-process bus below. The host bus is one-way.
 */
import { useEffect, useState } from 'react'
import type {
  PluginContext,
  PluginManifest,
  PluginLifecycleHook,
  PluginPanelProps,
} from '@swallow-note/plugin-sdk'
import {
  registerContextMenu,
  unregisterContextMenu,
  getStubMenuRegistry,
} from '@swallow-note/plugin-sdk'
import { usePluginStorage } from '@swallow-note/plugin-sdk'

// ─── Icon ─────────────────────────────────────────────────────────────────────

function MenuIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="8" />
      <line x1="12" y1="12" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12" y2="16" />
    </svg>
  )
}

// ─── Item registration (module-level, executed in onLoad) ─────────────────────

const PLUGIN_ID = 'com.example.context-menu-item'

// We use module-level state to track registrations so onUnload can
// reverse them without depending on a closure that captures the
// context object.
const REGISTERED_IDS = [
  'context-demo:copy-path',
  'context-demo:reveal',
  'context-demo:word-count',
  'context-demo:open-in-new-tab',
]

// Internal pub/sub so menu onClick handlers can wake up the panel.
// Keyed by item id; payload is whatever the click handler produced.
type InternalEvent = 'copied' | 'counted'
type InternalHandler = (event: InternalEvent, data: unknown) => void
const internalHandlers = new Set<InternalHandler>()
function emitInternal(event: InternalEvent, data: unknown): void {
  for (const h of internalHandlers) {
    try {
      h(event, data)
    } catch (err) {
      console.error('[context-menu] internal handler threw:', err)
    }
  }
}

function onLoad(ctx: PluginContext): void {
  // Item 1: copy path to clipboard
  registerContextMenu(ctx.pluginId, {
    id: 'context-demo:copy-path',
    label: 'Copy path to clipboard',
    iconName: 'Copy',
    locations: ['fileTree', 'tab'],
    onClick: async (mctx) => {
      if (!mctx.path) return
      try {
        await navigator.clipboard.writeText(mctx.path)
        emitInternal('copied', mctx.path)
      } catch (err) {
        console.error('clipboard write failed', err)
      }
    },
  })

  // Item 2: reveal in editor (open the file in a new tab)
  registerContextMenu(ctx.pluginId, {
    id: 'context-demo:reveal',
    label: 'Open in editor',
    iconName: 'ExternalLink',
    locations: ['fileTree', 'tab'],
    when: (mctx) => !!mctx.path && !mctx.isDirectory,
    onClick: (mctx) => {
      if (!mctx.path) return
      // We don't have a direct Tauri command to add a tab from the
      // host, so we just log. In a real plugin you'd expose a
      // `panel.invokeBackend` call to do this.
      console.log('reveal in editor:', mctx.path)
    },
  })

  // Item 3: word count of current selection (editor only)
  registerContextMenu(ctx.pluginId, {
    id: 'context-demo:word-count',
    label: 'Count words in selection',
    iconName: 'FileText',
    locations: ['editor'],
    when: (mctx) => !!mctx.selection && mctx.selection.length > 0,
    onClick: (mctx) => {
      if (!mctx.selection) return
      const words = mctx.selection.trim().split(/\s+/).filter(Boolean).length
      const chars = mctx.selection.length
      emitInternal('counted', { words, chars })
      console.log(`[${words} words / ${chars} chars]`)
    },
  })

  // Item 4: open path in new tab (only for files inside the workspace)
  registerContextMenu(ctx.pluginId, {
    id: 'context-demo:open-in-new-tab',
    label: 'Open in new tab',
    iconName: 'FilePlus',
    locations: ['fileTree'],
    when: (mctx) => !!mctx.path && !mctx.isDirectory,
    onClick: (mctx) => {
      console.log('open in new tab:', mctx.path)
    },
  })
}

const onUnload: PluginLifecycleHook = (ctx) => {
  for (const id of REGISTERED_IDS) {
    unregisterContextMenu(ctx.pluginId, id)
  }
}

// ─── Panel (mostly informational) ─────────────────────────────────────────────

function MainPanel(panel: PluginPanelProps) {
  const [lastCopied, setLastCopied] = usePluginStorage<string>(panel, 'lastCopiedPath', '')
  const [lastCount, setLastCount] = usePluginStorage<{ words: number; chars: number } | null>(
    panel,
    'lastWordCount',
    null
  )
  // Bump to force re-render when the host clears contributions.
  const [, setRefresh] = useState(0)

  useEffect(() => {
    const handler: InternalHandler = (event, data) => {
      if (event === 'copied') {
        const path = data as string
        setLastCopied(path)
      } else if (event === 'counted') {
        setLastCount(data as { words: number; chars: number })
      }
    }
    internalHandlers.add(handler)
    // Re-render whenever the host's menu registry changes – useful
    // for showing the "active items" count below.
    const interval = window.setInterval(() => setRefresh((n) => n + 1), 1000)
    return () => {
      internalHandlers.delete(handler)
      window.clearInterval(interval)
    }
  }, [setLastCopied, setLastCount])

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600 }}>Context Menu Demo</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        This plugin has no panel trigger in the sidebar – its surface is
        the right-click menu. Try right-clicking a file in the file tree
        or a tab.
      </p>
      <div style={{ fontSize: 11, padding: 8, background: 'var(--bg-secondary)', borderRadius: 4 }}>
        <div>Last copied path: {lastCopied || '(none)'}</div>
        <div>
          Last word count:{' '}
          {lastCount ? `${lastCount.words} words / ${lastCount.chars} chars` : '(none)'}
        </div>
        <div>Active items: {getStubMenuRegistry().getByLocation('fileTree').length}</div>
      </div>
    </div>
  )
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

const manifest: PluginManifest = {
  id: PLUGIN_ID,
  name: 'Context Menu Items',
  description: 'Contributes custom entries to file tree, tab, and editor right-click menus.',
  version: '0.1.0',
  author: 'SwallowNote',
  publishedAt: '2026-06-10',
  iconPosition: 'titleBar',
  contentPosition: 'leftPanel',
  order: 60,
  enabled: true,
  icon: MenuIcon,
  panel: MainPanel,
  onLoad,
  onUnload,

  // Contributing context menu items requires the `context-menu`
  // permission; without it the host would silently drop
  // `registerContextMenu` calls or render the items disabled.
  // `storage` is needed because the panel reads from / writes to
  // its own key/value namespace.
  permissions: ['context-menu', 'storage'],
}

export default manifest
