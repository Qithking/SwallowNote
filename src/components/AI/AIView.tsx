import { useState, useRef, useEffect, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import {
  Bot,
  Send,
  Loader2,
  Sparkles,
  Check,
  Settings,
  Square,
  X,
  ClipboardPaste,
  PenLine,
  Replace,
  FilePlus,
} from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { useUIStore, useEditorStore, useWorkspaceStore } from '@/stores'
import { MarkdownRenderer } from './MarkdownRenderer'
import { getAiProxyUrl } from '@/lib/ai'
import { loadFileContent } from '@/lib/api'
import { restartAiProxy, saveAiMessage, loadAiMessages, loadAiRolePrompts, writeFile, createFile, type AiRolePrompt } from '@/lib/tauri'

function getMessageText(message: { parts?: Array<{ type: string; text?: string }> }): string {
  if (!message.parts) return ''
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

function formatTimeStr(timeStr: string): string {
  if (!timeStr) return ''
  const match = timeStr.match(/(\d{2}):(\d{2}):(\d{2})/)
  if (match) return `${match[1]}:${match[2]}:${match[3]}`
  return timeStr
}

function AIView() {
  const { t } = useTranslation()
  // Maximum number of messages kept in memory to prevent unbounded growth
  const MAX_IN_MEMORY_MESSAGES = 100
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isOverflow, setIsOverflow] = useState(false)
  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      const height = Math.min(Math.max(el.scrollHeight, 50), 200)
      el.style.height = height + 'px'
      setIsOverflow(el.scrollHeight > 200)
    }
  }, [inputValue])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollViewportRef = useRef<HTMLDivElement | null>(null)
  const savedMessageIds = useRef<Set<string>>(new Set())
  const [messageTimestamps, setMessageTimestamps] = useState<Record<string, string>>({})
  const [oldestDbId, setOldestDbId] = useState<number | null>(null)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const historyLoadedRef = useRef(false)
  // Tracks whether chat history has finished loading.
  // Context-menu requests must wait for history to load before sending,
  // otherwise setMessages(historyMessages) will overwrite the newly sent message.
  const historyReadyRef = useRef(false)
  const [aiRolePrompts, setAiRolePrompts] = useState<AiRolePrompt[]>([])
  const [activeRoleKey, setActiveRoleKey] = useState('chat')
  // Map from message ID to display text for context-menu-triggered messages
  // (so the chat bubble shows "[润色] src/App.tsx (L10-L25)" instead of the entire file content)
  const contextMenuDisplayTexts = useRef<Map<string, string>>(new Map())

  // 待映射的展示文本：以发送时生成的稳定 correlation id 为 key（Task 21）
  // 使用稳定 id 而非 messages.length，避免 history 头部插入消息后索引错位
  const pendingDisplayTexts = useRef<Map<string, string>>(new Map())
  // 发送顺序队列：按 FIFO 将 pending 展示文本匹配到新出现的 user 消息
  const pendingDisplayTextQueue = useRef<Array<string>>([])
  // 已匹配过展示文本的 user 消息 id 集合，避免重复匹配
  const displayTextMappedIds = useRef<Set<string>>(new Set())

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
  const editorTabs = useEditorStore((s) => s.tabs)
  const editorActiveTabId = useEditorStore((s) => s.activeTabId)
  const { rootPath } = useWorkspaceStore()

  // 使用 ref 让 mount-only useEffect 能读取到最新的 aiPort / activeAiModelId，
  // 避免空依赖数组导致的 stale closure（Task 19）
  const aiPortRef = useRef(aiPort)
  aiPortRef.current = aiPort
  const activeAiModelIdRef = useRef(activeAiModelId)
  activeAiModelIdRef.current = activeAiModelId

  const isConfigured = aiModels.length > 0

  const chat = useChat({
    transport: new DefaultChatTransport({
      api: getAiProxyUrl(aiPort),
    }),
  })

  const { messages, status, stop, error, sendMessage, setMessages } = chat
  const isLoading = status === 'submitted' || status === 'streaming'

  // 当 messages 变化时，按 FIFO 顺序把待映射展示文本匹配到新出现的 user 消息（Task 21）
  useEffect(() => {
    if (pendingDisplayTextQueue.current.length === 0) return
    // 找出尚未匹配展示文本的 user 消息
    const unmapped = messages.filter(
      (msg) => msg.role === 'user' && !displayTextMappedIds.current.has(msg.id)
    )
    // 按 FIFO 顺序消费待映射项，与 unmapped user 消息一一对应
    while (pendingDisplayTextQueue.current.length > 0 && unmapped.length > 0) {
      const correlationId = pendingDisplayTextQueue.current.shift()!
      const msg = unmapped.shift()!
      const displayText = pendingDisplayTexts.current.get(correlationId)
      if (displayText !== undefined) {
        contextMenuDisplayTexts.current.set(msg.id, displayText)
        pendingDisplayTexts.current.delete(correlationId)
      }
      displayTextMappedIds.current.add(msg.id)
    }
  }, [messages])

  // Throttled scroll-to-bottom: avoids excessive scroll calls during streaming
  const scrollToBottomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollToBottom = useCallback(() => {
    if (scrollToBottomTimerRef.current) return
    scrollToBottomTimerRef.current = setTimeout(() => {
      scrollToBottomTimerRef.current = null
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
  }, [])

  useEffect(() => {
    scrollToBottom()
    return () => {
      if (scrollToBottomTimerRef.current) {
        clearTimeout(scrollToBottomTimerRef.current)
        scrollToBottomTimerRef.current = null
      }
    }
  }, [messages, scrollToBottom])

  // Trim in-memory messages when they exceed the limit to prevent unbounded memory growth
  useEffect(() => {
    if (messages.length <= MAX_IN_MEMORY_MESSAGES) return
    // Don't trim during active streaming to avoid disrupting the response
    if (isLoading) return
    // 裁剪前先把尚未入库的 user 消息保存到 DB，避免丢弃后无法找回（Task 20）
    // assistant 消息在流式结束时已保存；db- 前缀消息已存在于 DB，跳过避免重复入库
    const discardCount = messages.length - MAX_IN_MEMORY_MESSAGES
    const toDiscard = messages.slice(0, discardCount)
    // 裁剪前先把待裁剪的 user 消息 flush 到 DB，失败则跳过裁剪保留在内存，下次 effect 重新尝试（P0 NEW-3）
    // 使用内部 async 函数，避免 useEffect 回调本身返回 Promise（React 不允许）
    let cancelled = false
    const flushAndTrim = async () => {
      for (const msg of toDiscard) {
        if (msg.role === 'user' && !savedMessageIds.current.has(msg.id)) {
          const text = getMessageText(msg)
          if (text) {
            try {
              await saveAiMessage('user', text, activeAiModelIdRef.current || '')
              // 标记为已入库，避免下次 effect 重试时重复写入
              savedMessageIds.current.add(msg.id)
            } catch (e) {
              console.error('[AIView] Failed to flush user message before trim, skipping trim:', e)
              // flush 失败则不裁剪，保留在内存中，等待下次 effect 重新尝试
              return
            }
          }
        }
      }
      // flush 全部成功后才裁剪；若 effect 已被清理（依赖变化）则跳过 setMessages 避免竞态
      if (cancelled) return
      const trimmed = messages.slice(messages.length - MAX_IN_MEMORY_MESSAGES)
      setMessages(trimmed)
    }
    flushAndTrim()
    return () => {
      cancelled = true
    }
  }, [messages.length, isLoading])

  useEffect(() => {
    // 通过 ref 读取最新值，避免空依赖数组导致的 stale closure（Task 19）
    const currentActiveAiModelId = activeAiModelIdRef.current
    const currentAiPort = aiPortRef.current
    // If no active model or active model not in list, set default model
    if ((!currentActiveAiModelId || !aiModels.find((m) => m.id === currentActiveAiModelId)) && aiModels.length > 0) {
      // Priority: 1. defaultAiModelId if valid, 2. first available model
      const defaultModel = defaultAiModelId && aiModels.find((m) => m.id === defaultAiModelId)
      setActiveAiModel(defaultModel ? defaultModel.id : aiModels[0].id)
    }
    if (currentActiveAiModelId) {
      const model = aiModels.find((m) => m.id === currentActiveAiModelId)
      if (model) {
        const apiKey = model._decryptedApiKey || ''
        restartAiProxy(model.provider, apiKey, model.baseUrl, model.model, currentAiPort).catch(console.error)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load role prompts on mount and listen for changes from settings panel
  const reloadRolePrompts = useCallback(() => {
    loadAiRolePrompts()
      .then((prompts) => setAiRolePrompts(prompts))
      .catch((e) => console.error('Failed to load AI role prompts:', e))
  }, [])

  useEffect(() => {
    reloadRolePrompts()
    window.addEventListener('ai-role-prompts-changed', reloadRolePrompts)
    return () => window.removeEventListener('ai-role-prompts-changed', reloadRolePrompts)
  }, [reloadRolePrompts])

  useEffect(() => {
    if (historyLoadedRef.current || !isConfigured) return
    historyLoadedRef.current = true
    const loadHistory = async () => {
      try {
        const dbMessages = await loadAiMessages(undefined, 30)
        if (dbMessages.length > 0) {
          const chatMessages = dbMessages.reverse().map((msg) => ({
            id: `db-${msg.id}`,
            role: msg.role as 'user' | 'assistant',
            parts: [{ type: 'text' as const, text: msg.content }],
          }))
          setMessages(chatMessages)
          const timestamps: Record<string, string> = {}
          dbMessages.forEach((msg) => {
            savedMessageIds.current.add(`db-${msg.id}`)
            timestamps[`db-${msg.id}`] = msg.created_at
          })
          setMessageTimestamps((prev) => ({ ...prev, ...timestamps }))
          setOldestDbId(dbMessages[0].id)
          setHasMoreHistory(dbMessages.length >= 30)
        }
      } catch (e) {
        console.error('Failed to load AI chat history:', e)
      } finally {
        // Mark history as ready even if loading failed, so pending requests can proceed
        historyReadyRef.current = true
      }
    }
    loadHistory()
  }, [isConfigured])

  useEffect(() => {
    if (status !== 'ready') return
    if (messages.length === 0) return
    const lastMsg = messages[messages.length - 1]
    if (lastMsg?.role === 'assistant' && !savedMessageIds.current.has(lastMsg.id)) {
      const text = getMessageText(lastMsg)
      if (text) {
        savedMessageIds.current.add(lastMsg.id)
        const now = new Date()
        const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
        setMessageTimestamps((prev) => ({ ...prev, [lastMsg.id]: timeStr }))
        saveAiMessage('assistant', text, activeAiModelId || '').catch(console.error)
      }
    }
  }, [status])

  const loadMoreHistory = useCallback(async () => {
    if (isLoadingHistory || !hasMoreHistory || oldestDbId === null) return
    setIsLoadingHistory(true)
    try {
      const viewport = scrollViewportRef.current
      const prevScrollHeight = viewport?.scrollHeight || 0

      const dbMessages = await loadAiMessages(oldestDbId, 30)
      if (dbMessages.length > 0) {
        const chatMessages = dbMessages.reverse().map((msg) => ({
          id: `db-${msg.id}`,
          role: msg.role as 'user' | 'assistant',
          parts: [{ type: 'text' as const, text: msg.content }],
        }))
        setMessages((prev) => [...chatMessages, ...prev])
        const timestamps: Record<string, string> = {}
        dbMessages.forEach((msg) => {
          savedMessageIds.current.add(`db-${msg.id}`)
          timestamps[`db-${msg.id}`] = msg.created_at
        })
        setMessageTimestamps((prev) => ({ ...prev, ...timestamps }))
        setOldestDbId(dbMessages[0].id)
        setHasMoreHistory(dbMessages.length >= 30)

        requestAnimationFrame(() => {
          if (viewport) {
            const newScrollHeight = viewport.scrollHeight
            viewport.scrollTop = newScrollHeight - prevScrollHeight
          }
        })
      } else {
        setHasMoreHistory(false)
      }
    } catch (e) {
      console.error('Failed to load more history:', e)
    } finally {
      setIsLoadingHistory(false)
    }
  }, [isLoadingHistory, hasMoreHistory, oldestDbId])

  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    const handleScroll = () => {
      if (viewport.scrollTop < 50 && hasMoreHistory && !isLoadingHistory) {
        loadMoreHistory()
      }
    }
    viewport.addEventListener('scroll', handleScroll)
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [hasMoreHistory, isLoadingHistory, loadMoreHistory])

  const handleModelChange = async (modelId: string) => {
    setActiveAiModel(modelId)
    const model = aiModels.find((m) => m.id === modelId)
    if (model) {
      const apiKey = model._decryptedApiKey || ''
      try {
        await restartAiProxy(model.provider, apiKey, model.baseUrl, model.model, aiPort)
      } catch (e) {
        console.error('Failed to restart AI proxy:', e)
      }
    }
  }

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  /**
   * Open the Settings panel and jump directly to the AI section.
   * Mirrors the behaviour of clicking the activity-bar gear icon,
   * which also sets `sidebarView = 'settings'` (the rendering
   * condition in `App.tsx` requires BOTH `settingsPanelVisible`
   * AND `sidebarView === 'settings'` for the panel to appear).
   */
  const openAiSettings = useCallback(() => {
    setSettingsSection('ai')
    setSettingsPanelVisible(true)
    setSidebarView('settings')
  }, [setSettingsSection, setSettingsPanelVisible, setSidebarView])

  const handleSaveAsNewFile = async (content: string) => {
    const activeTab = editorTabs.find((t) => t.id === editorActiveTabId)
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
      console.error('Failed to save as new file:', e)
    }
  }

  // Track pending user timestamps: maps a snapshot of messages.length at send time to the timestamp
  const pendingUserTimestampsByCount = useRef<Map<number, string>>(new Map())

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

  // Listen for context menu requests from the store — process once and clear
  // Uses a processed-ID set to prevent duplicate processing from React re-renders or Strict Mode
  // Limited to 100 entries to prevent memory leaks
  const processedRequestIds = useRef<Set<string>>(new Set())
  const MAX_PROCESSED_IDS = 100

  useEffect(() => {
    if (!aiContextMenuRequest || !isConfigured) return

    // Use the request's unique ID to detect duplicates (React Strict Mode double-fire)
    const requestId = aiContextMenuRequest.id

    // Skip if this request was already processed (prevents React Strict Mode double-fire)
    if (processedRequestIds.current.has(requestId)) return
    processedRequestIds.current.add(requestId)
    // Evict oldest entries to prevent unbounded growth
    if (processedRequestIds.current.size > MAX_PROCESSED_IDS) {
      const iter = processedRequestIds.current.values()
      processedRequestIds.current.delete(iter.next().value!)
    }

    // Clear from store immediately to prevent re-trigger
    setAiContextMenuRequest(null)

    const { roleKey, roleName, hasSelection, content, lineRange, filePath } = aiContextMenuRequest

    // Switch to AI panel
    setRightPanelType('ai')

    // Build the display message (what the user sees in the chat bubble)
    let displayMessage: string
    if (hasSelection && lineRange) {
      displayMessage = `[${roleName}] ${filePath} (L${lineRange[0]}-L${lineRange[1]})`
    } else {
      displayMessage = `[${roleName}] ${filePath}`
    }

    // Build the actual content sent to AI
    const aiContent = `${displayMessage}\n\n${content}`

    // Set the role key
    setActiveRoleKey(roleKey)

    // Helper: actually send the message (called once history is ready)
    const doSend = () => {
      // Record the local timestamp
      const now = new Date()
      const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
      const countBeforeSend = messages.length
      pendingUserTimestampsByCount.current.set(countBeforeSend, timeStr)

      // 生成稳定 correlation id 作为 key，避免 messages.length 索引错位（Task 21）
      const correlationId = crypto.randomUUID()
      pendingDisplayTexts.current.set(correlationId, displayMessage)
      pendingDisplayTextQueue.current.push(correlationId)

      const rolePrompt = aiRolePrompts.find((p) => p.role_key === roleKey)
      const systemPrompt = rolePrompt?.prompt || ''

      // Send to AI with full content
      if (systemPrompt) {
        sendMessage({ text: aiContent }, { body: { systemPrompt } })
      } else {
        sendMessage({ text: aiContent })
      }

      // Save display message to DB (not the full content)
      saveAiMessage('user', displayMessage, activeAiModelId || '').catch(console.error)
    }

    // If chat history hasn't finished loading yet, wait for it.
    // Otherwise setMessages(history) will overwrite the newly sent user message.
    if (historyReadyRef.current) {
      doSend()
    } else {
      // 轮询等待 history 加载完成，带 cleanup 防止组件卸载或依赖变化时泄漏
      let checkInterval: ReturnType<typeof setInterval> | null = null
      let safetyTimeout: ReturnType<typeof setTimeout> | null = null

      checkInterval = setInterval(() => {
        if (historyReadyRef.current) {
          if (checkInterval) clearInterval(checkInterval)
          if (safetyTimeout) clearTimeout(safetyTimeout)
          doSend()
        }
      }, 50)

      // 安全超时：最多等待 3 秒
      safetyTimeout = setTimeout(() => {
        if (checkInterval) clearInterval(checkInterval)
        if (!historyReadyRef.current) {
          historyReadyRef.current = true
          doSend()
        }
      }, 3000)

      // cleanup: 组件卸载或依赖变化时清理定时器
      return () => {
        if (checkInterval) clearInterval(checkInterval)
        if (safetyTimeout) clearTimeout(safetyTimeout)
      }
    }
  }, [aiContextMenuRequest]) // eslint-disable-line react-hooks/exhaustive-deps

  const persistAndSend = async (text: string) => {
    // Record the local timestamp and current message count before sending
    const now = new Date()
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    const countBeforeSend = messages.length
    pendingUserTimestampsByCount.current.set(countBeforeSend, timeStr)

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
          console.error('Failed to read attached file:', filePath, e)
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
      const activeTab = editorTabs.find((t) => t.id === editorActiveTabId)
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
    saveAiMessage('user', displayText, activeAiModelId || '').catch(console.error)
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

      <ScrollArea ref={scrollAreaRef} className="flex-1 p-3">
        <div className="py-[5px]">
        {!isConfigured ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Sparkles size={32} className="mb-3 opacity-50" />
            <p className="text-sm text-center mb-4">
              {t('ai.notConfigured')}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={openAiSettings}
            >
              <Settings size={14} className="mr-1.5" />
              {t('ai.goToSettings')}
            </Button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Sparkles size={32} className="mb-3 opacity-50" />
            <p className="text-sm text-center font-medium">
              {t('ai.placeholderResponse')}
            </p>
          </div>
        ) : (
          <>
            {isLoadingHistory && (
              <div className="flex items-center justify-center py-2">
                <Loader2 size={14} className="animate-spin text-muted-foreground" />
              </div>
            )}
            {messages.map((message) => {
              const text = getMessageText(message)
              // For context-menu-triggered messages, show the display summary instead of full content
              const displayText = message.role === 'user' && contextMenuDisplayTexts.current.has(message.id)
                ? contextMenuDisplayTexts.current.get(message.id)!
                : text
              return (
                <div
                  key={message.id}
                  className={cn(
                    'flex gap-3 mt-4',
                    message.role === 'user' && 'flex-row-reverse'
                  )}
                  style={{ maxWidth: '100%' }}
                >
                  <div
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-md',
                      message.role === 'user' ? 'bg-primary/20 text-foreground' : 'bg-accent'
                    )}
                  >
                    {message.role === 'user' ? (
                      <span className="text-xs text-foreground">You</span>
                    ) : (
                      <Bot size={14} />
                    )}
                  </div>
                  <div
                    className={cn(
                      'p-3 rounded-lg overflow-hidden shadow-md',
                      message.role === 'user'
                        ? 'bg-primary/15 text-foreground max-w-[85%]'
                        : 'bg-accent max-w-[85%]'
                    )}
                  >
                    {message.role === 'assistant' ? (
                      <div className="min-w-0 overflow-hidden">
                        <MarkdownRenderer content={displayText} />
                      </div>
                    ) : (
                      <p className="text-xs whitespace-pre-wrap break-words">{displayText}</p>
                    )}
                    {message.role === 'user' && messageTimestamps[message.id] && (
                      <div className="flex items-center justify-between gap-1 mt-1">
                        <span />
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => handleCopy(text, message.id)}
                                className="p-1 rounded hover:bg-black/10 text-xs opacity-50 hover:opacity-100"
                              >
                                {copiedId === message.id ? (
                                  <Check size={12} />
                                ) : (
                                  <ClipboardPaste size={12} />
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{t('ai.copyContent')}</TooltipContent>
                          </Tooltip>
                          <span className="text-[10px] text-muted-foreground">
                            {formatTimeStr(messageTimestamps[message.id])}
                          </span>
                        </div>
                      </div>
                    )}
                    {message.role === 'assistant' && text && (
                      <div className="flex items-center justify-end gap-1 mt-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => insertAtCursor(text)}
                              className="p-1 rounded hover:bg-black/10 text-xs opacity-50 hover:opacity-100"
                            >
                              <PenLine size={12} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>{t('ai.insertAtCursor')}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => replaceContent(text)}
                              className="p-1 rounded hover:bg-black/10 text-xs opacity-50 hover:opacity-100"
                            >
                              <Replace size={12} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>{t('ai.replaceContent')}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => handleCopy(text, message.id)}
                              className="p-1 rounded hover:bg-black/10 text-xs opacity-50 hover:opacity-100"
                            >
                              {copiedId === message.id ? (
                                <Check size={12} />
                              ) : (
                                <ClipboardPaste size={12} />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>{t('ai.copyContent')}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => handleSaveAsNewFile(text)}
                              className="p-1 rounded hover:bg-black/10 text-xs opacity-50 hover:opacity-100"
                            >
                              <FilePlus size={12} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>{t('ai.saveAsNewFile')}</TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}
        {isLoading && (() => {
          const lastMsg = messages[messages.length - 1]
          return !lastMsg || lastMsg.role !== 'assistant' || !getMessageText(lastMsg)
        })() && (
          <div className="flex gap-3 mt-4">
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center shadow-md">
              <Bot size={14} />
            </div>
            <div className="max-w-[85%] p-3 rounded-lg bg-accent shadow-md">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-xs">{t('ai.thinking')}</span>
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="p-3 mt-2 rounded-lg bg-destructive/10 text-destructive text-xs">
            {error.message || t('ai.error')}
          </div>
        )}
        <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <div className="p-3 ">
        {aiAttachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {aiAttachedFiles.map((filePath, index) => {
              const fileName = filePath.split(/[\\/]/).pop() || filePath
              return (
                <span
                  key={filePath}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-xs text-primary max-w-[180px] truncate"
                  title={filePath}
                >
                  <span className="truncate">{fileName}</span>
                  <button
                    type="button"
                    onClick={() => removeAiAttachedFile(index)}
                    className="ml-0.5 p-0.5 rounded hover:bg-primary/20 text-muted-foreground hover:text-foreground"
                  >
                    <X size={10} />
                  </button>
                </span>
              )
            })}
          </div>
        )}
        <form onSubmit={onFormSubmit} className="relative rounded-lg border border-border overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
          <div className="w-full  pt-3">
            <textarea
              ref={textareaRef}
              className={cn("w-full px-3 text-xs min-h-[50px] max-h-[200px] resize-none outline-none bg-transparent", isOverflow ? "overflow-y-auto" : "overflow-y-hidden")}
              placeholder={isConfigured ? t('ai.placeholder') : t('ai.notConfigured')}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!isConfigured}
            />
          </div>
          <div className="w-full flex items-center justify-between px-2 py-1.5 rounded-b-lg" style={{ background: 'var(--bg-secondary)' }}>
            <div className="flex items-center gap-1">
              {isConfigured && (
                <Select value={activeRoleKey} onValueChange={setActiveRoleKey}>
                  <SelectTrigger className="h-6 w-auto border-0 bg-transparent shadow-none px-1 text-[11px] text-muted-foreground hover:text-foreground focus:ring-0 max-w-[100px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="min-w-[120px]">
                    {aiRolePrompts.map((role) => (
                      <SelectItem key={role.role_key} value={role.role_key} className="text-xs py-1 pl-7 pr-2">
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex items-center gap-1">
              {isLoading && (
                <button
                  type="button"
                  onClick={() => stop()}
                  className="p-1.5 rounded-md bg-destructive text-destructive-foreground hover:opacity-90"
                >
                  <Square size={12} />
                </button>
              )}
              <button
                type="submit"
                disabled={!isConfigured || !inputValue.trim() || isLoading}
                className="p-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90"
              >
                <Send size={12} />
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

export { AIView }
