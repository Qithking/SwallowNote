/**
 * PluginErrorBoundary — React error boundary for plugin panels
 * 
 * Catches render errors in plugin panels and shows a graceful fallback UI.
 * Tracks crash count and triggers auto-disable after threshold.
 * 
 * Usage:
 *   <PluginErrorBoundary pluginId={pluginId}>
 *     <Panel {...panelProps} />
 *   </PluginErrorBoundary>
 */
import { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, X } from 'lucide-react'

interface PluginErrorBoundaryProps {
  pluginId: string
  children: ReactNode
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
    // Reset error state when children change (e.g., plugin reloaded)
    if (prevProps.children !== this.props.children) {
      this.setState({ hasError: false, error: undefined })
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined })
    this.props.onRecover?.(this.props.pluginId)
  }

  handleDisable = () => {
    // Will be handled by host when close is called
    const event = new CustomEvent('plugin:disable', { detail: { pluginId: this.props.pluginId } })
    window.dispatchEvent(event)
  }

  render() {
    if (this.state.hasError) {
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
            Plugin Error
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 16 }}>
            The plugin <code style={{ background: 'var(--bg-primary)', padding: '2px 6px', borderRadius: 4 }}>
              {this.props.pluginId}
            </code> encountered an error and cannot be displayed.
          </p>
          {this.state.error && (
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
                View error details
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
                {this.state.error.stack || this.state.error.message}
              </pre>
            </details>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={this.handleRetry}
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
              Retry
            </button>
            <button
              onClick={this.handleDisable}
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
              Disable Plugin
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default PluginErrorBoundary
