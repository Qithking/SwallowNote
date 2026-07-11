/**
 * Command Palette — 向命令面板贡献命令
 *
 * 展示：
 *  - onLoad 中 registerCommand 注册 3 个命令
 *  - onUnload 中 clearPluginCommands 批量清理
 *  - panel 中 usePluginCommands() 实时展示注册表
 *  - 命令的 onTrigger 回调如何与面板通信（模块级内部总线）
 *
 * 命令出现在宿主命令面板（Ctrl/Cmd+P），可绑定快捷键。
 * id 需跨重载稳定，宿主按 <pluginId>:<id> 索引。
 */
import { useEffect, useState } from 'react'
import type {
  PluginCommand,
  PluginContext,
  PluginManifest,
  PluginPanelProps,
} from '@swallow-note/plugin-sdk'
import {
  clearPluginCommands,
  registerCommand,
  usePluginCommands,
} from '@swallow-note/plugin-sdk'
// 重新导出 setHost，让宿主在触发生命周期钩子前注入真实实现
export { setHost } from '@swallow-note/plugin-sdk'

const PLUGIN_ID = 'com.example.command-palette'

// ─── 模块级内部总线 ────────────────────────────────────────────────────────────
// 命令的 onTrigger 在命令面板上下文中执行（不在 React 内），
// 通过此总线通知面板刷新"最近触发"展示。宿主事件总线是单向的
// （host → plugin），插件自身通信用模块级 emitter。

interface TriggerLog {
  id: string
  label: string
  at: string
}

type InternalListener = (log: TriggerLog) => void
const internalListeners = new Set<InternalListener>()

function emitTrigger(log: TriggerLog): void {
  for (const listener of internalListeners) {
    try {
      listener(log)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[command-palette] internal listener threw:', err)
    }
  }
}

// ─── 侧边栏图标 ───────────────────────────────────────────────────────────────

function CommandIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 6h11" />
      <path d="M9 12h11" />
      <path d="M9 18h11" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </svg>
  )
}

// ─── 命令定义 ─────────────────────────────────────────────────────────────────
// onTrigger 只能是无参函数；需要上下文时应闭包捕获或读模块级状态。

function buildCommands(): PluginCommand[] {
  return [
    {
      id: 'insert-timestamp',
      label: 'Insert Timestamp',
      iconName: 'Clock',
      onTrigger: () => {
        // 实际插件应调用宿主编辑器 API 插入文本；此处演示记录触发
        const stamp = new Date().toISOString()
        emitTrigger({ id: 'insert-timestamp', label: 'Insert Timestamp', at: stamp })
      },
    },
    {
      id: 'insert-toc',
      label: 'Insert Table of Contents',
      iconName: 'List',
      // when 返回 false 时命令在面板中隐藏（但注册表保留，便于条件切换）
      when: () => true,
      onTrigger: () => {
        emitTrigger({
          id: 'insert-toc',
          label: 'Insert Table of Contents',
          at: new Date().toISOString(),
        })
      },
    },
    {
      id: 'word-count',
      label: 'Show Word Count',
      iconName: 'FileText',
      // category 让命令在面板中分组显示
      category: 'Tools',
      onTrigger: () => {
        emitTrigger({ id: 'word-count', label: 'Show Word Count', at: new Date().toISOString() })
      },
    },
  ]
}

// ─── 面板 ──────────────────────────────────────────────────────────────────────

function CommandPanel(panel: PluginPanelProps) {
  // usePluginCommands 自动订阅注册表变更，返回当前可见命令列表
  const commands = usePluginCommands()
  const [lastTrigger, setLastTrigger] = useState<TriggerLog | null>(null)

  // 订阅模块级内部总线，展示最近一次触发的命令
  useEffect(() => {
    const listener: InternalListener = (log) => setLastTrigger(log)
    internalListeners.add(listener)
    return () => {
      internalListeners.delete(listener)
    }
  }, [])

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Command Palette Demo</h2>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          Plugin ID: <code>{panel.pluginId}</code>
        </p>
      </header>

      <section>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>已注册命令（usePluginCommands）</h3>
        {commands.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            暂无命令。命令在 onLoad 中注册，若未加载请检查插件状态。
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {commands.map((cmd) => (
              <li
                key={cmd.id}
                style={{
                  padding: '6px 8px',
                  border: '1px solid var(--border-color)',
                  borderRadius: 4,
                  background: 'var(--bg-secondary)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    <code style={{ marginRight: 6 }}>{cmd.iconName ?? '?'}</code>
                    {cmd.label}
                  </span>
                  {cmd.category && (
                    <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{cmd.category}</span>
                  )}
                </div>
                <code style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{cmd.id}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>最近触发</h3>
        {lastTrigger ? (
          <div style={{ fontSize: 12, padding: '6px 8px', border: '1px solid var(--border-color)', borderRadius: 4 }}>
            <div>
              <strong>{lastTrigger.label}</strong>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
              {new Date(lastTrigger.at).toLocaleString()}
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            打开命令面板（Ctrl/Cmd+P）触发任一命令后，此处显示最近一次记录。
          </p>
        )}
      </section>
    </div>
  )
}

// ─── 生命周期钩子 ──────────────────────────────────────────────────────────────

function onLoad(ctx: PluginContext): void {
  // 注册 3 个命令到命令面板。registerCommand 会自动去重（同 id 覆盖）。
  for (const cmd of buildCommands()) {
    registerCommand(ctx.pluginId, cmd)
  }
}

function onUnload(ctx: PluginContext): void {
  // 批量清理本插件注册的所有命令，避免卸载后命令面板残留失效项
  clearPluginCommands(ctx.pluginId)
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

const manifest: PluginManifest = {
  id: PLUGIN_ID,
  name: 'Command Palette Demo',
  description: 'Demonstrates contributing commands to the palette',
  version: '0.1.0',
  author: 'SwallowNote',
  publishedAt: '2026-07-10',

  iconPosition: 'sidebar',
  contentPosition: 'fullPanel',
  order: 100,
  enabled: true,

  icon: CommandIcon,
  panel: CommandPanel,

  permissions: [],

  onLoad,
  onUnload,
}

export default manifest
