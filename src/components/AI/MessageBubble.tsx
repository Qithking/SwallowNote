/**
 * MessageBubble - AI 对话单条消息渲染。
 * 从 src/components/AI/MessageList.tsx 抽取, 行为保持不变。
 */
import { type MutableRefObject } from 'react'
import {
  Bot,
  Check,
  ClipboardPaste,
  PenLine,
  Replace,
  FilePlus,
} from 'lucide-react'
import type { UIMessage } from 'ai'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { MarkdownRenderer } from './MarkdownRenderer'
import { getMessageText, formatTimeStr } from '@/lib/ai-utils'

interface MessageBubbleProps {
  message: UIMessage
  contextMenuDisplayTexts: MutableRefObject<Map<string, string>>
  messageTimestamps: Record<string, string>
  copiedId: string | null
  onCopy: (content: string, id: string) => void
  onInsertAtCursor: (text: string) => void
  onReplaceContent: (text: string) => void
  onSaveAsNewFile: (content: string) => void
}

function MessageBubble({
  message,
  contextMenuDisplayTexts,
  messageTimestamps,
  copiedId,
  onCopy,
  onInsertAtCursor,
  onReplaceContent,
  onSaveAsNewFile,
}: MessageBubbleProps) {
  const { t } = useTranslation()
  const text = getMessageText(message)
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
          <span className="text-xs text-foreground">{t('ai.you')}</span>
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
                    onClick={() => onCopy(text, message.id)}
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
                  onClick={() => onInsertAtCursor(text)}
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
                  onClick={() => onReplaceContent(text)}
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
                  onClick={() => onCopy(text, message.id)}
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
                  onClick={() => onSaveAsNewFile(text)}
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
}

export { MessageBubble }
