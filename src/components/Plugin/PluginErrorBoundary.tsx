/**
 * PluginErrorBoundary — React error boundary for plugin panels
 *
 * Catches render errors in plugin panels and shows a graceful fallback UI.
 * Tracks crash count and triggers auto-disable after threshold.
 *
 * The error UI is a thin function component so we can use the
 * `useTranslation` hook from react-i18next directly. (Class components
 * can't use hooks; using `withTranslation` would force the consumer
 * to wrap the export, and we already have a single call site in
 * `PluginPanelHost`.)
 *
 * Usage:
 *   <PluginErrorBoundary pluginId={pluginId}>
 *     <Panel {...panelProps} />
 *   </PluginErrorBoundary>
 */
import { Component, ErrorInfo, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import { usePluginStore } from '@/stores'
import { togglePluginEnabled } from '@/lib/tauri'

interface PluginErrorBoundaryProps {
  pluginId: string
  children: ReactNode
  /**
   * Stable identity key for the current children. When this value
   * changes, the boundary treats it as "the plugin has been swapped"
   * and resets its error state. The host passes `plugin.id` here so
   * that the original `prevProps.children !== this.props.children`
   * bug — where any parent re-render created a new React element
   * reference and falsely tripped the reset — no longer happens.
   *
   * **Required for new code.** The fallback `children`-reference
   * comparison below is kept only for backwards compatibility with
   * any third-party callers that wrap the boundary without the new
   * `resetKey` prop; **new usages must pass `resetKey={plugin.id}`**
   * to avoid the loop the previous behaviour caused. The host
   * (`PluginPanelHost`) already does this in both render branches.
   *
   * Backwards compatible: if `resetKey` is omitted the boundary
   * falls back to comparing `children` (legacy behaviour — fragile).
   */
  resetKey?: string
  onCrash?: (pluginId: string, error: Error) => void
  onRecover?: (pluginId: string) => void
}

interface PluginErrorBoundaryState {
  hasError: boolean
  error?: Error
}

export class PluginErrorBoundary extends Component<PluginErrorBoundaryProps, PluginErrorBoundaryState> {
  constructor(props: PluginErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(_error: Error): PluginErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[plugin-error] Panel crash for ${this.props.pluginId}:`, error, errorInfo)

    // Notify host of the crash
    this.props.onCrash?.(this.props.pluginId, error)
  }

  componentDidUpdate(prevProps: PluginErrorBoundaryProps) {
    // Reset error state only when the *plugin identity* changes (via
    // `resetKey`) or, as a legacy fallback, when the host swaps
    // children by reference. Comparing `children` alone is too eager:
    // the host re-creates a `<PanelComp {...panelProps} />` element
    // on every render, so any parent re-render would silently clear
    // the error state and let a broken panel loop on crash → reset
    // → crash.
    const identityChanged =
      prevProps.resetKey !== undefined
        ? prevProps.resetKey !== this.props.resetKey
        : prevProps.children !== this.props.children
    if (identityChanged) {
      this.setState({ hasError: false, error: undefined })
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined })
    this.props.onRecover?.(this.props.pluginId)
  }

  handleDisable = () => {
    // Two effects to make the disable actually take hold:
    //   1. Frontend store: mark the plugin disabled in the Zustand
    //      store so the UI updates immediately and `onDisable`
    //      lifecycle hook fires.
    //   2. Backend: write the `.disabled` marker on disk via the
    //      Tauri IPC, so the change survives a restart.
    //
    // We also keep the legacy `plugin:disable` window event so the
    // health monitor (Phase 8.6 D17) can still clear its crash
    // counter if it ever receives the event.
    const { pluginId } = this.props
    try {
      usePluginStore.getState().setPluginEnabled(pluginId, false)
    } catch (err) {
      console.error(`[plugin-error] Failed to disable plugin "${pluginId}" in store:`, err)
    }
    try {
      void togglePluginEnabled(pluginId, false)
    } catch (err) {
      console.error(`[plugin-error] Failed to persist disable for plugin "${pluginId}":`, err)
    }
    try {
      window.dispatchEvent(new CustomEvent('plugin:disable', { detail: { pluginId } }))
    } catch {
      /* SSR / non-browser — ignore */
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <PluginErrorFallback
          pluginId={this.props.pluginId}
          error={this.state.error}
          onRetry={this.handleRetry}
          onDisable={this.handleDisable}
        />
      )
    }

    return this.props.children
  }
}

/**
 * The visible fallback. Kept as a tiny function component so we can
 * use react-i18next's `useTranslation` hook. The error boundary
 * itself stays a class (React doesn't support hook-based error
 * boundaries yet).
 */
function PluginErrorFallback({
  pluginId,
  error,
  onRetry,
  onDisable,
}: {
  pluginId: string
  error?: Error
  onRetry: () => void
  onDisable: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        height: '100%',
        background: 'var(--bg-secondary, #f5f5f7)',
      }}
    >
      <AlertTriangle
        size={48}
        style={{ color: 'var(--danger-color, #f44336)', marginBottom: 16 }}
      />
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
        {t('plugin.error.title')}
      </h2>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 16 }}>
        {t('plugin.error.description', { id: pluginId })}
      </p>
      {error && (
        <details
          style={{
            background: 'var(--bg-primary, #fff)',
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
            width: '100%',
            maxWidth: 400,
          }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 500 }}>
            {t('plugin.error.viewDetails')}
          </summary>
          <pre
            style={{
              marginTop: 8,
              padding: 8,
              background: '#1a1a1a',
              color: '#e0e0e0',
              borderRadius: 4,
              fontSize: 12,
              overflowX: 'auto',
              maxHeight: 150,
              overflowY: 'auto',
            }}
          >
            {error.stack || error.message}
          </pre>
        </details>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onRetry}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            background: 'var(--bg-primary, #fff)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          <RefreshCw size={14} />
          {t('plugin.error.retry')}
        </button>
        <button
          onClick={onDisable}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            border: 'none',
            borderRadius: 6,
            background: 'var(--danger-color, #f44336)',
            color: 'white',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          <X size={14} />
          {t('plugin.error.disable')}
        </button>
      </div>
    </div>
  )
}

export default PluginErrorBoundary
