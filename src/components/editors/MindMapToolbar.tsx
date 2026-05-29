/**
 * MindMap Toolbar Component
 *
 * Provides basic operations for the mind map editor.
 * This is a simplified toolbar inspired by the official simple-mind-map Vue2 example.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Undo2,
  Redo2,
  Paintbrush,
  SmilePlus,
  Link,
  FileText,
  Tag,
  Type,
  Square,
  Layout,
  Palette,
  ZoomIn,
  ZoomOut,
  Maximize,
  Settings,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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

const ICON_LIST = [
  { name: 'smile', emoji: '😊', label: '微笑' },
  { name: 'cry', emoji: '😢', label: '哭泣' },
  { name: 'laugh', emoji: '😄', label: '大笑' },
  { name: 'angry', emoji: '😠', label: '愤怒' },
  { name: 'surprise', emoji: '😲', label: '惊讶' },
  { name: 'love', emoji: '❤️', label: '爱心' },
  { name: 'star', emoji: '⭐', label: '星星' },
  { name: 'fire', emoji: '🔥', label: '火焰' },
  { name: 'check', emoji: '✅', label: '完成' },
  { name: 'cross', emoji: '❌', label: '错误' },
  { name: 'warn', emoji: '⚠️', label: '警告' },
  { name: 'question', emoji: '❓', label: '疑问' },
  { name: 'idea', emoji: '💡', label: '想法' },
  { name: 'rocket', emoji: '🚀', label: '火箭' },
  { name: 'target', emoji: '🎯', label: '目标' },
  { name: 'flag', emoji: '🚩', label: '旗帜' },
  { name: 'lock', emoji: '🔒', label: '锁定' },
  { name: 'key', emoji: '🔑', label: '钥匙' },
  { name: 'clock', emoji: '⏰', label: '时钟' },
  { name: 'calendar', emoji: '📅', label: '日历' },
  { name: 'phone', emoji: '📞', label: '电话' },
  { name: 'email', emoji: '📧', label: '邮件' },
  { name: 'home', emoji: '🏠', label: '首页' },
  { name: 'link', emoji: '🔗', label: '链接' },
  { name: 'up', emoji: '👆', label: '向上' },
  { name: 'down', emoji: '👇', label: '向下' },
  { name: 'left', emoji: '👈', label: '向左' },
  { name: 'right', emoji: '👉', label: '向右' },
  { name: 'plus', emoji: '➕', label: '加' },
  { name: 'minus', emoji: '➖', label: '减' },
  { name: 'chart', emoji: '📊', label: '图表' },
  { name: 'file', emoji: '📄', label: '文件' },
]

export function MindMapToolbar({ mindMap }: MindMapToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [activeNodes, setActiveNodes] = useState<any[]>([])
  const [currentLayout, setCurrentLayout] = useState('logicalStructure')
  const [currentTheme, setCurrentTheme] = useState('default')
  const [showBaseStylePlugin, setShowBaseStylePlugin] = useState(false)
  const [showNodeStylePlugin, setShowNodeStylePlugin] = useState(false)
  const [isPainterActive, setIsPainterActive] = useState(false)
  const [hyperlinkDialogOpen, setHyperlinkDialogOpen] = useState(false)
  const [noteDialogOpen, setNoteDialogOpen] = useState(false)
  const [iconDialogOpen, setIconDialogOpen] = useState(false)
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  const [hyperlinkUrl, setHyperlinkUrl] = useState('')
  const [hyperlinkTitle, setHyperlinkTitle] = useState('')
  const [noteText, setNoteText] = useState('')
  const [tagInput, setTagInput] = useState('')

  const handleToolbarWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = toolbarRef.current
    if (!el) return
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
  }, [])

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

    const handlePainterStart = () => setIsPainterActive(true)
    const handlePainterEnd = () => setIsPainterActive(false)

    mindMap.on('painter_start', handlePainterStart)
    mindMap.on('painter_end', handlePainterEnd)

    return () => {
      mindMap.off('painter_start', handlePainterStart)
      mindMap.off('painter_end', handlePainterEnd)
    }
  }, [mindMap])

  const hasActiveNode = activeNodes.length > 0

  const handleUndo = () => {
    if (!mindMap) return
    mindMap.execCommand('BACK')
  }

  const handleRedo = () => {
    if (!mindMap) return
    mindMap.execCommand('FORWARD')
  }

  const handleFormatPainter = () => {
    if (!mindMap || !hasActiveNode) return
    mindMap.painter?.startPainter()
  }

  const handleOpenIconDialog = () => {
    if (!mindMap || !hasActiveNode) return
    setIconDialogOpen(true)
  }

  const handleOpenHyperlinkDialog = () => {
    if (!mindMap || !hasActiveNode) return
    const node = activeNodes[0]
    setHyperlinkUrl(node.getData('hyperlink') || '')
    setHyperlinkTitle(node.getData('hyperlinkTitle') || '')
    setHyperlinkDialogOpen(true)
  }

  const handleOpenNoteDialog = () => {
    if (!mindMap || !hasActiveNode) return
    const node = activeNodes[0]
    setNoteText(node.getData('note') || '')
    setNoteDialogOpen(true)
  }

  const handleOpenTagDialog = () => {
    if (!mindMap || !hasActiveNode) return
    const node = activeNodes[0]
    const existingTags = node.getData('tag') || []
    setTagInput(existingTags.join(', '))
    setTagDialogOpen(true)
  }

  const handleSetHyperlink = useCallback(() => {
    if (!mindMap || !hasActiveNode) return
    const node = activeNodes[0]
    mindMap.execCommand('SET_NODE_HYPERLINK', node, hyperlinkUrl, hyperlinkTitle)
    setHyperlinkDialogOpen(false)
  }, [mindMap, activeNodes, hyperlinkUrl, hyperlinkTitle])

  const handleSetNote = useCallback(() => {
    if (!mindMap || !hasActiveNode) return
    const node = activeNodes[0]
    mindMap.execCommand('SET_NODE_NOTE', node, noteText)
    setNoteDialogOpen(false)
  }, [mindMap, activeNodes, noteText])

  const handleSetIcon = useCallback((iconName: string) => {
    if (!mindMap || !hasActiveNode) return
    const node = activeNodes[0]
    const currentIcons = node.getData('icon') || []
    const exists = currentIcons.some((i: any) => i.name === iconName)
    let newIcons: any[]
    if (exists) {
      newIcons = currentIcons.filter((i: any) => i.name !== iconName)
    } else {
      newIcons = [...currentIcons, { name: iconName }]
    }
    mindMap.execCommand('SET_NODE_ICON', node, newIcons)
  }, [mindMap, activeNodes])

  const handleSetTag = useCallback(() => {
    if (!mindMap || !hasActiveNode) return
    const node = activeNodes[0]
    const tags = tagInput
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0)
    mindMap.execCommand('SET_NODE_TAG', node, tags)
    setTagDialogOpen(false)
  }, [mindMap, activeNodes, tagInput])

  const handleAddSummary = () => {
    if (!mindMap || !hasActiveNode) return
    mindMap.execCommand('ADD_GENERALIZATION')
  }

  const handleAddOuterFrame = () => {
    if (!mindMap || !hasActiveNode) return
    mindMap.execCommand('ADD_OUTER_FRAME')
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

  return (
    <>
      <div
        ref={toolbarRef}
        onWheel={handleToolbarWheel}
        className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-x-auto overflow-y-hidden scrollbar-none"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', minHeight: '37px', maxHeight: '37px' }}
      >
      {/* Undo / Redo */}
      <div className="flex items-center gap-0.5 shrink-0">
        <ToolbarButton
          onClick={handleUndo}
          title="回退 (Ctrl+Z)"
        >
          <Undo2 size={14} />
          <span className="text-[10px]">回退</span>
        </ToolbarButton>

        <ToolbarButton
          onClick={handleRedo}
          title="前进 (Ctrl+Y)"
        >
          <Redo2 size={14} />
          <span className="text-[10px]">前进</span>
        </ToolbarButton>
      </div>

      <div className="w-px h-4 bg-[var(--border-color)] mx-1 shrink-0" />

      {/* Format Painter */}
      <ToolbarButton
        onClick={handleFormatPainter}
        disabled={!hasActiveNode}
        title="格式刷"
        className="shrink-0"
        style={isPainterActive ? { background: 'var(--bg-hover)' } : undefined}
      >
        <Paintbrush size={14} />
        <span className="text-[10px]">格式刷</span>
      </ToolbarButton>

      <div className="w-px h-4 bg-[var(--border-color)] mx-1 shrink-0" />

      {/* Node Enhancement */}
      <div className="flex items-center gap-0.5 shrink-0">
        <ToolbarButton
          onClick={handleOpenIconDialog}
          disabled={!hasActiveNode}
          title="图标"
        >
          <SmilePlus size={14} />
          <span className="text-[10px]">图标</span>
        </ToolbarButton>

        <ToolbarButton
          onClick={handleOpenHyperlinkDialog}
          disabled={!hasActiveNode}
          title="超链接"
        >
          <Link size={14} />
          <span className="text-[10px]">超链接</span>
        </ToolbarButton>

        <ToolbarButton
          onClick={handleOpenNoteDialog}
          disabled={!hasActiveNode}
          title="备注"
        >
          <FileText size={14} />
          <span className="text-[10px]">备注</span>
        </ToolbarButton>

        <ToolbarButton
          onClick={handleOpenTagDialog}
          disabled={!hasActiveNode}
          title="标签"
        >
          <Tag size={14} />
          <span className="text-[10px]">标签</span>
        </ToolbarButton>

        <ToolbarButton
          onClick={handleAddSummary}
          disabled={!hasActiveNode}
          title="概要 (Ctrl+G)"
        >
          <Type size={14} />
          <span className="text-[10px]">概要</span>
        </ToolbarButton>

        <ToolbarButton
          onClick={handleAddOuterFrame}
          disabled={!hasActiveNode}
          title="外框"
        >
          <Square size={14} />
          <span className="text-[10px]">外框</span>
        </ToolbarButton>
      </div>

      <div className="w-px h-4 bg-[var(--border-color)] mx-1 shrink-0" />

      {/* Layout */}
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-0.5 px-1.5 py-1 rounded text-[var(--text-secondary)] text-xs hover:bg-[var(--bg-hover)] transition-colors outline-none shrink-0">
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
        <DropdownMenuTrigger className="flex items-center gap-0.5 px-1.5 py-1 rounded text-[var(--text-secondary)] text-xs hover:bg-[var(--bg-hover)] transition-colors outline-none shrink-0">
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

      <div className="w-px h-4 bg-[var(--border-color)] mx-1 shrink-0" />

      {/* Style Plugins */}
      <div className="flex items-center gap-0.5 shrink-0">
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

      <div className="w-px h-4 bg-[var(--border-color)] mx-1 shrink-0" />

      {/* View Operations */}
      <div className="flex items-center gap-0.5 shrink-0">
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

      {/* Hyperlink Dialog */}
      <Dialog open={hyperlinkDialogOpen} onOpenChange={setHyperlinkDialogOpen}>
        <DialogContent
          style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
          }}
        >
          <DialogHeader>
            <DialogTitle style={{ color: 'var(--text-primary)' }}>设置超链接</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>链接地址</label>
              <Input
                value={hyperlinkUrl}
                onChange={(e) => setHyperlinkUrl(e.target.value)}
                placeholder="https://"
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  borderColor: 'var(--border-color)',
                }}
              />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>链接标题</label>
              <Input
                value={hyperlinkTitle}
                onChange={(e) => setHyperlinkTitle(e.target.value)}
                placeholder="链接标题（可选）"
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  borderColor: 'var(--border-color)',
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={() => setHyperlinkDialogOpen(false)}
              className="px-3 py-1.5 rounded text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              取消
            </button>
            <button
              onClick={handleSetHyperlink}
              className="px-3 py-1.5 rounded text-xs text-white"
              style={{ background: 'var(--theme-color)' }}
            >
              确定
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Note Dialog */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent
          style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
          }}
        >
          <DialogHeader>
            <DialogTitle style={{ color: 'var(--text-primary)' }}>设置备注</DialogTitle>
          </DialogHeader>
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="输入备注内容..."
            rows={5}
            style={{
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              borderColor: 'var(--border-color)',
            }}
          />
          <DialogFooter>
            <button
              onClick={() => setNoteDialogOpen(false)}
              className="px-3 py-1.5 rounded text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              取消
            </button>
            <button
              onClick={handleSetNote}
              className="px-3 py-1.5 rounded text-xs text-white"
              style={{ background: 'var(--theme-color)' }}
            >
              确定
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Icon Dialog */}
      <Dialog open={iconDialogOpen} onOpenChange={setIconDialogOpen}>
        <DialogContent
          style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
          }}
        >
          <DialogHeader>
            <DialogTitle style={{ color: 'var(--text-primary)' }}>设置图标</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-8 gap-1">
            {ICON_LIST.map((icon) => {
              const currentIcons = activeNodes[0]?.getData('icon') || []
              const isActive = currentIcons.some((i: any) => i.name === icon.name)
              return (
                <button
                  key={icon.name}
                  onClick={() => handleSetIcon(icon.name)}
                  className="flex items-center justify-center w-8 h-8 rounded text-lg hover:bg-[var(--bg-hover)] transition-colors"
                  style={{
                    border: isActive ? '2px solid var(--theme-color)' : '1px solid var(--border-color)',
                    background: isActive ? 'var(--bg-hover)' : 'transparent',
                  }}
                  title={icon.label}
                >
                  {icon.emoji}
                </button>
              )
            })}
          </div>
          <DialogFooter>
            <button
              onClick={() => setIconDialogOpen(false)}
              className="px-3 py-1.5 rounded text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              关闭
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tag Dialog */}
      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
        <DialogContent
          style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
          }}
        >
          <DialogHeader>
            <DialogTitle style={{ color: 'var(--text-primary)' }}>设置标签</DialogTitle>
          </DialogHeader>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>
              输入标签，多个标签用逗号分隔
            </label>
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="标签1, 标签2, 标签3"
              style={{
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                borderColor: 'var(--border-color)',
              }}
            />
          </div>
          <DialogFooter>
            <button
              onClick={() => setTagDialogOpen(false)}
              className="px-3 py-1.5 rounded text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              取消
            </button>
            <button
              onClick={handleSetTag}
              className="px-3 py-1.5 rounded text-xs text-white"
              style={{ background: 'var(--theme-color)' }}
            >
              确定
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
