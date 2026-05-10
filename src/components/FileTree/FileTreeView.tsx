import { useEffect } from 'react'
import { FileText, FilePlus, FolderPlus, Image, Folder, FolderOpen, RefreshCw, ChevronRight, File } from 'lucide-react'
import { useWorkspaceStore, useEditorStore, useFileTreeStore } from '@/stores'
import { loadFileContent } from '@/lib/api'
import { openFolderDialog } from '@/lib/tauri'
import type { FileNode } from '@/stores/filetree'

interface TreeItemProps {
  node: FileNode
  depth: number
  onToggle: (path: string) => void
  expanded: Set<string>
  onSelect: (node: FileNode) => void
  selectedPath: string | null
}

function TreeItem({ node, depth, onToggle, expanded, onSelect, selectedPath }: TreeItemProps) {
  const isExpanded = expanded.has(node.path)
  const hasChildren = node.children && node.children.length > 0
  const isSelected = !node.isDirectory && node.path === selectedPath

  const handleClick = () => {
    if (node.isDirectory) {
      onToggle(node.path)
    } else {
      onSelect(node)
    }
  }

  const getIcon = () => {
    if (node.isDirectory) {
      return isExpanded ? <FolderOpen size={14} className="text-[#d4a05a]" /> : <Folder size={14} className="text-[#d4a05a]" />
    }
    const ext = node.name.split('.').pop()?.toLowerCase()
    if (ext === 'md') return <FileText size={14} style={{ color: '#569cd6' }} />
    if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext || '')) return <Image size={14} style={{ color: '#ce9178' }} />
    return <File size={14} style={{ color: 'var(--text-muted)' }} />
  }

  return (
    <div>
      <div
        data-path={node.path}
        className={`flex items-center h-[24px] cursor-pointer select-none gap-1 text-sm ${isSelected ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
      >
        {node.isDirectory ? (
          <ChevronRight
            size={14}
            className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              onToggle(node.path)
            }}
          />
        ) : (
          <span className="w-[14px]" />
        )}
        {getIcon()}
        <span className="truncate">{node.name}</span>
      </div>
      {isExpanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onToggle={onToggle}
              expanded={expanded}
              onSelect={onSelect}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function FileTreeView() {
  const { rootPath } = useWorkspaceStore()
  const { addTab } = useEditorStore()
  const { nodes, expanded, selectedPath, isLoading, setSelectedPath, toggleNode, loadRoot } = useFileTreeStore()

  useEffect(() => {
    if (rootPath) loadRoot(rootPath)
    else useFileTreeStore.getState().clearAll()
  }, [rootPath, loadRoot])

  const handleSelect = (node: FileNode) => {
    setSelectedPath(node.path)
    loadFileContent(node.path)
      .then((content) => {
        addTab({
          id: node.id,
          path: node.path,
          name: node.name,
          content,
          isDirty: false,
          fileSize: content.length > 1024 ? `${(content.length / 1024).toFixed(1)}Kb` : `${content.length}B`,
          modifiedTime: new Date().toLocaleString(),
          wordCount: content.split(/\s+/).filter(Boolean).length,
        })
      })
      .catch(console.error)
  }

  const handleOpenFolder = async () => {
    const path = await openFolderDialog()
    if (path) useWorkspaceStore.getState().setRootPath(path)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between h-[40px] px-3 shrink-0 select-none" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>资源管理器</span>
        <div className="flex items-center gap-0.5">
          <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-muted)' }} onClick={handleOpenFolder}>
            <FolderOpen size={14} />
          </button>
          <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-muted)' }}>
            <FilePlus size={14} />
          </button>
          <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-muted)' }}>
            <FolderPlus size={14} />
          </button>
          <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-muted)' }} onClick={() => loadRoot(rootPath!)}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
            <RefreshCw size={16} className="animate-spin" />
          </div>
        ) : nodes.length > 0 ? (
          nodes.map((node) => (
            <TreeItem key={node.path} node={node} depth={0} onToggle={toggleNode} expanded={expanded} onSelect={handleSelect} selectedPath={selectedPath} />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
            <FolderOpen size={32} className="mb-2 opacity-50" />
            <p className="text-sm">未打开文件夹</p>
          </div>
        )}
      </div>
    </div>
  )
}
