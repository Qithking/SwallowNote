import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ChevronRight, Folder, FolderOpen, Check, X, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useCategoryStore, type CategoryNode } from '@/stores'

interface CategoryTreeSelectProps {
  value: string[]
  onChange: (categories: string[]) => void
}

export function CategoryTreeSelect({ value, onChange }: CategoryTreeSelectProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const tree = useCategoryStore((s) => s.tree)
  const [search, setSearch] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [showNewInput, setShowNewInput] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setShowNewInput(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  const toggleCategory = useCallback((path: string) => {
    const newValue = value.includes(path)
      ? value.filter((v) => v !== path)
      : [...value, path]
    onChange(newValue)
  }, [value, onChange])

  const removeCategory = useCallback((path: string) => {
    onChange(value.filter((v) => v !== path))
  }, [value, onChange])

  const addNewCategory = useCallback(() => {
    const trimmed = newCategory.trim()
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed])
      // 持久化新分类到 Rust categories 表（不刷新树，等保存后由 file-saved 事件驱动）
      const categoryExists = (nodes: CategoryNode[], path: string): boolean => {
        for (const node of nodes) {
          if (node.path === path) return true
          if (node.children.length > 0 && categoryExists(node.children, path)) return true
        }
        return false
      }
      if (!categoryExists(tree, trimmed)) {
        invoke('create_category', { path: trimmed }).catch(() => {})
      }
      setNewCategory('')
      setShowNewInput(false)
    }
  }, [newCategory, value, onChange, tree])

  // 搜索过滤
  const filterTree = useCallback((nodes: CategoryNode[], query: string): CategoryNode[] => {
    if (!query) return nodes
    const lowerQuery = query.toLowerCase()
    return nodes.reduce<CategoryNode[]>((acc, node) => {
      const childMatch = filterTree(node.children, query)
      const selfMatch = node.path.toLowerCase().includes(lowerQuery) || node.name.toLowerCase().includes(lowerQuery)
      if (selfMatch || childMatch.length > 0) {
        acc.push({ ...node, children: childMatch })
      }
      return acc
    }, [])
  }, [])

  const filteredTree = filterTree(tree, search)

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      {/* 已选分类 chip - 对齐 np-select-trigger 样式 */}
      <div
        className="flex flex-wrap gap-0.5 items-center border border-border rounded cursor-pointer hover:border-primary/50 bg-transparent"
        style={{ height: 26, fontSize: '11.5px', minWidth: 80, borderRadius: 4, padding: '0 6px' }}
        onClick={() => setOpen(!open)}
      >
        {value.length === 0 ? (
          <span className="text-[11.5px] text-muted-foreground truncate">
            {t('category.searchPlaceholder')}
          </span>
        ) : (
          value.map((cat) => (
            <span
              key={cat}
              className="inline-flex items-center gap-0.5 px-1 py-0 text-[10px] bg-accent rounded leading-tight shrink-0"
            >
              {cat.split('/').pop()}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeCategory(cat)
                }}
                className="hover:text-destructive"
              >
                <X size={8} />
              </button>
            </span>
          ))
        )}
      </div>

      {/* 下拉面板 - 右对齐 */}
      {open && (
        <div className="absolute z-50 right-0 mt-1 border border-border rounded-md bg-popover shadow-lg max-h-[240px] overflow-hidden flex flex-col" style={{ minWidth: 200 }}>
          {/* 搜索框 */}
          <div className="p-1.5 border-b border-border/50">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('category.searchPlaceholder')}
              className="w-full text-xs bg-transparent outline-none placeholder:text-muted-foreground"
              autoFocus
            />
          </div>

          {/* 树 */}
          <div className="flex-1 overflow-auto scrollable-area py-0.5">
            {filteredTree.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                {t('category.empty')}
              </div>
            ) : (
              filteredTree.map((node) => (
                <SelectTreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  selected={value}
                  onToggle={toggleCategory}
                />
              ))
            )}
          </div>

          {/* 新建分类 */}
          <div className="border-t border-border/50 p-1.5">
            {showNewInput ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addNewCategory()
                    if (e.key === 'Escape') setShowNewInput(false)
                  }}
                  placeholder="技术/前端/Vue"
                  className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground"
                  autoFocus
                />
                <button onClick={addNewCategory} className="p-0.5 hover:text-primary">
                  <Check size={12} />
                </button>
                <button onClick={() => setShowNewInput(false)} className="p-0.5 hover:text-destructive">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNewInput(true)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus size={12} />
                {t('category.newCategory')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/// 选择树节点
function SelectTreeNode({
  node,
  depth,
  selected,
  onToggle,
}: {
  node: CategoryNode
  depth: number
  selected: string[]
  onToggle: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(depth < 1)
  const hasChildren = node.children.length > 0
  const isChecked = selected.includes(node.path)

  return (
    <div>
      <div
        className="flex items-center gap-1 px-1 py-0.5 cursor-pointer hover:bg-accent/50 text-xs"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {hasChildren ? (
          <ChevronRight
            size={12}
            className={cn(
              'shrink-0 text-muted-foreground transition-transform duration-150',
              expanded && 'rotate-90',
            )}
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
          />
        ) : (
          <span className="w-3" />
        )}
        <button
          className="flex items-center gap-1 flex-1 min-w-0"
          onClick={() => onToggle(node.path)}
        >
          {/* Checkbox */}
          <span
            className={cn(
              'w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center',
              isChecked
                ? 'bg-primary border-primary text-primary-foreground'
                : 'border-border',
            )}
          >
            {isChecked && <Check size={10} />}
          </span>
          {hasChildren ? (
            expanded ? (
              <FolderOpen size={13} className="shrink-0 text-amber-500" />
            ) : (
              <Folder size={13} className="shrink-0 text-amber-500" />
            )
          ) : (
            <Folder size={13} className="shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{node.name}</span>
          {node.count > 0 && (
            <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
              {node.count}
            </span>
          )}
        </button>
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <SelectTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}
