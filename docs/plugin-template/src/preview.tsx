/**
 * Standalone preview frame.
 *
 * Renders the user's `manifest.panel` inside a mocked host shell,
 * with a dev-tools panel for emitting events, inspecting storage,
 * and testing context-menu contributions.
 *
 * This file is for development only. The bundled plugin never
 * imports `Preview`; the `vite build` library entry point is
 * `src/plugin/index.tsx` instead.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, CSSProperties } from 'react'
import manifest from './plugin'
import {
  type ContextMenuItem,
  type ContextMenuLocation,
  type PluginCommand,
  type PluginEvent,
  type PluginEventBus,
  type PluginEventPayloadMap,
  type PluginPanelProps,
  buildPluginContext,
  clearPluginMenuItems,
  emitAppExit,
  emitAppReady,
  emitLocaleChanged,
  emitNoteChanged,
  emitNoteClosed,
  emitNoteOpened,
  emitNoteSaved,
  emitPluginSettingsChanged,
  emitSettingChanged,
  emitThemeChanged,
  getContextMenuItems,
  getPluginStorage,
  getSetting,
  getAllSettings,
  listPluginCommands,
  onSettingsChange,
  pluginEventBus,
  registerCommand,
  runLifecycleHook,
  setSetting,
  unregisterCommand,
  usePluginCommands,
} from '@swallow-note/plugin-sdk'

// ────────────────────────────── styles ────────────────────────────────────

const shellStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 360px',
  height: '100vh',
  background: '#f5f5f7',
}
const mainStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  borderRight: '1px solid #d2d2d7',
  background: '#fff',
  overflow: 'hidden',
}
const headerStyle: CSSProperties = {
  padding: '10px 16px',
  borderBottom: '1px solid #e5e5ea',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontSize: 13,
}
const panelWrapStyle: CSSProperties = { flex: 1, overflow: 'auto' }
const sideStyle: CSSProperties = {
  padding: 16,
  fontSize: 12,
  overflow: 'auto',
}
const sectionStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #d2d2d7',
  borderRadius: 6,
  padding: 12,
  marginBottom: 12,
}
const sectionTitle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 8,
  color: '#6e6e73',
}
const btn: CSSProperties = {
  fontSize: 12,
  padding: '4px 10px',
  margin: 2,
  border: '1px solid #c7c7cc',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
}
const input: CSSProperties = {
  fontSize: 12,
  padding: '4px 8px',
  border: '1px solid #c7c7cc',
  borderRadius: 4,
  width: '100%',
  boxSizing: 'border-box',
  marginBottom: 6,
}

// ─────────────────────────── dev tools data ──────────────────────────────

// pluginEventBus 内部挂载了 emit 方法（类型上未暴露），
// 预览模式需要发射 editor:registered / editor:unregistered 事件，
// 但 SDK 未提供公开的 emit 助手，这里通过类型转换访问内部 emit。
type PluginBusWithEmit = PluginEventBus & {
  emit: <E extends PluginEvent>(event: E, payload: PluginEventPayloadMap[E]) => void
}

/** 发射 editor:registered 事件（SDK 未提供公开助手） */
function emitEditorRegistered(pluginId: string, extension: string): void {
  ;(pluginEventBus as unknown as PluginBusWithEmit).emit('editor:registered', { pluginId, extension })
}

/** 发射 editor:unregistered 事件（SDK 未提供公开助手） */
function emitEditorUnregistered(pluginId: string, extension: string): void {
  ;(pluginEventBus as unknown as PluginBusWithEmit).emit('editor:unregistered', { pluginId, extension })
}

const EVENT_PRESETS: { label: string; fire: () => void }[] = [
  { label: 'note:open  /notes/welcome.md', fire: () => emitNoteOpened('n1', '/notes/welcome.md') },
  { label: 'note:save /notes/welcome.md', fire: () => emitNoteSaved('n1', '/notes/welcome.md') },
  { label: 'note:close /notes/welcome.md', fire: () => emitNoteClosed('n1', '/notes/welcome.md') },
  { label: 'theme:change → dark', fire: () => emitThemeChanged('dark') },
  { label: 'theme:change → light', fire: () => emitThemeChanged('light') },
  { label: 'locale:change → zh-CN', fire: () => emitLocaleChanged('zh-CN') },
  { label: 'settings:change fontSize=14', fire: () => emitSettingChanged('fontSize', 14) },
  { label: 'plugin-settings:change', fire: () => emitPluginSettingsChanged(manifest.id, { theme: 'dark' }) },
  // app:exit 需要用户确认后再发射，避免误触发导致宿主准备退出
  {
    label: 'app:exit (confirm)',
    fire: () => {
      if (window.confirm('确认发射 app:exit 事件？')) emitAppExit()
    },
  },
]

