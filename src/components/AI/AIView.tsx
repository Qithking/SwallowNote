/**
 * AIView Component - AI assistant panel
 * Note: AI functionality is not yet implemented
 */
import { useState, useRef, useEffect } from 'react'
import {
  Bot,
  Send,
  Loader2,
  Sparkles,
  Copy,
  Check,
  FileText,
  Globe,
  Settings,
  Wand2,
} from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

function AIView() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    // TODO: Implement actual AI integration
    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'This is a placeholder response. AI integration coming soon.',
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, assistantMessage])
      setIsLoading(false)
    }, 1000)
  }

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const quickActions = [
    { icon: Wand2, label: 'Complete', action: () => {} },
    { icon: FileText, label: 'Rewrite', action: () => {} },
    { icon: Globe, label: 'Fetch URL', action: () => {} },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center h-10 px-3 shrink-0 border-b" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
        <div className="flex items-center gap-2">
          <Bot size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>AI Assistant</span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto">
              <Settings size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>设置</TooltipContent>
        </Tooltip>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-3 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Sparkles size={32} className="mb-3 opacity-50" />
            <p className="text-sm text-center mb-4">
              Ask me anything about your code or content
            </p>
            <div className="flex items-center gap-2">
              {quickActions.map((action) => {
                const Icon = action.icon
                return (
                  <button
                    key={action.label}
                    onClick={action.action}
                    className="px-3 py-1.5 rounded-full bg-accent text-xs hover:bg-accent/80 flex items-center gap-1"
                  >
                    <Icon size={12} />
                    {action.label}
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'flex gap-3',
                message.role === 'user' && 'flex-row-reverse'
              )}
            >
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
                  message.role === 'user' ? 'bg-primary' : 'bg-accent'
                )}
              >
                {message.role === 'user' ? (
                  <span className="text-xs text-primary-foreground">You</span>
                ) : (
                  <Bot size={14} />
                )}
              </div>
              <div
                className={cn(
                  'flex-1 p-3 rounded-lg',
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-accent'
                )}
              >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                <div className="flex items-center justify-end mt-2">
                  <button
                    onClick={() => handleCopy(message.content, message.id)}
                    className="p-1 rounded hover:bg-black/10 text-xs opacity-50 hover:opacity-100"
                  >
                    {copiedId === message.id ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
              <Bot size={14} />
            </div>
            <div className="flex-1 p-3 rounded-lg bg-accent">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-sm">Thinking...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </ScrollArea>

      {/* Input */}
      <div className="p-3 border-t border-border">
        <div className="relative">
          <textarea
            ref={inputRef}
            className="w-full h-20 p-3 rounded-lg border border-border bg-background resize-none text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Ask AI anything..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="absolute bottom-3 right-3 p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

export { AIView }
