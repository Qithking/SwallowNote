/**
 * PluginPanelHost
 *
 * Wraps a plugin's panel component and dispatches the panel-level
 * lifecycle hooks (onMount, onUnmount, onActivate, onDeactivate).
 *
 * The host renders a `Suspense` boundary so plugins that lazy-load
 * their content don't make the surrounding UI flicker. The fallback
 * is intentionally null because plugin panels are responsible for
 * their own loading state.
 *
 * Hook dispatching:
 *  - onMount / onUnmount fire when the host component mounts or
 *    unmounts, keyed by `plugin.id`. This means React's
 *    mount → unmount → remount cycle (driven by `key` changes on the
 *    parent) translates to a clean onMount → onUnmount → onMount
 *    sequence, not a single long-lived mount.
 *  - onActivate / onDeactivate fire when `isActive` flips. A panel
 *    can be mounted but inactive (e.g. hidden by a tab), and the
 *    hook pair lets the plugin defer heavy work until the user
 *    actually looks at it.
 *
 * Both pairs run after React's commit phase, so a hook that does
 * `setState` won't trigger a re-render in the same tick.
 */
import { Suspense, useEffect, useRef, type ReactNode } from 'react'
import type { PluginDefinition, PluginPanelProps } from '@/types/plugin'
import { buildPluginContext, runLifecycleHook } from '@/lib/plugin-host'

export interface PluginPanelHostProps {
  plugin: PluginDefinition
  panel: PluginDefinition['panel']
  isActive: boolean
  panelProps: PluginPanelProps
}

export function PluginPanelHost({
  plugin,
  panel,
  isActive,
  panelProps,
}: PluginPanelHostProps): ReactNode {
  // Capture the previous isActive in a ref so the onActivate /
  // onDeactivate effect can detect transitions. Using a ref avoids
  // needing a second state variable that would itself trigger a
  // re-render.
  const wasActiveRef = useRef(isActive)

  // Mount / unmount. We depend only on plugin.id so React's key-based
  // remount naturally produces a fresh onMount → onUnmount cycle.
  // The cleanup is the only way to guarantee onUnmount runs even if
  // the host crashes mid-render.
  useEffect(() => {
    const ctx = buildPluginContext(plugin)
    void runLifecycleHook(plugin.hooks?.onMount, ctx)
    return () => {
      void runLifecycleHook(plugin.hooks?.onUnmount, ctx)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.id])

  // Activate / deactivate. We use a transition detector so a parent
  // that re-renders with the same isActive value does not re-fire
  // the hooks. The cleanup also runs when plugin.id changes, which
  // means switching from plugin A to plugin B emits A.onDeactivate
  // and B.onActivate in the right order.
  useEffect(() => {
    const ctx = buildPluginContext(plugin)
    if (isActive && !wasActiveRef.current) {
      void runLifecycleHook(plugin.hooks?.onActivate, ctx)
    } else if (!isActive && wasActiveRef.current) {
      void runLifecycleHook(plugin.hooks?.onDeactivate, ctx)
    }
    wasActiveRef.current = isActive
    return () => {
      // Final cleanup: if the host unmounts while active, fire
      // onDeactivate so the plugin can flush any pending state.
      if (wasActiveRef.current) {
        void runLifecycleHook(plugin.hooks?.onDeactivate, ctx)
        wasActiveRef.current = false
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.id, isActive])

  if (typeof panel === 'function') {
    const PanelComp = panel as unknown as React.ComponentType<typeof panelProps>
    return <Suspense fallback={null}><PanelComp {...panelProps} /></Suspense>
  }
  return <Suspense fallback={null}>{panel}</Suspense>
}