// ─────────────────────── 命令面板测试 ─────────────────────────────────────

/** 命令面板测试区域：注册 / 注销 / 列出命令，并通过 usePluginCommands 实时展示 */
function CommandPaletteSection() {
  const [cmdId, setCmdId] = useState('')
  const [cmdLabel, setCmdLabel] = useState('')
  const [cmdIconName, setCmdIconName] = useState('')
  const [listResult, setListResult] = useState<PluginCommand[] | null>(null)
  // usePluginCommands 内部订阅 registry 变更，命令注册 / 注销后自动刷新
  const commands = usePluginCommands()

  const handleRegister = () => {
    if (!cmdId || !cmdLabel) return
    registerCommand('preview', {
      id: cmdId,
      label: cmdLabel,
      iconName: cmdIconName || undefined,
      onTrigger: () => console.log(`[preview] command "${cmdId}" triggered`),
    })
  }

  const handleUnregister = () => {
    if (!cmdId) return
    unregisterCommand('preview', cmdId)
  }

  const handleList = () => {
    setListResult(listPluginCommands())
  }

  return (
    <div style={sectionStyle}>
      <div style={sectionTitle}>Command palette</div>
      <input style={input} value={cmdId} onChange={(e) => setCmdId(e.target.value)} placeholder="命令 id" />
      <input style={input} value={cmdLabel} onChange={(e) => setCmdLabel(e.target.value)} placeholder="label" />
      <input style={input} value={cmdIconName} onChange={(e) => setCmdIconName(e.target.value)} placeholder="iconName（可选）" />
      <div>
        <button style={btn} onClick={handleRegister}>注册命令</button>
        <button style={btn} onClick={handleUnregister}>注销命令</button>
        <button style={btn} onClick={handleList}>列出命令</button>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: '#6e6e73' }}>
        usePluginCommands() 实时命令（{commands.length}）:
      </div>
      {commands.length === 0 && (
        <div style={{ fontSize: 11, color: '#6e6e73' }}>(无)</div>
      )}
      {commands.map((c) => (
        <div key={c.id} style={{ fontSize: 11, fontFamily: 'monospace' }}>
          {c.id} — {c.label}{c.iconName ? ` [${c.iconName}]` : ''}
        </div>
      ))}
      {listResult && (
        <>
          <div style={{ marginTop: 8, fontSize: 11, color: '#6e6e73' }}>
            listPluginCommands() 结果（{listResult.length}）:
          </div>
          {listResult.map((c) => (
            <div key={c.id} style={{ fontSize: 11, fontFamily: 'monospace' }}>
              {c.id} — {c.label}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ─────────────────────── Frontmatter 测试 ─────────────────────────────────

/** Frontmatter 测试区域：读取 / 写入活动笔记的 frontmatter（预览模式走模拟数据） */
function FrontmatterSection({ panelProps }: { panelProps: PluginPanelProps }) {
  const [fmKey, setFmKey] = useState('')
  const [fmValue, setFmValue] = useState('')
  // undefined = 尚未读取；null = 已读取但无 frontmatter；对象 = 读取到的内容
  const [fmDisplay, setFmDisplay] = useState<Record<string, unknown> | null | undefined>(undefined)

  const handleRead = () => {
    setFmDisplay(panelProps.getActiveNoteFrontmatter())
  }

  const handleWrite = () => {
    if (!fmKey) return
    panelProps.setActiveNoteFrontmatter({ [fmKey]: fmValue })
  }

  return (
    <div style={sectionStyle}>
      <div style={sectionTitle}>Frontmatter</div>
      <button style={btn} onClick={handleRead}>读取 Frontmatter</button>
      {fmDisplay !== undefined && (
        <pre style={{ fontSize: 10, fontFamily: 'monospace', margin: '4px 0', color: '#6e6e73' }}>
          {fmDisplay === null ? 'null' : JSON.stringify(fmDisplay, null, 2)}
        </pre>
      )}
      <input style={input} value={fmKey} onChange={(e) => setFmKey(e.target.value)} placeholder="key" />
      <input style={input} value={fmValue} onChange={(e) => setFmValue(e.target.value)} placeholder="value" />
      <button style={btn} onClick={handleWrite}>写入 Frontmatter</button>
    </div>
  )
}

// ─────────────────────── 设置 API 测试 ────────────────────────────────────

/** 设置 API 测试区域：读取 / 写入单个设置，读取所有设置 */
function SettingsApiSection({ panelProps }: { panelProps: PluginPanelProps }) {
  const [settingKey, setSettingKey] = useState('')
  const [settingValue, setSettingValue] = useState('')
  const [readResult, setReadResult] = useState<unknown>(null)
  const [readDone, setReadDone] = useState(false)
  const [allSettings, setAllSettings] = useState<Record<string, unknown> | null>(null)

  const handleRead = async () => {
    if (!settingKey) return
    const v = await panelProps.getSetting(settingKey)
    setReadResult(v)
    setReadDone(true)
  }

  const handleWrite = async () => {
    if (!settingKey) return
    await panelProps.setSetting(settingKey, settingValue)
  }

  const handleReadAll = async () => {
    const all = await panelProps.getAllSettings()
    setAllSettings(all)
  }

  return (
    <div style={sectionStyle}>
      <div style={sectionTitle}>Settings API</div>
      <input style={input} value={settingKey} onChange={(e) => setSettingKey(e.target.value)} placeholder="key" />
      <input style={input} value={settingValue} onChange={(e) => setSettingValue(e.target.value)} placeholder="value" />
      <div>
        <button style={btn} onClick={handleRead}>读取设置</button>
        <button style={btn} onClick={handleWrite}>写入设置</button>
        <button style={btn} onClick={handleReadAll}>读取所有设置</button>
      </div>
      {readDone && (
        <div style={{ fontSize: 11, fontFamily: 'monospace', marginTop: 4 }}>
          <strong>读取结果:</strong> {JSON.stringify(readResult)}
        </div>
      )}
      {allSettings && (
        <pre style={{ fontSize: 10, fontFamily: 'monospace', margin: '4px 0' }}>
          {JSON.stringify(allSettings, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ──────────────────────────── component ──────────────────────────────────

export function Preview() {
  const [active, setActive] = useState(true)
  const [storageTick, setStorageTick] = useState(0)
  const [eventLog, setEventLog] = useState<string[]>([])
  const [notePath, setNotePath] = useState('/notes/example.md')
  const [contentLen, setContentLen] = useState(0)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    items: ContextMenuItem[]
  } | null>(null)

  // 预览模式无真实笔记，用 ref 维护一个模拟 frontmatter 对象，
  // 供 panelProps.getActiveNoteFrontmatter / setActiveNoteFrontmatter 读写。
  // 使用 ref 避免 panelProps memo 因 frontmatter 变更而重建。
  const mockFrontmatterRef = useRef<Record<string, unknown>>({})

  // 参数化事件的输入状态（plugin-settings:change / editor:registered / editor:unregistered）
  const [psPluginId, setPsPluginId] = useState(manifest.id)
  const [psValues, setPsValues] = useState('{"theme":"dark"}')
  const [editorPluginId, setEditorPluginId] = useState(manifest.id)
  const [editorExtension, setEditorExtension] = useState('.md')

  // Lifecycle: onMount, onUnmount, onActivate, onDeactivate
  // Hooks are flat top-level fields on PluginManifest (not under
  // a `hooks` object). The standalone preview synthesises a
  // PluginDefinition-shaped context (id + pluginPath) for the
  // hooks since the host fills in `pluginPath` at load time.
  const ctx = useMemo(() => buildPluginContext({ id: manifest.id, pluginPath: '' }), [])
  useEffect(() => {
    void runLifecycleHook(manifest.onLoad, ctx)
    void runLifecycleHook(manifest.onMount, ctx)
    return () => {
      void runLifecycleHook(manifest.onUnmount, ctx)
      void runLifecycleHook(manifest.onUnload, ctx)
      clearPluginMenuItems(manifest.id)
    }
  }, [ctx])

  useEffect(() => {
    void runLifecycleHook(active ? manifest.onActivate : manifest.onDeactivate, ctx)
  }, [active, ctx])

  // App ready – one-shot
  useEffect(() => {
    emitAppReady()
  }, [])

  // Capture event log for debugging
  useEffect(() => {
    const all = [
      'note:open', 'note:close', 'note:save', 'note:change',
      'theme:change', 'locale:change', 'settings:change', 'app:ready',
      'app:exit', 'plugin-settings:change',
      'editor:registered', 'editor:unregistered',
    ] as const
    const unsubs = all.map((evt) =>
      pluginEventBus.on(evt, (payload) => {
        setEventLog((prev) =>
          [`${new Date().toLocaleTimeString()}  ${evt}  ${JSON.stringify(payload)}`, ...prev].slice(0, 30)
        )
      })
    )
    return () => unsubs.forEach((u) => u())
  }, [])

  // Build panel props — 补齐 PluginPanelProps 全部必需字段，
  // settings/frontmatter 在独立预览中走 SDK stub 或返回空值
  const panelProps = useMemo<PluginPanelProps>(() => ({
    pluginId: manifest.id,
    isActive: active,
    close: () => setActive(false),
    invokeBackend: async (cmd, args) => {
      console.log('[preview] invokeBackend', cmd, args)
      return null
    },
    store: getPluginStorage(manifest.id),
    events: pluginEventBus,
    activeNoteContent: '',
    activeNotePath: notePath,
    getSetting: (key: string) => getSetting(manifest.id, key),
    setSetting: (key: string, value: unknown) => setSetting(manifest.id, key, value),
    getAllSettings: () => getAllSettings(manifest.id),
    onSettingsChange: (handler) => onSettingsChange(manifest.id, handler),
    // 预览模式用 mockFrontmatterRef 模拟活动笔记的 frontmatter
    getActiveNoteFrontmatter: () => mockFrontmatterRef.current,
    setActiveNoteFrontmatter: (data) => {
      mockFrontmatterRef.current = { ...mockFrontmatterRef.current, ...data }
    },
    onNoteFrontmatterChanged: () => () => {},
  }), [active, notePath])

  const Panel = manifest.panel as ComponentType<PluginPanelProps>

  // Storage snapshot
  // Uses store.keys() so unknown / custom keys are visible without
  // hardcoding them in the preview frame.
  const [storageSnapshot, setStorageSnapshot] = useState<Record<string, unknown>>({})
  useEffect(() => {
    const store = getPluginStorage(manifest.id)
    void store.keys().then(async (keys) => {
      const rows = await Promise.all(keys.map(async (k) => [k, await store.get(k)] as const))
      const obj: Record<string, unknown> = {}
      for (const [k, v] of rows) if (v !== null && v !== undefined) obj[k] = v
      setStorageSnapshot(obj)
    })
  }, [storageTick])

  // Right-click handler on the panel area
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const location: ContextMenuLocation = 'editor'
    const items = getContextMenuItems(location, {
      location,
      activePath: notePath,
    })
    setContextMenu({ x: e.clientX, y: e.clientY, items })
  }, [notePath])

  return (
    <div style={shellStyle}>
      {/* Main panel area */}
      <div style={mainStyle}>
        <div style={headerStyle}>
          <strong>{manifest.name}</strong>
          <span style={{ color: '#6e6e73', fontSize: 11 }}>{manifest.id}</span>
          <span style={{ flex: 1 }} />
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            isActive
          </label>
          <button style={btn} onClick={() => setActive(false)}>close</button>
        </div>
        <div style={panelWrapStyle} onContextMenu={handleContextMenu}>
          <Panel {...panelProps} />
        </div>
        {contextMenu && (
          <div
            style={{
              position: 'fixed', top: contextMenu.y, left: contextMenu.x,
              background: '#fff', border: '1px solid #c7c7cc', borderRadius: 4,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: 4, zIndex: 1000,
              minWidth: 200, fontSize: 12,
            }}
            onClick={() => setContextMenu(null)}
          >
            {contextMenu.items.length === 0 && (
              <div style={{ padding: 8, color: '#6e6e73' }}>No menu items at this location</div>
            )}
            {contextMenu.items.map((it) => (
              <div
                key={it.id}
                style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f5')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                onClick={() => {
                  void it.onClick({ location: 'editor', activePath: notePath })
                  setContextMenu(null)
                }}
              >
                {it.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dev tools sidebar */}
      <div style={sideStyle}>
        <div style={sectionStyle}>
          <div style={sectionTitle}>Emit events</div>
          {EVENT_PRESETS.map((p) => (
            <button key={p.label} style={btn} onClick={p.fire}>{p.label}</button>
          ))}
          <div style={{ marginTop: 8, fontSize: 11, color: '#6e6e73' }}>
            Custom note:change
          </div>
          <input
            style={input}
            value={notePath}
            onChange={(e) => setNotePath(e.target.value)}
            placeholder="path"
          />
          <input
            style={input}
            type="number"
            value={contentLen}
            onChange={(e) => setContentLen(Number(e.target.value))}
            placeholder="content length"
          />
          <button
            style={btn}
            onClick={() => emitNoteChanged('n1', notePath, 'x'.repeat(contentLen))}
          >
            emit note:change
          </button>

          {/* 参数化事件：需要用户输入参数的事件发射器 */}
          <div style={{ marginTop: 10, fontSize: 11, color: '#6e6e73' }}>
            参数化事件
          </div>
          <input
            style={input}
            value={psPluginId}
            onChange={(e) => setPsPluginId(e.target.value)}
            placeholder="pluginId"
          />
          <input
            style={input}
            value={psValues}
            onChange={(e) => setPsValues(e.target.value)}
            placeholder='values JSON，如 {"theme":"dark"}'
          />
          <button
            style={btn}
            onClick={() => {
              try {
                const values = JSON.parse(psValues) as Record<string, unknown>
                emitPluginSettingsChanged(psPluginId, values)
              } catch (err) {
                console.error('[preview] values 不是合法 JSON', err)
              }
            }}
          >
            plugin-settings:change
          </button>
          <input
            style={input}
            value={editorPluginId}
            onChange={(e) => setEditorPluginId(e.target.value)}
            placeholder="pluginId"
          />
          <input
            style={input}
            value={editorExtension}
            onChange={(e) => setEditorExtension(e.target.value)}
            placeholder="extension，如 .md"
          />
          <button
            style={btn}
            onClick={() => emitEditorRegistered(editorPluginId, editorExtension)}
          >
            editor:registered
          </button>
          <button
            style={btn}
            onClick={() => emitEditorUnregistered(editorPluginId, editorExtension)}
          >
            editor:unregistered
          </button>
        </div>

        {/* 命令面板测试 */}
        <CommandPaletteSection />

        {/* Frontmatter 测试 */}
        <FrontmatterSection panelProps={panelProps} />

        {/* 设置 API 测试 */}
        <SettingsApiSection panelProps={panelProps} />

        <div style={sectionStyle}>
          <div style={sectionTitle}>Storage ({manifest.id})</div>
          {Object.keys(storageSnapshot).length === 0 && (
            <div style={{ fontSize: 11, color: '#6e6e73' }}>(empty — known keys: count, config, history, installedAt)</div>
          )}
          {Object.entries(storageSnapshot).map(([k, v]) => (
            <div key={k} style={{ fontSize: 11, marginBottom: 4 }}>
              <strong>{k}:</strong>{' '}
              <code style={{ fontSize: 10 }}>{JSON.stringify(v).slice(0, 80)}</code>
            </div>
          ))}
          <button
            style={{ ...btn, marginTop: 6 }}
            onClick={() => {
              const store = getPluginStorage(manifest.id)
              void store.clear().then(() => setStorageTick((t) => t + 1))
            }}
          >
            Clear storage
          </button>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitle}>Event log</div>
          {eventLog.length === 0 && (
            <div style={{ fontSize: 11, color: '#6e6e73' }}>(waiting for events…)</div>
          )}
          {eventLog.map((line, i) => (
            <div key={i} style={{ fontSize: 10, fontFamily: 'monospace', marginBottom: 2 }}>
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
