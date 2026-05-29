/**
 * MindMap Toolbar Component
 *
 * Provides basic operations for the mind map editor.
 * This is a simplified toolbar inspired by the official simple-mind-map Vue2 example.
 */
import { useState, useEffect } from 'react'
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
} from 'lucide-react'
import { BaseStylePlugin, NodeStylePlugin } from './mindmap-plugins'

interface MindMapToolbarProps {
  mindMap: any // simple-mind-map instance
}

const LAYOUT_OPTIONS = [
  { value: 'logicalStructure', label: '逻辑结构图' },
  { value: 'mindMap', label: '思维导图' },
  { value: 'organizationStructure', label: '组织结构图' },
  { value: 'catalogOrganization', label: '目录组织图' },
  { value: 'timeline', label: '时间轴' },
  { value: 'fishbone', label: '鱼骨图' },
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
  const [showLayoutMenu, setShowLayoutMenu] = useState(false)
  const [showThemeMenu, setShowThemeMenu] = useState(false)
  const [showBaseStylePlugin, setShowBaseStylePlugin] = useState(false)
  const [showNodeStylePlugin, setShowNodeStylePlugin] = useState(false)

  useEffect(() => {
    if (!mindMap) return

    const handleNodeActive = (nodes: any[]) => {
      setActiveNodes(nodes || [])
    }

    mindMap.on('node_active', handleNodeActive)
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
    setShowLayoutMenu(false)
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
    setShowThemeMenu(false)
  }

  const hasActiveNode = activeNodes.length > 0
  const isRootNode = hasActiveNode && activeNodes[0].isRoot
  const canExpand = hasActiveNode && activeNodes[0].children && activeNodes[0].children.length > 0
  const isExpanded = hasActiveNode && activeNodes[0].getData('expand') !== false

  return (
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
      <div className="relative">
        <ToolbarButton onClick={() => setShowLayoutMenu(!showLayoutMenu)} title="布局">
          <Layout size={14} />
          <span className="text-[10px] ml-0.5">布局</span>
        </ToolbarButton>
        {showLayoutMenu && (
          <DropdownMenu
            options={LAYOUT_OPTIONS}
            value={currentLayout}
            onChange={handleLayoutChange}
            onClose={() => setShowLayoutMenu(false)}
          />
        )}
      </div>

      {/* Theme */}
      <div className="relative">
        <ToolbarButton onClick={() => setShowThemeMenu(!showThemeMenu)} title="主题">
          <Palette size={14} />
          <span className="text-[10px] ml-0.5">主题</span>
        </ToolbarButton>
        {showThemeMenu && (
          <DropdownMenu
            options={THEME_OPTIONS}
            value={currentTheme}
            onChange={handleThemeChange}
            onClose={() => setShowThemeMenu(false)}
          />
        )}
      </div>

      <div className="w-px h-4 bg-[var(--border-color)] mx-1" />

      {/* Style Plugins */}
      <div className="flex items-center gap-0.5">
        <ToolbarButton
          onClick={() => setShowBaseStylePlugin(true)}
          title="基础样式"
        >
          <Settings size={14} />
          <span className="text-[10px]">基础</span>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => setShowNodeStylePlugin(true)}
          disabled={!hasActiveNode}
          title="节点样式"
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

      {/* Style Plugin Modals */}
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
    </div>
  )
}

interface ToolbarButtonProps {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
}

function ToolbarButton({ children, onClick, disabled, title }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`
        flex items-center gap-0.5 px-1.5 py-1 rounded
        text-[var(--text-secondary)] text-xs
        hover:bg-[var(--bg-hover)]
        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent
        transition-colors
      `}
    >
      {children}
    </button>
  )
}

interface DropdownMenuProps {
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
  onClose: () => void
}

function DropdownMenu({ options, value, onChange, onClose }: DropdownMenuProps) {
  useEffect(() => {
    const handleClickOutside = () => onClose()
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside, { once: true })
    }, 0)
    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [onClose])

  return (
    <div className="absolute top-full left-0 mt-1 py-1 min-w-[120px] rounded-md shadow-lg border border-[var(--border-color)] bg-[var(--bg-primary)] z-50">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`
            w-full px-3 py-1.5 text-left text-xs
            hover:bg-[var(--bg-hover)]
            ${value === option.value ? 'text-[var(--theme-color)]' : 'text-[var(--text-secondary)]'}
          `}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
