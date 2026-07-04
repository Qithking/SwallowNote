/**
 * 密盘主面板组件（v2）。
 *
 * 状态机：
 * - loading：检查数据库状态
 * - uninitialized：数据库未创建，内嵌显示密码设置界面
 * - locked：数据库已创建但未解锁，内嵌显示解锁界面
 * - unlocked：已解锁，显示文件树（参考资源管理器）
 *
 * 点击笔记 → 调用 openEditorTab 在主编辑区打开 tab（不在面板内编辑）。
 * 内容编辑防抖 500ms 保存，切换笔记前 flush。
 * 面板 unmount 时，若 requirePasswordEveryTime 为 true，fire-and-forget 调用 lock。
 */
import { useEffect, useState, useCallback, useRef, forwardRef } from 'react'
import {
  Lock, RefreshCw, FilePlus, FolderPlus, Folder, FolderOpen,
  ChevronRight, FileText, Trash2, Edit3, Eye, EyeOff, ClipboardCopy,
} from 'lucide-react'
import type { PluginPanelProps, OpenEditorTabProps, EditorToolbarConfig } from '@swallow-note/plugin-sdk'
import { openEditorTab } from '@swallow-note/plugin-sdk'
import type { DiskState, NoteListItem, NoteFull } from './types'
import { validatePassword, strengthLabel, strengthColor, PASSWORD_MAX_LEN } from './passwordStrength'

/** 缓存：parentId → 子项列表。null key 表示根级。 */
type TreeCache = Map<string | null, NoteListItem[]>

/** 防抖保存间隔（毫秒）。 */
const SAVE_DEBOUNCE_MS = 500

/** 密盘 tab 的工具栏配置：隐藏路径相关项（spec 要求）。 */
const DISK_TOOLBAR_CONFIG: EditorToolbarConfig = {
  copyPath: false,
  openLocation: false,
  openHistory: false,
  showFilePath: false,
  externalChangeWarning: false,
  conflictIndicator: false,
}

