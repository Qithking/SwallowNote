import { useState, useRef, useEffect } from 'react'
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
} from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores'
import { getAiProxyUrl } from '@/lib/ai'
import { restartAiProxy } from '@/lib/tauri'

function getMessageText(message: { parts?: Array<{ type: string; text?: string }> }): string {
  if (!message.parts) return ''
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

function AIView() {
  const { t } = useTranslation()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { aiModels, activeAiModelId, aiPort, setSettingsPanelVisible, setActiveAiModel } = useUIStore()

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isConfigured && inputValue.trim()) {
        sendMessage({ text: inputValue.trim() })
        setInputValue('')
        setMessages((prev) => prev.length > 100 ? prev.slice(-100) : prev)
      }
    }
  }

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isConfigured || !inputValue.trim()) return
    sendMessage({ text: inputValue.trim() })
    setInputValue('')
    setMessages((prev) => prev.length > 100 ? prev.slice(-100) : prev)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center h-10 px-3 shrink-0 " style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
        <div className="flex items-center gap-2">
          <Bot size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('ai.title')}</span>
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

      <ScrollArea className="flex-1 p-3 space-y-4">
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
            <Sparkles size={32} className="mb-3 opacity-50" />
            <p className="text-sm text-center">
              {t('ai.askAnything')}
            </p>
          </div>
        ) : (
          messages.map((message) => {
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
          })
        )}
        {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex gap-3 mt-4">
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
              <Bot size={14} />
            </div>
            <div className="flex-1 p-3 rounded-lg bg-accent">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-sm">{t('ai.thinking')}</span>
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error.message || t('ai.error')}
          </div>
        )}
        <div ref={messagesEndRef} />
      </ScrollArea>

      <div className="p-3 ">
        <form onSubmit={onFormSubmit} className="relative">
          <textarea
            className="w-full h-24 p-3 rounded-lg border border-border bg-background resize-none text-sm focus:outline-none focus:ring-1 focus:ring-ring"
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
                <SelectContent>
                  {aiModels.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
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
