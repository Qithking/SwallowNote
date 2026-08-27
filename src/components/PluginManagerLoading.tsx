import { lazy } from 'react'

const PluginManagerView = lazy(() => import('@/components/Plugin/PluginManagerView').then(m => ({ default: m.PluginManagerView })))

export { PluginManagerView }

export function PluginManagerLoading() {
  return (
    <div className="flex-1 flex items-center justify-center" style={{ background: 'var(--bg-secondary)' }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    </div>
  )
}

let pluginManagerPreloaded = false
export function preloadPluginManager() {
  if (!pluginManagerPreloaded) {
    pluginManagerPreloaded = true
    void import('@/components/Plugin/PluginManagerView')
  }
}