export function SecretDiskPanel(props: PluginPanelProps) {
  const { invokeBackend, getSetting, pluginId } = props

  const [diskState, setDiskState] = useState<DiskState>('locked')
  const [loading, setLoading] = useState(true)
  const [rootItems, setRootItems] = useState<NoteListItem[]>([])
  const treeCacheRef = useRef<TreeCache>(new Map())
  const requirePasswordRef = useRef(false)
  // 当前活跃笔记的 flush 函数（切换/卸载前调用）
  const currentFlushRef = useRef<(() => Promise<void>) | null>(null)
  // 防抖定时器
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 初始化：检查数据库状态。 */
  const checkState = useCallback(async () => {
    try {
      const initialized = (await invokeBackend('is_initialized')) as boolean
      if (!initialized) {
        setDiskState('uninitialized')
        setLoading(false)
        return
      }
      const unlocked = (await invokeBackend('is_unlocked')) as boolean
      setDiskState(unlocked ? 'unlocked' : 'locked')
      setLoading(false)
    } catch (err) {
      console.error('[secret-disk] 检查状态失败:', err)
      setLoading(false)
    }
  }, [invokeBackend])

  /** 加载 requirePasswordEveryTime 设置。 */
  useEffect(() => {
    void getSetting<boolean>('requirePasswordEveryTime').then((val) => {
      requirePasswordRef.current = val === true
    })
  }, [getSetting])

  /** 启动时检查状态。 */
  useEffect(() => {
    void checkState()
  }, [checkState])

  /** 立即 flush 当前防抖内容。 */
  const flushPending = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (currentFlushRef.current) {
      const flush = currentFlushRef.current
      currentFlushRef.current = null
      await flush()
    }
  }, [])

  /** 面板 unmount：flush + 自动锁定。 */
  useEffect(() => {
    return () => {
      // flush 当前防抖内容（fire-and-forget）
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        void currentFlushRef.current?.()
      }
      // 自动锁定
      if (requirePasswordRef.current) {
        void invokeBackend('lock').catch(() => {
          // fire-and-forget，忽略错误
        })
      }
    }
  }, [invokeBackend])

  /** 解锁/初始化成功：加载根级子项并切换到文件树视图。 */
  const handleAuthSuccess = useCallback(async () => {
    setDiskState('unlocked')
    try {
      const items = (await invokeBackend('list_children', { parentId: null })) as NoteListItem[]
      treeCacheRef.current.set(null, items)
      setRootItems(items)
    } catch (err) {
      console.error('[secret-disk] 加载根级失败:', err)
    }
  }, [invokeBackend])

  /** 刷新指定父级的子项缓存。 */
  const refreshChildren = useCallback(
    async (parentId: string | null) => {
      try {
        const items = (await invokeBackend('list_children', { parentId })) as NoteListItem[]
        treeCacheRef.current.set(parentId, items)
        if (parentId === null) {
          setRootItems(items)
        }
        return items
      } catch (err) {
        console.error('[secret-disk] 刷新子项失败:', err)
        return []
      }
    },
    [invokeBackend],
  )

  /** 点击笔记：flush 前一个 → 加载新笔记 → openEditorTab 在主编辑区打开。 */
  const handleSelectNote = useCallback(
    async (note: NoteListItem) => {
      // flush 前一个笔记的防抖内容（spec：切换笔记前 flush）
      await flushPending()

      try {
        const full = (await invokeBackend('get_note', { id: note.id })) as NoteFull

        // onChange 回调：防抖 500ms 保存到加密数据库
        const onChange = (content: string) => {
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current)
          }
          // 更新 flush 函数，引用最新内容
          currentFlushRef.current = async () => {
            try {
              await invokeBackend('update_note', { id: note.id, content })
            } catch (err) {
              console.error('[secret-disk] 保存失败:', err)
            }
          }
          debounceTimerRef.current = setTimeout(() => {
            void currentFlushRef.current?.()
            debounceTimerRef.current = null
          }, SAVE_DEBOUNCE_MS)
        }

        const tabProps: OpenEditorTabProps = {
          id: note.id,
          name: note.title,
          icon: <Lock size={14} />,
          content: full.content,
          onChange,
          toolbarConfig: DISK_TOOLBAR_CONFIG,
        }
        openEditorTab(pluginId, tabProps)
      } catch (err) {
        console.error('[secret-disk] 加载笔记失败:', err)
      }
    },
    [invokeBackend, pluginId, flushPending],
  )

  /** 锁定密盘：先 flush 再锁定。 */
  const handleLock = useCallback(async () => {
    await flushPending()
    try {
      await invokeBackend('lock')
      treeCacheRef.current.clear()
      setRootItems([])
      setDiskState('locked')
    } catch (err) {
      console.error('[secret-disk] 锁定失败:', err)
    }
  }, [invokeBackend, flushPending])

  // ── 渲染 ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 16, color: 'var(--text-2, #6b7280)', fontSize: 13 }}>
        加载中…
      </div>
    )
  }

  if (diskState === 'uninitialized') {
    return (
      <PasswordInline
        mode="init"
        invokeBackend={invokeBackend}
        onSuccess={handleAuthSuccess}
      />
    )
  }

  if (diskState === 'locked') {
    return (
      <PasswordInline
        mode="unlock"
        invokeBackend={invokeBackend}
        onSuccess={handleAuthSuccess}
      />
    )
  }

  return (
    <DiskFileTree
      rootItems={rootItems}
      treeCache={treeCacheRef.current}
      invokeBackend={invokeBackend}
      refreshChildren={refreshChildren}
      onSelectNote={handleSelectNote}
      onLock={handleLock}
    />
  )
}

// ════════════════════════════════════════════════════════════════
//  内嵌密码 UI（init / unlock 模式，非弹框）
// ════════════════════════════════════════════════════════════════

interface PasswordInlineProps {
  mode: 'init' | 'unlock'
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  onSuccess: () => void
}

