/**
 * MindMap Toolbar Component
 *
 * Provides basic operations for the mind map editor.
 * This is a simplified toolbar inspired by the official simple-mind-map Vue2 example.
 */
import React, { useState, useEffect } from 'react'
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Layout,
  Palette,
  ZoomIn,
  ZoomOut,
  Maximize,
  Settings,
  Paintbrush,
  Check,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { BaseStylePlugin, NodeStylePlugin } from './mindmap-plugins'

interface MindMapToolbarProps {
  mindMap: any // simple-mind-map instance
}

const LAYOUT_GROUPS = [
  {
    label: '逻辑结构',
    children: [
      { value: 'logicalStructure', label: '逻辑结构图' },
      { value: 'logicalStructureLeft', label: '向左逻辑结构图' },
    ],
  },
  {
    label: '思维导图',
    children: [
      { value: 'mindMap', label: '思维导图' },
    ],
  },
  {
    label: '组织结构',
    children: [
      { value: 'organizationStructure', label: '组织结构图' },
      { value: 'catalogOrganization', label: '目录组织图' },
    ],
  },
  {
    label: '时间轴',
    children: [
      { value: 'timeline', label: '时间轴' },
      { value: 'timeline2', label: '时间轴2' },
      { value: 'verticalTimeline', label: '竖向时间轴' },
      { value: 'verticalTimeline2', label: '竖向时间轴2' },
      { value: 'verticalTimeline3', label: '竖向时间轴3' },
    ],
  },
  {
    label: '鱼骨图',
    children: [
      { value: 'fishbone', label: '鱼骨图' },
      { value: 'fishbone2', label: '鱼骨图2' },
      { value: 'rightFishbone', label: '向右鱼骨图' },
      { value: 'rightFishbone2', label: '向右鱼骨图2' },
    ],
  },
]

// simple-mind-map 的 dist 文件只包含 default 主题
// 其他主题需要通过 MindMap.defineTheme() 注册或使用 setThemeConfig() 自定义
const THEME_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'dark', label: '深色' },
]

