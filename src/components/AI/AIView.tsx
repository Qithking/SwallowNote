import { useState, useRef, useEffect, useCallback } from 'react'
import { Bot, Settings } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslation } from 'react-i18next'
import { useUIStore, useEditorStore, useWorkspaceStore } from '@/stores'
import { loadFileContent } from '@/lib/api'
import { restartAiProxy, saveAiMessage, loadAiRolePrompts, writeFile, createFile, type AiRolePrompt } from '@/lib/tauri'
import { logger } from '@/lib/logger'
import { useAiChat } from '@/hooks/useAiChat'
import { useAiMessageDisplay } from '@/hooks/useAiMessageDisplay'
import { useAiScroll } from '@/hooks/useAiScroll'
import { useAiMessageTrimming } from '@/hooks/useAiMessageTrimming'
import { MessageList } from './MessageList'
import { InputArea } from './InputArea'
import { useAiHistory } from '@/hooks/useAiHistory'
import { useAiContextMenu } from '@/hooks/useAiContextMenu'

function AIView() {
  const { t } = useTranslation()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copiedIdTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [inputValue, setInputValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isOverflow, setIsOverflow] = useState(false)
  const savedMessageIds = useRef<Set<string>>(new Set())
  const [messageTimestamps, setMessageTimestamps] = useState<Record<string, string>>({})
  const [aiRolePrompts, setAiRolePrompts] = useState<AiRolePrompt[]>([])
  const [activeRoleKey, setActiveRoleKey] = useState('chat')
  const pendingUserTimestampsByCount = useRef<Map<number, string>>(new Map())

  // Use Zustand selectors to avoid unnecessary re-renders from unrelated state changes
  const aiModels = useUIStore((s) => s.aiModels)
  const activeAiModelId = useUIStore((s) => s.activeAiModelId)
  const defaultAiModelId = useUIStore((s) => s.defaultAiModelId)
  const aiPort = useUIStore((s) => s.aiPort)
  const setSettingsPanelVisible = useUIStore((s) => s.setSettingsPanelVisible)
  const setSettingsSection = useUIStore((s) => s.setSettingsSection)
  const setSidebarView = useUIStore((s) => s.setSidebarView)
  const setActiveAiModel = useUIStore((s) => s.setActiveAiModel)
  const aiAttachedFiles = useUIStore((s) => s.aiAttachedFiles)
  const removeAiAttachedFile = useUIStore((s) => s.removeAiAttachedFile)
  const clearAiAttachedFiles = useUIStore((s) => s.clearAiAttachedFiles)
  const aiContextMenuRequest = useUIStore((s) => s.aiContextMenuRequest)
  const setAiContextMenuRequest = useUIStore((s) => s.setAiContextMenuRequest)
  const setRightPanelType = useUIStore((s) => s.setRightPanelType)
  const insertAtCursor = useEditorStore((s) => s.insertAtCursor)
  const replaceContent = useEditorStore((s) => s.replaceContent)
  // 只订阅 active tab 引用，避免订阅整个 tabs 数组导致任意 tab 内容变更都重渲染
  const activeEditorTab = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const rootPath = useWorkspaceStore((s) => s.rootPath)

  const isConfigured = aiModels.length > 0

  // useChat 集成、stopRef 与模型初始化逻辑 (原 AIView 121-131, 252-280)
  const { messages, status, stop, error, sendMessage, setMessages, isLoading, activeAiModelIdRef } = useAiChat({
    aiPort,
    activeAiModelId,
    aiModels,
    defaultAiModelId,
    setActiveAiModel,
  })

  // 右键消息展示文本映射子系统 (原 AIView 81-159)
  const { contextMenuDisplayTexts, pendingDisplayTexts, pendingDisplayTextQueue, displayTextMappedIds } = useAiMessageDisplay(messages)

  // 滚动到底节流与滚动容器 ref (原 AIView 68-69, 160-180)
  const { messagesEndRef, scrollViewportRef } = useAiScroll(messages)

  // 内存消息超限裁剪 (原 AIView 181-250)
  useAiMessageTrimming({
    messages,
    isLoading,
    setMessages,
    savedMessageIds,
    contextMenuDisplayTexts,
    displayTextMappedIds,
    setMessageTimestamps,
    pendingUserTimestampsByCount,
    activeAiModelIdRef,
  })

  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      const height = Math.min(Math.max(el.scrollHeight, 50), 200)
      el.style.height = height + 'px'
      setIsOverflow(el.scrollHeight > 200)
    }
  }, [inputValue])
  // Cleanup copy-feedback timer on unmount
  useEffect(() => {
    return () => clearTimeout(copiedIdTimer.current)
  }, [])

  // Load role prompts on mount and listen for changes from settings panel
  const reloadRolePrompts = useCallback(() => {
    loadAiRolePrompts()
      .then((prompts) => setAiRolePrompts(prompts))
      .catch((e) => logger.error('ai-view', 'Failed to load AI role prompts:', e))
  }, [])

  useEffect(() => {
    reloadRolePrompts()
    window.addEventListener('ai-role-prompts-changed', reloadRolePrompts)
    return () => window.removeEventListener('ai-role-prompts-changed', reloadRolePrompts)
  }, [reloadRolePrompts])

  // 历史加载、分页加载更多、滚动监听、assistant 消息自动保存 (原 AIView 112-210)
  const { isLoadingHistory, historyReadyRef } = useAiHistory({
    isConfigured,
    status,
    messages,
    setMessages,
    savedMessageIds,
    setMessageTimestamps,
    scrollViewportRef,
    activeAiModelId,
  })

  const handleModelChange = async (modelId: string) => {
    setActiveAiModel(modelId)
    const model = aiModels.find((m) => m.id === modelId)
    if (model) {
      const apiKey = model._decryptedApiKey || ''
      try {
        await restartAiProxy(model.provider, apiKey, model.baseUrl, model.model, aiPort)
      } catch (e) {
        logger.error('ai-view', 'Failed to restart AI proxy:', e)
      }
    }
  }

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content)
    setCopiedId(id)
    clearTimeout(copiedIdTimer.current)
    copiedIdTimer.current = setTimeout(() => setCopiedId(null), 2000)
  }

  // 打开设置面板并跳转 AI section; 需同时设 sidebarView='settings' 才能渲染
  const openAiSettings = useCallback(() => {
    setSettingsSection('ai')
    setSettingsPanelVisible(true)
    setSidebarView('settings')
  }, [setSettingsSection, setSettingsPanelVisible, setSidebarView])

  const handleSaveAsNewFile = async (content: string) => {
    const activeTab = activeEditorTab
    if (!activeTab?.path) return
    // Get directory of the active tab file
    const dirPath = activeTab.path.includes('/') ? activeTab.path.substring(0, activeTab.path.lastIndexOf('/')) : ''
    if (!dirPath) return
    // Generate file name with yyyyMMddHHmmsss format
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const fileName = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${String(now.getSeconds()).padStart(3, '0')}`
    const fullPath = `${dirPath}/${fileName}.md`
    try {
      await createFile(fullPath, false)
      await writeFile(fullPath, content)
      // Refresh file tree
      const { useFileTreeStore } = await import('@/stores/filetree')
      await useFileTreeStore.getState().refreshExpanded()
    } catch (e) {
      logger.error('ai-view', 'Failed to save as new file:', e)
    }
  }

  // pendingUserTimestampsByCount 的 LRU 上限：超过 50 条时删除最旧的 key，避免无界增长
  const MAX_PENDING_TIMESTAMPS = 50
  const trimPendingTimestampsLRU = () => {
    while (pendingUserTimestampsByCount.current.size > MAX_PENDING_TIMESTAMPS) {
      const oldest = pendingUserTimestampsByCount.current.keys().next().value
      if (oldest === undefined) break
      pendingUserTimestampsByCount.current.delete(oldest)
    }
  }

  // Effect: assign timestamps to new user messages once they appear in the messages array
  useEffect(() => {
    if (pendingUserTimestampsByCount.current.size === 0) return
    let updated = false
    const newEntries: Record<string, string> = {}
    for (const [countAtSend, timeStr] of pendingUserTimestampsByCount.current) {
      // The new user message should be at index `countAtSend` (the old length before adding)
      const msg = messages[countAtSend]
      if (msg && msg.role === 'user' && !messageTimestamps[msg.id]) {
        newEntries[msg.id] = timeStr
        savedMessageIds.current.add(msg.id)
        pendingUserTimestampsByCount.current.delete(countAtSend)
        updated = true
      }
    }
    if (updated) {
      setMessageTimestamps((prev) => ({ ...prev, ...newEntries }))
    }
  }, [messages])

  // 右键菜单触发的 AI 对话请求处理 (原 AIView 209-308)
  useAiContextMenu({
    aiContextMenuRequest,
    isConfigured,
    setAiContextMenuRequest,
    setRightPanelType,
    setActiveRoleKey,
    messages,
    pendingUserTimestampsByCount,
    trimPendingTimestampsLRU,
    pendingDisplayTexts,
    pendingDisplayTextQueue,
    aiRolePrompts,
    sendMessage,
    activeAiModelId,
    historyReadyRef,
  })

  const persistAndSend = async (text: string) => {
    // Record the local timestamp and current message count before sending
    const now = new Date()
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    const countBeforeSend = messages.length
    pendingUserTimestampsByCount.current.set(countBeforeSend, timeStr)
    trimPendingTimestampsLRU()

    // Get system prompt for the active role
    const activePrompt = aiRolePrompts.find((p) => p.role_key === activeRoleKey)
    const systemPrompt = activePrompt?.prompt || ''

    let aiContent = text
    let displayText = text

    // When there are attached files from the file tree, read their content and append
    if (aiAttachedFiles.length > 0) {
      const fileParts: string[] = []
      const displayNames: string[] = []
      for (const filePath of aiAttachedFiles) {
        try {
          const content = await loadFileContent(filePath)
          // Compute relative path for display
          let relPath = filePath
          if (rootPath && relPath.startsWith(rootPath)) {
            relPath = relPath.slice(rootPath.length)
            if (relPath.startsWith('/')) relPath = relPath.slice(1)
          }
          displayNames.push(relPath)
          fileParts.push(`--- ${relPath} ---\n${content}`)
        } catch (e) {
          logger.error('ai-view', 'Failed to read attached file:', filePath, e)
        }
      }
      if (fileParts.length > 0) {
        displayText = text + '\n\n[' + displayNames.join(', ') + ']'
        aiContent = text + '\n\n' + fileParts.join('\n\n')
        // 生成稳定 correlation id 作为 key，避免 messages.length 索引错位（Task 21）
        const correlationId = crypto.randomUUID()
        pendingDisplayTexts.current.set(correlationId, displayText)
        pendingDisplayTextQueue.current.push(correlationId)
      }
      // Clear attached files after sending
      clearAiAttachedFiles()
    } else if (activeRoleKey !== 'chat') {
      // For non-chat roles (e.g. polish, format, summary), automatically attach
      // the active tab's file content so the AI can operate on it.
      // The user's input (e.g. "整理格式") is treated as an instruction for that file.
      const activeTab = activeEditorTab
      if (activeTab?.content) {
        // Compute relative file path for display
        let filePath = activeTab.path || ''
        if (rootPath && filePath.startsWith(rootPath)) {
          filePath = filePath.slice(rootPath.length)
          if (filePath.startsWith('/')) filePath = filePath.slice(1)
        }
        displayText = `[${activePrompt?.name || activeRoleKey}] ${filePath}`
        aiContent = `${displayText}\n\n${activeTab.content}`
        // 生成稳定 correlation id 作为 key，避免 messages.length 索引错位（Task 21）
        const correlationId = crypto.randomUUID()
        pendingDisplayTexts.current.set(correlationId, displayText)
        pendingDisplayTextQueue.current.push(correlationId)
      }
    }

    // Pass systemPrompt via body option; the proxy handler will inject it as a system message
    if (systemPrompt) {
      sendMessage({ text: aiContent }, { body: { systemPrompt } })
    } else {
      sendMessage({ text: aiContent })
    }

    // Save the display text (not the full file content) to DB
    saveAiMessage('user', displayText, activeAiModelId || '').catch((e) => logger.error('ai-view', 'Failed to save AI user message:', e))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isConfigured && inputValue.trim()) {
        persistAndSend(inputValue.trim())
        setInputValue('')
      }
    }
  }

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isConfigured || !inputValue.trim()) return
    persistAndSend(inputValue.trim())
    setInputValue('')
  }

  const scrollAreaRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      const viewport = node.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement | null
      if (viewport) {
        scrollViewportRef.current = viewport
      }
    }
  }, [])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center h-10 px-3 shrink-0 " style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
        <div className="flex items-center gap-2">
          <Bot size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="text-sm font-medium uppercase tracking-wider" >{t('ai.title')}</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {isConfigured && (
            <Select value={activeAiModelId} onValueChange={handleModelChange}>
              <SelectTrigger className="h-7 w-auto border-0 bg-transparent shadow-none px-1 text-xs text-muted-foreground hover:text-foreground focus:ring-0 max-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="min-w-[120px]">
                {aiModels.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs py-1 pl-7 pr-2">
                    {m.name || m.model}{m.isBuiltIn ? ` · ${t('ai.builtIn')}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={openAiSettings}
              >
                <Settings size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.settings')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <MessageList
        isConfigured={isConfigured}
        messages={messages}
        isLoadingHistory={isLoadingHistory}
        contextMenuDisplayTexts={contextMenuDisplayTexts}
        messageTimestamps={messageTimestamps}
        copiedId={copiedId}
        isLoading={isLoading}
        error={error}
        messagesEndRef={messagesEndRef}
        scrollAreaRef={scrollAreaRef}
        handleCopy={handleCopy}
        insertAtCursor={insertAtCursor}
        replaceContent={replaceContent}
        handleSaveAsNewFile={handleSaveAsNewFile}
        openAiSettings={openAiSettings}
      />

      <InputArea
        isConfigured={isConfigured}
        inputValue={inputValue}
        setInputValue={setInputValue}
        isOverflow={isOverflow}
        textareaRef={textareaRef}
        isLoading={isLoading}
        aiAttachedFiles={aiAttachedFiles}
        removeAiAttachedFile={removeAiAttachedFile}
        aiRolePrompts={aiRolePrompts}
        activeRoleKey={activeRoleKey}
        setActiveRoleKey={setActiveRoleKey}
        onFormSubmit={onFormSubmit}
        handleKeyDown={handleKeyDown}
        stop={stop}
      />
    </div>
  )
}

export { AIView }