function PasswordInline({ mode, invokeBackend, onSuccess }: PasswordInlineProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const showStrength = mode === 'init'
  const validation = showStrength ? validatePassword(password) : null

  const canSubmit = (() => {
    if (loading) return false
    if (mode === 'unlock') return password.length > 0
    return validation?.valid === true && password === confirmPassword
  })()

  /** 提交密码到后端。 */
  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError('')
    try {
      if (mode === 'init') {
        await invokeBackend('init', { password })
      } else {
        await invokeBackend('unlock', { password })
      }
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSubmit) {
      void handleSubmit()
    }
  }

  const inputType = showPassword ? 'text' : 'password'

  return (
    <div style={pwdContainerStyle} onKeyDown={handleKeyDown}>
      <div style={pwdHeaderStyle}>
        <Lock size={20} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          {mode === 'init' ? '设置密盘密码' : '解锁密盘'}
        </span>
      </div>

      <div style={pwdFieldStyle}>
        <label style={pwdLabelStyle}>密码</label>
        <div style={{ position: 'relative' }}>
          <input
            type={inputType}
            style={{ ...pwdInputStyle, paddingRight: 36 }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'init' ? '设置密码（至少 8 位，含字母和数字）' : '输入密码'}
            maxLength={PASSWORD_MAX_LEN}
            autoFocus
          />
          <button
            type="button"
            style={pwdEyeBtnStyle}
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {showStrength && password.length > 0 && validation && (
          <div style={pwdStrengthBarStyle}>
            <div
              style={{
                ...pwdStrengthFillStyle,
                width: validation.strength === 'weak' ? '33%' : validation.strength === 'medium' ? '66%' : '100%',
                backgroundColor: strengthColor(validation.strength!),
              }}
            />
            <span style={{ fontSize: 11, color: strengthColor(validation.strength!) }}>
              {strengthLabel(validation.strength!)}
            </span>
            {validation.error && (
              <span style={{ fontSize: 11, color: '#ef4444', marginLeft: 8 }}>
                {validation.error}
              </span>
            )}
          </div>
        )}
      </div>

      {mode === 'init' && (
        <div style={pwdFieldStyle}>
          <label style={pwdLabelStyle}>确认密码</label>
          <input
            type={inputType}
            style={pwdInputStyle}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="再次输入密码"
            maxLength={PASSWORD_MAX_LEN}
          />
          {confirmPassword.length > 0 && password !== confirmPassword && (
            <span style={{ fontSize: 11, color: '#ef4444', marginTop: 4, display: 'block' }}>
              两次输入的密码不一致
            </span>
          )}
        </div>
      )}

      {error && <div style={pwdErrorStyle}>{error}</div>}

      <button
        style={{ ...pwdSubmitBtnStyle, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {loading ? '处理中…' : mode === 'init' ? '创建密盘' : '解锁'}
      </button>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
//  文件树视图（参考 FileTreeView 结构）
// ════════════════════════════════════════════════════════════════

interface DiskFileTreeProps {
  rootItems: NoteListItem[]
  treeCache: TreeCache
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  refreshChildren: (parentId: string | null) => Promise<NoteListItem[]>
  onSelectNote: (note: NoteListItem) => void
  onLock: () => Promise<void>
}

function DiskFileTree({
  rootItems,
  treeCache,
  invokeBackend,
  refreshChildren,
  onSelectNote,
  onLock,
}: DiskFileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ parentId: string | null; type: 'file' | 'folder' } | null>(null)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; parentId: string | null; value: string } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    item: NoteListItem | null
    parentId: string | null
  } | null>(null)
  // 拖拽状态
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const dragSourceRef = useRef<string | null>(null)
  // 类型断言：@types/react 18.3 中 useRef<T>(null) 返回 RefObject<T | null>，
  // 但原生 input 和 forwardRef 的 ref prop 期望 RefObject<T>（不含 null）
  const inputRef = useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>

  /** 输入框聚焦。 */
  useEffect(() => {
    if (creating || renaming) inputRef.current?.focus()
  }, [creating, renaming])

  /** 关闭右键菜单（点击任意位置或 ESC）。 */
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  /** 展开/折叠文件夹。 */
  const toggleExpand = async (folder: NoteListItem) => {
    const next = new Set(expanded)
    if (next.has(folder.id)) {
      next.delete(folder.id)
    } else {
      next.add(folder.id)
      // 首次展开：从缓存或后端加载子项
      if (!treeCache.has(folder.id)) {
        await refreshChildren(folder.id)
      }
    }
    setExpanded(next)
  }

  /** 新建项目。 */
  const handleCreate = async () => {
    if (!creating || !newName.trim()) {
      setCreating(null)
      setNewName('')
      return
    }
    try {
      await invokeBackend('create_item', {
        parentId: creating.parentId,
        title: newName.trim(),
        type: creating.type,
      })
      await refreshChildren(creating.parentId)
      if (creating.parentId) {
        setExpanded((prev) => new Set([...prev, creating.parentId!]))
      }
    } catch (err) {
      console.error('[secret-disk] 创建失败:', err)
    }
    setCreating(null)
    setNewName('')
  }

  /** 重命名项目。 */
  const handleRename = async () => {
    if (!renaming || !renaming.value.trim()) {
      setRenaming(null)
      return
    }
    try {
      await invokeBackend('rename_item', { id: renaming.id, title: renaming.value.trim() })
      await refreshChildren(renaming.parentId)
    } catch (err) {
      console.error('[secret-disk] 重命名失败:', err)
    }
    setRenaming(null)
  }

  /** 删除项目。 */
  const handleDelete = async (item: NoteListItem) => {
    if (!confirm(`确定删除「${item.title}」？${item.type === 'folder' ? '文件夹内的所有内容将被递归删除。' : ''}`)) {
      return
    }
    try {
      await invokeBackend('delete_item', { id: item.id })
      await refreshChildren(item.parentId)
    } catch (err) {
      console.error('[secret-disk] 删除失败:', err)
    }
  }

  /** 复制标题到剪贴板。 */
  const handleCopyTitle = (item: NoteListItem) => {
    void navigator.clipboard?.writeText(item.title).catch(() => {})
  }

  /** 刷新全部：清空缓存重新加载根级及已展开文件夹。 */
  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      treeCache.clear()
      await refreshChildren(null)
      const expandedIds = Array.from(expanded)
      await Promise.all(expandedIds.map((id) => refreshChildren(id)))
    } catch (err) {
      console.error('[secret-disk] 刷新失败:', err)
    } finally {
      setRefreshing(false)
    }
  }

  /** 拖拽：开始。 */
  const handleDragStart = (e: React.DragEvent, item: NoteListItem) => {
    dragSourceRef.current = item.id
    e.dataTransfer.effectAllowed = 'move'
  }

  /** 拖拽：经过文件夹（阻止默认行为以允许 drop）。 */
  const handleDragOver = (e: React.DragEvent, item: NoteListItem) => {
    if (item.type !== 'folder') return
    if (dragSourceRef.current === item.id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(item.id)
  }

  /** 拖拽：放下，调用 move_item。 */
  const handleDrop = async (e: React.DragEvent, target: NoteListItem) => {
    e.preventDefault()
    const sourceId = dragSourceRef.current
    setDragOverId(null)
    dragSourceRef.current = null
    if (!sourceId || sourceId === target.id || target.type !== 'folder') return
    try {
      await invokeBackend('move_item', { id: sourceId, targetParentId: target.id })
      // 清空缓存重新加载（简单可靠）
      treeCache.clear()
      await refreshChildren(null)
      const expandedIds = Array.from(expanded)
      await Promise.all(expandedIds.map((id) => refreshChildren(id)))
    } catch (err) {
      console.error('[secret-disk] 移动失败:', err)
    }
  }

  /** 右键菜单触发。 */
  const handleContextMenu = (e: React.MouseEvent, item: NoteListItem | null, parentId: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, item, parentId })
  }

  return (
    <div style={treeContainerStyle}>
      {/* 标题栏（参考 FileTreeView：标题 + 工具按钮组） */}
      <div style={treeHeaderStyle}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>密盘</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button style={toolBtnStyle} onClick={() => setCreating({ parentId: null, type: 'file' })} title="新建笔记">
            <FilePlus size={14} />
          </button>
          <button style={toolBtnStyle} onClick={() => setCreating({ parentId: null, type: 'folder' })} title="新建文件夹">
            <FolderPlus size={14} />
          </button>
          <button style={toolBtnStyle} onClick={handleRefresh} disabled={refreshing} title="刷新">
            <RefreshCw size={14} />
          </button>
          <button style={toolBtnStyle} onClick={onLock} title="锁定密盘">
            <Lock size={14} />
          </button>
        </div>
      </div>

      {/* 文件树 */}
      <div
        style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}
        onContextMenu={(e) => handleContextMenu(e, null, null)}
      >
        {/* 新建输入框（根级） */}
        {creating?.parentId === null && (
          <NewItemInput
            ref={inputRef}
            type={creating.type}
            value={newName}
            onChange={setNewName}
            onSubmit={handleCreate}
            onCancel={() => { setCreating(null); setNewName('') }}
            depth={0}
          />
        )}

        {rootItems.length === 0 && !creating && (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-2, #6b7280)', fontSize: 12 }}>
            空白密盘，点击上方按钮新建笔记或文件夹
          </div>
        )}

        {rootItems.map((item) => (
          <TreeItem
            key={item.id}
            item={item}
            depth={0}
            expanded={expanded}
            treeCache={treeCache}
            invokeBackend={invokeBackend}
            refreshChildren={refreshChildren}
            onSelectNote={onSelectNote}
            onToggle={toggleExpand}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            renaming={renaming}
            setRenaming={setRenaming}
            onRename={handleRename}
            onDelete={handleDelete}
            onContextMenu={handleContextMenu}
            onCreate={setCreating}
            creating={creating}
            newName={newName}
            setNewName={setNewName}
            handleCreate={handleCreate}
            inputRef={inputRef}
            dragOverId={dragOverId}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={() => setDragOverId(null)}
          />
        ))}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenuView
          x={contextMenu.x}
          y={contextMenu.y}
          item={contextMenu.item}
          parentId={contextMenu.parentId}
          onNewFile={(pid) => setCreating({ parentId: pid, type: 'file' })}
          onNewFolder={(pid) => setCreating({ parentId: pid, type: 'folder' })}
          onRename={(item) => setRenaming({ id: item.id, parentId: item.parentId, value: item.title })}
          onDelete={handleDelete}
          onCopyTitle={handleCopyTitle}
        />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
