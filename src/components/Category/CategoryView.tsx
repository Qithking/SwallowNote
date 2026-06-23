import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ChevronRight, Folder, FolderOpen, RefreshCw, Plus, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCategoryStore, type CategoryNode } from '@/stores'
import { useEditorStore } from '@/stores'
import { cn } from '@/lib/utils'
import { getFileIcon } from '@/lib/utils/fileIcon'
import { loadFileContent } from '@/lib/api'
import { countWords } from '@/lib/utils/wordCount'

export function CategoryView() {
  const { t } = useTranslation()
  const tree = useCategoryStore((s) => s.tree)
  const loading = useCategoryStore((s) => s.loading)
  const loadTree = useCategoryStore((s) => s.loadTree)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string; name: string } | null>(null)
  const [newItem, setNewItem] = useState<{ parentPath: string; name: string } | null>(null)
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const newInputRef = useRef<HTMLInputElement>(null)

  // 监听文件保存事件，刷新分类树
  // index_saved_file 已同步更新 md_frontmatter 表，可直接刷新
  useEffect(() => {
    const handleFileSaved = () => {
      useCategoryStore.getState().loadTree()
    }
    window.addEventListener('file-saved', handleFileSaved)
    return () => {
      window.removeEventListener('file-saved', handleFileSaved)
    }
  }, [])

  // 点击空白处关闭右键菜单
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    if (contextMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu])

  // 编辑输入框自动聚焦
  useEffect(() => {
    if (editingPath) {
      setTimeout(() => editInputRef.current?.focus(), 0)
    }
  }, [editingPath])

  // 新建输入框自动聚焦
  useEffect(() => {
    if (newItem) {
      setTimeout(() => newInputRef.current?.focus(), 0)
    }
  }, [newItem])

  const addTab = useEditorStore((s) => s.addTab)

  const openFile = useCallback(async (filePath: string) => {
    try {
      const content = await loadFileContent(filePath)
      const fileName = filePath.split('/').pop() || filePath
      addTab({
        id: filePath,
        path: filePath,
        name: fileName,
        content,
        isDirty: false,
        isEdited: false,
        viewMode: 'preview',
        fileSize: content.length > 1024 ? `${(content.length / 1024).toFixed(1)}Kb` : `${content.length}B`,
        modifiedTime: new Date().toLocaleString(),
        wordCount: countWords(content),
      })
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }, [addTab])

  // 右键菜单
  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, name: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, path, name })
  }, [])

  // 重命名分类
  const handleStartRename = useCallback((path: string, name: string) => {
    setEditingPath(path)
    setEditingName(name)
    setContextMenu(null)
  }, [])

  const handleFinishRename = useCallback(async () => {
    if (!editingPath || !editingName.trim()) {
      setEditingPath(null)
      return
    }
    const newName = editingName.trim()
    // 计算新路径：替换最后一段
    const lastSlash = editingPath.lastIndexOf('/')
    const newPath = lastSlash >= 0
      ? editingPath.substring(0, lastSlash + 1) + newName
      : newName

    if (newPath !== editingPath) {
      try {
        await invoke('rename_category', { oldPath: editingPath, newPath })
        // 同步更新已打开 tab 的 frontmatter.categories
        useEditorStore.getState().renameCategoryInTabs(editingPath, newPath)
        await useCategoryStore.getState().loadTree()
      } catch {
        // 静默失败
      }
    }
    setEditingPath(null)
  }, [editingPath, editingName])

  const handleCancelRename = useCallback(() => {
    setEditingPath(null)
  }, [])

  // 删除分类
  const handleDelete = useCallback(async (path: string) => {
    setContextMenu(null)
    try {
      await invoke('delete_category', { path })
      // 同步更新已打开 tab 的 frontmatter.categories
      useEditorStore.getState().removeCategoryFromTabs(path)
      await useCategoryStore.getState().loadTree()
    } catch {
      // 静默失败
    }
  }, [])

  // 新建子分类
  const handleStartNew = useCallback((parentPath: string) => {
    setNewItem({ parentPath, name: '' })
    setContextMenu(null)
  }, [])

  // 新建根级分类
  const handleNewRoot = useCallback(() => {
    setNewItem({ parentPath: '', name: '' })
  }, [])

  const handleFinishNew = useCallback(async () => {
    if (!newItem || !newItem.name.trim()) {
      setNewItem(null)
      return
    }
    const trimmed = newItem.name.trim()
    const fullPath = newItem.parentPath ? `${newItem.parentPath}/${trimmed}` : trimmed

    // 持久化空分类到 categories 表，等待完成后再刷新
    await invoke('create_category', { path: fullPath }).catch(() => {})

    await useCategoryStore.getState().loadTree()
    setNewItem(null)
  }, [newItem])

  const handleCancelNew = useCallback(() => {
    setNewItem(null)
  }, [])

  return (
    <div className="flex flex-col h-full" onClick={() => setContextMenu(null)}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('category.title')}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleNewRoot}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            title={t('category.newCategory')}
          >
            <Plus size={12} />
          </button>
          <button
            onClick={loadTree}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            title={t('common.refresh')}
          >
            <RefreshCw size={12} className={cn(loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* 分类树 */}
      <div className="flex-1 overflow-auto scrollable-area">
        {tree.length === 0 && !newItem ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            {t('category.empty')}
          </div>
        ) : (
          <div className="py-1">
            {tree.map((node) => (
              <CategoryTreeNode
                key={node.path}
                node={node}
                depth={0}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                openFile={openFile}
                onContextMenu={handleContextMenu}
                editingPath={editingPath}
                editingName={editingName}
                editInputRef={editInputRef}
                setEditingName={setEditingName}
                onFinishEdit={handleFinishRename}
                onCancelEdit={handleCancelRename}
                newItem={newItem}
                newInputRef={newInputRef}
                setNewItem={setNewItem}
                onFinishNew={handleFinishNew}
                onCancelNew={handleCancelNew}
              />
            ))}
            {/* 根级新建输入框 */}
            {newItem && newItem.parentPath === '' && (
              <div
                className="flex items-center gap-1 px-2 py-0.5 text-xs"
                style={{ paddingLeft: '8px' }}
              >
                <Folder size={13} className="shrink-0 text-amber-500" />
                <input
                  ref={newInputRef}
                  type="text"
                  value={newItem.name}
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinishNew()
                    if (e.key === 'Escape') handleCancelNew()
                  }}
                  onBlur={handleFinishNew}
                  placeholder={t('category.newCategoryPlaceholder')}
                  className="flex-1 h-5 px-1 text-xs bg-transparent border border-border/50 rounded outline-none focus:border-primary/50"
                  style={{ color: 'var(--text-primary)' }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed z-50 border border-border rounded-md bg-popover shadow-lg py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-left"
            onClick={() => handleStartRename(contextMenu.path, contextMenu.name)}
          >
            <Pencil size={11} />
            {t('category.rename')}
          </button>
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-left"
            onClick={() => handleStartNew(contextMenu.path)}
          >
            <Plus size={11} />
            {t('category.newSubCategory')}
          </button>
          <div className="border-t border-border/50 my-1" />
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-destructive text-left"
            onClick={() => handleDelete(contextMenu.path)}
          >
            <Trash2 size={11} />
            {t('category.delete')}
          </button>
        </div>
      )}
    </div>
  )
}

