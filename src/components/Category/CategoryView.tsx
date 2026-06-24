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
import { FullPathTooltip } from '@/components/Search/FullPathTooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'

export function CategoryView() {
  const { t } = useTranslation()
  const tree = useCategoryStore((s) => s.tree)
  const loading = useCategoryStore((s) => s.loading)
  const loadTree = useCategoryStore((s) => s.loadTree)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
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

  // 重命名分类
  const handleStartRename = useCallback((path: string, name: string) => {
    setEditingPath(path)
    setEditingName(name)
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
      } catch (e) {
        console.error('Failed to rename category:', editingPath, '->', newPath, e)
      }
    }
    setEditingPath(null)
  }, [editingPath, editingName])

  const handleCancelRename = useCallback(() => {
    setEditingPath(null)
  }, [])

  // 删除分类：弹出确认对话框
  const handleDelete = useCallback((path: string) => {
    setDeleteTarget(path)
  }, [])

  // 确认删除分类
  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    const path = deleteTarget
    setDeleteTarget(null)
    try {
      await invoke('delete_category', { path })
      // 同步更新已打开 tab 的 frontmatter.categories
      useEditorStore.getState().removeCategoryFromTabs(path)
      // 自动保存所有受影响的 tab，确保磁盘 YAML 与数据库一致
      await useEditorStore.getState().saveAllDirtyTabs()
      await useCategoryStore.getState().loadTree()
    } catch (e) {
      console.error('Failed to delete category:', path, e)
    }
  }, [deleteTarget])

  // 新建子分类
  const handleStartNew = useCallback((parentPath: string) => {
    setNewItem({ parentPath, name: '' })
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
    await invoke('create_category', { path: fullPath }).catch((e) => {
      console.error('Failed to create category:', fullPath, e)
    })

    await useCategoryStore.getState().loadTree()
    setNewItem(null)
  }, [newItem])

  const handleCancelNew = useCallback(() => {
    setNewItem(null)
  }, [])

  return (
    <div className="flex flex-col h-full">
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
                onStartRename={handleStartRename}
                onStartNew={handleStartNew}
                onDelete={handleDelete}
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

      {/* 删除分类确认对话框 */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('category.deleteCategory')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('category.confirmDelete', { name: deleteTarget?.split('/').pop() || deleteTarget })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>{t('category.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  onStartRename,
  onStartNew,
  onDelete,
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
  onStartRename: (path: string, name: string) => void
  onStartNew: (parentPath: string) => void
  onDelete: (path: string) => void
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
      <ContextMenu>
        <ContextMenuTrigger asChild>
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
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onStartRename(node.path, node.name)}>
            <Pencil size={11} className="mr-2" />
            {t('category.rename')}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onStartNew(node.path)}>
            <Plus size={11} className="mr-2" />
            {t('category.newSubCategory')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive"
            onClick={() => onDelete(node.path)}
          >
            <Trash2 size={11} className="mr-2" />
            {t('category.delete')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

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
                <FullPathTooltip content={file.file_path}>
                  <span className="truncate text-muted-foreground">
                    {fileName}
                  </span>
                </FullPathTooltip>
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
              onStartRename={onStartRename}
              onStartNew={onStartNew}
              onDelete={onDelete}
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