//  递归树项组件
// ════════════════════════════════════════════════════════════════

interface TreeItemProps {
  item: NoteListItem
  depth: number
  expanded: Set<string>
  treeCache: TreeCache
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  refreshChildren: (parentId: string | null) => Promise<NoteListItem[]>
  onSelectNote: (note: NoteListItem) => void
  onToggle: (folder: NoteListItem) => void
  selectedId: string | null
  setSelectedId: (id: string) => void
  renaming: { id: string; parentId: string | null; value: string } | null
  setRenaming: (r: { id: string; parentId: string | null; value: string } | null) => void
  onRename: () => void
  onDelete: (item: NoteListItem) => void
  onContextMenu: (e: React.MouseEvent, item: NoteListItem | null, parentId: string | null) => void
  onCreate: (state: { parentId: string | null; type: 'file' | 'folder' } | null) => void
  creating: { parentId: string | null; type: 'file' | 'folder' } | null
  newName: string
  setNewName: (val: string) => void
  handleCreate: () => void
  inputRef: React.RefObject<HTMLInputElement>
  dragOverId: string | null
  onDragStart: (e: React.DragEvent, item: NoteListItem) => void
  onDragOver: (e: React.DragEvent, item: NoteListItem) => void
  onDrop: (e: React.DragEvent, target: NoteListItem) => void
  onDragEnd: () => void
}