/// 分类树节点组件（含内联文件列表）
function CategoryTreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
  openFile,
  onContextMenu,
  editingPath,
  editingName,
  editInputRef,
  setEditingName,
  onFinishEdit,
  onCancelEdit,
  newItem,
  newInputRef,
  setNewItem,
  onFinishNew,
  onCancelNew,
}: {
  node: CategoryNode
  depth: number
  selectedPath: string | null
  onSelect: (path: string | null) => void
  openFile: (filePath: string) => void
  onContextMenu: (e: React.MouseEvent, path: string, name: string) => void
  editingPath: string | null
  editingName: string
  editInputRef: React.RefObject<HTMLInputElement | null>
  setEditingName: (name: string) => void
  onFinishEdit: () => void
  onCancelEdit: () => void
  newItem: { parentPath: string; name: string } | null
  newInputRef: React.RefObject<HTMLInputElement | null>
  setNewItem: (item: { parentPath: string; name: string } | null) => void
  onFinishNew: () => void
  onCancelNew: () => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(depth < 1)
  const hasChildren = node.children.length > 0
  const hasFiles = (node.files?.length ?? 0) > 0
  const isEditing = editingPath === node.path
  const isSelected = selectedPath === node.path

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-0.5 cursor-pointer text-xs select-none',
          isSelected
            ? 'bg-primary/10 text-[var(--text-primary)]'
            : 'hover:bg-accent/50 text-[var(--text-secondary)]',
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => {
          onSelect(node.path)
          if (hasChildren || hasFiles) setExpanded(!expanded)
        }}
        onContextMenu={(e) => onContextMenu(e, node.path, node.name)}
      >
        {hasChildren || hasFiles ? (
          <ChevronRight
            size={12}
            className={cn(
              'shrink-0 text-muted-foreground transition-transform duration-150',
              expanded && 'rotate-90',
            )}
          />
        ) : (
          <span className="w-3" />
        )}
        {hasChildren ? (
          expanded ? (
            <FolderOpen size={13} className="shrink-0 text-amber-500" />
          ) : (
            <Folder size={13} className="shrink-0 text-amber-500" />
          )
        ) : (
          <Folder size={13} className="shrink-0 text-muted-foreground" />
        )}
        {isEditing ? (
          <input
            ref={editInputRef}
            type="text"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={onFinishEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onFinishEdit()
              if (e.key === 'Escape') onCancelEdit()
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 h-5 px-1 text-xs bg-transparent border border-border/50 rounded outline-none focus:border-primary/50"
            style={{ color: 'var(--text-primary)' }}
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
        {node.count > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
            {node.count}
          </span>
        )}
      </div>

      {/* 展开内容：文件列表 + 子分类 */}
      {expanded && (
        <div>
          {/* 文件列表 - 内联在分类节点下 */}
          {node.files?.map((file) => {
            const fileName = file.file_path.split('/').pop() || file.file_path
            return (
              <div
                key={file.file_path}
                className="flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-accent/50 text-xs"
                style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
                onClick={(e) => {
                  e.stopPropagation()
                  openFile(file.file_path)
                }}
              >
                <span className="w-3 shrink-0" />
                <span className="shrink-0 flex items-center justify-center w-3 h-3">
                  {getFileIcon(fileName)}
                </span>
                <span className="truncate text-muted-foreground">
                  {fileName}
                </span>
              </div>
            )
          })}

          {/* 子分类 */}
          {node.children.map((child) => (
            <CategoryTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              openFile={openFile}
              onContextMenu={onContextMenu}
              editingPath={editingPath}
              editingName={editingName}
              editInputRef={editInputRef}
              setEditingName={setEditingName}
              onFinishEdit={onFinishEdit}
              onCancelEdit={onCancelEdit}
              newItem={newItem}
              newInputRef={newInputRef}
              setNewItem={setNewItem}
              onFinishNew={onFinishNew}
              onCancelNew={onCancelNew}
            />
          ))}

          {/* 新建子分类输入框 */}
          {newItem && newItem.parentPath === node.path && (
            <div
              className="flex items-center gap-1 px-2 py-0.5 text-xs"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              <Folder size={13} className="shrink-0 text-amber-500" />
              <input
                ref={newInputRef}
                type="text"
                value={newItem.name}
                onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onFinishNew()
                  if (e.key === 'Escape') onCancelNew()
                }}
                onBlur={onFinishNew}
                placeholder={t('category.newCategoryPlaceholder')}
                className="flex-1 h-5 px-1 text-xs bg-transparent border border-border/50 rounded outline-none focus:border-primary/50"
                style={{ color: 'var(--text-primary)' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