export function MindMapToolbar({ mindMap }: MindMapToolbarProps) {
  const [activeNodes, setActiveNodes] = useState<any[]>([])
  const [currentLayout, setCurrentLayout] = useState('logicalStructure')
  const [currentTheme, setCurrentTheme] = useState('default')
  const [showBaseStylePlugin, setShowBaseStylePlugin] = useState(false)
  const [showNodeStylePlugin, setShowNodeStylePlugin] = useState(false)

  useEffect(() => {
    if (!mindMap) return

    const handleNodeActive = (_node: any, activeNodeList: any[]) => {
      setActiveNodes(activeNodeList || [])
    }

    mindMap.on('node_active', handleNodeActive)

    // Get currently active nodes on mount / when mindMap instance changes
    // simple-mind-map only fires 'node_active' on selection CHANGE,
    // so we need to read the initial state explicitly
    const currentActiveNodes = mindMap.renderer?.activeNodeList || []
    if (currentActiveNodes.length > 0) {
      setActiveNodes(currentActiveNodes)
    }

    return () => {
      mindMap.off('node_active', handleNodeActive)
    }
  }, [mindMap])

  const handleInsertChild = () => {
    if (!mindMap) return
    mindMap.execCommand('INSERT_CHILD_NODE')
  }

  const handleInsertSibling = () => {
    if (!mindMap) return
    mindMap.execCommand('INSERT_NODE')
  }

  const handleInsertParent = () => {
    if (!mindMap) return
    mindMap.execCommand('INSERT_PARENT_NODE')
  }

  const handleRemoveNode = () => {
    if (!mindMap) return
    mindMap.execCommand('REMOVE_NODE')
  }

  const handleToggleExpand = () => {
    if (!mindMap || activeNodes.length === 0) return
    const node = activeNodes[0]
    const isExpand = node.getData('expand') !== false
    mindMap.execCommand('SET_NODE_EXPAND', node, !isExpand)
  }

  const handleZoomIn = () => {
    if (!mindMap) return
    mindMap.view.enlarge()
  }

  const handleZoomOut = () => {
    if (!mindMap) return
    mindMap.view.narrow()
  }

  const handleFit = () => {
    if (!mindMap) return
    mindMap.view.fit()
  }

  const handleLayoutChange = (layout: string) => {
    if (!mindMap) return
    mindMap.setLayout(layout)
    setCurrentLayout(layout)
  }

  const handleThemeChange = (theme: string) => {
    if (!mindMap) return
    if (theme === 'dark') {
      // 使用 setThemeConfig 自定义暗色主题
      mindMap.setThemeConfig({
        backgroundColor: '#1a1a1a',
        lineColor: '#4a9eff',
        root: {
          fillColor: '#2d5a8a',
          color: '#fff',
        },
        second: {
          fillColor: '#3a3a3a',
          color: '#e0e0e0',
          borderColor: '#4a9eff',
        },
        node: {
          fillColor: '#2a2a2a',
          color: '#d0d0d0',
          borderColor: '#555',
        },
      })
    } else {
      // 恢复默认主题配置
      mindMap.setThemeConfig({
        backgroundColor: '#fafafa',
        lineColor: '#549688',
        root: {
          fillColor: '#549688',
          color: '#fff',
        },
        second: {
          fillColor: '#fff',
          color: '#565656',
          borderColor: '#549688',
        },
        node: {
          fillColor: '#fff',
          color: '#6a6a6a',
          borderColor: 'transparent',
        },
      })
    }
    setCurrentTheme(theme)
  }

  const hasActiveNode = activeNodes.length > 0
  const isRootNode = hasActiveNode && activeNodes[0].isRoot
  const canExpand = hasActiveNode && activeNodes[0].children && activeNodes[0].children.length > 0
  const isExpanded = hasActiveNode && activeNodes[0].getData('expand') !== false

  return (
    <>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
      {/* Node Operations */}
      <div className="flex items-center gap-0.5">
        <ToolbarButton
          onClick={handleInsertChild}
          disabled={!hasActiveNode}
          title="插入子节点 (Tab)"
        >
          <Plus size={14} />
          <span className="text-[10px]">子</span>
        </ToolbarButton>

        <ToolbarButton
          onClick={handleInsertSibling}
          disabled={!hasActiveNode || isRootNode}
          title="插入同级节点 (Enter)"
        >
          <Plus size={14} />
          <span className="text-[10px]">同级</span>
        </ToolbarButton>

        <ToolbarButton
          onClick={handleInsertParent}
          disabled={!hasActiveNode || isRootNode}
          title="插入父节点"
        >
          <Plus size={14} />
          <span className="text-[10px]">父</span>
        </ToolbarButton>

        <ToolbarButton
          onClick={handleRemoveNode}
          disabled={!hasActiveNode || isRootNode}
          title="删除节点 (Delete)"
        >
          <Trash2 size={14} className="text-red-500" />
        </ToolbarButton>

        <ToolbarButton
          onClick={handleToggleExpand}
          disabled={!canExpand}
          title={isExpanded ? '折叠' : '展开'}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </ToolbarButton>
      </div>

      <div className="w-px h-4 bg-[var(--border-color)] mx-1" />

      {/* Layout */}
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-0.5 px-1.5 py-1 rounded text-[var(--text-secondary)] text-xs hover:bg-[var(--bg-hover)] transition-colors outline-none">
          <Layout size={14} />
          <span className="text-[10px] ml-0.5">布局</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="min-w-[140px]"
          style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
          }}
        >
          {LAYOUT_GROUPS.map((group) => (
            group.children.length === 1 ? (
              <DropdownMenuItem
                key={group.children[0].value}
                onSelect={() => handleLayoutChange(group.children[0].value)}
                className="text-xs cursor-pointer"
                style={{ color: currentLayout === group.children[0].value ? 'var(--theme-color)' : 'var(--text-secondary)' }}
              >
                {group.children[0].label}
                {currentLayout === group.children[0].value && <Check size={14} className="ml-auto" />}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuSub key={group.label}>
                <DropdownMenuSubTrigger
                  className="text-xs"
                  style={{ color: group.children.some(c => c.value === currentLayout) ? 'var(--theme-color)' : 'var(--text-secondary)' }}
                >
                  {group.label}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  {group.children.map((child) => (
                    <DropdownMenuItem
                      key={child.value}
                      onSelect={() => handleLayoutChange(child.value)}
                      className="text-xs cursor-pointer"
                      style={{ color: currentLayout === child.value ? 'var(--theme-color)' : 'var(--text-secondary)' }}
                    >
                      {child.label}
                      {currentLayout === child.value && <Check size={14} className="ml-auto" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Theme */}
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-0.5 px-1.5 py-1 rounded text-[var(--text-secondary)] text-xs hover:bg-[var(--bg-hover)] transition-colors outline-none">
          <Palette size={14} />
          <span className="text-[10px] ml-0.5">主题</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="min-w-[100px]"
          style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
          }}
        >
          {THEME_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => handleThemeChange(option.value)}
              className="text-xs cursor-pointer"
              style={{ color: currentTheme === option.value ? 'var(--theme-color)' : 'var(--text-secondary)' }}
            >
              {option.label}
              {currentTheme === option.value && <Check size={14} className="ml-auto" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="w-px h-4 bg-[var(--border-color)] mx-1" />

      {/* Style Plugins */}
      <div className="flex items-center gap-0.5">
        <ToolbarButton
          onClick={() => {
            if (showNodeStylePlugin) setShowNodeStylePlugin(false)
            setShowBaseStylePlugin(!showBaseStylePlugin)
          }}
          title="基础样式"
          style={showBaseStylePlugin ? { background: 'var(--bg-hover)' } : undefined}
        >
          <Settings size={14} />
          <span className="text-[10px]">基础</span>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => {
            if (showBaseStylePlugin) setShowBaseStylePlugin(false)
            setShowNodeStylePlugin(!showNodeStylePlugin)
          }}
          disabled={!hasActiveNode}
          title="节点样式"
          style={showNodeStylePlugin ? { background: 'var(--bg-hover)' } : undefined}
        >
          <Paintbrush size={14} />
          <span className="text-[10px]">节点</span>
        </ToolbarButton>
      </div>

      <div className="w-px h-4 bg-[var(--border-color)] mx-1" />

      {/* View Operations */}
      <div className="flex items-center gap-0.5">
        <ToolbarButton onClick={handleZoomIn} title="放大">
          <ZoomIn size={14} />
        </ToolbarButton>

        <ToolbarButton onClick={handleZoomOut} title="缩小">
          <ZoomOut size={14} />
        </ToolbarButton>

        <ToolbarButton onClick={handleFit} title="适应画布">
          <Maximize size={14} />
        </ToolbarButton>
      </div>
      </div>

      {showBaseStylePlugin && (
        <BaseStylePlugin
          mindMap={mindMap}
          onClose={() => setShowBaseStylePlugin(false)}
        />
      )}
      {showNodeStylePlugin && (
        <NodeStylePlugin
          mindMap={mindMap}
          onClose={() => setShowNodeStylePlugin(false)}
        />
      )}
    </>
  )
}

interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode
}

const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`
          flex items-center gap-0.5 px-1.5 py-1 rounded
          text-[var(--text-secondary)] text-xs
          hover:bg-[var(--bg-hover)]
          disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent
          transition-colors
          ${className || ''}
        `}
        {...props}
      >
        {children}
      </button>
    )
  }
)
ToolbarButton.displayName = 'ToolbarButton'
