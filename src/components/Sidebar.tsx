/**
 * Sidebar Component - Left sidebar with view content
 * All panels are always mounted, visibility controlled by CSS display property
 * Now supports plugins with contentPosition === 'leftPanel'
 */
import { useShallow } from 'zustand/react/shallow'
import { FileTreeView } from './FileTree/FileTreeView'
import { SearchView } from './Search/SearchView'
import { GitView } from './Git/GitView'
import { SettingsView } from './Settings/SettingsView'
import { PluginPanelHost } from './Plugin/PluginPanelHost'
import { useUIStore, usePluginStore } from '@/stores'
import { createPluginPanelProps } from '@/lib/plugin-utils'

function Sidebar() {
  const sidebarView = useUIStore((s) => s.sidebarView)
  // useShallow compares the selector result structurally so we don't
  // re-render the whole Sidebar every time any plugin metadata changes.
  const leftPanelPlugins = usePluginStore(
    useShallow((s) => {
      const filtered = s.plugins.filter(
        (p) => p.contentPosition === 'leftPanel' && p.enabled
      )
      return [...filtered].sort(
        (a, b) => (a.order ?? 100) - (b.order ?? 100)
      )
    })
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto w-full scrollable-area relative">
        <div className={`absolute inset-0 ${sidebarView === 'explorer' ? '' : 'hidden'}`}>
          <FileTreeView />
        </div>
        <div className={`absolute inset-0 ${sidebarView === 'search' ? '' : 'hidden'}`}>
          <SearchView />
        </div>
        <div className={`absolute inset-0 ${sidebarView === 'git' ? '' : 'hidden'}`}>
          <GitView />
        </div>
        <div className={`absolute inset-0 ${sidebarView === 'settings' ? '' : 'hidden'}`}>
          <SettingsView />
        </div>

        {/* Plugin left-panel views. Only the active plugin's panel is
            actually mounted; the others are skipped entirely so React
            unmounts them and their useEffect cleanup runs. Previously
            all panels were rendered with `display: none`, which left
            stale state and skipped cleanups on plugin switch. The
            outer `key={plugin.id}` on the wrapping div keeps the DOM
            identity stable per plugin. The PluginPanelHost handles
            onMount/onUnmount/onActivate/onDeactivate lifecycle hooks. */}
        {leftPanelPlugins.map((plugin) => {
          const pluginViewId = `plugin:${plugin.id}`
          const isActive = sidebarView === pluginViewId
          if (!isActive) return null
          const panel = plugin.panel
          const panelProps = createPluginPanelProps(plugin.id, isActive, () => {
            // Clear the active plugin and reset sidebarView. The
            // cross-store coupling in setActivePlugin also resets
            // sidebarView, but we call it explicitly so the panel
            // component's "close" intent is symmetric with the
            // ActivityBar/TitleBar close paths.
            useUIStore.getState().setSidebarView('explorer')
            usePluginStore.getState().setActivePlugin(null, 'leftPanel')
          })
          return (
            <div key={plugin.id} className="absolute inset-0">
              <PluginPanelHost
                plugin={plugin}
                panel={panel}
                isActive={isActive}
                panelProps={panelProps}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { Sidebar }
