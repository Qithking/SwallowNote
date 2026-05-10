/**
 * FileTreeView Component - File tree browser
 */
import { useEffect, useState, useCallback } from 'react'
import {
  ChevronRight,
  File,
  FileText,
  FilePlus,
  FolderPlus,
  Image,
  Folder,
  FolderOpen,
  RefreshCw,
} from 'lucide-react'
import { useFileTreeStore, useWorkspaceStore, useEditorStore } from '@/stores'
import { cn } from '@/lib/utils'
import { loadDirectory, loadFileContent } from '@/lib/api'
import { demoFileTree, DEMO_ROOT_PATH, demoContent, demoDirtyContent } from '@/lib/demoData'

// Internal FileNode type (camelCase)
interface FileNodeInternal {
  id: string
  name: string
  path: string
  isDirectory: boolean
  children?: FileNodeInternal[]
}

interface FileTreeNodeProps {
  node: FileNodeInternal
  depth: number
  onRefresh: () => void
}

function FileTreeNode({ node, depth, onRefresh }: FileTreeNodeProps) {
  const { selectedPath, setSelectedPath, expandedPaths, toggleExpanded } = useFileTreeStore()
  const { addTab } = useEditorStore()
  const isExpanded = expandedPaths.has(node.path)
  const isSelected = selectedPath === node.path

  const handleClick = () => {
    setSelectedPath(node.path)
    if (node.isDirectory) {
      toggleExpanded(node.path)
    }
  }

  const handleDoubleClick = async () => {
    if (!node.isDirectory) {
      try {
        // Demo mode: use demo content
        if (node.path.startsWith(DEMO_ROOT_PATH)) {
          const name = node.name
          if (name === 'markdown.md') {
            const now = new Date()
            const modifiedTime = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
            addTab({
              id: node.id,
              path: `traeProjects/world_hello/Cargo.toml`,
              name: node.name,
              content: demoContent,
              isDirty: false,
              fileSize: '13Kb',
              modifiedTime,
              wordCount: 180,
            })
            addTab({
              id: node.id + '-draft',
              path: `traeProjects/world_hello/README.md`,
              name: 'draft.md',
              content: demoDirtyContent,
              isDirty: true,
              fileSize: '2.4Kb',
              modifiedTime,
              wordCount: 85,
            })
          }
          return
        }

        const content = await loadFileContent(node.path)
        const wordCount = content ? content.split(/\s+/).filter(Boolean).length : 0
        const fileSizeStr = content
          ? content.length > 1024
            ? `${(content.length / 1024).toFixed(1)}Kb`
            : `${content.length}B`
          : '0B'
        const now = new Date()
        const modifiedTime = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        addTab({
          id: node.id,
          path: node.path,
          name: node.name,
          content,
          isDirty: false,
          fileSize: fileSizeStr,
          modifiedTime,
          wordCount,
        })
      } catch (error) {
        console.error('Failed to load file:', error)
      }
    }
  }

  const handleExpand = async () => {
    if (!node.isDirectory) return

    if (!expandedPaths.has(node.path)) {
      toggleExpanded(node.path)
    } else {
      // Load children if not loaded
      if (!node.children || node.children.length === 0) {
        try {
          await loadDirectory(node.path)
          onRefresh()
        } catch (error) {
          console.error('Failed to load directory:', error)
        }
      }
    }
  }

  const getFileIcon = () => {
    if (node.isDirectory) {
      return isExpanded ? (
        <FolderOpen size={14} className="text-[#d4a05a]" />
      ) : (
        <Folder size={14} className="text-[#d4a05a]" />
      )
    }
    const ext = node.name.split('.').pop()?.toLowerCase()
    if (ext === 'md' || ext === 'markdown') {
      return <FileText size={14} style={{ color: '#569cd6' }} />
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext || '')) {
      return <Image size={14} style={{ color: '#ce9178' }} />
    }
    return <File size={14} style={{ color: 'var(--text-muted)' }} />
  }

  return (
    <>
      <div
        className={cn(
          'flex items-center h-[24px] cursor-pointer select-none gap-1 text-sm',
          isSelected
            ? 'bg-[var(--bg-selection)] text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {node.isDirectory && (
          <ChevronRight
            size={14}
            className={cn('icon transition-transform shrink-0', isExpanded && 'rotate-90')}
            onClick={(e) => {
              e.stopPropagation()
              handleExpand()
            }}
          />
        )}
        {!node.isDirectory && <span className="icon shrink-0" style={{ width: 14 }} />}
        {getFileIcon()}
        <span className="truncate">{node.name}</span>
      </div>
      {node.isDirectory && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode key={child.id} node={child} depth={depth + 1} onRefresh={onRefresh} />
          ))}
        </div>
      )}
    </>
  )
}

function FileTreeView() {
  const { rootNode, setRootNode } = useFileTreeStore()
  const { rootPath } = useWorkspaceStore()
  const [isLoading, setIsLoading] = useState(false)

  const loadFileTree = useCallback(async () => {
    if (!rootPath) {
      // Demo mode: use demo tree
      setRootNode(demoFileTree)
      return
    }
    setIsLoading(true)
    try {
      const nodes = await loadDirectory(rootPath)
      const rootNodeData: FileNodeInternal = {
        id: 'root',
        name: rootPath.split('/').pop() || 'root',
        path: rootPath,
        isDirectory: true,
        children: nodes,
      }
      setRootNode(rootNodeData)
    } catch (error) {
      console.error('Failed to load file tree:', error)
    } finally {
      setIsLoading(false)
    }
  }, [rootPath, setRootNode])

  useEffect(() => {
    loadFileTree()
  }, [loadFileTree])

  const handleRefresh = () => {
    loadFileTree()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-20 text-[var(--text-muted)]">
        <RefreshCw size={16} className="animate-spin" />
      </div>
    )
  }

  if (rootNode) {
    return (
      <div className="flex flex-col h-full">
        {/* Explorer toolbar */}
        <div
          className="flex items-center justify-between h-[40px] px-3 shrink-0 select-none"
          style={{ borderBottom: '1px solid var(--border-color)' }}
        >
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            资源管理器
          </span>
          <div className="flex items-center gap-0.5">
            <button
              className="h-6 w-6 flex items-center justify-center rounded"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
              title="新建文件"
            >
              <FilePlus size={14} />
            </button>
            <button
              className="h-6 w-6 flex items-center justify-center rounded"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
              title="新建文件夹"
            >
              <FolderPlus size={14} />
            </button>
            <button
              className="h-6 w-6 flex items-center justify-center rounded"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
              title="刷新"
              onClick={handleRefresh}
            >
              <RefreshCw size={14} />
            </button>
            <button
              className="h-6 w-6 flex items-center justify-center rounded"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
              title="折叠全部"
            >
              <ChevronRight size={14} className="rotate-90" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {rootNode.children?.map((child) => (
            <FileTreeNode key={child.id} node={child} depth={0} onRefresh={handleRefresh} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-40 text-[var(--text-muted)]">
      <FolderOpen size={32} className="mb-2 opacity-50" />
      <p className="text-sm">No folder opened</p>
      <button className="mt-2 text-xs text-[var(--text-link)] hover:underline">
        Open Folder
      </button>
    </div>
  )
}

export { FileTreeView }