function TreeItem(props: TreeItemProps) {
  const {
    item, depth, expanded, treeCache,
    onSelectNote, onToggle, selectedId, setSelectedId,
    renaming, setRenaming, onRename, onContextMenu,
    onCreate, creating, newName, setNewName, handleCreate, inputRef,
    dragOverId, onDragStart, onDragOver, onDrop, onDragEnd,
  } = props

  const isExpanded = expanded.has(item.id)
  const isRenaming = renaming?.id === item.id
  const isSelected = selectedId === item.id
  const isDragOver = dragOverId === item.id
  const children = treeCache.get(item.id) ?? []

  /** 点击行：选中 + 文件夹展开/文件打开。 */
  const handleClick = () => {
    if (isRenaming) return
    setSelectedId(item.id)
    if (item.type === 'folder') {
      void onToggle(item)
    } else {
      void onSelectNote(item)
    }
  }

  return (
    <div
      draggable={!isRenaming}
      onDragStart={(e) => onDragStart(e, item)}
      onDragOver={(e) => onDragOver(e, item)}
      onDrop={(e) => onDrop(e, item)}
      onDragEnd={onDragEnd}
    >
      <div
        style={{
          ...itemStyle,
          paddingLeft: 8 + depth * 14,
          backgroundColor: isRenaming
            ? 'rgba(59, 130, 246, 0.08)'
            : isDragOver
              ? 'rgba(59, 130, 246, 0.15)'
              : isSelected
                ? 'rgba(59, 130, 246, 0.05)'
                : 'transparent',
        }}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, item, item.parentId)}
      >
        {/* 展开/折叠箭头 */}
        {item.type === 'folder' ? (
          <button
            style={chevronStyle}
            onClick={(e) => { e.stopPropagation(); void onToggle(item) }}
            aria-label={isExpanded ? '折叠' : '展开'}
          >
            <ChevronRight
              size={12}
              style={{ transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'none' }}
            />
          </button>
        ) : (
          <span style={{ width: 14, display: 'inline-block', flexShrink: 0 }} />
        )}

        {/* 文件/文件夹图标 */}
        {item.type === 'folder' ? (
          isExpanded ? <FolderOpen size={14} style={iconStyle} /> : <Folder size={14} style={iconStyle} />
        ) : (
          <FileText size={14} style={iconStyle} />
        )}

        {/* 标题 or 重命名输入框 */}
        {isRenaming ? (
          <input
            ref={inputRef}
            style={renameInputStyle}
            value={renaming!.value}
            onChange={(e) => setRenaming({ ...renaming!, value: e.target.value })}
            onBlur={onRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onRename() }
              if (e.key === 'Escape') { setRenaming(null) }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span style={titleStyle}>{item.title}</span>
        )}
      </div>

      {/* 新建输入框（在文件夹内） */}
      {creating?.parentId === item.id && item.type === 'folder' && (
        <NewItemInput
          ref={inputRef}
          type={creating.type}
          value={newName}
          onChange={setNewName}
          onSubmit={handleCreate}
          onCancel={() => { onCreate(null); setNewName('') }}
          depth={depth + 1}
        />
      )}

      {/* 递归渲染子项 */}
      {isExpanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <TreeItem key={child.id} {...props} item={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
//  新建项目输入框（forwardRef 用于聚焦）
// ════════════════════════════════════════════════════════════════

interface NewItemInputProps {
  type: 'file' | 'folder'
  value: string
  onChange: (val: string) => void
  onSubmit: () => void
  onCancel: () => void
  depth: number
}

const NewItemInput = forwardRef<HTMLInputElement, NewItemInputProps>(function NewItemInput(
  { type, value, onChange, onSubmit, onCancel, depth },
  ref,
) {
  return (
    <div style={{ ...createInputRowStyle, paddingLeft: 8 + depth * 14 }}>
      {type === 'folder' ? <Folder size={14} /> : <FileText size={14} />}
      <input
        ref={ref}
        style={createInputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onSubmit() }
          if (e.key === 'Escape') { onCancel() }
        }}
        placeholder={type === 'folder' ? '文件夹名称' : '笔记名称'}
      />
    </div>
  )
})

