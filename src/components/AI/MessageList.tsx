/**
 * MessageList - AI 对话消息列表渲染组件。
 * 从 src/components/AI/AIView.tsx 迁移，行为保持不变。
 */
import { type RefObject, type MutableRefObject } from 'react'
import {
  Sparkles,
  Settings,
  Loader2,
  Bot,
} from 'lucide-react'
import type { UIMessage } from 'ai'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTranslation } from 'react-i18next'
import { getMessageText } from '@/lib/ai-utils'
import { MessageBubble } from './MessageBubble'

interface MessageListProps {
  isConfigured: boolean
  messages: UIMessage[]
  isLoadingHistory: boolean
  contextMenuDisplayTexts: MutableRefObject<Map<string, string>>
  messageTimestamps: Record<string, string>
  copiedId: string | null
  isLoading: boolean
  error: Error | undefined
  messagesEndRef: RefObject<HTMLDivElement | null>
  scrollAreaRef: (node: HTMLDivElement | null) => void
  handleCopy: (content: string, id: string) => void
  insertAtCursor: (text: string) => void
  replaceContent: (text: string) => void
  handleSaveAsNewFile: (content: string) => void
  openAiSettings: () => void
}

function MessageList({
  isConfigured,
  messages,
  isLoadingHistory,
  contextMenuDisplayTexts,
  messageTimestamps,
  copiedId,
  isLoading,
  error,
  messagesEndRef,
  scrollAreaRef,
  handleCopy,
  insertAtCursor,
  replaceContent,
  handleSaveAsNewFile,
  openAiSettings,
}: MessageListProps) {
  const { t } = useTranslation()

  return (
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
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              contextMenuDisplayTexts={contextMenuDisplayTexts}
              messageTimestamps={messageTimestamps}
              copiedId={copiedId}
              onCopy={handleCopy}
              onInsertAtCursor={insertAtCursor}
              onReplaceContent={replaceContent}
              onSaveAsNewFile={handleSaveAsNewFile}
            />
          ))}
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
  )
}

export { MessageList }
