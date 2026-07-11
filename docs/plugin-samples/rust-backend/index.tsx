/**
 * Rust Backend — 调用 Rust 后端子进程
 *
 * 展示：
 *  - panel.invokeBackend<T>(command, args) —— 调用后端 JSON-RPC 命令
 *  - 后端通过 stdin/stdout JSON-RPC 2.0 与宿主通信
 *  - 错误处理：try/catch 捕获后端返回的 JSON-RPC error
 *  - 30s 超时：单次调用超过 30 秒宿主会拒绝并抛错
 *
 * 后端命令（见 backend/src/main.rs）：
 *  - count_words({ text }) —— 统计单词数，返回 number
 *  - parse_json({ data }) —— 解析 JSON 字符串，返回解析后的对象
 *
 * 注意：独立预览模式（npm run dev）下无宿主，invokeBackend 返回 null；
 * 真实调用需在宿主中加载本插件并编译 Rust 后端二进制。
 */
import { useState } from 'react'
import type { PluginManifest, PluginPanelProps } from '@swallow-note/plugin-sdk'
// 重新导出 setHost，让宿主在触发生命周期钩子前注入真实实现
export { setHost } from '@swallow-note/plugin-sdk'

// ─── 侧边栏图标 ───────────────────────────────────────────────────────────────

function BackendIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  )
}

// ─── 结果展示类型 ─────────────────────────────────────────────────────────────

interface CallResult {
  command: string
  status: 'success' | 'error'
  data: unknown
  at: string
}

// ─── 面板 ──────────────────────────────────────────────────────────────────────

function BackendPanel(panel: PluginPanelProps) {
  const [result, setResult] = useState<CallResult | null>(null)
  const [loading, setLoading] = useState(false)

  // 通用调用封装：try/catch 捕获后端错误，统一写入 result 展示
  const runCall = async (
    command: string,
    args: Record<string, unknown>,
    label: string
  ): Promise<void> => {
    setLoading(true)
    try {
      const data = await panel.invokeBackend(command, args)
      setResult({ command: label, status: 'success', data, at: new Date().toISOString() })
    } catch (err) {
      // 宿主把 JSON-RPC error.message 转成字符串抛出
      setResult({
        command: label,
        status: 'error',
        data: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      })
    } finally {
      setLoading(false)
    }
  }

  // Count Words：统计单词数，返回 number
  const handleCountWords = () => {
    void runCall('count_words', { text: 'hello world from rust' }, 'count_words')
  }

  // Parse JSON：解析 JSON 字符串，返回对象
  const handleParseJson = () => {
    void runCall('parse_json', { data: '{"key":"value"}' }, 'parse_json')
  }

  // 故意触发错误：传入非法 JSON，演示错误处理
  const handleParseInvalidJson = () => {
    void runCall('parse_json', { data: '{not valid json' }, 'parse_json (invalid)')
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Rust Backend Demo</h2>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          Plugin ID: <code>{panel.pluginId}</code>
        </p>
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          type="button"
          onClick={handleCountWords}
          style={buttonStyle}
          disabled={loading}
        >
          Count Words（"hello world from rust"）
        </button>
        <button
          type="button"
          onClick={handleParseJson}
          style={buttonStyle}
          disabled={loading}
        >
          Parse JSON（{`'{"key":"value"}'`}）
        </button>
        <button
          type="button"
          onClick={handleParseInvalidJson}
          style={buttonStyle}
          disabled={loading}
        >
          Parse JSON（非法 JSON，演示错误）
        </button>
      </section>

      {/* 结果展示 */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>调用结果</h3>
        {loading ? (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>调用中…</p>
        ) : result ? (
          <div
            style={{
              padding: 8,
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              background: 'var(--bg-secondary)',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>
                <strong>{result.command}</strong>
              </span>
              <span
                style={{
                  color: result.status === 'success' ? 'var(--success-color, #22c55e)' : 'var(--danger-color, #f44336)',
                }}
              >
                {result.status === 'success' ? '成功' : '失败'}
              </span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>
              {new Date(result.at).toLocaleString()}
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: 11,
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)}
            </pre>
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            点击上方按钮调用 Rust 后端。count_words 返回单词数（number），parse_json 返回解析后的对象。
          </p>
        )}
      </section>

      {/* 超时提示 */}
      <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        单次调用超时 <strong>30 秒</strong>；连续超时 3 次会触发熔断，宿主主动 kill 后端进程。
        后端空闲 10 分钟自动回收。详见 [backend.md](../../plugin-system/backend.md)。
      </p>
    </div>
  )
}

// ─── 样式 ─────────────────────────────────────────────────────────────────────

const buttonStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 4,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-secondary)',
  cursor: 'pointer',
  fontSize: 12,
}

// ─── Manifest ─────────────────────────────────────────────────────────────────
// hasBackend: true（在 manifest.json 中声明，JS manifest 不含此字段）
// permissions 声明 'backend'：invokeBackend 需要 backend 权限。

const manifest: PluginManifest = {
  id: 'com.example.rust-backend',
  name: 'Rust Backend Demo',
  description: 'Demonstrates a plugin with a Rust backend using stdin/stdout JSON-RPC',
  version: '0.1.0',
  author: 'SwallowNote',
  publishedAt: '2026-07-10',

  iconPosition: 'sidebar',
  contentPosition: 'fullPanel',
  order: 100,
  enabled: true,

  icon: BackendIcon,
  panel: BackendPanel,

  permissions: ['backend'],
}

export default manifest
