import { useState, useRef, useEffect, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import {
  Bot,
  Send,
  Loader2,
  Sparkles,
  Copy,
  Check,
  Settings,
  Square,
  X,
} from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores'
import { getAiProxyUrl } from '@/lib/ai'
import { restartAiProxy, saveAiMessage, loadAiMessages } from '@/lib/tauri'

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
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollViewportRef = useRef<HTMLDivElement | null>(null)
  const savedMessageIds = useRef<Set<string>>(new Set())
  const messageTimestamps = useRef<Map<string, string>>(new Map())
  const [oldestDbId, setOldestDbId] = useState<number | null>(null)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const historyLoadedRef = useRef(false)
  const { aiModels, activeAiModelId, aiPort, setSettingsPanelVisible, setActiveAiModel, aiAttachedFiles, removeAiAttachedFile } = useUIStore()

  const activeModel = aiModels.find((m) => m.id === activeAiModelId)
  const isConfigured = !!activeModel

  const chat = useChat({
    transport: new DefaultChatTransport({
      api: getAiProxyUrl(aiPort),
    }),
  })

  const { messages, status, stop, error, sendMessage, setMessages } = chat
  const isLoading = status === 'submitted' || status === 'streaming'

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    if (!activeAiModelId && aiModels.length > 0) {
      setActiveAiModel(aiModels[0].id)
    }
    if (activeAiModelId) {
      const model = aiModels.find((m) => m.id === activeAiModelId)
      if (model) {
        const apiKey = model._decryptedApiKey || ''
        restartAiProxy(model.provider, apiKey, model.baseUrl, model.model, aiPort).catch(console.error)
      }
    }
  }, [])

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
          dbMessages.forEach((msg) => {
            savedMessageIds.current.add(`db-${msg.id}`)
            messageTimestamps.current.set(`db-${msg.id}`, msg.created_at)
          })
          setOldestDbId(dbMessages[0].id)
          setHasMoreHistory(dbMessages.length >= 30)
        }
      } catch (e) {
        console.error('Failed to load AI chat history:', e)
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
        messageTimestamps.current.set(lastMsg.id, timeStr)
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
        dbMessages.forEach((msg) => {
          savedMessageIds.current.add(`db-${msg.id}`)
          messageTimestamps.current.set(`db-${msg.id}`, msg.created_at)
        })
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

  const persistAndSend = (text: string) => {
    sendMessage({ text })
    const now = new Date()
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    saveAiMessage('user', text, activeAiModelId || '').then(() => {
      const chatMsgId = chat.messages[chat.messages.length - 1]?.id
      if (chatMsgId) {
        savedMessageIds.current.add(chatMsgId)
        messageTimestamps.current.set(chatMsgId, timeStr)
      }
    }).catch(console.error)
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
    let text = inputValue.trim()
    if (aiAttachedFiles.length > 0) {
      text += '\n\n--- attached files ---\n' + aiAttachedFiles.join('\n')
    }
    persistAndSend(text)
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 ml-auto"
              onClick={() => setSettingsPanelVisible(true)}
            >
              <Settings size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.settings')}</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea ref={scrollAreaRef} className="flex-1 p-3 space-y-4">
        {!isConfigured ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Sparkles size={32} className="mb-3 opacity-50" />
            <p className="text-sm text-center mb-4">
              {t('ai.notConfigured')}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettingsPanelVisible(true)}
            >
              <Settings size={14} className="mr-1.5" />
              {t('ai.goToSettings')}
            </Button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Sparkles size={24} className="mb-3 opacity-50" />
            <p className="text-xs text-center">
              {t('ai.askAnything')}
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
              return (
                <div
                  key={message.id}
                  className={cn(
                    'flex gap-3 mt-4',
                    message.role === 'user' && 'flex-row-reverse'
                  )}
                >
                  <div
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
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
                      'flex-1 p-3 rounded-lg',
                      message.role === 'user'
                        ? 'bg-primary/15 text-foreground'
                        : 'bg-accent'
                    )}
                  >
                    <p className="text-xs whitespace-pre-wrap">{text}</p>
                    {message.role === 'user' && messageTimestamps.current.get(message.id) && (
                      <p className="text-[10px] text-muted-foreground mt-1 text-right">
                        {formatTimeStr(messageTimestamps.current.get(message.id)!)}
                      </p>
                    )}
                    {message.role === 'assistant' && text && (
                      <div className="flex items-center justify-end mt-2">
                        <button
                          onClick={() => handleCopy(text, message.id)}
                          className="p-1 rounded hover:bg-black/10 text-xs opacity-50 hover:opacity-100"
                        >
                          {copiedId === message.id ? (
                            <Check size={12} />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}
        {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex gap-3 mt-4">
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
              <Bot size={14} />
            </div>
            <div className="flex-1 p-3 rounded-lg bg-accent">
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
        <form onSubmit={onFormSubmit} className="relative">
          <textarea
            className="w-full h-24 p-3 rounded-lg border border-border bg-background resize-none text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={isConfigured ? t('ai.placeholder') : t('ai.notConfigured')}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!isConfigured}
          />
          <div className="absolute bottom-3 right-3 flex items-center gap-1">
            {isConfigured && (
              <Select value={activeAiModelId} onValueChange={handleModelChange}>
                <SelectTrigger className="h-7 w-auto border-0 bg-transparent shadow-none px-1 text-xs text-muted-foreground hover:text-foreground focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="min-w-[120px]">
                  {aiModels.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs py-1 pl-7 pr-2">
                      {m.name || m.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isLoading && (
              <button
                type="button"
                onClick={() => stop()}
                className="p-2 rounded-lg bg-destructive text-destructive-foreground hover:opacity-90"
              >
                <Square size={14} />
              </button>
            )}
            <button
              type="submit"
              disabled={!isConfigured || !inputValue.trim() || isLoading}
              className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90"
            >
              <Send size={14} />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export { AIView }
