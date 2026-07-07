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
  ChevronRight, FileText, Trash2, Edit3, Eye, EyeOff, ClipboardCopy, Settings,
} from 'lucide-react'
import type { PluginPanelProps, OpenEditorTabProps, EditorToolbarConfig } from '@swallow-note/plugin-sdk'
import { openEditorTab, closePluginTabs, closeEditorTab, getPluginStorage } from '@swallow-note/plugin-sdk'
import * as Dialog from '@radix-ui/react-dialog'
import { open, save } from '@tauri-apps/plugin-dialog'
import { Database, Download, Upload, KeyRound } from 'lucide-react'
import type { DiskState, NoteListItem, NoteFull } from './types'
import { validatePassword, strengthLabel, strengthColor, PASSWORD_MAX_LEN } from './passwordStrength'

/** 缓存：parentId → 子项列表。null key 表示根级。 */
type TreeCache = Map<string | null, NoteListItem[]>

/** 防抖保存间隔（毫秒）。 */
const SAVE_DEBOUNCE_MS = 500

/** 展开状态持久化 storage key。 */
const EXPANDED_STORAGE_KEY = 'tree-expanded-ids'

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
  const { invokeBackend, getSetting, setSetting, pluginId, events } = props

  const [diskState, setDiskState] = useState<DiskState>('locked')
  const [loading, setLoading] = useState(true)
  const [rootItems, setRootItems] = useState<NoteListItem[]>([])
  const treeCacheRef = useRef<TreeCache>(new Map())
  // parentMap: 记录每个 item 的 parentId，用于 tab 切换时自动展开祖先文件夹
  const parentMapRef = useRef<Map<string, string | null>>(new Map())
  // treeCache 是 ref 不触发 re-render，用 treeVersion 强制刷新子树
  const [treeVersion, setTreeVersion] = useState(0)
  const requirePasswordRef = useRef(false)
  // 当前活跃笔记的 flush 函数（切换/卸载前调用）
  const currentFlushRef = useRef<(() => Promise<void>) | null>(null)
  // 防抖定时器
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 设置对话框状态
  const [requirePassword, setRequirePassword] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importSourcePath, setImportSourcePath] = useState<string | null>(null)
  const [importPassword, setImportPassword] = useState('')
  const [showSettings, setShowSettings] = useState(false)

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
      // 如果已解锁，加载根级子项（切换侧边栏后重新 mount 需要重新加载）
      if (unlocked) {
        const items = (await invokeBackend('list_children', { parentId: null })) as NoteListItem[]
        for (const item of items) {
          parentMapRef.current.set(item.id, null)
        }
        treeCacheRef.current.set(null, items)
        setRootItems(items)
      }
    } catch (err) {
      console.error('[secret-disk] 检查状态失败:', err)
      setLoading(false)
    }
  }, [invokeBackend])

  /** 加载 requirePasswordEveryTime 设置。 */
  useEffect(() => {
    void getSetting<boolean>('requirePasswordEveryTime').then((val) => {
      requirePasswordRef.current = val === true
      setRequirePassword(val === true)
    })
  }, [getSetting])

  /** 启动时检查状态。 */
  useEffect(() => {
    void checkState()
  }, [checkState])

  /** 监听 note:open 事件，同步文件树选中状态。 */
  const activeNoteIdRef = useRef<string | null>(null)
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  useEffect(() => {
    const handler = (payload: { noteId: string; path: string }) => {
      // 仅处理本插件的笔记（path 以 plugin://<pluginId>/ 开头）
      const prefix = `plugin://${pluginId}/`
      if (payload.path.startsWith(prefix)) {
        const noteId = payload.path.slice(prefix.length)
        activeNoteIdRef.current = noteId
        setActiveNoteId(noteId)
      } else {
        // 切换到非密盘 tab，清除选中
        activeNoteIdRef.current = null
        setActiveNoteId(null)
      }
    }
    const unsub = events.on('note:open', handler)
    return unsub
  }, [events, pluginId])

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
      for (const item of items) {
        parentMapRef.current.set(item.id, null)
      }
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
        for (const item of items) {
          parentMapRef.current.set(item.id, parentId)
        }
        treeCacheRef.current.set(parentId, items)
        if (parentId === null) {
          setRootItems(items)
        }
        // 无论 parentId 是否为 null，都触发 treeVersion 更新，确保子组件重新读取 treeCache
        setTreeVersion((v) => v + 1)
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

  /** 锁定密盘：先 flush 再锁定，最后关闭所有密盘 tab。 */
  const handleLock = useCallback(async () => {
    await flushPending()
    try {
      await invokeBackend('lock')
      treeCacheRef.current.clear()
      setRootItems([])
      setDiskState('locked')
      closePluginTabs(pluginId)
    } catch (err) {
      console.error('[secret-disk] 锁定失败:', err)
    }
  }, [invokeBackend, flushPending, pluginId])

  /** 切换"每次打开需要密码"。 */
  const handleToggleRequirePassword = useCallback(
    async (checked: boolean) => {
      setRequirePassword(checked)
      requirePasswordRef.current = checked
      await setSetting('requirePasswordEveryTime', checked)
    },
    [setSetting],
  )

  /** 备份数据库：弹出保存对话框。 */
  const handleBackup = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const targetPath = await save({
      defaultPath: `secret-backup-${today}.swl`,
      filters: [{ name: '密盘数据库', extensions: ['swl'] }],
    })
    if (!targetPath) return

    try {
      await invokeBackend('backup', { targetPath })
      alert('备份成功')
    } catch (err) {
      alert(`备份失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [invokeBackend])

  /** 导入数据库：先选择文件，再内嵌输入密码。 */
  const handleImportSelectFile = useCallback(async () => {
    const sourcePath = await open({
      multiple: false,
      filters: [{ name: '密盘数据库', extensions: ['swl'] }],
    })
    if (typeof sourcePath === 'string') {
      setImportSourcePath(sourcePath)
      setImportPassword('')
      setImporting(true)
    }
  }, [])

  /** 确认导入：用输入的密码验证并替换数据库。 */
  const handleConfirmImport = useCallback(async () => {
    if (!importSourcePath || !importPassword) return
    try {
      await invokeBackend('import_db', {
        sourcePath: importSourcePath,
        password: importPassword,
      })
      alert('导入成功')
      // 导入成功后重新加载根级
      const items = (await invokeBackend('list_children', { parentId: null })) as NoteListItem[]
      treeCacheRef.current.set(null, items)
      setRootItems(items)
    } catch (err) {
      alert(`导入失败，已恢复原数据库：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setImporting(false)
      setImportSourcePath(null)
      setImportPassword('')
    }
  }, [invokeBackend, importSourcePath, importPassword])

  /** 修改密码成功回调。 */
  const handleChangePasswordSuccess = useCallback(() => {
    setShowChangePassword(false)
  }, [])

  // ── 渲染 ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 16, color: 'var(--text-secondary, #666)', fontSize: 13 }}>
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
        treeVersion={treeVersion}
        pluginId={pluginId}
        invokeBackend={invokeBackend}
        refreshChildren={refreshChildren}
        onSelectNote={handleSelectNote}
        onLock={handleLock}
        showSettings={showSettings}
        onSettingsOpenChange={setShowSettings}
        requirePassword={requirePassword}
        onToggleRequirePassword={handleToggleRequirePassword}
        showChangePassword={showChangePassword}
        onShowChangePassword={setShowChangePassword}
        onBackup={handleBackup}
        onImportSelectFile={handleImportSelectFile}
        importing={importing}
        importSourcePath={importSourcePath}
        importPassword={importPassword}
        onImportPasswordChange={setImportPassword}
        onConfirmImport={handleConfirmImport}
        onCancelImport={() => {
          setImporting(false)
          setImportSourcePath(null)
          setImportPassword('')
        }}
        onChangePasswordSuccess={handleChangePasswordSuccess}
        activeNoteId={activeNoteId}
        parentMap={parentMapRef.current}
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
  treeVersion: number
  pluginId: string
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  refreshChildren: (parentId: string | null) => Promise<NoteListItem[]>
  onSelectNote: (note: NoteListItem) => void
  onLock: () => Promise<void>
  // 设置相关 props
  showSettings: boolean
  onSettingsOpenChange: (open: boolean) => void
  requirePassword: boolean
  onToggleRequirePassword: (checked: boolean) => void
  showChangePassword: boolean
  onShowChangePassword: (show: boolean) => void
  onBackup: () => void
  onImportSelectFile: () => void
  importing: boolean
  importSourcePath: string | null
  importPassword: string
  onImportPasswordChange: (val: string) => void
  onConfirmImport: () => void
  onCancelImport: () => void
  onChangePasswordSuccess: () => void
  /** 宿主活跃的笔记 ID，用于同步文件树选中状态 */
  activeNoteId: string | null
  /** id -> parentId 映射，用于 tab 切换时自动展开祖先文件夹 */
  parentMap: Map<string, string | null>
}

