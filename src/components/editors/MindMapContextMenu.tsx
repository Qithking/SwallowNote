/**
 * MindMap Context Menu - Right-click menu for mind map nodes
 *
 * Provides context menu operations for selected nodes in the mind map editor.
 * Menu items include: insert sibling/child/parent node, add summary,
 * move up/down, expand/collapse, delete, copy/cut/paste.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Trash2,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  FileText,
  Scissors,
  ClipboardPaste,
  Type,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface MindMapContextMenuProps {
  mindMap: any // simple-mind-map instance
  children: React.ReactNode
}

export function MindMapContextMenu({ mindMap, children }: MindMapContextMenuProps) {
  const { t } = useTranslation()
  const [activeNodes, setActiveNodes] = useState<any[]>([])
  const [contextNode, setContextNode] = useState<any>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const isNodeContextMenu = useRef(false)

  useEffect(() => {
    if (!mindMap) return

    const handleNodeActive = (_node: any, activeNodeList: any[]) => {
      setActiveNodes(activeNodeList || [])
    }

    mindMap.on('node_active', handleNodeActive)

    const currentActiveNodes = mindMap.renderer?.activeNodeList || []
    if (currentActiveNodes.length > 0) {
      setActiveNodes(currentActiveNodes)
    }

    return () => {
      mindMap.off('node_active', handleNodeActive)
    }
  }, [mindMap])

  useEffect(() => {
    if (!mindMap) return

    const handleNodeContextMenu = (e: any, node: any) => {
      setContextNode(node)
      isNodeContextMenu.current = true

      const clientX = e.clientX ?? e.event?.clientX ?? e.originalEvent?.clientX ?? 0
      const clientY = e.clientY ?? e.event?.clientY ?? e.originalEvent?.clientY ?? 0

      const syntheticEvent = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
      })
      triggerRef.current?.dispatchEvent(syntheticEvent)
    }

    mindMap.on('node_contextmenu', handleNodeContextMenu)
    return () => {
      mindMap.off('node_contextmenu', handleNodeContextMenu)
    }
  }, [mindMap])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (isNodeContextMenu.current) {
      isNodeContextMenu.current = false
      return
    }

    if (!mindMap) return

    const renderer = mindMap.renderer
    if (renderer) {
      const rect = (mindMap.el || mindMap?.el).getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const node = renderer.findNodeByPosition?.(x, y)
        || renderer.findNode?.(x, y)
      if (node) {
        setContextNode(node)
      } else {
        setContextNode(null)
      }
    }
  }, [mindMap])

  const getNode = () => {
    return contextNode || (activeNodes.length > 0 ? activeNodes[0] : null)
  }

  const hasActiveNode = activeNodes.length > 0
  const node = getNode()
  const isRootNode = node?.isRoot === true

  const activateContextNode = () => {
    if (!mindMap || !contextNode) return false
    const renderer = mindMap.renderer
    if (!renderer) return false

    const index = renderer.findActiveNodeIndex?.(contextNode)
    if (index !== -1) return true

    renderer.clearActiveNodeList()
    renderer.addNodeToActiveList(contextNode)
    renderer.emitNodeActiveEvent(contextNode)
    return true
  }

  // --- Command handlers ---

  const handleInsertSibling = () => {
    if (!mindMap) return
    if (contextNode) {
      activateContextNode()
    }
    mindMap.execCommand('INSERT_NODE')
  }

  const handleInsertChild = () => {
    if (!mindMap) return
    if (contextNode) {
      activateContextNode()
    }
    mindMap.execCommand('INSERT_CHILD_NODE')
  }

  const handleInsertParent = () => {
    if (!mindMap) return
    if (contextNode) {
      activateContextNode()
    }
    mindMap.execCommand('INSERT_PARENT_NODE')
  }

  const handleAddSummary = () => {
    if (!mindMap || !node) return
    if (contextNode) {
      activateContextNode()
    }
    mindMap.execCommand('ADD_GENERALIZATION')
  }

  const handleMoveUp = () => {
    if (!mindMap || !node || isRootNode) return
    if (contextNode) {
      activateContextNode()
    }
    mindMap.execCommand('UP_NODE')
  }

  const handleMoveDown = () => {
    if (!mindMap || !node || isRootNode) return
    if (contextNode) {
      activateContextNode()
    }
    mindMap.execCommand('DOWN_NODE')
  }

  const handleCollapseAll = () => {
    if (!mindMap || !node) return
    const uid = node.getData('uid')
    if (uid) {
      mindMap.execCommand('UNEXPAND_ALL', true, uid)
    }
  }

  const handleExpandAll = () => {
    if (!mindMap || !node) return
    const uid = node.getData('uid')
    if (uid) {
      mindMap.execCommand('EXPAND_ALL', uid)
    }
  }

  const handleDelete = () => {
    if (!mindMap || !hasActiveNode || isRootNode) return
    mindMap.execCommand('REMOVE_NODE')
  }

  const handleDeleteOnlyCurrent = () => {
    if (!mindMap || !node || isRootNode) return
    if (contextNode) {
      activateContextNode()
    }
    mindMap.execCommand('REMOVE_NODE')
  }

  const handleCopy = () => {
    if (!mindMap || !node) return
    if (contextNode) {
      activateContextNode()
    }
    mindMap.renderer?.copy()
  }

  const handleCut = () => {
    if (!mindMap || !node) return
    if (contextNode) {
      activateContextNode()
    }
    mindMap.renderer?.cut()
  }

  const handlePaste = () => {
    if (!mindMap || !node) return
    if (contextNode) {
      activateContextNode()
    }
    mindMap.renderer?.paste()
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={triggerRef} onContextMenu={handleContextMenu} className="flex-1 flex flex-col">
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="min-w-[200px]"
        style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        }}
      >
        {/* Insert Operations */}
        <ContextMenuItem onClick={handleInsertSibling} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
          <span className="flex-1">{t('mindMap.insertSibling')}</span>
          <kbd className="text-[10px] font-mono opacity-60">Enter</kbd>
        </ContextMenuItem>
        <ContextMenuItem onClick={handleInsertChild} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
          <span className="flex-1">{t('mindMap.insertChild')}</span>
          <kbd className="text-[10px] font-mono opacity-60">Tab</kbd>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={handleInsertParent}
          disabled={isRootNode}
          style={{ color: isRootNode ? 'var(--text-muted)' : 'var(--text-secondary)' }}
          className="cursor-pointer"
        >
          <span className="flex-1">{t('mindMap.insertParent')}</span>
          <kbd className="text-[10px] font-mono opacity-60">Shift + Tab</kbd>
        </ContextMenuItem>

        <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />

        {/* Summary */}
        <ContextMenuItem
          onClick={handleAddSummary}
          disabled={!hasActiveNode || isRootNode}
          style={{ color: !hasActiveNode || isRootNode ? 'var(--text-muted)' : 'var(--text-secondary)' }}
          className="cursor-pointer"
        >
          <Type size={12} />
          <span className="flex-1 ml-1">{t('mindMap.addSummary')}</span>
          <kbd className="text-[10px] font-mono opacity-60">Ctrl + G</kbd>
        </ContextMenuItem>

        <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />

        {/* Move Operations */}
        <ContextMenuItem
          onClick={handleMoveUp}
          disabled={!hasActiveNode || isRootNode}
          style={{ color: !hasActiveNode || isRootNode ? 'var(--text-muted)' : 'var(--text-secondary)' }}
          className="cursor-pointer"
        >
          <ArrowUp size={12} />
          <span className="flex-1 ml-1">{t('mindMap.moveUp')}</span>
          <kbd className="text-[10px] font-mono opacity-60">Ctrl + ↑</kbd>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={handleMoveDown}
          disabled={!hasActiveNode || isRootNode}
          style={{ color: !hasActiveNode || isRootNode ? 'var(--text-muted)' : 'var(--text-secondary)' }}
          className="cursor-pointer"
        >
          <ArrowDown size={12} />
          <span className="flex-1 ml-1">{t('mindMap.moveDown')}</span>
          <kbd className="text-[10px] font-mono opacity-60">Ctrl + ↓</kbd>
        </ContextMenuItem>

        <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />

        {/* Expand/Collapse */}
        <ContextMenuItem
          onClick={handleCollapseAll}
          style={{ color: 'var(--text-secondary)' }}
          className="cursor-pointer"
        >
          <ChevronDown size={12} />
          <span className="ml-1">{t('mindMap.collapseAll')}</span>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={handleExpandAll}
          style={{ color: 'var(--text-secondary)' }}
          className="cursor-pointer"
        >
          <ChevronUp size={12} />
          <span className="ml-1">{t('mindMap.expandAll')}</span>
        </ContextMenuItem>

        <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />

        {/* Delete Operations */}
        <ContextMenuItem
          onClick={handleDelete}
          disabled={!hasActiveNode || isRootNode}
          style={{ color: 'var(--danger-color, #f44336)' }}
          className="cursor-pointer"
        >
          <Trash2 size={12} />
          <span className="flex-1 ml-1" style={{ color: 'var(--danger-color, #f44336)' }}>{t('mindMap.deleteNode')}</span>
          <kbd className="text-[10px] font-mono opacity-60" style={{ color: 'var(--text-muted)' }}>Delete</kbd>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={handleDeleteOnlyCurrent}
          disabled={!hasActiveNode || isRootNode}
          style={{ color: 'var(--danger-color, #f44336)' }}
          className="cursor-pointer"
        >
          <Trash2 size={12} />
          <span className="flex-1 ml-1" style={{ color: 'var(--danger-color, #f44336)' }}>{t('mindMap.deleteOnlyCurrent')}</span>
          <kbd className="text-[10px] font-mono opacity-60" style={{ color: 'var(--text-muted)' }}>Shift + Backspace</kbd>
        </ContextMenuItem>

        <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />

        {/* Copy/Cut/Paste */}
        <ContextMenuItem
          onClick={handleCopy}
          disabled={!hasActiveNode}
          style={{ color: !hasActiveNode ? 'var(--text-muted)' : 'var(--text-secondary)' }}
          className="cursor-pointer"
        >
          <FileText size={12} />
          <span className="flex-1 ml-1">{t('mindMap.copyNode')}</span>
          <kbd className="text-[10px] font-mono opacity-60">Ctrl + C</kbd>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={handleCut}
          disabled={!hasActiveNode || isRootNode}
          style={{ color: !hasActiveNode || isRootNode ? 'var(--text-muted)' : 'var(--text-secondary)' }}
          className="cursor-pointer"
        >
          <Scissors size={12} />
          <span className="flex-1 ml-1">{t('mindMap.cutNode')}</span>
          <kbd className="text-[10px] font-mono opacity-60">Ctrl + X</kbd>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={handlePaste}
          disabled={!hasActiveNode}
          style={{ color: !hasActiveNode ? 'var(--text-muted)' : 'var(--text-secondary)' }}
          className="cursor-pointer"
        >
          <ClipboardPaste size={12} />
          <span className="flex-1 ml-1">{t('mindMap.pasteNode')}</span>
          <kbd className="text-[10px] font-mono opacity-60">Ctrl + V</kbd>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
