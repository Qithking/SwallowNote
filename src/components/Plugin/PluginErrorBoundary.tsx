/**
 * PluginErrorBoundary — Error boundary for plugin cards and panels.
 *
 * Catches rendering errors in individual plugin components and displays
 * a fallback UI instead of crashing the entire plugin manager.
 *
 * Supports:
 *  - `resetKey`: When this value changes, the boundary automatically
 *    resets from the error state (e.g. when a plugin is re-enabled).
 *  - `onCrash`: Called with the pluginId and error when a crash is
 *    caught, used by the health monitor for crash counting.
 *  - `onRecover`: Called with the pluginId when the user clicks
 *    "Retry" or the boundary resets via `resetKey`.
 */
import { Component, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'

interface Props {
  children: ReactNode
  pluginId: string
  pluginName?: string
  /** When this value changes, the boundary resets from error state. */
  resetKey?: string
  /** Called when a rendering error is caught. */
  onCrash?: (pluginId: string, error: Error) => void
  /** Called when the boundary recovers from an error (retry or resetKey change). */
  onRecover?: (pluginId: string) => void
  onReset?: () => void
  /** Fallback UI variant: 'toolbar' shows a compact icon, 'card' (default) shows the full card */
  variant?: 'toolbar' | 'card'
}

interface State {
  hasError: boolean
  error?: Error
}

export class PluginErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`Plugin error [${this.props.pluginId}]:`, error, errorInfo)
    this.props.onCrash?.(this.props.pluginId, error)
  }

  componentDidUpdate(prevProps: Props) {
    // Reset the error state when resetKey changes (e.g. plugin re-enabled)
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: undefined })
      this.props.onRecover?.(this.props.pluginId)
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined })
    this.props.onRecover?.(this.props.pluginId)
    this.props.onReset?.()
  }

  render() {
    if (this.state.hasError) {
      const isToolbar = this.props.variant === 'toolbar'
      const errMsg = this.state.error?.message || String(this.state.error || '')

      if (isToolbar) {
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={this.handleReset}
                className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                style={{ color: 'var(--pa-negative)' }}
              >
                <AlertCircle size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent style={{ maxWidth: 260 }}>
              <div style={{ fontSize: 11, wordBreak: 'break-all' }}>
                {this.props.pluginName || this.props.pluginId}: {errMsg}
              </div>
            </TooltipContent>
          </Tooltip>
        )
      }

      return (
        <div
          className="pa-market-card"
          style={{
            border: '1px solid var(--pa-negative)',
            background: 'var(--pa-paper)',
            padding: 16,
            borderRadius: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <AlertCircle size={16} style={{ color: 'var(--pa-negative)' }} />
            <span style={{ fontWeight: 500, color: 'var(--pa-ink)' }}>
              {this.props.pluginName || this.props.pluginId}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--pa-mute)', marginBottom: 4 }}>
            插件渲染出错
          </div>
          <div style={{ fontSize: 11, color: 'var(--pa-mute)', marginBottom: 12, wordBreak: 'break-all' }}>
            {errMsg}
          </div>
          <button
            type="button"
            onClick={this.handleReset}
            style={{
              fontSize: 12,
              padding: '4px 12px',
              border: '1px solid var(--pa-line)',
              background: 'var(--pa-paper-2)',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