function DiskFileTree({
  rootItems,
  treeCache,
  treeVersion,
  pluginId,
  invokeBackend,
  refreshChildren,
  onSelectNote,
  onLock,
  showSettings,
  onSettingsOpenChange,
  requirePassword,
  onToggleRequirePassword,
  showChangePassword,
  onShowChangePassword,
  onBackup,
  onImportSelectFile,
  importing,
  importSourcePath,
  importPassword,
  onImportPasswordChange,
  onConfirmImport,
  onCancelImport,
  onChangePasswordSuccess,
  activeNoteId,
  parentMap,
}: DiskFileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ parentId: string | null; type: 'file' | 'folder' } | null>(null)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; parentId: string | null; value: string } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // 展开状态持久化：mount 时从 storage 读取
  const storageRef = useRef(getPluginStorage(pluginId))
  const refreshChildrenRef = useRef(refreshChildren)
  refreshChildrenRef.current = refreshChildren
  useEffect(() => {
    void storageRef.current.get<string[]>(EXPANDED_STORAGE_KEY).then(async (ids) => {
      if (ids && ids.length > 0) {
        setExpanded(new Set(ids))
        // 修复：重新加载所有已展开文件夹的子项（treeCache 在 unmount 后丢失）
        for (const id of ids) {
          if (!treeCache.has(id)) {
            await refreshChildrenRef.current(id)
          }
        }
      }
    })
  }, [])
  // 展开状态变化时写入 storage
  useEffect(() => {
    void storageRef.current.set(EXPANDED_STORAGE_KEY, Array.from(expanded))
  }, [expanded])
  // 同步宿主活跃笔记 ID 到文件树选中状态
  useEffect(() => {
    if (activeNoteId) {
      setSelectedId(activeNoteId)
      // 自动展开包含该 note 的所有祖先文件夹
      const ancestors: string[] = []
      let currentId: string | null = activeNoteId
      while (currentId) {
        const parentId = parentMap.get(currentId)
        if (parentId !== undefined && parentId !== null) {
          ancestors.push(parentId)
          currentId = parentId
        } else {
          break
        }
      }
      if (ancestors.length > 0) {
        setExpanded((prev) => {
          const next = new Set(prev)
          for (const id of ancestors) {
            next.add(id)
          }
          return next
        })
        // 加载所有祖先的子项（如果未加载）
        for (const id of ancestors) {
          if (!treeCache.has(id)) {
            void refreshChildren(id)
          }
        }
      }
      // 滚动定位到选中项
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-note-id="${activeNoteId}"]`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
      })
    } else {
      setSelectedId(null)
    }
  }, [activeNoteId, parentMap, refreshChildren, treeCache])
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    item: NoteListItem | null
    parentId: string | null
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
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

  /** 关闭右键菜单（点击外部、ESC 或滚动）。
   *  使用 document mousedown 捕获阶段检测点击外部，
   *  比 window click 更可靠（避开 React 合成事件冒泡时序问题）。 */
  useEffect(() => {
    if (!contextMenu) return
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    const onScroll = () => setContextMenu(null)
    // 捕获阶段：在事件向下传递时就检测，避免菜单自身 stopPropagation 的干扰
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
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

  /** 递归收集某节点下所有笔记 id（用于删除文件夹时关闭其下所有 tab）。 */
  const collectNoteIds = useCallback(async (id: string): Promise<string[]> => {
    const items = (await invokeBackend('list_children', { parentId: id })) as NoteListItem[]
    const ids: string[] = []
    for (const child of items) {
      if (child.type === 'file') {
        ids.push(child.id)
      } else {
        ids.push(...(await collectNoteIds(child.id)))
      }
    }
    return ids
  }, [invokeBackend])

  /** 删除项目。 */
  const handleDelete = async (item: NoteListItem) => {
    if (!confirm(`确定删除「${item.title}」？${item.type === 'folder' ? '文件夹内的所有内容将被递归删除。' : ''}`)) {
      return
    }
    try {
      // 先收集需要关闭的 tab id（删除后端数据后 id 仍可用）
      const noteIdsToClose: string[] = item.type === 'file'
        ? [item.id]
        : await collectNoteIds(item.id)

      await invokeBackend('delete_item', { id: item.id })
      await refreshChildren(item.parentId)

      // 关闭对应编辑器 tab
      for (const noteId of noteIdsToClose) {
        closeEditorTab(pluginId, noteId)
      }
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
      await invokeBackend('move_item', { id: sourceId, newParentId: target.id })
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

  const findItemById = useCallback((id: string): NoteListItem | undefined => {
    const search = (items: NoteListItem[]): NoteListItem | undefined => {
      for (const item of items) {
        if (item.id === id) return item
        if (item.type === 'folder') {
          const children = treeCache.get(item.id) ?? []
          const found = search(children)
          if (found) return found
        }
      }
      return undefined
    }
    return search(rootItems)
  }, [rootItems, treeCache])

  /** 开始新建：设置 creating 状态，若目标父文件夹非空则自动展开并加载子项。 */
  const startCreate = (parentId: string | null, type: 'file' | 'folder') => {
    let actualParentId = parentId
    if (actualParentId) {
      const selectedItem = findItemById(actualParentId)
      if (selectedItem?.type === 'folder') {
        setExpanded((prev) => {
          const next = new Set(prev)
          next.add(actualParentId!)
          return next
        })
        if (!treeCache.has(actualParentId)) {
          void refreshChildren(actualParentId)
        }
      } else {
        actualParentId = selectedItem?.parentId ?? null
      }
    }
    setCreating({ parentId: actualParentId, type })
    setNewName('')
  }

  return (
    <div style={treeContainerStyle}>
      {/* 标题栏（参考 FileTreeView：标题 + 工具按钮组） */}
      <div style={treeHeaderStyle}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>密盘</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            style={toolBtnStyle}
            onClick={() => startCreate(selectedId, 'file')}
            title="新建笔记"
          >
            <FilePlus size={14} />
          </button>
          <button
            style={toolBtnStyle}
            onClick={() => startCreate(selectedId, 'folder')}
            title="新建文件夹"
          >
            <FolderPlus size={14} />
          </button>
          <button style={toolBtnStyle} onClick={handleRefresh} disabled={refreshing} title="刷新">
            <RefreshCw size={14} />
          </button>
          <button style={toolBtnStyle} onClick={onLock} title="锁定密盘">
            <Lock size={14} />
          </button>
          <button style={toolBtnStyle} onClick={() => onSettingsOpenChange(true)} title="设置">
            <Settings size={14} />
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
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-secondary, #666)', fontSize: 12 }}>
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
            treeVersion={treeVersion}
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
          ref={menuRef}
          x={contextMenu.x}
          y={contextMenu.y}
          item={contextMenu.item}
          parentId={contextMenu.parentId}
          onNewFile={(pid) => startCreate(pid, 'file')}
          onNewFolder={(pid) => startCreate(pid, 'folder')}
          onRename={(item) => setRenaming({ id: item.id, parentId: item.parentId, value: item.title })}
          onDelete={handleDelete}
          onCopyTitle={handleCopyTitle}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* 设置对话框（使用 radix-ui/react-dialog） */}
      <Dialog.Root open={showSettings} onOpenChange={onSettingsOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay style={settingsOverlayStyle} />
          <Dialog.Content style={settingsContentStyle}>
            <Dialog.Title style={settingsTitleStyle}>密盘设置</Dialog.Title>

            {/* 每次打开需要密码 */}
            <div style={settingsSectionStyle}>
              <label style={settingsLabelRowStyle}>
                <input
                  type="checkbox"
                  checked={requirePassword}
                  onChange={(e) => void onToggleRequirePassword(e.target.checked)}
                  style={settingsCheckboxStyle}
                />
                <span>每次打开需要密码</span>
              </label>
              <p style={settingsHintStyle}>勾选后，每次打开密盘面板都需要输入密码。关闭面板时自动锁定数据库。</p>
            </div>

            <div style={settingsDividerStyle} />

            {/* 数据库管理 */}
            <div style={settingsSectionStyle}>
              <div style={settingsSectionTitleStyle}>
                <Database size={14} />
                <span>数据库管理</span>
              </div>

              <button style={settingsButtonStyle} onClick={onBackup}>
                <Download size={14} />
                <span>备份数据库</span>
              </button>

              <button style={settingsButtonStyle} onClick={onImportSelectFile}>
                <Upload size={14} />
                <span>导入数据库</span>
              </button>
            </div>

            <div style={settingsDividerStyle} />

            {/* 修改密码 */}
            <div style={settingsSectionStyle}>
              {!showChangePassword ? (
                <button style={settingsButtonStyle} onClick={() => onShowChangePassword(true)}>
                  <KeyRound size={14} />
                  <span>修改密码</span>
                </button>
              ) : (
                <ChangePasswordInline
                  invokeBackend={invokeBackend}
                  onSuccess={onChangePasswordSuccess}
                  onCancel={() => onShowChangePassword(false)}
                />
              )}
            </div>

            <div style={settingsDividerStyle} />

            {/* 导入数据库：内嵌密码输入 */}
            {importing && importSourcePath && (
              <div style={settingsSectionStyle}>
                <div style={settingsSectionTitleStyle}>
                  <Lock size={14} />
                  <span>输入导入数据库的密码</span>
                </div>
                <input
                  type="password"
                  style={settingsInputStyle}
                  autoFocus
                  value={importPassword}
                  onChange={(e) => onImportPasswordChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void onConfirmImport()
                    if (e.key === 'Escape') {
                      onCancelImport()
                    }
                  }}
                  placeholder="密码"
                  maxLength={PASSWORD_MAX_LEN}
                />
                <div style={{ fontSize: 11, color: 'var(--text-secondary, #666)', wordBreak: 'break-all' }}>
                  文件：{importSourcePath}
                </div>
                <div style={settingsActionsStyle}>
                  <button
                    style={settingsCancelBtnStyle}
                    onClick={onCancelImport}
                  >
                    取消
                  </button>
                  <button
                    style={{ ...settingsSubmitBtnStyle, opacity: importPassword ? 1 : 0.5, cursor: importPassword ? 'pointer' : 'not-allowed' }}
                    onClick={onConfirmImport}
                    disabled={!importPassword}
                  >
                    确认导入
                  </button>
                </div>
              </div>
            )}

            <Dialog.Close asChild>
              <button style={settingsCloseBtnStyle}>关闭</button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
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
  treeVersion: number
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
    item, depth, expanded, treeCache, treeVersion,
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
        data-note-id={item.id}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, item, null)}
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
  onClose: () => void
}

const ContextMenuView = forwardRef<HTMLDivElement, ContextMenuViewProps>(function ContextMenuView(
  { x, y, item, parentId, onNewFile, onNewFolder, onRename, onDelete, onCopyTitle, onClose },
  ref,
) {
  /** 菜单项点击：执行操作后主动关闭菜单（点击外部由 document mousedown 处理）。 */
  const handleItemClick = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
    onClose()
  }

  // 简单边界处理：避免超出视口右侧/下侧
  const maxX = typeof window !== 'undefined' ? window.innerWidth - 180 : x
  const maxY = typeof window !== 'undefined' ? window.innerHeight - 240 : y
  const left = Math.min(x, maxX)
  const top = Math.min(y, maxY)

  return (
    <div
      ref={ref}
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
          <button style={menuItemStyle} onClick={handleItemClick(() => onNewFile(item.id))}>
            <FileText size={12} /> <span>新建笔记</span>
          </button>
          <button style={menuItemStyle} onClick={handleItemClick(() => onNewFolder(item.id))}>
            <Folder size={12} /> <span>新建文件夹</span>
          </button>
          <div style={menuDividerStyle} />
        </>
      )}

      {/* 空白区域：新建根级项 */}
      {!item && (
        <>
          <button style={menuItemStyle} onClick={handleItemClick(() => onNewFile(null))}>
            <FileText size={12} /> <span>新建笔记</span>
          </button>
          <button style={menuItemStyle} onClick={handleItemClick(() => onNewFolder(null))}>
            <Folder size={12} /> <span>新建文件夹</span>
          </button>
          <div style={menuDividerStyle} />
        </>
      )}

      {/* 节点相关：重命名/删除/复制标题 */}
      {item && (
        <>
          <button style={menuItemStyle} onClick={handleItemClick(() => onRename(item))}>
            <Edit3 size={12} /> <span>重命名</span>
          </button>
          <button style={menuItemStyle} onClick={handleItemClick(() => onCopyTitle(item))}>
            <ClipboardCopy size={12} /> <span>复制标题</span>
          </button>
          <div style={menuDividerStyle} />
          <button
            style={{ ...menuItemStyle, color: '#ef4444' }}
            onClick={handleItemClick(() => onDelete(item))}
          >
            <Trash2 size={12} /> <span>删除</span>
          </button>
        </>
      )}
    </div>
  )
})

// ════════════════════════════════════════════════════════════════
//  样式
// ════════════════════════════════════════════════════════════════

// ── 密码内嵌 UI 样式 ──────────────────────────────────────────────

const pwdContainerStyle: React.CSSProperties = {
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  boxSizing: 'border-box',
  overflow: 'auto',
}

const pwdHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 8,
  color: 'var(--text-primary, #1f1f1f)',
}

const pwdFieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const pwdLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-secondary, #666)',
  fontWeight: 500,
}

const pwdInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid var(--border-color, #e5e5e5)',
  borderRadius: 6,
  fontSize: 14,
  backgroundColor: 'var(--bg-primary, #EDEFF2)',
  color: 'var(--text-primary, #1f1f1f)',
  outline: 'none',
  boxSizing: 'border-box',
  minHeight: 36,
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
  color: 'var(--text-secondary, #666)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 4,
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
  backgroundColor: '#3b82f6',
  background: 'var(--theme-color, #3b82f6)',
  color: '#ffffff',
  fontSize: 14,
  fontWeight: 500,
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 40,
  cursor: 'pointer',
  marginTop: 8,
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
  borderBottom: '1px solid var(--border-color, #e5e5e5)',
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
  color: 'var(--text-secondary, #666)',
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
  color: 'var(--text-secondary, #666)',
  flexShrink: 0,
}

const iconStyle: React.CSSProperties = {
  flexShrink: 0,
  color: 'var(--text-secondary, #666)',
}

const titleStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  color: 'var(--text-primary, #1f1f1f)',
}

const renameInputStyle: React.CSSProperties = {
  flex: 1,
  padding: '2px 4px',
  border: '1px solid var(--theme-color, #3b82f6)',
  borderRadius: 3,
  fontSize: 13,
  backgroundColor: 'var(--bg-secondary, #ffffff)',
  color: 'var(--text-primary, #1f1f1f)',
  outline: 'none',
  minWidth: 80,
}

const createInputRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 24,
  color: 'var(--text-secondary, #666)',
}

const createInputStyle: React.CSSProperties = {
  flex: 1,
  padding: '2px 4px',
  border: '1px solid var(--theme-color, #3b82f6)',
  borderRadius: 3,
  fontSize: 13,
  backgroundColor: 'var(--bg-secondary, #ffffff)',
  color: 'var(--text-primary, #1f1f1f)',
  outline: 'none',
  minWidth: 80,
  marginRight: 8,
}

// ── 右键菜单样式 ────────────────────────────────────────────────

const menuContainerStyle: React.CSSProperties = {
  position: 'fixed',
  minWidth: 160,
  padding: 4,
  backgroundColor: 'var(--bg-primary, #EDEFF2)',
  border: '1px solid var(--border-color, #e5e5e5)',
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
  color: 'var(--text-primary, #1f1f1f)',
  textAlign: 'left',
  borderRadius: 4,
}

const menuDividerStyle: React.CSSProperties = {
  height: 1,
  backgroundColor: 'var(--border-color, #e5e5e5)',
  margin: '4px 0',
}

// ── 设置对话框样式 ──────────────────────────────────────────────

const settingsOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  zIndex: 10000,
}

const settingsContentStyle: React.CSSProperties = {
  position: 'fixed',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  width: '100%',
  maxWidth: 400,
  backgroundColor: 'var(--bg-primary, #EDEFF2)',
  border: '1px solid var(--border-color, #e5e5e5)',
  borderRadius: 8,
  padding: 16,
  zIndex: 10001,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
}

const settingsTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  margin: '0 0 16px 0',
  color: 'var(--text-primary, #1f1f1f)',
}

const settingsSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const settingsLabelRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--text-primary, #1f1f1f)',
}

const settingsCheckboxStyle: React.CSSProperties = {
  cursor: 'pointer',
}

const settingsHintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-secondary, #666)',
  margin: 0,
  lineHeight: 1.5,
}

const settingsDividerStyle: React.CSSProperties = {
  height: 1,
  backgroundColor: 'var(--border-color, #e5e5e5)',
  margin: '12px 0',
}

const settingsSectionTitleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-secondary, #666)',
  marginBottom: 4,
}

const settingsButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  border: '1px solid var(--border-color, #e5e5e5)',
  borderRadius: 6,
  background: 'var(--bg-secondary, #ffffff)',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--text-primary, #1f1f1f)',
}

const settingsInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid var(--border-color, #e5e5e5)',
  borderRadius: 6,
  fontSize: 14,
  backgroundColor: 'var(--bg-secondary, #ffffff)',
  color: 'var(--text-primary, #1f1f1f)',
  outline: 'none',
  boxSizing: 'border-box',
}

const settingsActionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 4,
}

const settingsCancelBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  border: '1px solid var(--border-color, #e5e5e5)',
  borderRadius: 6,
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--text-primary, #1f1f1f)',
}

const settingsSubmitBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  border: 'none',
  borderRadius: 6,
  background: 'var(--theme-color, #3b82f6)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
}

const settingsCloseBtnStyle: React.CSSProperties = {
  marginTop: 16,
  padding: '8px 16px',
  border: 'none',
  borderRadius: 6,
  background: 'var(--theme-color, #3b82f6)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
  width: '100%',
}

// ── 修改密码内嵌组件 ──────────────────────────────────────────────

interface ChangePasswordInlineProps {
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  onSuccess: () => void
  onCancel: () => void
}

function ChangePasswordInline({ invokeBackend, onSuccess, onCancel }: ChangePasswordInlineProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const validation = validatePassword(newPassword)

  const canSubmit = (() => {
    if (loading) return false
    return (
      currentPassword.length > 0 &&
      validation?.valid === true &&
      newPassword === confirmPassword
    )
  })()

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError('')
    try {
      await invokeBackend('change_password', {
        currentPassword,
        newPassword,
      })
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
    } else if (e.key === 'Escape') {
      onCancel()
    }
  }

  const inputType = showPassword ? 'text' : 'password'

  return (
    <div style={changePwdContainerStyle} onKeyDown={handleKeyDown}>
      <div style={settingsSectionTitleStyle}>
        <KeyRound size={14} />
        <span>修改密码</span>
      </div>

      <div style={pwdFieldStyle}>
        <label style={pwdLabelStyle}>当前密码</label>
        <input
          type={inputType}
          style={settingsInputStyle}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="输入当前密码"
          maxLength={PASSWORD_MAX_LEN}
          autoFocus
        />
      </div>

      <div style={pwdFieldStyle}>
        <label style={pwdLabelStyle}>新密码</label>
        <div style={{ position: 'relative' }}>
          <input
            type={inputType}
            style={{ ...settingsInputStyle, paddingRight: 36 }}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="输入新密码（至少 8 位，含字母和数字）"
            maxLength={PASSWORD_MAX_LEN}
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
        {newPassword.length > 0 && validation && (
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

      <div style={pwdFieldStyle}>
        <label style={pwdLabelStyle}>确认新密码</label>
        <input
          type={inputType}
          style={settingsInputStyle}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="再次输入新密码"
          maxLength={PASSWORD_MAX_LEN}
        />
        {confirmPassword.length > 0 && newPassword !== confirmPassword && (
          <span style={{ fontSize: 11, color: '#ef4444', marginTop: 4, display: 'block' }}>
            两次输入的密码不一致
          </span>
        )}
      </div>

      {error && <div style={pwdErrorStyle}>{error}</div>}

      <div style={settingsActionsStyle}>
        <button style={settingsCancelBtnStyle} onClick={onCancel} disabled={loading}>
          取消
        </button>
        <button
          style={{ ...settingsSubmitBtnStyle, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {loading ? '处理中…' : '确认修改'}
        </button>
      </div>
    </div>
  )
}

const changePwdContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 12,
  border: '1px solid var(--border-color, #e5e5e5)',
  borderRadius: 6,
  backgroundColor: 'var(--bg-secondary, #ffffff)',
}
