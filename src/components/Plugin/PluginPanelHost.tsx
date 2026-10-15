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
 * Permission gate: before mounting the panel we check the in-memory
 * permission guard. A plugin whose declared permissions are not all
 * granted gets a guidance card instead of its panel — mounting the
 * panel would make it call events/storage APIs that hard-throw
 * PluginPermissionDeniedError and crash into the error boundary.
 * The gate subscribes to permission changes so the panel mounts
 * immediately after the user grants in the dialog. Gated plugins
 * also skip the lifecycle hooks below (they live in the inner
 * component which only mounts once permissions are complete).
 *
 * Hook dispatching (inner component):
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
 *
 * Stability:
 *  - Wrapped in PluginErrorBoundary to catch render errors
 *  - Connected to health monitor for crash tracking and auto-disable
 */
import { Suspense, useEffect, useSyncExternalStore, useRef, useState, type ReactNode } from 'react'
import type { PluginDefinition, PluginPanelProps, PluginPermissionStatus } from '@/types/plugin'
import { buildPluginContext } from '@/lib/plugin-host'
import { runPluginLifecycleHook } from '@/lib/plugin-host-takeover'
import {
  hasPermission,
  subscribePermissionChanges,
  getPermissionsVersion,
} from '@/lib/plugin-permission-guard'
import { PluginErrorBoundary } from './PluginErrorBoundary'
import { recordPluginCrash, resetPluginCrashCount } from '@/lib/plugin-health'
import { getPluginPermissions } from '@/lib/plugin-permissions'
import { PluginPermissionGateCard } from './PluginPermissionGateCard'
import { PluginPermissionDialog } from './PluginPermissionDialog'

export interface PluginPanelHostProps {
  plugin: PluginDefinition
  panel: PluginDefinition['panel']
  isActive: boolean
  panelProps: PluginPanelProps
}

export function PluginPanelHost(props: PluginPanelHostProps): ReactNode {
  const { plugin } = props
  // 订阅授权集变化：授权/撤销后立即重算门控结果
  useSyncExternalStore(subscribePermissionChanges, getPermissionsVersion)
  const declared = plugin.permissions ?? []
  const missing = declared.filter((p) => !hasPermission(plugin.id, p))
  if (missing.length > 0) {
    return (
      <PluginPermissionGateCard
        pluginId={plugin.id}
        pluginName={plugin.name}
        missing={missing}
        requested={declared}
      />
    )
  }
  return <GrantedPluginPanelHost {...props} />
}

function GrantedPluginPanelHost({
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
    void runPluginLifecycleHook(plugin, plugin.hooks?.onMount, ctx, 'onMount')
    return () => {
      void runPluginLifecycleHook(plugin, plugin.hooks?.onUnmount, ctx, 'onUnmount')
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
      void runPluginLifecycleHook(plugin, plugin.hooks?.onActivate, ctx, 'onActivate')
    } else if (!isActive && wasActiveRef.current) {
      void runPluginLifecycleHook(plugin, plugin.hooks?.onDeactivate, ctx, 'onDeactivate')
    }
    wasActiveRef.current = isActive
    return () => {
      // Final cleanup: if the host unmounts while active, fire
      // onDeactivate so the plugin can flush any pending state.
      if (wasActiveRef.current) {
        void runPluginLifecycleHook(plugin, plugin.hooks?.onDeactivate, ctx, 'onDeactivate')
        wasActiveRef.current = false
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.id, isActive])

  const handleCrash = (pluginId: string, error: Error) => {
    recordPluginCrash(pluginId, error)
  }

  const handleRecover = (pluginId: string) => {
    resetPluginCrashCount(pluginId)
  }

  // ── 反应式权限弹窗（用户 c1d651a 逻辑） ──
  // 当 error boundary 捕获到 PluginPermissionDeniedError 时，
  // 用户可点击"授权"打开权限对话框，授权后 resetKey bump 触发面板重挂
  const [showPermDialog, setShowPermDialog] = useState(false)
  const [permStatus, setPermStatus] = useState<PluginPermissionStatus[]>([])
  const [permNonce, setPermNonce] = useState(0)

  const handleRequestPermission = (_pluginId: string) => {
    void getPluginPermissions(plugin.id).then((s) => {
      setPermStatus(s)
      setShowPermDialog(true)
    })
  }

  const handlePermDialogClose = () => {
    setShowPermDialog(false)
    // bump resetKey 使 error boundary 重置，面板以新权限重挂
    setPermNonce((n) => n + 1)
  }

  const errorBoundaryResetKey = `${plugin.id}-${permNonce}`

  if (typeof panel === 'function') {
    const PanelComp = panel as unknown as React.ComponentType<typeof panelProps>
    return (
      <>
        <PluginErrorBoundary
          pluginId={plugin.id}
          resetKey={errorBoundaryResetKey}
          onCrash={handleCrash}
          onRecover={handleRecover}
          onRequestPermission={handleRequestPermission}
        >
          <Suspense fallback={null}>
            <PanelComp {...panelProps} />
          </Suspense>
        </PluginErrorBoundary>
        {showPermDialog && (
          <PluginPermissionDialog
            pluginId={plugin.id}
            pluginName={plugin.name}
            permissions={plugin.permissions}
            currentStatus={permStatus}
            onClose={handlePermDialogClose}
          />
        )}
      </>
    )
  }
  return (
    <>
      <PluginErrorBoundary
        pluginId={plugin.id}
        resetKey={errorBoundaryResetKey}
        onCrash={handleCrash}
        onRecover={handleRecover}
        onRequestPermission={handleRequestPermission}
      >
        <Suspense fallback={null}>{panel}</Suspense>
      </PluginErrorBoundary>
      {showPermDialog && (
        <PluginPermissionDialog
          pluginId={plugin.id}
          pluginName={plugin.name}
          permissions={plugin.permissions}
          currentStatus={permStatus}
          onClose={handlePermDialogClose}
        />
      )}
    </>
  )
}
