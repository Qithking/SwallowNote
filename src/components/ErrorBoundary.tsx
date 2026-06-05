/**
 * ErrorBoundary — React 错误边界组件
 * 防止子组件渲染崩溃时导致整个应用白屏
 *
 * 使用方式：
 *   <ErrorBoundary fallback={<div>编辑器加载失败，请重新打开文件</div>}>
 *     <MarkdownEditor />
 *   </ErrorBoundary>
 *
 *   // 或使用工厂函数快速包裹
 *   withErrorBoundary(<MarkdownEditor />, '编辑器加载失败')
 */
import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  /** 出错时展示的 fallback 内容。不传则使用默认样式。 */
  fallback?: ReactNode
  /** 出错时的回调，可用于上报错误 */
  onError?: (error: Error, info: { componentStack: string }) => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary] Caught error:', error, info)
    this.props.onError?.(error, info)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback
      }

      // 默认 fallback UI
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-muted)] p-6">
          <AlertTriangle size={32} className="text-yellow-500 opacity-70" />
          <p className="text-sm font-medium text-[var(--text-secondary)]">组件渲染出错</p>
          {this.state.error && (
            <p className="text-xs font-mono text-[var(--text-muted)] max-w-sm text-center truncate" title={this.state.error.message}>
              {this.state.error.message}
            </p>
          )}
          <button
            onClick={this.handleReset}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <RefreshCw size={12} />
            重试
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * 快速包裹工厂函数，适用于简单场景
 * @example
 *   {withErrorBoundary(<MarkdownEditor />, '编辑器加载失败，请重新打开文件')}
 */
export function withErrorBoundary(children: ReactNode, fallbackMessage?: string) {
  return (
    <ErrorBoundary fallback={
      fallbackMessage ? (
        <div className="flex items-center justify-center h-full text-sm text-[var(--text-muted)]">
          {fallbackMessage}
        </div>
      ) : undefined
    }>
      {children}
    </ErrorBoundary>
  )
}
