/**
 * PanelContent — extracted from App.tsx so that App no longer subscribes
 * to the `tabs` array.  Previously, App held `const tabs = useEditorStore(
 * (s) => s.tabs)` and passed `activeTab?.content` / `activeTab?.path` into
 * plugin panel rendering.  Because `updateTabContent` creates a new `tabs`
 * reference on every (debounced) content change, App re-rendered the entire
 * component tree on every keystroke — cascading to TitleBar, ActivityBar,
 * Sidebar, TabBar, EditorToolbar, none of which are wrapped in `memo()`.
 *
 * By moving the content-dependent rendering into these standalone components,
 * each component subscribes to only the editor-store fields it needs.
 * App itself now subscribes only to a `hasTabs` boolean, so it no longer
 * re-renders during editing.
 *
 * Key optimisation: content / path subscriptions are split into child
 * components so that built-in panels (AI, Directory, History, EditorSettings)
 * don't re-render when the user types — only plugin panels and the note-
 * properties panel subscribe to the fields they actually need.
 */
import { Suspense, lazy } from 'react'
import { useUIStore, useEditorStore, usePluginStore } from '@/stores'
import { NotePropertiesPanel } from '@/components/NoteProperties/NotePropertiesPanel'
import { PluginPanelHost } from '@/components/Plugin/PluginPanelHost'
import {
  isPluginRightPanelType,
  extractPluginId,
  pluginRightPanelType,
  createPluginPanelProps,
} from '@/lib/plugin-utils'
import type { PluginDefinition } from '@/types/plugin'

const AIView = lazy(() => import('@/components/AI/AIView').then(m => ({ default: m.AIView })))
const DirectoryView = lazy(() => import('@/components/Directory/DirectoryView').then(m => ({ default: m.DirectoryView })))
const HistoryView = lazy(() => import('@/components/History/HistoryView').then(m => ({ default: m.HistoryView })))
const EditorSettings = lazy(() => import('@/components/EditorSettings/EditorSettings').then(m => ({ default: m.EditorSettings })))

/**
 * Right panel content.  Only subscribes to `rightPanelType` — the decision
 * of which panel to show.  Content-heavy subscriptions are delegated to
 * child components so built-in panels don't re-render on every keystroke.
 */
export function RightPanelContent() {
  const rightPanelType = useUIStore((s) => s.rightPanelType)

  // --- Plugin right panel ---
  if (rightPanelType && isPluginRightPanelType(rightPanelType)) {
    return <PluginRightPanelContent rightPanelType={rightPanelType} />
  }

  // --- Built-in right panels ---
  switch (rightPanelType) {
    case 'ai':
      return <Suspense fallback={null}><AIView /></Suspense>
    case 'directory':
      return <Suspense fallback={null}><DirectoryView /></Suspense>
    case 'history':
      return <Suspense fallback={null}><HistoryView visible={true} /></Suspense>
    case 'editorSettings':
      return <Suspense fallback={null}><EditorSettings /></Suspense>
    case 'noteProperties':
      return <NotePropertiesRightPanel />
    default:
      return null
  }
}

/**
 * Plugin right panel.  Subscribes to `plugins` and the active tab's
 * content / path — re-renders only when those change.
 */
function PluginRightPanelContent({ rightPanelType }: { rightPanelType: string }) {
  const allPlugins = usePluginStore((s) => s.plugins)

  // String selectors use Object.is — only trigger a re-render when the
  // actual value changes, not when the `tabs` array reference changes.
  const activeTabContent = useEditorStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.content ?? '',
  )
  const activeTabPath = useEditorStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.path ?? '',
  )

  const pluginId = extractPluginId(rightPanelType)
  const plugin = allPlugins.find((p) => p.id === pluginId)
  if (!plugin) return null

  const panel = plugin.panel
  const isActive = rightPanelType === pluginRightPanelType(plugin.id)
  const panelProps = createPluginPanelProps(
    plugin.id,
    isActive,
    () => {
      // Symmetric close path: hide the right panel and clear the
      // active plugin id, matching the ActivityBar/TitleBar close paths.
      useUIStore.getState().setRightPanelType(null)
      usePluginStore.getState().setActivePlugin(null, 'rightPanel')
    },
    activeTabContent,
    activeTabPath,
  )

  return (
    <PluginPanelHost
      key={plugin.id}
      plugin={plugin}
      panel={panel}
      isActive={isActive}
      panelProps={panelProps}
    />
  )
}

/**
 * Note-properties right panel.  Subscribes to `activeTabId` and the active
 * tab's `frontmatter`.  Because `updateTabContent` spreads the old tab
 * (`{ ...t, content, ... }`), the `frontmatter` reference is preserved
 * across content updates — Zustand's Object.is comparison sees the same
 * reference and skips the re-render.
 */
function NotePropertiesRightPanel() {
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const activeTabFrontmatter = useEditorStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.frontmatter,
  )

  if (!activeTabId) return null
  return (
    <NotePropertiesPanel
      tabId={activeTabId}
      frontmatter={activeTabFrontmatter || {}}
    />
  )
}

/**
 * Full-panel / editor-area plugin content.  Receives the resolved plugin
 * definition as a prop (App computes it from sidebar/settings state) but
 * subscribes to the active tab's content / path itself.
 */
export function FullPanelPluginContent({
  plugin,
}: {
  plugin: PluginDefinition
}) {
  const activeTabContent = useEditorStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.content ?? '',
  )
  const activeTabPath = useEditorStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.path ?? '',
  )

  const panel = plugin.panel
  const panelProps = createPluginPanelProps(
    plugin.id,
    true,
    () => {
      useUIStore.getState().setSettingsPanelVisible(false)
      useUIStore.getState().setSidebarView('explorer')
      usePluginStore.getState().setActivePlugin(null, 'fullPanel')
    },
    activeTabContent,
    activeTabPath,
  )

  return (
    <PluginPanelHost
      key={plugin.id}
      plugin={plugin}
      panel={panel}
      isActive={true}
      panelProps={panelProps}
    />
  )
}
