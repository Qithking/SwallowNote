/**
 * MessageBubble — 单条消息气泡（对齐内置版 MessageBubble 的视觉）。
 * - user 右对齐：显示 metadata.displayText（角色动作展示文案）否则原文
 * - assistant 左对齐 MarkdownLite + 回写动作行（复制/插入到光标/整文替换/另存新文件，
 *   P2.5；操作经 props.actions 注入，反馈 toast 由 ChatPanel 统一处理）
 * - 流式占位：文本为空且 streaming 时显示「正在输入」点动画
 * - stopped / omitted / applied 元数据提示条
 */
import { useEffect, useRef, useState } from 'react'
import { Bot, Check, Copy, CornerDownRight, FilePlus2, Replace } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { UIMessage } from 'ai'
import { MarkdownLite } from './MarkdownLite'

export interface BubbleMeta {
  stopped?: boolean
  omitted?: number
  /** 就地应用标记（P2.5）：显示撤销按钮 */
  applied?: boolean
}

/**
 * 回写四操作（P2.5）：由 ChatPanel 注入（编辑器 API 调用与反馈提示内聚在面板层）。
 * undoApply 的 outputText 为该消息的 AI 输出文本——撤销前校验「当前选区 === 应用时
 * 写入的 AI 输出」防位置错位（§6.8；恢复值 selectionOriginal 由 ChatPanel 持有）。
 */
export interface BubbleActions {
  insertAtCursor: (text: string) => void
  replaceContent: (text: string) => void
  saveAsNewFile: (text: string) => void
  undoApply?: (outputText: string) => void
}

interface MessageBubbleProps {
  message: UIMessage
  meta?: BubbleMeta
  streaming?: boolean
  actions?: BubbleActions
  /** 是否可撤销就地应用（会话内最近一次 applied 消息，P2.5 简化：仅支持撤销最近一次） */
  canUndo?: boolean
}

interface UserMetadata {
  displayText?: string
}

function extractText(message: UIMessage): string {
  return message.parts
    .filter((p): p is Extract<UIMessage['parts'][number], { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
}

const rowStyle: CSSProperties = { display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-start' }
const avatarStyle: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  fontSize: 10,
}
const actionBtnStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: 2,
  color: 'var(--text-secondary, #6e6e73)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  fontSize: 11,
}

export function MessageBubble({ message, meta, streaming, actions, canUndo }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const text = extractText(message)
  const displayText = (message.metadata as UserMetadata | undefined)?.displayText
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ ...rowStyle, flexDirection: isUser ? 'row-reverse' : 'row' }}>
      <div
        style={{
          ...avatarStyle,
          background: isUser ? 'var(--accent-color, #0a84ff)' : 'rgba(128,128,128,0.2)',
          color: isUser ? '#fff' : 'var(--text-secondary, #6e6e73)',
        }}
      >
        {isUser ? '我' : <Bot size={13} />}
      </div>
      <div
        style={{
          padding: '8px 10px',
          borderRadius: 10,
          maxWidth: '85%',
          overflow: 'hidden',
          background: isUser ? 'var(--accent-color, #0a84ff)' : 'var(--bg-secondary, #f5f5f7)',
          color: isUser ? '#fff' : 'var(--text-primary, #1d1d1f)',
        }}
      >
        {isUser ? (
          <p style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {displayText ?? text}
          </p>
        ) : (
          <div style={{ minHeight: 18 }}>
            {text === '' && streaming ? (
              <TypingDots />
            ) : (
              <>
                <MarkdownLite content={text} />
                {(meta?.stopped || (meta?.omitted ?? 0) > 0) && <MetaHint meta={meta} />}
              </>
            )}
          </div>
        )}
        {!isUser && text !== '' && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            {canUndo && actions?.undoApply && (
              <button
                type="button"
                onClick={() => actions.undoApply?.(text)}
                title="撤销本次就地应用"
                style={actionBtnStyle}
              >
                <span>撤销应用</span>
              </button>
            )}
            {actions?.insertAtCursor && (
              <button type="button" onClick={() => actions.insertAtCursor(text)} title="插入到光标位置" style={actionBtnStyle}>
                <CornerDownRight size={12} />
                <span>插入</span>
              </button>
            )}
            {actions?.replaceContent && (
              <button type="button" onClick={() => actions.replaceContent(text)} title="替换整个文档内容" style={actionBtnStyle}>
                <Replace size={12} />
                <span>替换全文</span>
              </button>
            )}
            {actions?.saveAsNewFile && (
              <button type="button" onClick={() => actions.saveAsNewFile(text)} title="另存为新文件" style={actionBtnStyle}>
                <FilePlus2 size={12} />
                <span>另存</span>
              </button>
            )}
            <button type="button" onClick={handleCopy} title="复制内容" style={actionBtnStyle}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** stopped/omitted/applied 提示条 */
function MetaHint({ meta }: { meta?: BubbleMeta }) {
  const hints: string[] = []
  if (meta?.stopped) hints.push('已停止生成')
  if ((meta?.omitted ?? 0) > 0) hints.push(`上下文超限，已省略 ${meta?.omitted} 条早期消息`)
  return (
    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-secondary, #6e6e73)', fontStyle: 'italic' }}>
      {hints.join('；')}
    </div>
  )
}

/** 流式等待中的三点动画 */
function TypingDots() {
  const dot: CSSProperties = {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: 'var(--text-secondary, #6e6e73)',
    display: 'inline-block',
    marginRight: 3,
  }
  return (
    <div style={{ padding: '4px 0' }}>
      <span style={{ ...dot, animation: 'ai-blink 1.2s infinite' }} />
      <span style={{ ...dot, animation: 'ai-blink 1.2s infinite 0.2s' }} />
      <span style={{ ...dot, animation: 'ai-blink 1.2s infinite 0.4s' }} />
    </div>
  )
}
