/**
 * DirectoryView Component - Document outline/TOC panel using rc-tree
 */
import { useState, useEffect, useCallback } from 'react'
import Tree from 'rc-tree'
import 'rc-tree/assets/index.css'
import { FileText, Heading1, Heading2, Heading3, Heading4, Heading5, Heading6 } from 'lucide-react'
import { useEditorStore } from '@/stores'

interface TocItem {
  id: string
  text: string
  level: number
  line: number
  blockId?: string
}

interface TreeNode {
  key: string
  title: string
  children?: TreeNode[]
}

function extractToc(content: string): TocItem[] {
  const lines = content.split('\n')
  const toc: TocItem[] = []
  
  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      toc.push({
        id: `heading-${index}`,
        text: match[2],
        level: match[1].length,
        line: index + 1,
      })
    }
  })
  
  return toc
}

// 递归构建树形结构
function buildTree(items: TocItem[]): TreeNode[] {
  const result: TreeNode[] = []
  const stack: { level: number, children: TreeNode[] }[] = []
  
  for (const item of items) {
    const node: TreeNode = {
      key: item.id,
      title: item.text,
    }
    
    // 弹出所有深度 >= 当前深度的栈元素
    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop()
    }
    
    if (stack.length === 0) {
      // 顶级节点
      result.push(node)
      stack.push({ level: item.level, children: node.children = [] })
    } else {
      // 添加到父节点的 children
      stack[stack.length - 1].children.push(node)
      stack.push({ level: item.level, children: node.children = [] })
    }
  }
  
  return result
}

function DirectoryView() {
  const { tabs, activeTabId } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const [toc, setToc] = useState<TocItem[]>([])
  const [treeData, setTreeData] = useState<TreeNode[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])

  // 监听 block IDs 更新事件
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail.headings && Array.isArray(detail.headings)) {
        // 通过文本内容匹配来设置 blockId
        setToc(prev => prev.map(item => {
          const matchingHeading = detail.headings.find((h: any) => 
            h.text === item.text || h.text.trim() === item.text.trim()
          )
          return {
            ...item,
            blockId: matchingHeading?.id || item.id
          }
        }))
      }
    }
    window.addEventListener('block-editor-ready', handler)
    return () => window.removeEventListener('block-editor-ready', handler)
  }, [])

  useEffect(() => {
    if (activeTab?.content) {
      const newToc = extractToc(activeTab.content)
      setToc(newToc)
      setTreeData(buildTree(newToc))
      setExpandedKeys(newToc.map(item => item.id))
      setSelectedId('')
    } else {
      setToc([])
      setTreeData([])
      setExpandedKeys([])
      setSelectedId('')
    }
  }, [activeTab?.content])

  // 滚动定位
  const scrollToPosition = useCallback((item: TocItem) => {
    if (item.blockId) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('scroll-to-block-id', {
          detail: { blockId: item.blockId, fallbackText: item.text }
        }))
      }, 50)
    } else {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('scroll-to-block-id', {
          detail: { blockId: item.id, fallbackText: item.text }
        }))
      }, 50)
    }
  }, [])

  const handleSelect = (selectedKeys: React.Key[]) => {
    if (selectedKeys.length > 0) {
      const key = selectedKeys[0] as string
      setSelectedId(key)
      const item = toc.find(t => t.id === key)
      if (item) {
        scrollToPosition(item)
      }
    }
  }

  const handleExpand = (keys: React.Key[]) => {
    setExpandedKeys(keys as string[])
  }

  const renderTitle = (node: TreeNode) => {
    const isSelected = selectedId === node.key
    const tocItem = toc.find(t => t.id === node.key)
    const level = tocItem?.level || 1
    
    // 根据标题级别选择图标
    const IconComponent = level === 1 ? Heading1 : level === 2 ? Heading2 : level === 3 ? Heading3 : 
                         level === 4 ? Heading4 : level === 5 ? Heading5 : Heading6
    
    return (
      <span
        className={`flex items-center gap-1.5 text-sm cursor-pointer truncate ${isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'} hover:text-[var(--text-primary)]`}
        title={node.title}
      >
        <IconComponent size={12} className="shrink-0 opacity-70" />
        <span className="truncate">{node.title}</span>
      </span>
    )
  }

  if (!activeTab) {
    return (
      <div className="flex flex-col h-full w-[300px]">
        <div className="flex items-center h-10 px-3 shrink-0 border-b" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
          <div className="flex items-center gap-2">
            <FileText size={14} style={{ color: 'var(--text-muted)' }} />
            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>目录</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
          <p className="text-sm">未打开文件</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full w-[300px]">
      <div className="flex items-center h-10 px-3 shrink-0 border-b" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
        <div className="flex items-center gap-2">
          <FileText size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>目录</span>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {treeData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
            <p className="text-sm">无目录</p>
          </div>
        ) : (
          <Tree
            treeData={treeData}
            selectedKeys={selectedId ? [selectedId] : []}
            expandedKeys={expandedKeys}
            onSelect={handleSelect}
            onExpand={handleExpand}
            titleRender={renderTitle}
            showLine
            showIcon={false}
            className="text-[var(--text-secondary)] my-tree"
          />
        )}
      </div>
    </div>
  )
}

export { DirectoryView }
