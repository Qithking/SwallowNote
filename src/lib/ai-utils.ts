/**
 * AIView 纯工具函数。
 * 从 src/components/AI/AIView.tsx 迁移，行为保持不变。
 */

export function getMessageText(message: { parts?: Array<{ type: string; text?: string }> }): string {
  if (!message.parts) return ''
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

export function formatTimeStr(timeStr: string): string {
  if (!timeStr) return ''
  const match = timeStr.match(/(\d{2}):(\d{2}):(\d{2})/)
  if (match) return `${match[1]}:${match[2]}:${match[3]}`
  return timeStr
}
