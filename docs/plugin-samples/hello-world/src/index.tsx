/**
 * Hello World — minimal SwallowNote plugin
 *
 * Demonstrates:
 *  - icon: simple SVG component rendered at <Icon size={N} />
 *  - panel: a fullPanel that reads pluginId from props
 *  - manifest: the PluginManifest shape
 *
 * In a real plugin the imports come from the host's source tree:
 *   import type { PluginManifest, PluginPanelProps } from '@/types/plugin'
 *
 * When loaded as an external index.js (via the Tauri asset protocol),
 * the bundler inlines these types from a published SDK or this same
 * source tree at build time.
 */
import manifestJson from '../manifest.json'
import { definePlugin } from '@swallow-note/plugin-sdk'
import type { PluginPanelProps } from '@swallow-note/plugin-sdk'
// Re-export `setHost` so the host can install its real
// implementations (with permission checks) before firing our
// lifecycle hooks. Without this re-export the bundler's
// tree-shaker would drop the symbol from the ES bundle and
// the host would silently fall back to the SDK's stubs. The
// re-export makes `setHost` reachable from the entry, which
// keeps it in the bundle.
export { setHost } from '@swallow-note/plugin-sdk'

// ─── Icon (sidebar trigger) ────────────────────────────────────────────────────

function HelloIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  )
}

// ─── Panel (fullPanel content) ────────────────────────────────────────────────

function HelloPanel({ pluginId }: PluginPanelProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 12,
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 600 }}>Hello, world!</h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Plugin ID: <code>{pluginId}</code>
      </p>
    </div>
  )
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

// manifest 静态字段单一来源是 ../manifest.json；"permissions": [] 声明不申请
// 任何运行时权限（最小权限基线），icon/panel 组件由 runtime 第二参注入。
export default definePlugin(manifestJson, {
  icon: HelloIcon,
  panel: HelloPanel,
})