// ════════════════════════════════════════════════════════════════
//  右键菜单视图（原生定位，无第三方依赖）
// ════════════════════════════════════════════════════════════════

interface ContextMenuViewProps {
  x: number
  y: number
  item: NoteListItem | null
  parentId: string | null
  onNewFile: (parentId: string | null) => void
  onNewFolder: (parentId: string | null) => void
  onRename: (item: NoteListItem) => void
  onDelete: (item: NoteListItem) => void
  onCopyTitle: (item: NoteListItem) => void
}

function ContextMenuView({
  x, y, item, parentId, onNewFile, onNewFolder, onRename, onDelete, onCopyTitle,
}: ContextMenuViewProps) {
  /** 菜单项点击（阻止冒泡到 window click，避免菜单闪退）。 */
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
  }

  // 简单边界处理：避免超出视口右侧/下侧
  const maxX = typeof window !== 'undefined' ? window.innerWidth - 180 : x
  const maxY = typeof window !== 'undefined' ? window.innerHeight - 240 : y
  const left = Math.min(x, maxX)
  const top = Math.min(y, maxY)

  return (
    <div
      style={{
        ...menuContainerStyle,
        left,
        top,
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
    >
      {/* 文件夹相关：新建子项 */}
      {item?.type === 'folder' && (
        <>
          <button style={menuItemStyle} onClick={stop(() => onNewFile(item.id))}>
            <FileText size={12} /> <span>新建笔记</span>
          </button>
          <button style={menuItemStyle} onClick={stop(() => onNewFolder(item.id))}>
            <Folder size={12} /> <span>新建文件夹</span>
          </button>
          <div style={menuDividerStyle} />
        </>
      )}

      {/* 空白区域：新建根级项 */}
      {!item && (
        <>
          <button style={menuItemStyle} onClick={stop(() => onNewFile(parentId))}>
            <FileText size={12} /> <span>新建笔记</span>
          </button>
          <button style={menuItemStyle} onClick={stop(() => onNewFolder(parentId))}>
            <Folder size={12} /> <span>新建文件夹</span>
          </button>
          <div style={menuDividerStyle} />
        </>
      )}

      {/* 节点相关：重命名/删除/复制标题 */}
      {item && (
        <>
          <button style={menuItemStyle} onClick={stop(() => onRename(item))}>
            <Edit3 size={12} /> <span>重命名</span>
          </button>
          <button style={menuItemStyle} onClick={stop(() => onCopyTitle(item))}>
            <ClipboardCopy size={12} /> <span>复制标题</span>
          </button>
          <div style={menuDividerStyle} />
          <button
            style={{ ...menuItemStyle, color: '#ef4444' }}
            onClick={stop(() => onDelete(item))}
          >
            <Trash2 size={12} /> <span>删除</span>
          </button>
        </>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
//  样式
// ════════════════════════════════════════════════════════════════

// ── 密码内嵌 UI 样式 ──────────────────────────────────────────────

const pwdContainerStyle: React.CSSProperties = {
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  height: '100%',
  boxSizing: 'border-box',
  overflow: 'auto',
}

const pwdHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 8,
  color: 'var(--text-1, #111)',
}

const pwdFieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const pwdLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-2, #6b7280)',
  fontWeight: 500,
}

const pwdInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid var(--border-1, #d1d5db)',
  borderRadius: 6,
  fontSize: 14,
  backgroundColor: 'var(--paper-2, #fff)',
  color: 'var(--text-1, #111)',
  outline: 'none',
  boxSizing: 'border-box',
}

const pwdEyeBtnStyle: React.CSSProperties = {
  position: 'absolute',
  right: 8,
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 4,
  color: 'var(--text-2, #6b7280)',
  display: 'flex',
  alignItems: 'center',
}

const pwdStrengthBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 4,
}

const pwdStrengthFillStyle: React.CSSProperties = {
  height: 4,
  borderRadius: 2,
  transition: 'width 0.2s, background-color 0.2s',
}

const pwdErrorStyle: React.CSSProperties = {
  padding: '8px 12px',
  backgroundColor: 'rgba(239, 68, 68, 0.1)',
  color: '#ef4444',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid rgba(239, 68, 68, 0.2)',
}

const pwdSubmitBtnStyle: React.CSSProperties = {
  padding: '10px 16px',
  border: 'none',
  borderRadius: 6,
  background: 'var(--accent, #3b82f6)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 500,
  marginTop: 4,
}

// ── 文件树样式 ──────────────────────────────────────────────────

const treeContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
}

const treeHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: 40,
  padding: '0 12px',
  borderBottom: '1px solid var(--border-1, #e5e7eb)',
  flexShrink: 0,
}

const toolBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
  color: 'var(--text-2, #6b7280)',
  padding: 0,
}

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 24,
  fontSize: 13,
  whiteSpace: 'nowrap',
  cursor: 'default',
  userSelect: 'none',
}

const chevronStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  color: 'var(--text-2, #6b7280)',
  flexShrink: 0,
}

const iconStyle: React.CSSProperties = {
  flexShrink: 0,
  color: 'var(--text-2, #6b7280)',
}

const titleStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  color: 'var(--text-1, #111)',
}

const renameInputStyle: React.CSSProperties = {
  flex: 1,
  padding: '2px 4px',
  border: '1px solid var(--accent, #3b82f6)',
  borderRadius: 3,
  fontSize: 13,
  backgroundColor: 'var(--paper-1, #fff)',
  color: 'var(--text-1, #111)',
  outline: 'none',
  minWidth: 80,
}

const createInputRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 24,
  color: 'var(--text-2, #6b7280)',
}

const createInputStyle: React.CSSProperties = {
  flex: 1,
  padding: '2px 4px',
  border: '1px solid var(--accent, #3b82f6)',
  borderRadius: 3,
  fontSize: 13,
  backgroundColor: 'var(--paper-1, #fff)',
  color: 'var(--text-1, #111)',
  outline: 'none',
  minWidth: 80,
  marginRight: 8,
}

// ── 右键菜单样式 ────────────────────────────────────────────────

const menuContainerStyle: React.CSSProperties = {
  position: 'fixed',
  minWidth: 160,
  padding: 4,
  backgroundColor: 'var(--paper-2, #fff)',
  border: '1px solid var(--border-1, #d1d5db)',
  borderRadius: 6,
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
  zIndex: 10000,
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
}

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--text-1, #111)',
  textAlign: 'left',
  borderRadius: 4,
}

const menuDividerStyle: React.CSSProperties = {
  height: 1,
  backgroundColor: 'var(--border-1, #e5e7eb)',
  margin: '4px 0',
}
